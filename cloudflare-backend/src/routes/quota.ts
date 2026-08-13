import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { acquireQuota, getAllQuotas, getQuota, releaseQuota } from '../lib/quota';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

r.use('*', requireAuth);

/**
 * GET /v1/plugin/quota/new
 * popup 的「我的权益」面板用，一次拿全部配额。
 * data 必须是以配额名为 key 的对象，每个值含 available / total / used，
 * 见 index.html2.js 里 o[a.id].available / .total / .used 的读法。
 */
r.get('/new', async (c) => {
  return ok(await getAllQuotas(c.env, currentUser(c)));
});

/**
 * GET /v1/plugin/quota/new/{type}
 * 单个功能的配额。前端 checkQuota() 只看 data.available，
 * 请求失败时它会兜底成 {available:0,total:0} 然后弹升级引导，所以别返回 4xx。
 */
r.get('/new/:type', async (c) => {
  const type = c.req.param('type');
  return ok(await getQuota(c.env, currentUser(c), type));
});

/**
 * POST /v1/plugin/quota/acquire/{type}/{count}
 * 预扣。data 必须直接是记录 id 字符串 —— 前端拿 `u.data` 存进 ref，
 * 失败时原样丢给 /quota/release。
 */
r.post('/acquire/:type/:count?', async (c) => {
  const type = c.req.param('type');
  const count = Number(c.req.param('count') || '1');
  const res = await acquireQuota(c.env, currentUser(c), type, count);
  if (!res.okToUse) {
    // 两种失败要说清楚：日上限是「明天还有」，月度用尽是「该掏钱了」
    return fail(
      ERR.QUOTA_EXHAUSTED,
      res.dailyExceeded ? '今日次数已达上限，请明天再试或升级套餐' : '本月额度已用完，请升级套餐或购买加油包',
      200,
      null,
    );
  }
  return ok(res.recordId);
});

/**
 * POST /v1/plugin/quota/release
 * body: { id }
 * 任务失败/用户取消时退还预扣。评论分析那边传的是 userQuotaLogId，
 * 所以两个字段名都认。
 */
r.post('/release', async (c) => {
  const body = await c.req
    .json<{ id?: string; userQuotaLogId?: string }>()
    .catch(() => ({}) as { id?: string; userQuotaLogId?: string });
  const id = body.id || body.userQuotaLogId || '';
  const done = await releaseQuota(c.env, currentUser(c), id);
  return ok(done);
});

export default r;
