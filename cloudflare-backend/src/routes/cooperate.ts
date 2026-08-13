import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();
r.use('*', requireAuth);

/**
 * 达人合作分析。
 *
 * 这一组的特点是：**分析全在前端算**，服务端只负责存和取一份缓存。
 * 前端拿到 GET 的结果后，比较 data.latestCreateTime 和当前最新视频的 createTime，
 * 一致就直接复用，不一致才重算并 POST 回来。
 *
 * 所以后端不需要理解 jsonObject 的内容，当成 blob 存就行。
 */

/** GET /cooperate/analysis/{creatorId}?region=xx */
r.get('/analysis/:creatorId', async (c) => {
  const user = currentUser(c);
  const creatorId = c.req.param('creatorId');
  const region = c.req.query('region') || '';

  const row = await c.env.DB.prepare(
    `SELECT result FROM async_tasks
     WHERE user_id = ?1 AND type = 'cooperate_analysis' AND creator_id = ?2
       AND COALESCE(json_extract(input, '$.region'), '') = ?3
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(user.id, creatorId, region)
    .first<{ result: string | null }>();

  // 没有缓存时返回 null 而不是报错 —— 前端会当作"需要重新分析"处理
  if (!row?.result) return ok(null);
  try {
    return ok(JSON.parse(row.result));
  } catch {
    return ok(null);
  }
});

/**
 * POST /cooperate/analysis/info
 * body: { creatorId, region, jsonObject }
 *
 * ⚠️ 前端传上来的 body 已经被 JSON.stringify 过一次（index.js:181543），
 * 请求层检测到是字符串会原样透传，所以这里收到的仍是标准 JSON，不用二次解析。
 * 迁移时如果改了前端的序列化逻辑，注意别搞成双重编码。
 */
r.post('/analysis/info', async (c) => {
  const user = currentUser(c);
  const b = await readJson<{ creatorId?: string; region?: string; jsonObject?: unknown }>(c);

  if (!b.creatorId) return fail(ERR.PARAM, '缺少 creatorId');

  const payload = JSON.stringify(b.jsonObject ?? null);
  // jsonObject 里含 saleVideos / allStats / trendData，可能不小，做个上限保护
  if (payload.length > 900_000) return fail(ERR.PARAM, '分析结果过大');

  const existing = await c.env.DB.prepare(
    `SELECT task_id FROM async_tasks
     WHERE user_id = ?1 AND type = 'cooperate_analysis' AND creator_id = ?2
       AND COALESCE(json_extract(input, '$.region'), '') = ?3
     LIMIT 1`,
  )
    .bind(user.id, b.creatorId, b.region ?? '')
    .first<{ task_id: string }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE async_tasks SET result = ?2, status = 'success', updated_at = unixepoch()
       WHERE task_id = ?1`,
    )
      .bind(existing.task_id, payload)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO async_tasks (task_id, user_id, type, status, input, result, creator_id)
       VALUES (?1, ?2, 'cooperate_analysis', 'success', ?3, ?4, ?5)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        JSON.stringify({ region: b.region ?? '' }),
        payload,
        b.creatorId,
      )
      .run();
  }

  return ok(true);
});

export default r;
