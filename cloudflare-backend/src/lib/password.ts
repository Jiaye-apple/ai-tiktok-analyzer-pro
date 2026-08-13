/**
 * 密码哈希。用 WebCrypto 的 PBKDF2 —— Workers 里没有 bcrypt/argon2，
 * 而 PBKDF2 是标准库自带的，不用引任何依赖。
 *
 * 参数：SHA-256，100000 轮，每个用户独立 16 字节随机盐。
 *
 * 为什么是 10 万而不是 OWASP 建议的 21 万：**Workers 的硬限制**。
 * 传更大的值运行时会直接抛
 *   Pbkdf2 failed: iteration counts above 100000 are not supported
 * 10 万是平台允许的上限，也是 OWASP 早期对 PBKDF2-SHA256 的建议值。
 * 想要更强的话得换 scrypt/argon2，但 Workers 里没有原生实现。
 */

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LEN * 8,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { hash: await derive(password, salt), salt: toHex(salt.buffer) };
}

export async function verifyPassword(
  password: string,
  hash: string | null,
  salt: string | null,
): Promise<boolean> {
  if (!hash || !salt) return false;
  const got = await derive(password, fromHex(salt));
  return timingSafeEqual(got, hash);
}

/** 定长比较，避免按字符逐位泄漏信息。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 弱密码在这里挡掉，别等用户被撞库了才想起来。 */
export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 8) return '密码至少 8 位';
  if (pw.length > 128) return '密码太长了';
  if (/^\d+$/.test(pw)) return '密码不能全是数字';
  if (/^[a-zA-Z]+$/.test(pw)) return '密码不能全是字母';
  return null;
}
