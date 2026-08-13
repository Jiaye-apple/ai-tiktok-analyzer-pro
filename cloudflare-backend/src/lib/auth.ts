import type { Env, UserProfile, UserRow } from './types';
import { translate } from './i18n';

/**
 * 鉴权。扩展把 token 放在 `Token` 请求头里（注意是大写 T，不是 Authorization）——
 * 见 service-worker.ts.js：`s.token && (s.headers = { ...s.headers, Token: s.token })`。
 * 这里额外兼容 Authorization: Bearer，方便你用 curl 调试。
 */
export function extractToken(req: Request): string {
  const t = req.headers.get('Token');
  if (t) return t.trim();
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

export async function getUserByToken(env: Env, token: string): Promise<UserRow | null> {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT u.* FROM user_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ?1 AND t.expires_at > ?2 AND u.status = 'active'`,
  )
    .bind(token, now)
    .first<UserRow>();
  if (!row) return null;

  // 顺手刷新 last_used_at，用来做僵尸 token 清理。失败不影响主流程。
  env.DB.prepare(`UPDATE user_tokens SET last_used_at = ?1 WHERE token = ?2`)
    .bind(now, token)
    .run()
    .catch(() => {});

  return row;
}

/**
 * planCode -> LV 的映射。必须和扩展 hosts.js 里的写法完全一致：
 *   planCode.includes('plus')                       -> 'P'
 *   planCode.includes('pro') || planCode==='standard'-> 'V'
 *   其它                                             -> 'F'
 * 会员过期后一律按 'F' 处理。
 */
export function levelOf(planCode: string, expireAt: number | null): 'F' | 'P' | 'V' {
  const now = Math.floor(Date.now() / 1000);
  if (expireAt !== null && expireAt > 0 && expireAt < now) return 'F';
  if (planCode.includes('plus')) return 'P';
  if (planCode.includes('pro') || planCode === 'standard') return 'V';
  return 'F';
}

/** 会员过期时把用户降回 free，这样配额规则也会自动切到免费档。 */
export function effectivePlanCode(row: UserRow): string {
  const now = Math.floor(Date.now() / 1000);
  if (row.plan_expire_at !== null && row.plan_expire_at > 0 && row.plan_expire_at < now) {
    return 'free';
  }
  return row.plan_code;
}

export async function toProfile(env: Env, row: UserRow): Promise<UserProfile> {
  const planCode = effectivePlanCode(row);
  const plan = await env.DB.prepare(`SELECT name FROM plans WHERE code = ?1`)
    .bind(planCode)
    .first<{ name: string }>();

  return {
    id: row.id,
    username: row.username,
    headUrl: row.head_url ?? '',
    email: row.email,
    phone: row.phone,
    planCode,
    // 库里存的是中文名（免费版 / 个人版·月付…），在出口按界面语言翻译 ——
    // 否则英文界面的「Current plan」后面会跟一个中文词。
    planName: translate(plan?.name ?? planCode),
    planExpireAt: row.plan_expire_at,
    LV: levelOf(planCode, row.plan_expire_at),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function issueToken(env: Env, userId: string, device = ''): Promise<string> {
  const token = randomToken();
  const ttlDays = Number(env.TOKEN_TTL_DAYS || '30');
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  await env.DB.prepare(
    `INSERT INTO user_tokens (token, user_id, device, expires_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(token, userId, device.slice(0, 200), expiresAt)
    .run();
  return token;
}
