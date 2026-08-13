-- AI TikTok Video Downloader Pro 插件后台 —— D1 建表脚本
-- 对应原后台 www.kolsprite.com/v1/plugin 的全部业务（原产品名 达人精灵/KOLSprite，仅此处保留以便对照源码）
-- 执行：npm run db:init:remote

-- ---------------------------------------------------------------------------
-- 1. 套餐与用户
-- ---------------------------------------------------------------------------

-- 套餐定义。planCode 是给扩展看的：
--   含 "plus"                       -> LV = "P"（个人版）
--   含 "pro" 或等于 "standard"      -> LV = "V"（专业版）
--   其它（含 free）                  -> LV = "F"（免费版）
-- 这套映射写死在扩展 hosts.js 里，改 planCode 命名会直接影响前端显示。
CREATE TABLE IF NOT EXISTS plans (
  code          TEXT PRIMARY KEY,           -- free / plus_monthly / pro_yearly / standard ...
  name          TEXT NOT NULL,              -- 展示名，对应 userProfile.planName
  level         TEXT NOT NULL,              -- F / P / V，冗余存一份，避免前后端算法不一致
  price_cents   INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 0, -- 0 表示永久（免费版）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- uuid，对应 userProfile.id
  username      TEXT NOT NULL,              -- 对应 userProfile.username
  email         TEXT UNIQUE,
  phone         TEXT UNIQUE,
  head_url      TEXT,                       -- 对应 userProfile.headUrl
  plan_code     TEXT NOT NULL DEFAULT 'free' REFERENCES plans(code),
  plan_expire_at INTEGER,                   -- 到期时间戳（秒）；NULL = 不过期
  status        TEXT NOT NULL DEFAULT 'active',  -- active / disabled
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan_code);

-- 长期 token。扩展把它存在 chrome.storage.local 里，每个请求走 Token 头。
CREATE TABLE IF NOT EXISTS user_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      TEXT,                          -- X-Version / UA 摘要，便于排查
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON user_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_exp ON user_tokens(expires_at);

-- ---------------------------------------------------------------------------
-- 2. 激活码（新增能力，原后台没有）
-- ---------------------------------------------------------------------------
-- 原扩展只能跳官网付费开会员。这里加一套激活码，方便离线发卡 / 代理商分销。
CREATE TABLE IF NOT EXISTS activation_codes (
  code          TEXT PRIMARY KEY,           -- 建议 XXXX-XXXX-XXXX-XXXX
  plan_code     TEXT NOT NULL REFERENCES plans(code),
  duration_days INTEGER NOT NULL,           -- 激活后会员时长
  batch         TEXT,                       -- 批次号，便于统计和作废
  note          TEXT,
  max_uses      INTEGER NOT NULL DEFAULT 1, -- >1 就是多人可用的通用码
  used_count    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'unused', -- unused / used / disabled / expired
  expire_at     INTEGER,                    -- 码本身的有效期（不是会员时长）
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_codes_batch ON activation_codes(batch);
CREATE INDEX IF NOT EXISTS idx_codes_status ON activation_codes(status);

CREATE TABLE IF NOT EXISTS activation_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL REFERENCES activation_codes(code),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code   TEXT NOT NULL,
  days        INTEGER NOT NULL,
  expire_before INTEGER,                    -- 激活前的到期时间，便于回滚
  expire_after  INTEGER NOT NULL,
  ip          TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_act_code_user ON activation_records(code, user_id);
CREATE INDEX IF NOT EXISTS idx_act_user ON activation_records(user_id);

-- ---------------------------------------------------------------------------
-- 3. 配额体系
-- ---------------------------------------------------------------------------
-- 配额是**两层**结构：每个功能有自己的月度次数，另外还有一个全局共享的
-- 「通用精灵点数」池。功能次数用完后，可以按 points 折算继续消耗点数。
-- 前端显示的 available = 功能剩余次数 + floor(点数余额 / points)。
--
-- quota_type 全集（前 6 个是功能，Points 是点数池）：
--   ExcelExport         导出 Excel
--   VideoBatchDownload  批量下载视频
--   VideoScript         AI 视频脚本 / 字幕
--   SeaProductVideo     东南亚带货视频直链
--   FindKol             相似达人搜索
--   VideoReview         AI 看懂评论区
--   Points              通用精灵点数（i18n: permission_points）
CREATE TABLE IF NOT EXISTS quota_rules (
  plan_code   TEXT NOT NULL REFERENCES plans(code),
  quota_type  TEXT NOT NULL,
  total       INTEGER NOT NULL,             -- 每个周期的总量；Points 行是每月发多少点
  period      TEXT NOT NULL DEFAULT 'month',-- month / day / forever
  points      INTEGER NOT NULL DEFAULT 1,   -- 单次消耗多少点，前端 quota-detail 会显示
  PRIMARY KEY (plan_code, quota_type)
);

-- 当前周期的用量。period_key 形如 2026-08（月）或 2026-08-02（日）。
CREATE TABLE IF NOT EXISTS quota_usage (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_type  TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  extra       INTEGER NOT NULL DEFAULT 0,   -- 加油包额外赠送的额度
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, quota_type, period_key)
);

-- 预扣记录。前端流程是 acquire -> 干活 -> 失败则 release，
-- 所以必须能按 id 把预扣的量还回去。
CREATE TABLE IF NOT EXISTS quota_records (
  id          TEXT PRIMARY KEY,             -- uuid，就是 acquire 接口返回的 data
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_type  TEXT NOT NULL,
  amount      INTEGER NOT NULL,             -- 本次占用几次
  period_key  TEXT NOT NULL,
  -- 一次预扣可能同时动了功能次数和点数池，两边各扣多少必须记下来，
  -- 否则 release 的时候退不回去
  points_spent      INTEGER NOT NULL DEFAULT 0,
  points_period_key TEXT,
  status      TEXT NOT NULL DEFAULT 'held', -- held / committed / released
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  settled_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_qr_user ON quota_records(user_id, quota_type);
CREATE INDEX IF NOT EXISTS idx_qr_status ON quota_records(status, created_at);

-- ---------------------------------------------------------------------------
-- 4. 收藏夹
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_folders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'video', -- video / creator
  region      TEXT,
  item_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON collection_folders(user_id, type);

CREATE TABLE IF NOT EXISTS collection_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id   TEXT NOT NULL REFERENCES collection_folders(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL,                -- video / creator
  item_id     TEXT NOT NULL,                -- videoId 或 creatorId
  region      TEXT,
  payload     TEXT,                         -- 原始 JSON 快照，前端列表直接用
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_uniq ON collection_items(folder_id, item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_items_user ON collection_items(user_id, item_type);

-- ---------------------------------------------------------------------------
-- 5. 产品推广计划（sidepanel 的 promotion 系列接口）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  region      TEXT,
  product_id  TEXT,
  product_url TEXT,
  cover       TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_promo_user ON promotions(user_id);

CREATE TABLE IF NOT EXISTS promotion_creators (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id   TEXT NOT NULL,               -- TikTok uniqueId
  status       TEXT NOT NULL DEFAULT 'collected', -- collected / ignored / contacted
  payload      TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_uniq ON promotion_creators(promotion_id, creator_id);

-- ---------------------------------------------------------------------------
-- 6. 字幕 / 视频脚本
-- ---------------------------------------------------------------------------
-- 原后台把成品字幕放在 o.kolsprite.com/caption/{creatorId}/{videoId}.json，
-- 这里换成 R2，key 规则保持一致：caption/{creatorId}/{videoId}[-high].json
CREATE TABLE IF NOT EXISTS captions (
  creator_id  TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'F',    -- F=快速模式  M=专家模式（对应 -high 后缀）
  r2_key      TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'asr',  -- asr / tiktok_vtt / user_upload
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (creator_id, video_id, channel)
);

-- 脚本分享短码，对应 /caption/share/{videoId} 与官网 script-editor/share 页
CREATE TABLE IF NOT EXISTS caption_shares (
  share_code  TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  creator_id  TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  region      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_share_video ON caption_shares(video_id);

-- ---------------------------------------------------------------------------
-- 7. 异步任务（相似达人搜索、AI 看懂评论区）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS async_tasks (
  task_id     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                -- creator_similarity / video_review
  status      TEXT NOT NULL DEFAULT 'pending', -- pending / running / success / failed
  input       TEXT,                         -- 请求参数 JSON
  result      TEXT,                         -- 结果 JSON
  error       TEXT,
  creator_id  TEXT,
  video_id    TEXT,
  quota_record_id TEXT,                     -- 失败时按这个 id 退还配额
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_task_user ON async_tasks(user_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_task_video ON async_tasks(creator_id, video_id);

-- ---------------------------------------------------------------------------
-- 8. 视频 / 达人数据沉淀（原 plugin-data.kolsprite.com 那一组上报接口）
-- ---------------------------------------------------------------------------
-- 这些接口全是 hide:true 的静默上报，扩展不看返回值。
-- 如果你不做数据业务，可以只建表不读，或者直接让接口返回 OK 丢弃数据。
CREATE TABLE IF NOT EXISTS tk_videos (
  video_id    TEXT PRIMARY KEY,
  creator_id  TEXT,
  region      TEXT,
  title       TEXT,
  pub_time    INTEGER,
  play_cnt    INTEGER,
  like_cnt    INTEGER,
  comment_cnt INTEGER,
  collect_cnt INTEGER,
  forward_cnt INTEGER,
  tk_category TEXT,
  payload     TEXT,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tkv_creator ON tk_videos(creator_id);

CREATE TABLE IF NOT EXISTS tk_creators (
  creator_id     TEXT PRIMARY KEY,
  unique_id      TEXT,
  nickname       TEXT,
  region         TEXT,
  follower_count INTEGER,
  payload        TEXT,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tkc_unique ON tk_creators(unique_id);

CREATE TABLE IF NOT EXISTS tk_products (
  product_id  TEXT NOT NULL,
  region      TEXT NOT NULL,
  title       TEXT,
  price       TEXT,
  sold_count  INTEGER,
  payload     TEXT,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (product_id, region)
);

CREATE TABLE IF NOT EXISTS tk_video_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT NOT NULL,
  creator_id TEXT,
  region     TEXT,
  tag        TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tag_video ON tk_video_tags(video_id);

CREATE TABLE IF NOT EXISTS tk_effects (
  effect_id  TEXT PRIMARY KEY,
  name       TEXT,
  payload    TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- 9. 反馈留言（/message/send）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT,
  content    TEXT NOT NULL,
  contact    TEXT,
  extra      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- 10. 地区字典（/public/regions）
-- ---------------------------------------------------------------------------
-- 前端拿到的是按大洲分组的结构，且按业务类型分桶（目前只用到 "creator"）：
--   data.creator = [{ continentLabelCn, continentLabelEn, regions: [{code,name,labelCn}] }]
-- 国旗图标走 {PUBLIC_SITE_URL}/img/allcountry/{code}.svg，记得把这批 svg 传上去。
CREATE TABLE IF NOT EXISTS regions (
  code           TEXT PRIMARY KEY,          -- US / GB / ID ...
  name_en        TEXT NOT NULL,             -- 对应前端的 name
  name_zh        TEXT,                      -- 对应前端的 labelCn
  continent_en   TEXT NOT NULL,             -- 对应 continentLabelEn
  continent_zh   TEXT NOT NULL,             -- 对应 continentLabelCn
  biz_type       TEXT NOT NULL DEFAULT 'creator', -- 分桶键，前端默认取 creator
  enabled        INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_regions_biz ON regions(biz_type, sort_order);
