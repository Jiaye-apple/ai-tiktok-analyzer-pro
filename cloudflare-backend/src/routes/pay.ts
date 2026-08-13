import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { grantExtra } from '../lib/quota';
import {
  createCheckout,
  creemConfigured,
  creemProducts,
  emailOf,
  idOf,
  toEpochSeconds,
  verifyWebhookSignature,
  type CreemObject,
  type CreemSubscription,
  type CreemWebhookEvent,
} from '../lib/creem';
import {
  createWaffoCheckout,
  waffoCanUseApi,
  waffoPaymentLinks,
  verifyWaffoSignature,
  waffoConfigured,
  waffoEpochSeconds,
  waffoProducts,
  type WaffoEventData,
  type WaffoWebhookEvent,
} from '../lib/waffo';
import { currentWebUser, pageLang } from '../site/session';
import { brandTitle, escapeHtml, html, page } from '../site/layout';
import { st } from '../site/i18n';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * 支付闭环：
 *
 *   /price 页点购买
 *     → POST /pay/checkout {item}            建订单 + Creem 结账会话
 *     → 跳 checkout_url 付款
 *     → Creem 回调 POST /webhooks/creem      验签 → 幂等去重 → 履约（唯一发货点）
 *     → 用户回跳 GET /pay/success?order=     纯展示页，轮询订单状态
 *
 * 登录既认官网 session cookie 也认扩展 Token 头，哪边来的都能买。
 */

/** 当前生效的支付渠道。切 Waffo 只要把 PAY_PROVIDER 设成 waffo。 */
function payProvider(env: Env): 'waffo' | 'creem' {
  return (env.PAY_PROVIDER || '').toLowerCase() === 'waffo' ? 'waffo' : 'creem';
}

function payConfigured(env: Env): boolean {
  return payProvider(env) === 'waffo' ? waffoConfigured(env) : creemConfigured(env);
}

function payProducts(env: Env): Record<string, string> {
  if (payProvider(env) !== 'waffo') return creemProducts(env);
  // 有私钥走 API（用 PROD_ 映射），否则走托管直链（用链接映射）
  return waffoCanUseApi(env) ? waffoProducts(env) : waffoPaymentLinks(env);
}

async function payCreateCheckout(
  env: Env,
  input: {
    productId: string;
    requestId: string;
    successUrl: string;
    customerEmail?: string | null;
    metadata?: Record<string, string>;
    /** plan = 订阅，addon = 一次性。Waffo 建会话时必须报准 */
    productType?: 'onetime' | 'subscription';
  },
): Promise<{ checkoutId: string; url: string }> {
  if (payProvider(env) !== 'waffo') return createCheckout(env, input);
  if (waffoCanUseApi(env)) return createWaffoCheckout(env, input);

  // 直链兜底：productId 这时装的就是 Waffo 托管结账直链。
  // 实测直链只认 email 这一个自定义参数（metadata / externalId / successUrl 都不生效），
  // 所以把买家邮箱预填进去，webhook 再靠 buyerEmail + 商品名反查订单。
  const link = input.productId;
  if (!/^https?:\/\//.test(link)) {
    throw new Error('Waffo 直链未配置或格式不对');
  }
  if (!input.customerEmail) return { checkoutId: '', url: link };
  const u = new URL(link);
  u.searchParams.set('email', input.customerEmail);
  return { checkoutId: '', url: u.toString() };
}

async function buyer(c: {
  env: Env;
  get: (k: 'user') => UserRow | null;
  req: { header: (k: string) => string | undefined };
}): Promise<UserRow | null> {
  return c.get('user') ?? (await currentWebUser(c));
}

interface PlanRow {
  code: string;
  name: string;
  price_cents: number;
  duration_days: number;
}

interface AddonRow {
  code: string;
  quota_type: string;
  amount: number;
  price_cents: number;
  enabled: number;
}

async function loadItem(
  env: Env,
  item: string,
): Promise<{ kind: 'plan'; plan: PlanRow } | { kind: 'addon'; addon: AddonRow } | null> {
  if (item.startsWith('addon_')) {
    const addon = await env.DB.prepare(`SELECT * FROM billing_addons WHERE code = ?1`)
      .bind(item)
      .first<AddonRow>();
    return addon ? { kind: 'addon', addon } : null;
  }
  const plan = await env.DB.prepare(
    `SELECT code, name, price_cents, duration_days FROM plans WHERE code = ?1 AND code != 'free'`,
  )
    .bind(item)
    .first<PlanRow>();
  return plan ? { kind: 'plan', plan } : null;
}

/**
 * GET /pay/items —— /price 页的按钮状态。
 * data: { configured, items: { [code]: true } }  （true = 已映射 Creem 商品，可买）
 */
r.get('/pay/items', async (c) => {
  const products = payProducts(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT code, enabled FROM billing_addons ORDER BY sort_order`,
  ).all<{ code: string; enabled: number }>();

  const items: Record<string, boolean> = {};
  for (const code of ['plus_month', 'plus_year', 'pro_month', 'pro_year']) {
    items[code] = payConfigured(c.env) && !!products[code];
  }
  for (const a of results ?? []) {
    items[a.code] = payConfigured(c.env) && !!a.enabled && !!products[a.code];
  }
  return ok({ configured: payConfigured(c.env), items });
});

/** POST /pay/checkout  body: { item }  →  data: { url, orderId } */
r.post('/pay/checkout', async (c) => {
  const user = await buyer(c);
  if (!user) return fail(ERR.SESSION_EXPIRED, '请先登录后再购买');

  if (!payConfigured(c.env)) return fail(ERR.NOT_IMPLEMENTED, '支付服务未配置，请联系管理员');

  const body = await readJson<{ item?: string }>(c);
  const itemCode = (body.item || '').trim();
  if (!itemCode) return fail(ERR.PARAM, '商品不存在');

  const item = await loadItem(c.env, itemCode);
  if (!item) return fail(ERR.PARAM, '商品不存在');
  if (item.kind === 'addon' && !item.addon.enabled) {
    return fail(ERR.PARAM, '该商品暂未开放购买');
  }

  const productId = payProducts(c.env)[itemCode];
  if (!productId) return fail(ERR.NOT_IMPLEMENTED, '该商品暂未开放购买');

  const orderId = uuid();
  const amount = item.kind === 'plan' ? item.plan.price_cents : item.addon.price_cents;

  await c.env.DB.prepare(
    `INSERT INTO orders (id, user_id, kind, item_code, amount_cents, currency, status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'USD', 'pending')`,
  )
    .bind(orderId, user.id, item.kind, itemCode, amount)
    .run();

  try {
    const { checkoutId, url } = await payCreateCheckout(c.env, {
      productId,
      requestId: orderId,
      successUrl: `${c.env.PUBLIC_SITE_URL}/pay/success?order=${orderId}`,
      customerEmail: user.email,
      metadata: { order_id: orderId, user_id: user.id, item: itemCode, kind: item.kind },
      productType: item.kind === 'plan' ? 'subscription' : 'onetime',
    });
    await c.env.DB.prepare(`UPDATE orders SET creem_checkout_id = ?2 WHERE id = ?1`)
      .bind(orderId, checkoutId)
      .run();
    return ok({ url, orderId });
  } catch (e) {
    console.error('checkout failed', e);
    await c.env.DB.prepare(`UPDATE orders SET status = 'canceled' WHERE id = ?1`)
      .bind(orderId)
      .run();
    return fail(ERR.INTERNAL, '创建支付会话失败，请稍后再试');
  }
});

/** GET /pay/order/:id/status —— 成功页轮询用。只给本人看。 */
r.get('/pay/order/:id/status', async (c) => {
  const user = await buyer(c);
  if (!user) return fail(ERR.SESSION_EXPIRED, '登录已过期，请重新登录');
  const row = await c.env.DB.prepare(
    `SELECT status, item_code AS itemCode, kind FROM orders WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(c.req.param('id'), user.id)
    .first<{ status: string; itemCode: string; kind: string }>();
  if (!row) return fail(ERR.NOT_FOUND, '订单不存在');
  return ok(row);
});

/** 支付回跳页。纯展示 + 轮询，不做任何履约。 */
r.get('/pay/success', pageLang, async (c) => {
  const orderId = (c.req.query('order') || '').replace(/[^0-9a-f-]/gi, '');
  return html(
    page({
      title: brandTitle(st('pay_title')),
      seo: { path: '/pay/success', noindex: true },
      style: `
  .pay-card{max-width:520px;margin:0 auto;text-align:center;padding:46px 32px}
  .pay-icon{font-size:40px;line-height:1;margin-bottom:14px}
  .pay-status{font-family:var(--serif);font-size:22px;font-weight:700;margin-bottom:8px}
  .pay-sub{color:var(--muted);font-size:13.5px;line-height:1.9}
  .pay-links{margin-top:26px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .pay-links a{
    display:inline-block;padding:10px 18px;border:1px solid var(--rule);border-radius:2px;
    text-decoration:none;font-size:13.5px;font-weight:600;
  }
  .pay-links a.main{background:var(--rule);color:var(--paper)}
`,
      body: `
<div class="card pay-card">
  <div class="pay-icon" id="ic">⧗</div>
  <div class="pay-status" id="stt">${st('pay_processing')}</div>
  <p class="pay-sub" id="sub">${st('pay_processing_hint')}</p>
  <div class="pay-links">
    <a class="main" href="/kol/personal?tab=rights">${st('pay_go_rights')}</a>
    <a href="/price">${st('pay_back_price')}</a>
  </div>
</div>`,
      script: `
(function(){
  var order=${JSON.stringify(orderId)};
  if(!order)return;
  var n=0;
  function tick(){
    n++;
    fetch('/pay/order/'+order+'/status').then(function(r){return r.json()}).then(function(res){
      if(res&&res.data&&res.data.status==='paid'){
        document.getElementById('ic').textContent='✓';
        document.getElementById('stt').textContent=${JSON.stringify(st('pay_done'))};
        document.getElementById('sub').textContent=${JSON.stringify(st('pay_done_hint'))};
        return;
      }
      if(n<40)setTimeout(tick,3000);
    }).catch(function(){ if(n<40)setTimeout(tick,3000); });
  }
  tick();
})();`,
    }),
  );
});

// ---------------------------------------------------------------------------
// Webhook —— 唯一的履约入口
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  user_id: string;
  kind: string;
  item_code: string;
  status: string;
  creem_subscription_id: string | null;
}

/** 会员时长入账。续期规则与激活码一致：没过期就往后叠，过期了从现在起算。 */
async function applyPlan(
  env: Env,
  userId: string,
  planCode: string,
  periodEnd: number | null,
): Promise<number> {
  const plan = await env.DB.prepare(`SELECT duration_days FROM plans WHERE code = ?1`)
    .bind(planCode)
    .first<{ duration_days: number }>();
  const days = plan?.duration_days || 31;

  const user = await env.DB.prepare(`SELECT plan_expire_at FROM users WHERE id = ?1`)
    .bind(userId)
    .first<{ plan_expire_at: number | null }>();

  const now = Math.floor(Date.now() / 1000);
  const base = user?.plan_expire_at && user.plan_expire_at > now ? user.plan_expire_at : now;
  // 订阅有明确账期就取两者较大：既不吃掉用户已有的剩余时长，也不落后于账期
  const expire = Math.max(base + days * 86400, periodEnd ?? 0);

  await env.DB.prepare(
    `UPDATE users SET plan_code = ?2, plan_expire_at = ?3, updated_at = unixepoch() WHERE id = ?1`,
  )
    .bind(userId, planCode, expire)
    .run();
  return expire;
}

async function fulfillOrder(env: Env, order: OrderRow, obj: CreemObject): Promise<string> {
  const sub = typeof obj.subscription === 'string' ? null : obj.subscription;
  const periodEnd = toEpochSeconds(sub?.current_period_end_date ?? obj.current_period_end_date);

  let note = '';
  if (order.kind === 'plan') {
    const expire = await applyPlan(env, order.user_id, order.item_code, periodEnd);
    note = `plan ${order.item_code} until ${expire}`;
  } else {
    const addon = await env.DB.prepare(`SELECT * FROM billing_addons WHERE code = ?1`)
      .bind(order.item_code)
      .first<{ quota_type: string; amount: number }>();
    if (addon) {
      // 加油包进长期池（period_key='all'），不随月清零 —— 原站积分规则第 2 条
      await grantExtra(env, order.user_id, addon.quota_type, addon.amount, 'forever');
      note = `addon ${order.item_code} +${addon.amount} ${addon.quota_type}`;
    } else {
      note = `addon ${order.item_code} missing`;
    }
  }

  await env.DB.prepare(
    `UPDATE orders SET
       status = 'paid', paid_at = unixepoch(),
       creem_order_id        = COALESCE(?2, creem_order_id),
       creem_customer_id     = COALESCE(?3, creem_customer_id),
       creem_subscription_id = COALESCE(?4, creem_subscription_id),
       meta = ?5
     WHERE id = ?1`,
  )
    .bind(
      order.id,
      obj.order?.id ?? null,
      idOf(obj.customer) || null,
      idOf(obj.subscription) || null,
      JSON.stringify({ note, at: Math.floor(Date.now() / 1000) }),
    )
    .run();
  return note;
}

async function findOrder(env: Env, obj: CreemObject): Promise<OrderRow | null> {
  const meta = obj.metadata ?? {};
  const byId = obj.request_id || (meta.order_id as string | undefined) || '';
  if (byId) {
    const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(byId)
      .first<OrderRow>();
    if (row) return row;
  }
  const subId = idOf(obj.subscription) || obj.id || '';
  if (subId) {
    return env.DB.prepare(
      `SELECT * FROM orders WHERE creem_subscription_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(subId)
      .first<OrderRow>();
  }
  return null;
}

/** 续费（subscription.paid）。object 就是订阅实体。 */
async function handleSubscriptionPaid(env: Env, subObj: CreemSubscription): Promise<string> {
  const meta = subObj.metadata ?? {};
  let order: OrderRow | null = null;

  const subId = subObj.id ?? '';
  if (subId) {
    order = await env.DB.prepare(
      `SELECT * FROM orders WHERE creem_subscription_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(subId)
      .first<OrderRow>();
  }
  if (!order && meta.order_id) {
    order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(String(meta.order_id))
      .first<OrderRow>();
  }
  if (!order) return 'no matching order';

  const periodEnd = toEpochSeconds(subObj.current_period_end_date);

  if (order.status !== 'paid') {
    // 首付时 subscription.paid 先于 checkout.completed 到 —— 直接当履约处理
    return fulfillOrder(env, order, {
      id: '',
      subscription: { id: subId, current_period_end_date: subObj.current_period_end_date },
      customer: typeof subObj.customer === 'string' ? null : subObj.customer,
      metadata: meta as Record<string, unknown>,
    });
  }

  // 续费：只往前推，max() 保证重复事件幂等
  const user = await env.DB.prepare(`SELECT plan_expire_at, plan_code FROM users WHERE id = ?1`)
    .bind(order.user_id)
    .first<{ plan_expire_at: number | null; plan_code: string }>();
  if (!user) return 'user missing';

  const now = Math.floor(Date.now() / 1000);
  const plan = await env.DB.prepare(`SELECT duration_days FROM plans WHERE code = ?1`)
    .bind(order.item_code)
    .first<{ duration_days: number }>();
  const fallback = (user.plan_expire_at && user.plan_expire_at > now ? user.plan_expire_at : now)
    + (plan?.duration_days || 31) * 86400;
  const target = Math.max(user.plan_expire_at ?? 0, periodEnd ?? fallback);

  if (target > (user.plan_expire_at ?? 0)) {
    await env.DB.prepare(
      `UPDATE users SET plan_code = ?2, plan_expire_at = ?3, updated_at = unixepoch() WHERE id = ?1`,
    )
      .bind(order.user_id, order.item_code, target)
      .run();
    return `renewed ${order.item_code} until ${target}`;
  }
  return 'already up to date';
}

r.post('/webhooks/creem', async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header('creem-signature');

  if (!(await verifyWebhookSignature(c.env, raw, sig))) {
    console.warn('creem webhook: bad signature');
    return c.text('bad signature', 401);
  }

  let evt: CreemWebhookEvent;
  try {
    evt = JSON.parse(raw) as CreemWebhookEvent;
  } catch {
    return c.text('bad json', 400);
  }

  const evtId = evt.id || `no-id-${crypto.randomUUID()}`;
  const type = evt.eventType || 'unknown';

  // 幂等去重：同一事件只处理一次（Creem 会重试投递）
  const dedupe = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, event_type) VALUES (?1, ?2)`,
  )
    .bind(evtId, type)
    .run();
  if (!dedupe.meta.changes) return c.text('ok (duplicate)', 200);

  let note = 'ignored';
  let orderId: string | null = null;
  try {
    const obj = evt.object ?? {};
    switch (type) {
      case 'checkout.completed': {
        const order = await findOrder(c.env, obj);
        if (!order) note = 'no matching order';
        else if (order.status === 'paid') note = 'already paid';
        else note = await fulfillOrder(c.env, order, obj);
        orderId = order?.id ?? null;
        break;
      }
      case 'subscription.paid':
      case 'subscription.active': {
        note = await handleSubscriptionPaid(c.env, obj as CreemSubscription);
        break;
      }
      case 'refund.created': {
        const creemOrderId = obj.order?.id ?? '';
        const order = creemOrderId
          ? await c.env.DB.prepare(`SELECT * FROM orders WHERE creem_order_id = ?1`)
              .bind(creemOrderId)
              .first<OrderRow>()
          : await findOrder(c.env, obj);
        if (!order) note = 'no matching order';
        else {
          await c.env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?1`)
            .bind(order.id)
            .run();
          if (order.kind === 'plan') {
            // 退的是当前在用的套餐 → 立即失效（配额规则随 effectivePlanCode 自动降回 free）
            await c.env.DB.prepare(
              `UPDATE users SET plan_expire_at = unixepoch(), updated_at = unixepoch()
               WHERE id = ?1 AND plan_code = ?2`,
            )
              .bind(order.user_id, order.item_code)
              .run();
          }
          note = `refunded ${order.item_code}`;
          orderId = order.id;
        }
        break;
      }
      default:
        note = 'ignored';
    }
  } catch (e) {
    console.error('creem webhook failed', type, e);
    // 处理失败要把去重记录撤掉，Creem 重试时才有机会重新处理
    await c.env.DB.prepare(`DELETE FROM webhook_events WHERE id = ?1`).bind(evtId).run();
    return c.text('internal error', 500);
  }

  await c.env.DB.prepare(`UPDATE webhook_events SET note = ?2, order_id = ?3 WHERE id = ?1`)
    .bind(evtId, note.slice(0, 300), orderId)
    .run();
  console.log(`creem webhook ${type}: ${note}`);
  return c.text('ok', 200);
});

// ---------------------------------------------------------------------------
// Waffo Pancake webhook —— 另一个履约入口，逻辑和 Creem 那条对齐
//
// 字段对应关系（沿用 orders 表已有的 creem_* 列，不额外加迁移）：
//   creem_order_id        ← Waffo data.orderId
//   creem_subscription_id ← 订阅类事件的 data.orderId（Waffo 订阅续费共用同一个 orderId）
// ---------------------------------------------------------------------------

/** 按 orderMerchantExternalId / orderMetadata.order_id / 已存的 Waffo orderId 找我们的订单。 */
async function findWaffoOrder(env: Env, d: WaffoEventData): Promise<OrderRow | null> {
  const ext = (d.orderMerchantExternalId || '').trim();
  if (ext) {
    const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(ext)
      .first<OrderRow>();
    if (row) return row;
  }
  const metaOrderId = String((d.orderMetadata as Record<string, unknown> | null)?.order_id ?? '');
  if (metaOrderId) {
    const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(metaOrderId)
      .first<OrderRow>();
    if (row) return row;
  }
  const waffoOrderId = (d.orderId || '').trim();
  if (waffoOrderId) {
    const row = await env.DB.prepare(
      `SELECT * FROM orders
        WHERE creem_subscription_id = ?1 OR creem_order_id = ?1
        ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(waffoOrderId)
      .first<OrderRow>();
    if (row) return row;
  }

  // 托管直链模式带不了订单号 —— 用买家邮箱找该用户最近一笔待付订单。
  // 商品名对得上就优先取它，对不上就退回「最近一笔 pending」。
  const email = (d.buyerEmail || '').trim().toLowerCase();
  if (email) {
    const byName = await env.DB.prepare(
      `SELECT o.* FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE lower(u.email) = ?1 AND o.status = 'pending'
        ORDER BY o.created_at DESC LIMIT 5`,
    )
      .bind(email)
      .all<OrderRow>();
    const rows = byName.results ?? [];
    if (rows.length) {
      const pname = (d.productName || '').toLowerCase();
      if (pname) {
        for (const r of rows) {
          const item = await env.DB.prepare(
            `SELECT name FROM plans WHERE code = ?1
             UNION ALL SELECT code AS name FROM billing_addons WHERE code = ?1`,
          )
            .bind(r.item_code)
            .first<{ name: string }>();
          const key = (item?.name || r.item_code).toLowerCase();
          if (key && pname.includes(key)) return r;
        }
      }
      return rows[0];
    }
  }
  return null;
}

/** 首次履约：发套餐时长或加油包额度，并把订单置为 paid。 */
async function fulfillWaffoOrder(
  env: Env,
  order: OrderRow,
  d: WaffoEventData,
  isSubscription: boolean,
): Promise<string> {
  const periodEnd = waffoEpochSeconds(d.currentPeriodEnd);

  let note = '';
  if (order.kind === 'plan') {
    const expire = await applyPlan(env, order.user_id, order.item_code, periodEnd);
    note = `plan ${order.item_code} until ${expire}`;
  } else {
    const addon = await env.DB.prepare(`SELECT * FROM billing_addons WHERE code = ?1`)
      .bind(order.item_code)
      .first<{ quota_type: string; amount: number }>();
    if (addon) {
      await grantExtra(env, order.user_id, addon.quota_type, addon.amount, 'forever');
      note = `addon ${order.item_code} +${addon.amount} ${addon.quota_type}`;
    } else {
      note = `addon ${order.item_code} missing`;
    }
  }

  await env.DB.prepare(
    `UPDATE orders SET
       status = 'paid', paid_at = unixepoch(),
       creem_order_id        = COALESCE(?2, creem_order_id),
       creem_subscription_id = COALESCE(?3, creem_subscription_id),
       meta = ?4
     WHERE id = ?1`,
  )
    .bind(
      order.id,
      d.orderId ?? null,
      isSubscription ? (d.orderId ?? null) : null,
      JSON.stringify({ note, provider: 'waffo', at: Math.floor(Date.now() / 1000) }),
    )
    .run();
  return note;
}

/** 续费：只往前推到期时间，重复投递天然幂等。 */
async function renewWaffoSubscription(env: Env, d: WaffoEventData): Promise<string> {
  const order = await findWaffoOrder(env, d);
  if (!order) return 'no matching order';

  // 首付时 payment_succeeded 可能先于 activated 到 —— 当首次履约处理
  if (order.status !== 'paid') return fulfillWaffoOrder(env, order, d, true);
  if (order.kind !== 'plan') return 'not a plan order';

  const user = await env.DB.prepare(`SELECT plan_expire_at FROM users WHERE id = ?1`)
    .bind(order.user_id)
    .first<{ plan_expire_at: number | null }>();
  if (!user) return 'user missing';

  const now = Math.floor(Date.now() / 1000);
  const plan = await env.DB.prepare(`SELECT duration_days FROM plans WHERE code = ?1`)
    .bind(order.item_code)
    .first<{ duration_days: number }>();
  const fallback =
    (user.plan_expire_at && user.plan_expire_at > now ? user.plan_expire_at : now) +
    (plan?.duration_days || 31) * 86400;
  const target = Math.max(user.plan_expire_at ?? 0, waffoEpochSeconds(d.currentPeriodEnd) ?? fallback);

  if (target > (user.plan_expire_at ?? 0)) {
    await env.DB.prepare(
      `UPDATE users SET plan_code = ?2, plan_expire_at = ?3, updated_at = unixepoch() WHERE id = ?1`,
    )
      .bind(order.user_id, order.item_code, target)
      .run();
    return `renewed ${order.item_code} until ${target}`;
  }
  return 'already up to date';
}

r.post('/webhooks/waffo', async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header('X-Waffo-Signature') || c.req.header('x-waffo-signature');

  if (!(await verifyWaffoSignature(c.env, raw, sig))) {
    console.warn('waffo webhook: bad signature');
    return c.text('bad signature', 401);
  }

  let evt: WaffoWebhookEvent;
  try {
    evt = JSON.parse(raw) as WaffoWebhookEvent;
  } catch {
    return c.text('bad json', 400);
  }

  const evtId = evt.eventId || evt.id || `no-id-${crypto.randomUUID()}`;
  const type = evt.eventType || 'unknown';
  const d: WaffoEventData = evt.data ?? {};

  const dedupe = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, event_type) VALUES (?1, ?2)`,
  )
    .bind(evtId, type)
    .run();
  if (!dedupe.meta.changes) return c.text('ok (duplicate)', 200);

  let note = 'ignored';
  let orderId: string | null = null;
  try {
    switch (type) {
      case 'order.completed':
      case 'subscription.activated': {
        const order = await findWaffoOrder(c.env, d);
        if (!order) note = 'no matching order';
        else if (order.status === 'paid') note = 'already paid';
        else note = await fulfillWaffoOrder(c.env, order, d, type === 'subscription.activated');
        orderId = order?.id ?? null;
        break;
      }
      case 'subscription.payment_succeeded': {
        note = await renewWaffoSubscription(c.env, d);
        break;
      }
      case 'refund.succeeded': {
        const order = await findWaffoOrder(c.env, d);
        if (!order) note = 'no matching order';
        else {
          await c.env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?1`)
            .bind(order.id)
            .run();
          if (order.kind === 'plan') {
            await c.env.DB.prepare(
              `UPDATE users SET plan_expire_at = unixepoch(), updated_at = unixepoch()
               WHERE id = ?1 AND plan_code = ?2`,
            )
              .bind(order.user_id, order.item_code)
              .run();
          }
          note = `refunded ${order.item_code}`;
          orderId = order.id;
        }
        break;
      }
      case 'subscription.canceled': {
        // 账期结束才真正终止；到期时间到点自然失效，这里只留痕
        const order = await findWaffoOrder(c.env, d);
        orderId = order?.id ?? null;
        note = order ? `canceled ${order.item_code}` : 'no matching order';
        break;
      }
      case 'subscription.past_due': {
        const order = await findWaffoOrder(c.env, d);
        orderId = order?.id ?? null;
        note = order ? `past_due ${order.item_code}` : 'no matching order';
        break;
      }
      default:
        note = 'ignored';
    }
  } catch (e) {
    console.error('waffo webhook failed', type, e);
    await c.env.DB.prepare(`DELETE FROM webhook_events WHERE id = ?1`).bind(evtId).run();
    return c.text('internal error', 500);
  }

  await c.env.DB.prepare(`UPDATE webhook_events SET note = ?2, order_id = ?3 WHERE id = ?1`)
    .bind(evtId, note.slice(0, 300), orderId)
    .run();
  console.log(`waffo webhook ${type}: ${note}`);
  return c.text('ok', 200);
});

export default r;
