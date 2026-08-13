import type { Context, Next } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail } from '../lib/response';

type Ctx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;

/**
 * 需要登录的接口用它。
 * 返回 ERR_GLOBAL_SESSION_EXPIRED 是有意的 —— 扩展 hosts.js 里只认这个码，
 * 收到后会清掉本地 token 并把用户踢回登录态。换别的码前端会一直卡在假登录。
 */
export async function requireAuth(c: Ctx, next: Next) {
  const user = c.get('user');
  if (!user) {
    return fail(ERR.SESSION_EXPIRED, '登录已过期，请重新登录');
  }
  await next();
}

export function currentUser(c: Ctx): UserRow {
  return c.get('user') as UserRow;
}
