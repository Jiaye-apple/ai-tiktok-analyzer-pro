import type { Env } from './types';

/**
 * Creem 支付（Merchant of Record，https://docs.creem.io）。
 *
 * 只用到两条腿：
 *   1. POST /v1/checkouts 建结账会话 → 把用户送去 checkout_url
 *   2. Webhook 回调（creem-signature 头，HMAC-SHA256(raw body, secret) 的 hex）
 *
 * 安全边界：**履约只发生在 webhook 验签通过之后**。success_url 回跳页面
 * 只做「支付处理中/已到账」的展示，不改任何状态 —— 伪造回跳骗不到会员。
 *
 * 订阅商品首次支付会同时来 checkout.completed 和 subscription.paid，
 * 续费只来 subscription.paid。到期时间统一用 max(当前, 账期结束) 计算，
 * 天然幂等，两个事件重复处理也不会多送时长。
 */

export function creemConfigured(env: Env): boolean {
  return !!env.CREEM_API_KEY && !!env.CREEM_WEBHOOK_SECRET;
}

export function creemApiBase(env: Env): string {
  return env.CREEM_TEST_MODE === '1' ? 'https://test-api.creem.io' : 'https://api.creem.io';
}

/** 商品映射（plans.code / billing_addons.code → Creem product id）。 */
export function creemProducts(env: Env): Record<string, string> {
  try {
    const m = JSON.parse(env.CREEM_PRODUCTS || '{}');
    return typeof m === 'object' && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export interface CheckoutInput {
  productId: string;
  /** 我们的订单 id，webhook 里按它对账 */
  requestId: string;
  successUrl: string;
  customerEmail?: string | null;
  metadata?: Record<string, string>;
}

export class CreemError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 建结账会话，返回给用户跳转的 checkout_url。 */
export async function createCheckout(
  env: Env,
  input: CheckoutInput,
): Promise<{ checkoutId: string; url: string }> {
  const body: Record<string, unknown> = {
    product_id: input.productId,
    request_id: input.requestId,
    success_url: input.successUrl,
    metadata: input.metadata ?? {},
  };
  if (input.customerEmail) body.customer = { email: input.customerEmail };

  const res = await fetch(`${creemApiBase(env)}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CREEM_API_KEY!,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new CreemError(res.status, `Creem 返回 ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json<{ id?: string; checkout_url?: string }>();
  if (!data.checkout_url) throw new CreemError(502, 'Creem 返回里没有 checkout_url');
  return { checkoutId: data.id ?? '', url: data.checkout_url };
}

/**
 * webhook 验签：creem-signature = HMAC-SHA256(rawBody, CREEM_WEBHOOK_SECRET) 的 hex。
 * 用 WebCrypto 常数时间比较（先 HMAC 一轮再比，长度不同也不短路）。
 */
export async function verifyWebhookSignature(
  env: Env,
  rawBody: string,
  signature: string | undefined | null,
): Promise<boolean> {
  if (!env.CREEM_WEBHOOK_SECRET || !signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.CREEM_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature.trim().toLowerCase());
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- webhook payload 的宽松形状。字段名以 Creem 文档为准，读的时候全部可选。 ---

export interface CreemWebhookEvent {
  id?: string;
  eventType?: string;
  created_at?: number;
  object?: CreemObject;
}

export interface CreemObject {
  id?: string;
  request_id?: string | null;
  metadata?: Record<string, unknown> | null;
  status?: string;
  customer?: { id?: string; email?: string } | string | null;
  product?: { id?: string } | string | null;
  subscription?: CreemSubscription | string | null;
  order?: {
    id?: string;
    amount?: number;
    currency?: string;
    metadata?: Record<string, unknown> | null;
  } | null;
  /** subscription.* 事件里 object 本身就是订阅 */
  current_period_end_date?: string | number | null;
}

export interface CreemSubscription {
  id?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  product?: { id?: string } | string | null;
  customer?: { id?: string; email?: string } | string | null;
  current_period_end_date?: string | number | null;
}

export function idOf(v: { id?: string } | string | null | undefined): string {
  if (!v) return '';
  return typeof v === 'string' ? v : (v.id ?? '');
}

export function emailOf(v: { email?: string } | string | null | undefined): string {
  if (!v || typeof v === 'string') return '';
  return v.email ?? '';
}

/** Creem 的时间字段既可能是 ISO 字符串也可能是毫秒数，统一转成秒级时间戳。 */
export function toEpochSeconds(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Math.floor(v > 10_000_000_000 ? v / 1000 : v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}
