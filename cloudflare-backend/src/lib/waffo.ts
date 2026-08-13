import type { Env } from './types';

/**
 * Waffo Pancake 支付（Merchant of Record，https://docs.waffo.ai）。
 *
 * 和 Creem 的差别（迁移时最容易踩的三处）：
 *   1. 建结账会话走 POST /v1/actions/checkout/create-session，
 *      用 Store Slug 认证（X-Store-Slug + X-Environment），不需要私钥；
 *   2. webhook 验签是**非对称** RSA-SHA256：签名头 `X-Waffo-Signature: t=<ms>,v1=<base64>`，
 *      被签名的串是 `${t}.${rawBody}`，用后台给的 Public Key 验；
 *   3. 业务字段都在 `data` 里，我们自己的订单号靠 `orderMerchantExternalId` 回传。
 *
 * 安全边界同 Creem：履约只发生在验签通过之后，回跳页面纯展示。
 */

export function waffoConfigured(env: Env): boolean {
  const canAuth =
    (!!env.WAFFO_MERCHANT_ID && !!env.WAFFO_PRIVATE_KEY) ||
    Object.keys(waffoPaymentLinks(env)).length > 0;
  return canAuth && !!env.WAFFO_WEBHOOK_PUBLIC_KEY;
}

export function waffoApiBase(env: Env): string {
  return env.WAFFO_API_BASE || 'https://api.waffo.ai';
}

/** 只能是 'test' 或 'prod'（Waffo 网关只认这两个值），默认 prod */
export function waffoEnvName(env: Env): 'test' | 'prod' {
  return (env.WAFFO_ENV || '').toLowerCase() === 'test' ? 'test' : 'prod';
}

/** 商品映射（plans.code / billing_addons.code → Waffo PROD_xxx）。 */
export function waffoProducts(env: Env): Record<string, string> {
  try {
    const m = JSON.parse(env.WAFFO_PRODUCTS || '{}');
    return typeof m === 'object' && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 托管收银台直链映射（code → checkout.waffo.ai 链接）。 */
export function waffoPaymentLinks(env: Env): Record<string, string> {
  try {
    const m = JSON.parse(env.WAFFO_PAYMENT_LINKS || '{}');
    return typeof m === 'object' && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 能不能建 API 会话（要私钥）。不能就只能走直链。 */
export function waffoCanUseApi(env: Env): boolean {
  return !!env.WAFFO_MERCHANT_ID && !!env.WAFFO_PRIVATE_KEY;
}

export interface WaffoCheckoutInput {
  productId: string;
  /** 我们的订单 id，webhook 里按 orderMerchantExternalId 回来对账 */
  requestId: string;
  successUrl: string;
  customerEmail?: string | null;
  metadata?: Record<string, string>;
  /** 订阅商品必须报 'subscription'，一次性报 'onetime' */
  productType?: 'onetime' | 'subscription';
}

export class WaffoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function bytesToB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** PEM（PKCS#8）或裸 base64 都吃。 */
function pemBody(raw: string): string {
  return raw
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
}

/**
 * API Key 认证的请求签名：
 *   canonical = METHOD \n PATH \n TIMESTAMP \n base64(sha256(BODY))
 *   X-Signature = base64(RSA-SHA256(canonical, 私钥))
 * 时间戳单位是秒，服务端容忍前 5 分钟 / 后 1 分钟。
 */
async function signedHeaders(
  env: Env,
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const digest = bytesToB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const canonical = `${method}\n${path}\n${ts}\n${digest}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64ToBytes(pemBody(env.WAFFO_PRIVATE_KEY!)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(canonical),
  );

  return {
    'X-Merchant-Id': env.WAFFO_MERCHANT_ID!,
    'X-Timestamp': ts,
    'X-Signature': bytesToB64(sig),
  };
}

/** 建结账会话，返回给用户跳转的 checkoutUrl。 */
export async function createWaffoCheckout(
  env: Env,
  input: WaffoCheckoutInput,
): Promise<{ checkoutId: string; url: string }> {
  const body: Record<string, unknown> = {
    productId: input.productId,
    productType: input.productType ?? 'onetime',
    currency: 'USD',
    orderMerchantExternalId: input.requestId.slice(0, 128),
    successUrl: input.successUrl,
    metadata: input.metadata ?? {},
  };
  if (input.customerEmail) body.buyerEmail = input.customerEmail;

  const path = '/v1/actions/checkout/create-session';
  const payload = JSON.stringify(body);

  // 有私钥就走 API Key 签名（功能最全），否则退回 Store Slug（仅公开结账用）
  const auth =
    env.WAFFO_MERCHANT_ID && env.WAFFO_PRIVATE_KEY
      ? await signedHeaders(env, 'POST', path, payload)
      : { 'X-Store-Slug': env.WAFFO_STORE_SLUG!, 'X-Environment': waffoEnvName(env) };

  const res = await fetch(`${waffoApiBase(env)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new WaffoError(res.status, `Waffo 返回 ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json<{ data?: { sessionId?: string; checkoutUrl?: string } }>();
  const url = json.data?.checkoutUrl;
  if (!url) throw new WaffoError(502, 'Waffo 返回里没有 checkoutUrl');
  return { checkoutId: json.data?.sessionId ?? '', url };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 后台给的是裸 base64（SPKI），也兼容贴成 PEM 的情况。 */
function normalizePublicKey(raw: string): string {
  return raw
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * webhook 验签：`X-Waffo-Signature: t=<unix_ms>,v1=<base64(RSA-SHA256(`${t}.${rawBody}`))>`。
 * 必须用**原始未解析**的 body，JSON.parse 之后再拼会验不过。
 * 时间窗 5 分钟，防重放。
 */
export async function verifyWaffoSignature(
  env: Env,
  rawBody: string,
  header: string | undefined | null,
): Promise<boolean> {
  const pub = env.WAFFO_WEBHOOK_PUBLIC_KEY;
  if (!pub || !header) return false;

  let t = '';
  let v1 = '';
  for (const part of header.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    const v = rest.join('=');
    if (k === 't') t = v;
    else if (k === 'v1') v1 = v;
  }
  if (!t || !v1) return false;

  // 时间戳是毫秒；容忍 5 分钟内的偏差
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) return false;

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      b64ToBytes(normalizePublicKey(pub)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64ToBytes(v1),
      new TextEncoder().encode(`${t}.${rawBody}`),
    );
  } catch {
    return false;
  }
}

// --- webhook payload 的宽松形状，字段名以 Waffo 文档为准，读的时候全部可选 ---

export interface WaffoEventData {
  orderId?: string;
  orderStatus?: string;
  orderMerchantExternalId?: string;
  orderMetadata?: Record<string, unknown> | null;
  buyerEmail?: string;
  currency?: string;
  amount?: number;
  total?: number;
  productName?: string;
  paymentId?: string;
  paymentStatus?: string;
  billingPeriod?: string;
  currentPeriodStart?: string | number | null;
  currentPeriodEnd?: string | number | null;
  refundStatus?: string;
  [k: string]: unknown;
}

export interface WaffoWebhookEvent {
  id?: string;
  eventId?: string;
  eventType?: string;
  timestamp?: string | number;
  storeId?: string;
  mode?: string;
  data?: WaffoEventData;
}

/** ISO 字符串或秒/毫秒时间戳 → unix 秒。 */
export function waffoEpochSeconds(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
