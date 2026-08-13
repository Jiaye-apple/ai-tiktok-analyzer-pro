#!/usr/bin/env node
/**
 * 路由覆盖检查：把扩展会调用的**每一个** URL 都打一遍，确认后端都有对应路由。
 *
 * 光看代码容易漏，比如路径参数顺序反了、少了一层前缀、GET 写成了 POST，
 * 这些都只会在用户点到那个功能时才暴露。这个脚本把它们提前打出来。
 *
 * 判定标准只有一条：**不能返回 ERR_GLOBAL_404**。
 * 业务错误（参数不对、配额不足、AI 没配）都算通过 —— 说明路由是通的。
 *
 * 用法：先 npm run dev，然后
 *   node scripts/route-coverage.mjs
 */

const BASE = process.env.BASE || 'http://localhost:8788';
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-admin-key-change-me';
const API = `${BASE}/v1/plugin`;

/**
 * 复刻扩展 hosts.js:55630-55640 的 URL 拼接规则，确保这里算出的地址
 * 和扩展实际发出去的完全一致。
 */
function resolve(path, apiBase, apiOrigin) {
  if (path.startsWith('http')) return path;
  if (path.startsWith('/v1/plugin')) return apiOrigin + path;
  return apiBase + path;
}

async function main() {
  // 准备一个有 token 的用户
  const created = await (
    await fetch(`${BASE}/admin/users`, {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'route-coverage' }),
    })
  ).json();
  if (created.code !== 'OK') {
    console.error('建用户失败，检查 ADMIN_KEY 和 dev server：', created);
    process.exit(1);
  }
  const userId = created.data.id;
  const { data } = await (
    await fetch(`${BASE}/admin/users/${userId}/token`, {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY },
    })
  ).json();
  const TOKEN = data.token;

  // 扩展会调用的全部端点。path 一列写的是**扩展源码里传给请求函数的原始值**，
  // 好和 docs/API-INVENTORY.md 逐条对得上。
  const endpoints = [
    // --- 认证 / 公共 ---
    ['POST', '/public/token/exchange?token=dummy', null],
    ['GET', '/user/detail', null],
    ['GET', '/public/regions', null],

    // --- 配额 ---
    ['GET', '/quota/new', null],
    ['GET', '/quota/new/ExcelExport', null],
    ['POST', '/quota/acquire/ExcelExport/1', null],
    ['POST', '/quota/release', { id: 'x' }],

    // --- 收藏夹 ---
    ['POST', '/collection/add', { ids: ['1'], type: 'VIDEO' }],
    ['POST', '/collection/remove', { ids: ['1'], type: 'VIDEO' }],
    ['GET', '/collection/folder/VIDEO', null],
    ['POST', '/collection/folder', { name: 'x', type: 'VIDEO' }],
    ['DELETE', '/collection/folder/does-not-exist', null],
    ['POST', '/collection/folder/rename', { id: 'x', newName: 'y', type: 'VIDEO' }],
    ['GET', '/collection/someone/region', null],

    // --- 视频 ---
    ['GET', '/video/fetch_video_data?awemeId=1', null],
    ['POST', '/video/batch_fetch_video_data', { awemeIds: ['1'] }],
    ['POST', '/video/save', { itemInfo: { itemStruct: { id: '1' } } }],

    // --- 字幕 ---
    ['POST', '/caption/upload', { creatorId: 'a', videoId: 'b', wordList: [{ start_time: 0, end_time: 1, text: 'x' }] }],
    ['GET', '/caption/share/b?region=US', null],
    ['GET', '/caption/cdn/a/b.json', null],

    // --- AI 文案 ---
    ['POST', '/v1/plugin/copy-script/highlights', { subtitle: 'x' }],
    ['POST', '/v1/plugin/copy-script/summarize', { subtitle: 'x' }],
    ['POST', '/v1/plugin/copy-script/analyze-structure', { subtitle: 'x' }],
    ['POST', '/v1/plugin/copy-script/rewrite', { subtitle: 'x', rewriteMode: 'direct' }],

    // --- 相似达人 ---
    ['POST', '/creator/sts', null],
    ['POST', '/creator/similarity/async', { userId: '1', videoList: [] }],
    ['GET', '/creator/similarity/task?taskId=x', null],

    // --- 推广计划 ---
    ['GET', '/promotion/down/list', null],
    ['POST', '/promotion/add', { name: 'x' }],
    ['POST', '/promotion/update', { promotionPlanId: 'x', name: 'y' }],
    ['POST', '/promotion/delete', ['x']],
    ['POST', '/promotion/add/creator', { promotionPlanIdList: [], creatorList: [{ creatorId: 'c' }] }],
    ['POST', '/promotion/delete/creator', { promotionPlanId: 'x', authorIdList: ['c'] }],
    ['POST', '/promotion/ignore/creator', { promotionPlanId: 'x', creatorList: [{ creatorId: 'c' }] }],

    // --- AI 看懂评论区 ---
    ['POST', '/video/review/analysis', { videoId: 'v', reviewItemList: [{ content: 'x' }] }],
    ['POST', '/video/review/analysis/refresh', { videoId: 'v', reviewItemList: [{ content: 'x' }] }],
    ['GET', '/video/review/task/status?taskId=x', null],
    ['GET', '/video/review/task/recent?creatorId=c&videoId=v', null],
    ['GET', '/video/review/task/delete?taskId=x', null],
    ['POST', '/video/review/excel', { videoInfo: {}, analysisData: {}, commentList: [] }],

    // --- 商品 / 合作分析 ---
    ['POST', '/product/US/list', ['p1']],
    ['POST', '/product/US/gpm', ['c1']],
    ['GET', '/cooperate/analysis/c1?region=US', null],
    ['POST', '/cooperate/analysis/info', { creatorId: 'c1', region: 'US', jsonObject: {} }],

    // --- 留言 ---
    ['POST', '/message/send', { error: 'x' }],

    // --- 数据回流（原 plugin-data 域，扩展里是绝对 URL）---
    ['POST', `${API}/creator/save`, { user: { id: 'c1' } }],
    ['POST', `${API}/creator/video/tag`, { uid: 'c1', tags: {}, rings: {} }],
    ['POST', `${API}/video/label/add?region=US`, []],
    ['POST', `${API}/data/effect/upload`, []],
    ['POST', `${API}/product/data/via-video-product?region=US`, []],
    ['POST', `${API}/product/data/via-detail?region=US`, {}],
    ['POST', `${API}/product/data/via-list?region=US`, []],
    ['POST', `${API}/product/data/via-detail-relevant?region=US`, {}],
    ['POST', `${API}/video/analysis`, []],
    ['POST', `${API}/video/detail`, { itemInfo: { itemStruct: { id: '1' } } }],

    // --- 新增：激活码 ---
    ['POST', '/activation/redeem', { code: 'AAAA-BBBB-CCCC-DDDD' }],
    ['GET', '/activation/records', null],
    ['GET', '/activation/check?code=AAAA-BBBB-CCCC-DDDD', null],
  ];

  let missing = 0;
  let okCount = 0;
  const failures = [];

  for (const [method, path, body] of endpoints) {
    const url = resolve(path, API, BASE);
    const res = await fetch(url, {
      method,
      headers: {
        Token: TOKEN,
        'X-Version': '6.4.8',
        lang: 'zh-CN',
        ...(body !== null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });

    const ct = res.headers.get('content-type') || '';
    let code = 'BINARY';
    let message = '';
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => ({}));
      code = j.code ?? '?';
      message = j.message ?? '';
    }

    // 不能只看 code：/creator/similarity/task 在任务不存在时也返 ERR_GLOBAL_404
    // （前端靠这个码停止轮询）。只有 app.notFound() 那条兜底路由的 message
    // 才是「接口不存在」，那才是真的缺路由。
    if (code === 'ERR_GLOBAL_404' && message.startsWith('接口不存在')) {
      missing++;
      failures.push(`${method.padEnd(6)} ${path}`);
    } else {
      okCount++;
    }
  }

  console.log(`路由覆盖：${okCount}/${endpoints.length} 条可达`);
  if (missing) {
    console.log('\n后端没有对应路由：');
    for (const f of failures) console.log('  ' + f);
    process.exit(1);
  }
  console.log('扩展会调用的每一个地址后端都有实现。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
