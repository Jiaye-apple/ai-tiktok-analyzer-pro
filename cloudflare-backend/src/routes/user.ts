import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ok } from '../lib/response';
import { toProfile } from '../lib/auth';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * GET /v1/plugin/user/detail
 *
 * 扩展启动、切页、登录后都会调，是最高频的接口。
 * 返回体里 planCode 决定会员等级（LV），LV 又决定几乎所有功能按钮的可用性，
 * 所以字段名一个都不能改。
 *
 * 失败时前端会直接登出（hosts.js X6o 的 catch 里调 Oko()），
 * 所以这里只有真的没登录才失败，别的异常尽量兜住。
 */
r.get('/detail', requireAuth, async (c) => {
  const profile = await toProfile(c.env, currentUser(c));
  return ok(profile);
});

/** 主动登出，让 token 立即失效。扩展本地清 storage 之外，服务端也该销毁。 */
r.post('/logout', requireAuth, async (c) => {
  const token = c.req.header('Token') || '';
  if (token) {
    await c.env.DB.prepare(`DELETE FROM user_tokens WHERE token = ?1`).bind(token).run();
  }
  return ok(true);
});

export default r;
