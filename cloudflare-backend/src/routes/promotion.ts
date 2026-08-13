import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();
r.use('*', requireAuth);

/** GET /promotion/down/list —— 推广计划下拉，data 是 [{id, name, defaultFlag}] */
r.get('/down/list', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name,
            CASE WHEN id = (SELECT id FROM promotions WHERE user_id = ?1
                            ORDER BY created_at ASC LIMIT 1) THEN 1 ELSE 0 END AS defaultFlag
     FROM promotions WHERE user_id = ?1 AND status = 'active'
     ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all();
  return ok(results ?? []);
});

/** POST /promotion/add —— body {name} */
r.post('/add', async (c) => {
  const user = currentUser(c);
  const body = await readJson<{ name?: string; region?: string }>(c);
  const name = (body.name || '').trim();
  if (!name) return fail(ERR.PARAM, '计划名称不能为空');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO promotions (id, user_id, name, region) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, user.id, name, body.region ?? null)
    .run();
  return ok({ id, name });
});

/** POST /promotion/update —— body {promotionPlanId, name} */
r.post('/update', async (c) => {
  const user = currentUser(c);
  const body = await readJson<{ promotionPlanId?: string; name?: string }>(c);
  if (!body.promotionPlanId || !body.name) return fail(ERR.PARAM, '参数不完整');

  await c.env.DB.prepare(
    `UPDATE promotions SET name = ?3, updated_at = unixepoch() WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(body.promotionPlanId, user.id, body.name.trim())
    .run();
  return ok(true);
});

/**
 * POST /promotion/delete
 * 请求体是**裸数组** [planId, ...]，不是对象 —— 前端就是这么发的，别改成 {ids}。
 */
r.post('/delete', async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<string[] | { ids?: string[] }>().catch(() => [] as string[]);
  const ids = Array.isArray(body) ? body : (body.ids ?? []);
  if (!ids.length) return fail(ERR.PARAM, '缺少计划 id');

  const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
  await c.env.DB.prepare(
    `UPDATE promotions SET status = 'deleted', updated_at = unixepoch()
     WHERE user_id = ?1 AND id IN (${placeholders})`,
  )
    .bind(user.id, ...ids)
    .run();
  return ok(true);
});

/**
 * POST /promotion/add/creator
 * body: { promotionPlanIdList: string[], creatorList: [{creatorId, region}] }
 */
r.post('/add/creator', async (c) => {
  const user = currentUser(c);
  const body = await readJson<{
    promotionPlanIdList?: string[];
    creatorList?: Array<{ creatorId: string; region?: string; [k: string]: unknown }>;
  }>(c);

  const plans = body.promotionPlanIdList ?? [];
  const creators = body.creatorList ?? [];
  if (!creators.length) return fail(ERR.PARAM, '达人列表为空');

  // promotionPlanIdList 传 [] 是合法的（前端 promotionId 为空时就传空数组），
  // 这种情况落到用户的默认计划里，没有就自动建一个。
  let targets = plans;
  if (!targets.length) {
    const def = await c.env.DB.prepare(
      `SELECT id FROM promotions WHERE user_id = ?1 AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
    )
      .bind(user.id)
      .first<{ id: string }>();
    if (def) {
      targets = [def.id];
    } else {
      const id = uuid();
      await c.env.DB.prepare(
        `INSERT INTO promotions (id, user_id, name) VALUES (?1, ?2, '默认计划')`,
      )
        .bind(id, user.id)
        .run();
      targets = [id];
    }
  }

  const stmts = [];
  for (const planId of targets) {
    for (const cr of creators) {
      if (!cr?.creatorId) continue;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO promotion_creators (promotion_id, user_id, creator_id, status, payload)
           VALUES (?1, ?2, ?3, 'collected', ?4)
           ON CONFLICT(promotion_id, creator_id)
           DO UPDATE SET status = 'collected', payload = ?4`,
        ).bind(planId, user.id, String(cr.creatorId), JSON.stringify(cr)),
      );
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return ok({ added: stmts.length });
});

/**
 * POST /promotion/delete/creator
 * body: { promotionPlanId, authorIdList }
 * 字段名是 authorIdList 不是 creatorList，和 add 接口不对称，这是原样照搬前端。
 */
r.post('/delete/creator', async (c) => {
  const user = currentUser(c);
  const body = await readJson<{ promotionPlanId?: string; authorIdList?: string[] }>(c);
  const ids = body.authorIdList ?? [];
  if (!body.promotionPlanId || !ids.length) return fail(ERR.PARAM, '参数不完整');

  const placeholders = ids.map((_, i) => `?${i + 3}`).join(',');
  await c.env.DB.prepare(
    `DELETE FROM promotion_creators
     WHERE user_id = ?1 AND promotion_id = ?2 AND creator_id IN (${placeholders})`,
  )
    .bind(user.id, body.promotionPlanId, ...ids.map(String))
    .run();
  return ok(true);
});

/**
 * POST /promotion/ignore/creator
 * body: { promotionPlanId, creatorList: [{creatorId, handleName, region}] }
 * 被忽略的达人下次相似达人搜索时要过滤掉（ignore 参数为 1 时生效）。
 */
r.post('/ignore/creator', async (c) => {
  const user = currentUser(c);
  const body = await readJson<{
      promotionPlanId?: string;
      creatorList?: Array<{ creatorId: string; handleName?: string; region?: string }>;
    }>(c);

  const creators = body.creatorList ?? [];
  if (!body.promotionPlanId || !creators.length) return fail(ERR.PARAM, '参数不完整');

  await c.env.DB.batch(
    creators
      .filter((cr) => cr?.creatorId)
      .map((cr) =>
        c.env.DB.prepare(
          `INSERT INTO promotion_creators (promotion_id, user_id, creator_id, status, payload)
           VALUES (?1, ?2, ?3, 'ignored', ?4)
           ON CONFLICT(promotion_id, creator_id)
           DO UPDATE SET status = 'ignored', payload = ?4`,
        ).bind(body.promotionPlanId!, user.id, String(cr.creatorId), JSON.stringify(cr)),
      ),
  );
  return ok(true);
});

/** 列出某个计划下的达人，供官网「产品推广计划」页用。 */
r.get('/:planId/creators', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT creator_id AS creatorId, status, payload, created_at AS createdAt
     FROM promotion_creators WHERE user_id = ?1 AND promotion_id = ?2
     ORDER BY created_at DESC LIMIT 500`,
  )
    .bind(user.id, c.req.param('planId'))
    .all<{ creatorId: string; status: string; payload: string; createdAt: number }>();

  return ok(
    (results ?? []).map((row) => ({
      ...row,
      payload: safeParse(row.payload),
    })),
  );
});

function safeParse(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default r;
