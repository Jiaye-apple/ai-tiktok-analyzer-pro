/**
 * SMTP 密码的对称加密（AES-256-GCM）。
 *
 * 密钥从 JWT_SECRET 派生（SHA-256 一次），不新增 secret；
 * 密文格式 `v1:<base64(iv)>:<base64(cipher)>`，iv 每次随机。
 * 这是「存储加密」不是零知识 —— Worker 运行时必须能解密才能替用户发信，
 * 防的是 D1 数据被单独拖走的场景。
 */
import type { Env } from './types';

async function deriveKey(env: Env): Promise<CryptoKey> {
  const secret = env.JWT_SECRET || '';
  if (!secret) throw new Error('缺少 JWT_SECRET，无法加密 SMTP 凭据');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mailcrypt:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const key = await deriveKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `v1:${b64(iv)}:${b64(cipher)}`;
}

export async function decryptSecret(env: Env, stored: string): Promise<string> {
  const [ver, ivB64, cipherB64] = stored.split(':');
  if (ver !== 'v1' || !ivB64 || !cipherB64) throw new Error('SMTP 凭据格式不对');
  const key = await deriveKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(ivB64) as unknown as ArrayBuffer },
    key,
    unb64(cipherB64) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}
