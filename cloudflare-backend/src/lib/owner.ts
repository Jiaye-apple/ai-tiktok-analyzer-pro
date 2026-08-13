import { fail } from './response';
import { isHtmlNavigation, notFoundHtml } from '../site/layout';

/**
 * 管理面（/admin/*、/wish/admin* 与 /feedback/admin*）的统一门卫。
 *
 * 边缘层：Cloudflare Access（邮箱 OTP，只放行 ADMIN_EMAIL；机器脚本走
 * service token），由 scripts/setup-access.sh 创建维护。
 * Worker 层（这里）：兜底校验 Access 注入的身份头；不合法一律返回与
 * 全局 notFound 一字不差的假 404 —— 对外这些路由不存在。
 */
export const ADMIN_EMAIL = 'jerrylinap@gmail.com';

// 管理面只在主域（和本地开发）开放。tk.poviai.com 只是给人看官网的别名，
// 别名域上没挂 Access，若不封死，伪造身份头就能绕过边缘墙。
const ADMIN_HOSTS = new Set(['tiktok.poviai.com', 'localhost', '127.0.0.1']);

type GateCtx = {
  req: { url: string; method: string; path: string; header(name: string): string | undefined };
};

/** 与 index.ts 的 notFound 完全同一个调用，返回体逐字节一致（HTML 导航给 404 页，其余 200+JSON）。 */
export function fake404(c: GateCtx): Response {
  if (isHtmlNavigation(c.req)) return notFoundHtml();
  return fail('ERR_GLOBAL_404', `接口不存在: ${c.req.method} ${c.req.path}`, 200);
}

/** 放行返回 null，否则返回假 404。只认 Access 边缘注入的邮箱身份。 */
export function accessIdentityBlocked(c: GateCtx): Response | null {
  if (!ADMIN_HOSTS.has(new URL(c.req.url).hostname)) return fake404(c);
  const email = (c.req.header('Cf-Access-Authenticated-User-Email') || '').toLowerCase();
  const jwt = c.req.header('Cf-Access-Jwt-Assertion') || '';
  if (email === ADMIN_EMAIL && jwt) return null;
  return fake404(c);
}
