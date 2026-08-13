#!/usr/bin/env bash
# 端到端冒烟测试。跑之前先 `npm run dev`，然后 `bash scripts/smoke-test.sh`。
# 默认打本地 8788，也可以 BASE=https://api.yourdomain.com bash scripts/smoke-test.sh
set -uo pipefail

BASE="${BASE:-http://localhost:8788}"
ADMIN_KEY="${ADMIN_KEY:-dev-admin-key-change-me}"
API="$BASE/v1/plugin"

# 打线上时，本机到 Cloudflare 的链路会偶发断（实测 10 次里掉 1 次，
# 表现是 curl 返回空串或 000）。裸 curl 的话，掉一次就冤枉一个断言失败，
# 更坑的是掉在「扣配额」这种写操作上会让后面一串数字对不上，看着像业务 bug。
# 统一套一层重试：函数名就叫 curl，脚本里上百处调用不用改一行，
# acurl 也会自动继承。command curl 绕开函数本身，不会递归。
#
# 两个坑一起踩过，别单独调其中一个：
#
# ① --retry-all-errors 不能去掉。本机掉包表现为传输中途连接被重置（curl 56），
#    而裸 --retry 只管超时和 5xx，**不管连接重置** —— 去掉它，GET 那批
#    就会零星返回空串，看着像接口坏了。
# ② -m 不能调小。curl 把「超时」也算可重试错误，超时重试打在慢的写接口上
#    会出真事：客户端一断开，Cloudflare 就把那个 Worker 请求取消掉，
#    **扣款已经落库、退款还没跑到**就没了，重试的第二遍又扣一笔。
#    实测 -m 45 时批量解析每轮都稳定漏一笔没退的扣款，完全像后端 bug。
#
# 所以：超时给足（普通调用根本到不了 120 秒，重试实际只在断连时发生），
# 真正慢又耗额度的接口另走下面的 slowcurl。
curl() { command curl --retry 3 --retry-delay 1 --retry-all-errors -m 120 "$@"; }

# 明确不重试的版本：给「慢 + 会写数据」的接口用。
# 这类调用宁可让它偶尔因为断网失败一次，也不能重试 —— 重试 = 重复扣费。
slowcurl() { command curl -m 180 "$@"; }

# 线上 /admin 挂了 Cloudflare Access：管理接口要带 service token 双头
#（deploy.sh 会从 .dev.vars 传进来；本地开发没挂 Access，空着即可）。
CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-}"
CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-}"
acurl() {
  if [[ -n "$CF_ACCESS_CLIENT_ID" ]]; then
    curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
         -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" "$@"
  else
    curl "$@"
  fi
}

pass=0; fail=0
check() { # check <名称> <实际> <期望包含>
  if [[ "$2" == *"$3"* ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1))
  else
    printf '  \033[31m✗\033[0m %s\n    期望包含: %s\n    实际: %s\n' "$1" "$3" "${2:0:300}"; fail=$((fail+1))
  fi
}

echo "== 基础 =="
check "健康检查"      "$(curl -s "$BASE/health")" '"ok":true'
check "地区字典"      "$(curl -s "$API/public/regions")" 'continentLabelCn'
check "未登录被拦"    "$(curl -s "$API/user/detail")" 'ERR_GLOBAL_SESSION_EXPIRED'
check "404 走业务码"  "$(curl -s "$API/not/exist")" 'ERR_GLOBAL_404'

echo "== 建用户 + 发 token =="
UID_JSON=$(acurl -s -X POST "$BASE/admin/users" -H "X-Admin-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' -d '{"username":"smoke-tester","planCode":"free"}')
check "创建用户" "$UID_JSON" '"code":"OK"'
USER_ID=$(echo "$UID_JSON" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

TOKEN_JSON=$(acurl -s -X POST "$BASE/admin/users/$USER_ID/token" -H "X-Admin-Key: $ADMIN_KEY")
TOKEN=$(echo "$TOKEN_JSON" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
check "签发 token" "$TOKEN_JSON" '"token"'

AUTH=(-H "Token: $TOKEN" -H "X-Version: 2.1.3" -H "lang: zh-CN")

echo "== 登录闭环 =="
CODE_JSON=$(curl -s -X POST "$API/public/login-code" -H "X-Admin-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$USER_ID\"}")
LOGIN_CODE=$(echo "$CODE_JSON" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p' | tail -1)
EXCHANGED=$(curl -s -X POST "$API/public/token/exchange?token=$LOGIN_CODE")
check "一次性码换 token" "$EXCHANGED" '"code":"OK"'
# 2026-08-07 起兑换不再严格一次性：登录页会把同一个码每 400ms 兜底重发，
# 重复兑换必须返回**同一个** token（否则慢网络下并发兑换互相踩 → 同步卡死）。
FIRST_TOKEN=$(echo "$EXCHANGED" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')
check "重复兑换返回同一 token" "$(curl -s -X POST "$API/public/token/exchange?token=$LOGIN_CODE")" "$FIRST_TOKEN"
check "假码被拒" "$(curl -s -X POST "$API/public/token/exchange?token=deadbeef00")" 'ERR_UNAUTHORIZED'

echo "== 用户与会员 =="
DETAIL=$(curl -s "${AUTH[@]}" "$API/user/detail")
check "user/detail"      "$DETAIL" '"planCode":"free"'
check "免费用户 LV=F"    "$DETAIL" '"LV":"F"'

echo "== 配额 =="
# 数字对照 kolsprite.com/price（migrations/0005_billing.sql）：
# 免费档 导出 0 / 批量下载 10 / 脚本 50 / 东南亚 20 / 相似达人 1 每天 / 点数 0
check "全部配额"    "$(curl -s "${AUTH[@]}" "$API/quota/new")" 'VideoBatchDownload'
check "免费版导出为 0" "$(curl -s "${AUTH[@]}" "$API/quota/new/ExcelExport")" '"available":0'
check "单项配额"    "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoBatchDownload")" '"available":10'
ACQ=$(curl -s -X POST "${AUTH[@]}" "$API/quota/acquire/VideoBatchDownload/3")
REC_ID=$(echo "$ACQ" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')
check "预扣 3 次"   "$ACQ" '"code":"OK"'
check "扣后剩 7"    "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoBatchDownload")" '"available":7'
check "退还"        "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                      -d "{\"id\":\"$REC_ID\"}" "$API/quota/release")" '"data":true'
check "退还后回到 10" "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoBatchDownload")" '"available":10'
check "超额被拒"    "$(curl -s -X POST "${AUTH[@]}" "$API/quota/acquire/VideoBatchDownload/999")" 'ERR_QUOTA_EXHAUSTED'
# 免费版点数池是 0，VideoReview 又没有独立次数，所以应该完全用不了 ——
# 这和前端「免费版直接禁用 AI 看懂评论区」的判断是一致的
check "点数池存在"      "$(curl -s "${AUTH[@]}" "$API/quota/new")" '"Points"'
check "免费版点数为 0"  "$(curl -s "${AUTH[@]}" "$API/quota/new/Points")" '"total":0'
check "免费版评论分析不可用" "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoReview")" '"available":0'

echo "== 服务端硬拦截（免费档）=="
# 这几条是防「安慰剂」的核心：绕过前端直连接口也必须被拦
check "专家模式被拦" "$(curl -s -X POST "${AUTH[@]}" \
  -F "file=@/dev/null;filename=audio.wav" -F creatorId=smoke -F videoId=sv1 -F channel=M \
  "$API/caption/file")" '专家模式'
check "评论分析直连被拦" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"videoId":"sv9","reviewItemList":[{"content":"nice"}]}' \
  "$API/video/review/analysis")" '升级套餐'
# 东南亚批量：扣的次数必须等于「实际解出条数」折算出来的，解不出来的那部分要退回去
#（video.ts 里那段「按实际解出条数结算」）。
#
# ⚠️ 别写成「解析必失败 -> 额度原样不动」。上游 tikwm 是通是断看天：
# 断的时候解出 0 条该全退，通的时候解出 20 条就该实扣 10 次，两种都对。
# 写死「不动」的话，上游一恢复这条断言就红，红的还是测试不是产品。
# 这里断言的是不变式：扣掉的次数 == ceil(解出条数 / 2)，跟上游通不通无关。
#
# 也别再写成「打一批就该 ERR_QUOTA_EXHAUSTED」：计费是每 2 条算 1 次、
# 单次最多 30 条（= 15 次），免费档 20 次/月，一次调用本来就撑不爆。
BATCH_IDS='{"awemeIds":["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"]}'
used_of() { echo "$1" | sed -n 's/.*"used":\([0-9]*\).*/\1/p'; }
SEA_BEFORE=$(used_of "$(curl -s "${AUTH[@]}" "$API/quota/new/SeaProductVideo")")
# 用 slowcurl：20 条 × 并发 2 × 每条 2~13 秒，跑满两分钟很正常，
# 而且它会扣费，绝不能重试。
SEA_RESP=$(slowcurl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d "$BATCH_IDS" \
  "$API/video/batch_fetch_video_data")
SEA_AFTER=$(used_of "$(curl -s "${AUTH[@]}" "$API/quota/new/SeaProductVideo")")
# 解出几条 = 返回数组里 awemeId 出现几次
SEA_GOT=$(grep -o '"awemeId"' <<<"$SEA_RESP" | wc -l | tr -d ' ')
check "东南亚批量按实际解出条数结算" \
  "实扣 $((SEA_AFTER - SEA_BEFORE)) 次（解出 $SEA_GOT 条）" \
  "实扣 $(( (SEA_GOT + 1) / 2 )) 次"

echo "== 激活码 =="
GEN=$(acurl -s -X POST "$BASE/admin/activation/generate" -H "X-Admin-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"planCode":"pro_month","durationDays":31,"count":2,"batch":"SMOKE"}')
check "批量发码" "$GEN" '"count":2'
ACODE=$(echo "$GEN" | sed -n 's/.*"codes":\["\([^"]*\)".*/\1/p')
check "校验码有效"  "$(curl -s "$API/activation/check?code=$ACODE")" '"valid":true'
check "核销"        "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                      -d "{\"code\":\"$ACODE\"}" "$API/activation/redeem")" '"activated":true'
check "核销后升级为 V" "$(curl -s "${AUTH[@]}" "$API/user/detail")" '"LV":"V"'
check "专业版配额变大" "$(curl -s "${AUTH[@]}" "$API/quota/new/ExcelExport")" '"available":4000'
check "同码不能重复用" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                      -d "{\"code\":\"$ACODE\"}" "$API/activation/redeem")" '已经使用过'
check "激活记录"     "$(curl -s "${AUTH[@]}" "$API/activation/records")" 'pro_month'

echo "== 通用积分池 =="
# 专业版 3000 点，评论分析单次 20 点 -> 150 次 —— 和定价页「Max 150 / month」闭环
check "专业版点数 3000"      "$(curl -s "${AUTH[@]}" "$API/quota/new/Points")" '"total":3000'
check "评论分析换算 150 次"  "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoReview")" '"available":150'
PACQ=$(curl -s -X POST "${AUTH[@]}" "$API/quota/acquire/VideoReview/2")
PREC=$(echo "$PACQ" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')
check "扣 2 次评论分析"      "$PACQ" '"code":"OK"'
check "点数池同步扣 40"      "$(curl -s "${AUTH[@]}" "$API/quota/new/Points")" '"used":40'
check "评论分析剩 148 次"    "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoReview")" '"available":148'
check "退还后点数复原"       "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                             -d "{\"id\":\"$PREC\"}" "$API/quota/release")" '"data":true'
check "点数回到 3000"        "$(curl -s "${AUTH[@]}" "$API/quota/new/Points")" '"used":0'
# 功能自己的次数用完后会继续吃点数：专业版 VideoScript 3000 次 + 3000/10=300 次 = 3300
check "点数补足功能次数"     "$(curl -s "${AUTH[@]}" "$API/quota/new/VideoScript")" '"available":3300'

echo "== 支付 =="
check "支付商品状态可查" "$(curl -s "$BASE/pay/items")" '"configured":'
check "定价页可访问"     "$(curl -s "$BASE/price?lang=en-US")" 'Choose Your Plan'
check "回跳页可访问"     "$(curl -s "$BASE/pay/success?order=x")" 'pay-card'
check "坏签名 webhook 被拒" "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'creem-signature: deadbeef' -d '{}' "$BASE/webhooks/creem")" '401'

echo "== 收藏夹 =="
FOLDER=$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"name":"测试夹","type":"VIDEO"}' "$API/collection/folder")
FID=$(echo "$FOLDER" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
check "建收藏夹" "$FOLDER" '"code":"OK"'
check "列收藏夹" "$(curl -s "${AUTH[@]}" "$API/collection/folder/VIDEO")" '测试夹'
check "加收藏"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "{\"ids\":[\"7123\"],\"type\":\"VIDEO\",\"uniqueId\":\"someone\",\"folders\":[\"$FID\"]}" \
                   "$API/collection/add")" '"added":1'
check "取消收藏" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d '{"ids":["7123"],"type":"VIDEO"}' "$API/collection/remove")" '"data":true'
check "重命名"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "{\"id\":\"$FID\",\"newName\":\"改名了\",\"type\":\"VIDEO\"}" \
                   "$API/collection/folder/rename")" '"data":true'
check "删收藏夹" "$(curl -s -X DELETE "${AUTH[@]}" "$API/collection/folder/$FID")" '"data":true'

echo "== 推广计划 =="
PLAN=$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"name":"618 计划"}' "$API/promotion/add")
PID=$(echo "$PLAN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
check "建计划"   "$PLAN" '"code":"OK"'
check "计划列表" "$(curl -s "${AUTH[@]}" "$API/promotion/down/list")" '618 计划'
check "加达人"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "{\"promotionPlanIdList\":[\"$PID\"],\"creatorList\":[{\"creatorId\":\"c1\",\"region\":\"US\"}]}" \
                   "$API/promotion/add/creator")" '"added":1'
check "忽略达人" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "{\"promotionPlanId\":\"$PID\",\"creatorList\":[{\"creatorId\":\"c2\",\"handleName\":\"h2\",\"region\":\"US\"}]}" \
                   "$API/promotion/ignore/creator")" '"data":true'
check "移除达人" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "{\"promotionPlanId\":\"$PID\",\"authorIdList\":[\"c1\"]}" \
                   "$API/promotion/delete/creator")" '"data":true'
check "删计划(裸数组)" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
                   -d "[\"$PID\"]" "$API/promotion/delete")" '"data":true'

echo "== 字幕 =="
# videoId 每次跑都唯一：captions 是按 videoId 全局共享的，
# 固定 id 会撞上历史数据/别的测试灌的数据，分享详情就读串了
SVID="sm$(date +%s)$RANDOM"
# JSON 体用单引号拼接，不要在 "$( )" 里写 \" —— macOS 自带的 bash 3.2
# 解析嵌套转义引号有 bug，会把整个 -d 拆碎成多次请求
SVID_BODY='{"creatorId":"tester","videoId":"'$SVID'","wordList":[{"start_time":0,"end_time":1200,"text":"hello"}]}'
check "上传字幕" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "$SVID_BODY" "$API/caption/upload")" '"data":true'
check "读字幕(公开)" "$(curl -s "$API/caption/cdn/tester/$SVID.json")" 'hello'
SHARE=$(curl -s "${AUTH[@]}" "$API/caption/share/$SVID?region=US")
SCODE=$(echo "$SHARE" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')
check "生成分享码"  "$SHARE" '"code":"OK"'
check "分享码可读"  "$(curl -s "$API/caption/share/detail/$SCODE")" 'hello'

echo "== 达人相似度 / 上传票据 =="
STS=$(curl -s -X POST "${AUTH[@]}" "$API/creator/sts")
TICKET=$(echo "$STS" | sed -n 's/.*"ticket":"\([^"]*\)".*/\1/p')
check "取上传票据" "$STS" '"uploadUrl"'
check "直传封面"   "$(curl -s -X PUT --data-binary 'fake-jpeg' \
                     "$API/creator/upload?ticket=$TICKET&key=v1.jpg")" 'similarity/'
SIM=$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"userId":"123","handleName":"someone","region":"US","videoList":[],"ignore":0}' \
  "$API/creator/similarity/async")
check "提交相似任务" "$SIM" '"code":"OK"'
TASK=$(echo "$SIM" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')
# 轮询接口：达人库空的时候任务还在跑（data:null），库里有货时可能已经算完并返回数组。
# 两种都算正常 —— 这条要守的是「轮询能正常应答」，而不是某一个瞬时状态：
# 返 ERR_GLOBAL_SESSION_EXPIRED（被鉴权误伤）或 500 才是真出事，
# 那会让前端 5 秒一次无限轮下去。
check "轮询接口正常应答" "$(curl -s "${AUTH[@]}" "$API/creator/similarity/task?taskId=$TASK")" '"code":"OK"'

echo "== 合作分析缓存 =="
check "写缓存" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"creatorId":"c9","region":"US","jsonObject":{"latestCreateTime":123,"advice":"default"}}' \
  "$API/cooperate/analysis/info")" '"data":true'
check "读缓存" "$(curl -s "${AUTH[@]}" "$API/cooperate/analysis/c9?region=US")" 'latestCreateTime'

echo "== 数据回流（静默）=="
check "video/analysis" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '[{"videoId":"v9","creatorId":"c9","region":"US","title":"t","pubTime":1,"playCnt":2,"likeCnt":3,"commentCnt":4,"collectCnt":5,"forwardCnt":6,"tkCategory":"1"}]' \
  "$API/video/analysis")" '"code":"OK"'
check "creator/save"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"user":{"id":"c9","uniqueId":"someone","nickname":"N","region":"US"},"stats":{"followerCount":5000}}' \
  "$API/creator/save")" '"code":"OK"'
check "product 回流"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '[{"product_id":"p1","title":"商品","price":"12.30"}]' \
  "$API/product/data/via-list?region=US")" '"code":"OK"'
check "商品价格查询"   "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '["p1"]' "$API/product/US/list")" '"price":12.3'
check "GPM"            "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '["c9"]' "$API/product/US/gpm")" '"gpm":0'
check "错误上报"       "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"error":"boom","stack":"...","userid":"x"}' "$API/message/send")" '"data":true'

echo "== AI / 直链 =="
# AI_PROVIDER=workers-ai 时，本地 wrangler dev 需要先 `wrangler login` 才能调 Workers AI，
# 没登录会返回 ERR_INTERNAL。这里只验证路由通、信封格式对；
# AI 输出的真实效果要部署后或登录后才能验。
check "copy-script 路由通" "$(curl -s -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"caption":"t","subtitle":"00:00 --> 00:01\nhi","outputLanguage":"zh-CN"}' \
  "$API/copy-script/highlights")" '"code":'
check "视频直链降级为空" "$(curl -s "${AUTH[@]}" "$API/video/fetch_video_data?awemeId=1")" '"hdUrls":[]'

echo "== 评论分析结果必须公开可读 =="
# 前端拿到 resultUrl 后是**不带 Token** 直接 fetch 的（index.html3.js:42247）。
# 这条路由要是被 requireAuth 罩住，整个「AI 看懂评论区」会静默转圈。
# 这里用一个不存在的 taskId：期望是「结果不存在」，而不是「登录已过期」。
RES_PUBLIC=$(curl -s "$API/video/review/result/no-such-task.json")
check "结果接口不要求登录" "$RES_PUBLIC" 'ERR_NOT_FOUND'

echo "== Excel 导出 =="
XLSX=$(curl -s -o /tmp/kolsprite-smoke.xlsx -w '%{content_type}' -X POST "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"videoInfo":{"videoId":"v1","title":"标题"},"analysisData":{"summary":"总结","pain_points":{"note":"n","items":[{"point":"贵","mentions":3,"evidence":[{"original":"too expensive","translation":"太贵了"}]}]}},"commentList":[{"reviewId":"r1","content":"nice","likeCnt":2}]}' \
  "$API/video/review/excel")
check "xlsx content-type" "$XLSX" 'spreadsheetml'
check "xlsx 是合法 zip"   "$(head -c 2 /tmp/kolsprite-smoke.xlsx)" 'PK'

echo "== 官网页面（SSR，未登录也要出框架不能 500）=="
# 这些页面登录后才有数据，但未登录必须渲染出框架 + 登录引导。
# 只断言页面骨架关键字，不断言业务数据 —— 冒烟是查「有没有崩」，不是查内容。
for path in \
  kol/workbench kol/search kol/video-search kol/product-search \
  kol/kol-rank kol/video-rank kol/product-rank \
  kol/shop-search kol/shop-rank kol/shop-detail/123 \
  kol/collect kol/promotional kol/cooperate kol/cooperateactive \
  kol/task kol/risk kol/message-center kol/calendar kol/guide \
  kol/mail kol/create-mail kol/draft-mail kol/send-mail kol/temp kol/import \
  tools/video-download tools/script-analysis tools/hashtag-generator price
do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$path")
  check "GET /$path" "$CODE" '200'
done

# /kol/personal 是这批里唯一的例外：它没有「未登录骨架」，整页都是个人数据，
# 所以未登录直接 302 去登录页（site-kol.ts 的路由里刻意这么写的）。
# 以前它被混在上面那串里断言 200，是测试写错了，不是页面坏了。
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/kol/personal")
check "GET /kol/personal 未登录跳登录页" "$CODE" '302'

# 榜单四个 tab：涨粉榜依赖 creator_snapshots，表没建会 500
for t in fansCnt fansLst30d videoAvgPlay interactionRate; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/kol/kol-rank?type=$t")
  check "达人榜 $t" "$CODE" '200'
done

# 详情页：不存在的 id 要走「没找到」空态，不能 500
check "商品详情空态" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/kol/product-detail/no-such-id")" '200'

echo "== 官网 JSON API 未登录必须被拦 =="
# 这些接口会花钱（发信/建任务）或写用户数据，未登录一律拒绝。
for ep in \
  kol/api/task/similar kol/api/mail/account kol/api/mail/send \
  kol/api/mail/campaign kol/api/mail/contacts/import kol/api/inbox/read
do
  BODY=$(curl -s -X POST "$BASE/$ep" -H 'Content-Type: application/json' -d '{}')
  check "未登录拦截 /$ep" "$BODY" 'ERR_'
done

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[32m全部通过\033[0m  %d 项\n' "$pass"
else
  printf '\033[31m%d 项失败\033[0m，%d 项通过\n' "$fail" "$pass"
  exit 1
fi
