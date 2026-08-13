import type { Env } from './types';

/**
 * Google 登录（OAuth 2.0 授权码 + OpenID Connect）。
 *
 * GCP 项目 poviai-kol（project id: poviai-kol-504800，owner support@poviai.com），
 * 客户端 poviai-kol-web，同意屏幕已 push 到 In production。
 * 只要 openid/email/profile 三个非敏感 scope，
 * 所以不需要提交 Google 审核，也不会有「未验证应用」拦截页。
 *
 * 回调地址在 Google 后台是白名单，改这里的路径就必须同步改后台，否则报
 * redirect_uri_mismatch。目前登记了：
 *   https://tiktok.poviai.com/kol/exlogin/google/callback
 *   https://tk.poviai.com/kol/exlogin/google/callback
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** 回调路径。只有一处定义，拼 redirect_uri 和挂路由都用它。 */
export const GOOGLE_CALLBACK_PATH = '/kol/exlogin/google/callback';

export function googleEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * redirect_uri 按**当前请求的 origin** 算，不用 PUBLIC_SITE_URL。
 *
 * 因为站点有两个域名（tiktok / tk），用户从哪个域名点的登录就得跳回哪个 ——
 * 写死 PUBLIC_SITE_URL 的话，从 tk 点进来会跳到 tiktok 域名，
 * 那边的 sid cookie 是另一份，登录完页面还是未登录状态。
 */
export function callbackUrl(req: Request): string {
  return new URL(GOOGLE_CALLBACK_PATH, new URL(req.url).origin).toString();
}

export function authorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** 传给 Google 的界面语言，形如 zh-CN / ja。让同意屏幕跟站点语言一致。 */
  lang?: string;
}): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', opts.state);
  // 只是拿身份，不需要 refresh token，所以不要 access_type=offline / prompt=consent，
  // 老用户第二次点就能静默通过，不用每次重新授权。
  u.searchParams.set('include_granted_scopes', 'true');
  if (opts.lang) u.searchParams.set('hl', opts.lang);
  return u.toString();
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

/**
 * 用授权码换 id_token 并解出身份。
 *
 * 这里**不校验 id_token 签名**：token 是我们自己带 client_secret 直接向
 * oauth2.googleapis.com 发 HTTPS 请求换来的，不是从浏览器转手过来的，
 * 传输通道本身就是信任边界（Google 官方文档明确说这种情况可以跳过验签）。
 */
export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  // 失败时 Google 也返回 JSON（{error, error_description}），不查 ok 会把错误体当数据
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!body?.id_token) return null;

  const claims = decodeJwtPayload(body.id_token);
  if (!claims) return null;

  return identityFromClaims(claims);
}

/** exchangeCode / verifyIdToken 共用：从 id_token 的 claims 提炼身份。 */
function identityFromClaims(claims: Record<string, unknown>): GoogleIdentity | null {
  const email = String(claims.email || '').trim().toLowerCase();
  const sub = String(claims.sub || '');
  if (!email || !sub) return null;

  return {
    sub,
    email,
    // Google 自家账号一律 true；只有把外部邮箱挂进来的边缘情况会是 false，
    // 那种邮箱不能拿来认人（否则等于谁都能声称自己是那个邮箱的主人）。
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: String(claims.name || '').slice(0, 60),
    picture: String(claims.picture || '').slice(0, 500),
  };
}

// --- One Tap（GIS credential）验签 ------------------------------------------

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_KEY = 'google-jwks';

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

/**
 * JWKS 拉一次缓存一小时（KV 只当缓存用，最终一致无所谓）。
 * Google 会轮换密钥：缓存里找不到 kid 时强制回源刷一次再找。
 */
async function fetchJwks(env: Env, forceFresh: boolean): Promise<Jwk[]> {
  if (!forceFresh) {
    const cached = await env.KV.get(JWKS_CACHE_KEY);
    if (cached) {
      try {
        return (JSON.parse(cached) as { keys?: Jwk[] }).keys || [];
      } catch {
        /* 缓存坏了就回源 */
      }
    }
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) return [];
  const text = await res.text();
  try {
    const keys = (JSON.parse(text) as { keys?: Jwk[] }).keys || [];
    if (keys.length) await env.KV.put(JWKS_CACHE_KEY, text, { expirationTtl: 3600 });
    return keys;
  } catch {
    return [];
  }
}

function b64urlToBytes(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Uint8Array.from(atob(pad), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * 校验 One Tap 送来的 credential（ID token）并解出身份。
 *
 * 和 exchangeCode 不同，这个 token 是**浏览器转手**送来的 —— 任何人都能往
 * 接口 POST 任意字符串，所以必须完整走 RS256 验签 + iss/aud/exp 校验，
 * 缺一个都等于「谁都能声称自己是任意 Google 用户」。
 */
export async function verifyIdToken(env: Env, credential: string): Promise<GoogleIdentity | null> {
  const parts = credential.split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  try {
    const bytes = b64urlToBytes(parts[0]);
    if (!bytes) return null;
    header = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys = await fetchJwks(env, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await fetchJwks(env, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;

  const sig = b64urlToBytes(parts[2]);
  if (!sig) return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      sig as unknown as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const claims = decodeJwtPayload(credential);
  if (!claims) return null;

  const iss = String(claims.iss || '');
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return null;
  if (String(claims.aud || '') !== (env.GOOGLE_CLIENT_ID || '')) return null;
  // exp 给 60s 时钟偏移余量
  if (Number(claims.exp || 0) < Math.floor(Date.now() / 1000) - 60) return null;

  return identityFromClaims(claims);
}

/** 只解 payload，不验签 —— 见 exchangeCode 的注释。 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(pad), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
