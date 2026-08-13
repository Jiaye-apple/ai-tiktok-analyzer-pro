import type { Env, UserRow } from '../lib/types';
import { uuid } from '../lib/auth';
import { parseLang, withLang } from '../lib/i18n';

/**
 * 官网页面的会话与语言，site.ts / site-kol.ts 共用。
 * 原先内联在 site.ts 里，工作台那批页面出现后抽出来，两个路由文件一份逻辑。
 */

export const SESSION_DAYS = 30;

export async function currentWebUser(c: {
  env: Env;
  req: { header: (k: string) => string | undefined };
}): Promise<UserRow | null> {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return null;
  const now = Math.floor(Date.now() / 1000);
  return c.env.DB.prepare(
    `SELECT u.* FROM web_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.sid = ?1 AND s.expires_at > ?2 AND u.status = 'active'`,
  )
    .bind(m[1], now)
    .first<UserRow>();
}

export async function newSession(env: Env, userId: string, ip: string, ua: string): Promise<string> {
  const sid = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO web_sessions (sid, user_id, ip, user_agent, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(sid, userId, ip, ua.slice(0, 300), Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400)
    .run();
  return sid;
}

export function sessionCookie(sid: string): string {
  return `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

/**
 * 生成给扩展用的一次性码，/public/token/exchange 兑换。
 *
 * 存 D1 而不是 KV：KV 最终一致，慢网络/代理换出口时兑换请求可能打到
 * 还没同步到的 colo，读不到码 → 扩展一直「正在同步网页登录信息…」。
 *
 * 两个窗口，别混：
 *   · **首次兑换** 只认 5 分钟（created_at + 300，判据在 public.ts）；
 *   · **行的保留期** expires_at 给到 30 分钟 —— 已经兑过的码在这段时间里
 *     重复兑换照样返回同一个 token，不报「登录码无效或已过期」。
 * 为什么要留这么久：登录页的兜底重发跑在 setInterval 上，标签页切到后台会被
 * Chrome 降频到 1 分钟一次，30 次兜底就摊到半小时；原来 5 分钟就删行，
 * 迟到的那几发全部撞成失败 toast —— 用户其实早就登录成功了。
 *
 * 顺手清过期行，省一个定时任务。
 */
export const LOGIN_CODE_FIRST_USE_SECONDS = 300;
export const LOGIN_CODE_KEEP_SECONDS = 1800;

export async function issueLoginCode(env: Env, userId: string): Promise<string> {
  const code = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM login_codes WHERE expires_at < unixepoch()`),
    env.DB.prepare(
      `INSERT INTO login_codes (code, user_id, expires_at)
       VALUES (?1, ?2, unixepoch() + ?3)`,
    ).bind(code, userId, LOGIN_CODE_KEEP_SECONDS),
  ]);
  return code;
}

/**
 * 页面语言中间件（Hono 形状，泛型宽松以便两个路由文件直接 r.use('*', pageLang)）。
 *
 * ?lang= 优先并记进 plang cookie（扩展跳转只在第一个 URL 带 lang，
 * 用户点导航后靠 cookie 记住）；其次 cookie；最后退回全局中间件按
 * Accept-Language 定的语言。
 */
export async function pageLang(
  c: {
    req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined };
    res: { headers: Headers };
  },
  next: () => Promise<void>,
): Promise<void> {
  const q = c.req.query('lang');
  if (q) {
    await withLang(parseLang(q), next);
    c.res.headers.append(
      'Set-Cookie',
      `plang=${encodeURIComponent(q)}; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    return;
  }
  const saved = (c.req.header('Cookie') || '').match(/(?:^|;\s*)plang=([^;]+)/);
  if (saved) return withLang(parseLang(decodeURIComponent(saved[1])), next);
  return next();
}
