import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { issueToken, uuid } from '../lib/auth';
import { grantExtra } from '../lib/quota';
import { httpProviderOf, resolveChain } from '../lib/providers';
import { accessIdentityBlocked } from '../lib/owner';
import { runJobNow } from '../lib/jobs';
import { notifyUser } from '../lib/inbox';
import { feedbackAdminData, feedbackAdminPage, feedbackAdminShot } from './site';
import { adminHomePage } from './admin-home';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * 运营后台接口。两条进门方式，满足其一即可：
 *
 *   1) X-Admin-Key（`wrangler secret put ADMIN_KEY` 设置，别写进 wrangler.jsonc）
 *      —— 给脚本用：deploy.sh 自检、smoke-test、本地调试。线上这些脚本还要
 *      同时带 Access service token 双头，不然过不了边缘的 Access 墙。
 *   2) Cloudflare Access 邮箱身份（属主本人浏览器登录，lib/owner.ts 校验）
 *
 * 都没有就返回和全局 404 一字不差的假 404 —— 对外 /admin 不存在。
 * （原来这里返回「无权限」，等于告诉扫路径的人这里有东西。）
 */
r.use('*', async (c, next) => {
  const viaKey = !!c.env.ADMIN_KEY && c.req.header('X-Admin-Key') === c.env.ADMIN_KEY;
  if (!viaKey) {
    const blocked = accessIdentityBlocked(c);
    if (blocked) return blocked;
  }
  await next();
});

// 后台首页。/admin 本来是个纯前缀，浏览器开进来只有全局 404，
// 和「被墙拦了」的假 404 一字不差，分不清是没权限还是地址错。
r.get('/', adminHomePage);

// 意见反馈查看页（实现在 routes/site.ts，页面里 data/shot 路径按当前路径自适应）。
// 首选入口：/feedback/admin 需要单独的边缘 Access 应用，但管理 Access 的
// API token 权限缺失时建不了；/admin/* 的墙早就立着，挂这里零配置可用。
r.get('/feedback', feedbackAdminPage);
r.get('/feedback/data', feedbackAdminData);
r.get('/feedback/shot', feedbackAdminShot);

/** 建用户。官网注册流程走这个，或者你自己在官网直接写库。 */
r.post('/users', async (c) => {
  const b = await readJson<{ username?: string; email?: string; phone?: string; headUrl?: string; planCode?: string }>(c);
  if (!b.username) return fail(ERR.PARAM, '缺少 username');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, email, phone, head_url, plan_code)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, b.username, b.email ?? null, b.phone ?? null, b.headUrl ?? null, b.planCode ?? 'free')
    .run();

  return ok({ id });
});

/** 直接发一个长期 token，调试用。生产环境的登录请走 /public/login-code。 */
r.post('/users/:id/token', async (c) => {
  const token = await issueToken(c.env, c.req.param('id'), 'admin');
  return ok({ token });
});

/** 改会员。plan_expire_at 传 0 表示不过期。 */
r.post('/users/:id/plan', async (c) => {
  const b = await readJson<{ planCode?: string; expireAt?: number }>(c);
  if (!b.planCode) return fail(ERR.PARAM, '缺少 planCode');

  await c.env.DB.prepare(
    `UPDATE users SET plan_code = ?2, plan_expire_at = ?3, updated_at = unixepoch() WHERE id = ?1`,
  )
    .bind(c.req.param('id'), b.planCode, b.expireAt ?? null)
    .run();
  return ok(true);
});

/** 补额度（加油包 / 售后补偿）。 */
r.post('/users/:id/quota/grant', async (c) => {
  const b = await readJson<{ quotaType?: string; amount?: number; period?: string }>(c);
  if (!b.quotaType || !b.amount) return fail(ERR.PARAM, '缺少 quotaType 或 amount');

  await grantExtra(c.env, c.req.param('id'), b.quotaType, b.amount, b.period ?? 'month');
  return ok(true);
});

/** GET /admin/plans —— 套餐字典。首页的发码下拉从这里读，别在前端写死副本。 */
r.get('/plans', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT code, name, level, price_cents AS priceCents, duration_days AS durationDays
     FROM plans ORDER BY sort_order ASC`,
  ).all();
  return ok(results ?? []);
});

/**
 * 批量生成激活码。
 * body: { planCode, durationDays, count, batch?, maxUses?, expireAt?, note? }
 * 返回生成的码列表，**只返回这一次**，之后就只能从库里查。
 */
r.post('/activation/generate', async (c) => {
  const b = await readJson<{
      planCode?: string;
      durationDays?: number;
      count?: number;
      batch?: string;
      maxUses?: number;
      expireAt?: number;
      note?: string;
    }>(c);

  if (!b.planCode || !b.durationDays) return fail(ERR.PARAM, '缺少 planCode 或 durationDays');
  const count = Math.min(Math.max(1, b.count ?? 1), 1000);

  const plan = await c.env.DB.prepare(`SELECT code FROM plans WHERE code = ?1`)
    .bind(b.planCode)
    .first();
  if (!plan) return fail(ERR.PARAM, `套餐 ${b.planCode} 不存在`);

  const batch = b.batch || `B${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const codes: string[] = [];
  const stmts = [];

  for (let i = 0; i < count; i++) {
    const code = genCode();
    codes.push(code);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO activation_codes (code, plan_code, duration_days, batch, note, max_uses, expire_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        code,
        b.planCode,
        b.durationDays,
        batch,
        b.note ?? null,
        b.maxUses ?? 1,
        b.expireAt ?? null,
      ),
    );
  }

  // D1 的 batch 一次别塞太多，分片提交
  for (let i = 0; i < stmts.length; i += 50) {
    await c.env.DB.batch(stmts.slice(i, i + 50));
  }

  return ok({ batch, count, codes });
});

/** 作废激活码（整批或单张）。 */
r.post('/activation/disable', async (c) => {
  const b = await readJson<{ batch?: string; code?: string }>(c);
  if (b.code) {
    await c.env.DB.prepare(`UPDATE activation_codes SET status = 'disabled' WHERE code = ?1`)
      .bind(b.code.toUpperCase())
      .run();
  } else if (b.batch) {
    await c.env.DB.prepare(
      `UPDATE activation_codes SET status = 'disabled' WHERE batch = ?1 AND status = 'unused'`,
    )
      .bind(b.batch)
      .run();
  } else {
    return fail(ERR.PARAM, '需要 code 或 batch');
  }
  return ok(true);
});

/** 查某批激活码的使用情况。 */
r.get('/activation/batch/:batch', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT code, plan_code AS planCode, duration_days AS days, status,
            used_count AS usedCount, max_uses AS maxUses, created_at AS createdAt
     FROM activation_codes WHERE batch = ?1 ORDER BY created_at ASC`,
  )
    .bind(c.req.param('batch'))
    .all();
  return ok(results ?? []);
});

/**
 * 结算超时未 release 的预扣配额。
 * 前端只在失败时 release，成功了不会 commit，所以 held 记录会一直挂着。
 * 建议配一条 Cron Trigger 每小时跑一次。
 */
r.post('/quota/settle', async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE quota_records SET status = 'committed', settled_at = unixepoch()
     WHERE status = 'held' AND created_at < unixepoch() - 3600`,
  ).run();
  return ok({ settled: res.meta.changes ?? 0 });
});

/**
 * POST /admin/ai/selftest
 *
 * 逐个供应商实际发一次请求，把「谁通了、谁挂了、挂在哪一步」打出来。
 *
 * 为什么需要这个：Groq 会按 IP/地区拦请求（从国内开发机直连拿到的是
 * 403 "Access denied. Please check your network settings."，不是鉴权错误），
 * 但 Worker 是从 Cloudflare 边缘发出去的，通不通只能部署后才知道。
 * 模型 ID 也一样 —— 各家改名很勤，写死的默认值可能过期。
 *
 * 部署后跑一次，按结果调 wrangler.jsonc 里的模型名就行。
 */
r.post('/ai/selftest', async (c) => {
  const results: Array<Record<string, unknown>> = [];
  const chatChain = resolveChain(c.env, 'chat');
  const asrChain = resolveChain(c.env, 'asr');

  for (const name of new Set([...chatChain, ...asrChain])) {
    const p = httpProviderOf(c.env, name);
    const entry: Record<string, unknown> = { provider: name };

    if (name === 'workers-ai') {
      entry.chatModel = c.env.WORKERS_AI_CHAT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
      entry.asrModel = c.env.WORKERS_AI_ASR_MODEL || '@cf/openai/whisper-large-v3-turbo';
      try {
        const out = (await c.env.AI!.run(entry.chatModel as never, {
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
          max_tokens: 16,
        } as never)) as { response?: string };
        entry.chat = { ok: true, sample: String(out?.response ?? '').slice(0, 40) };
      } catch (e) {
        entry.chat = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      results.push(entry);
      continue;
    }

    if (!p) {
      entry.chat = { ok: false, error: '未配置 API key' };
      results.push(entry);
      continue;
    }

    entry.baseUrl = p.baseUrl;
    entry.chatModel = p.chatModel;
    entry.asrModel = p.asrModel;

    // 1) 模型列表：能不能连上、key 对不对，一次就能看出来
    try {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${p.apiKey}` },
      });
      const body = await res.text();
      entry.reachable = { ok: res.ok, status: res.status, body: res.ok ? undefined : body.slice(0, 200) };
      if (res.ok) {
        try {
          const ids = (JSON.parse(body).data ?? []).map((m: { id: string }) => m.id) as string[];
          entry.chatModelExists = ids.includes(p.chatModel);
          entry.asrModelExists = ids.includes(p.asrModel);
          entry.modelCount = ids.length;
        } catch {
          /* 有的服务 /models 结构不一样，跳过就行 */
        }
      }
    } catch (e) {
      entry.reachable = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // 2) 真发一次对话请求
    try {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify({
          model: p.chatModel,
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
          max_tokens: 16,
        }),
      });
      const body = await res.text();
      entry.chat = res.ok
        ? { ok: true, sample: (JSON.parse(body).choices?.[0]?.message?.content ?? '').slice(0, 40) }
        : { ok: false, status: res.status, error: body.slice(0, 200) };
    } catch (e) {
      entry.chat = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    results.push(entry);
  }

  return ok({
    chatChain,
    asrChain,
    results,
    hint: '按 chatChain 顺序降级；某家 reachable.ok=false 说明网络或 key 有问题，chatModelExists=false 说明模型名过期了',
  });
});

/** 功能许愿列表（官网 /wish 表单的落库）。浏览器查看走 /wish/admin 那张页。 */
r.get('/wishes', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);

  const { results } = await c.env.DB.prepare(
    `SELECT id, message, contact, lang, created_at AS createdAt
     FROM feature_wishes ORDER BY id DESC LIMIT ?1 OFFSET ?2`,
  )
    .bind(limit, offset)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM feature_wishes`).first<{
    n: number;
  }>();

  return ok({ total: total?.n ?? 0, items: results });
});

function genCode(): string {
  // 去掉容易看错的 0/O/1/I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const s = [...bytes].map((b) => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

/** GET /admin/orders?status=&limit= —— Creem 订单流水（对账 / 售后查询用）。 */
r.get('/orders', async (c) => {
  const status = c.req.query('status') || '';
  const limit = Math.min(Number(c.req.query('limit') || 100), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, u.username, u.email FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     ${status ? 'WHERE o.status = ?2' : ''}
     ORDER BY o.created_at DESC LIMIT ?1`,
  )
    .bind(...(status ? [limit, status] : [limit]))
    .all();
  return ok(results ?? []);
});

/** POST /admin/announcements —— 发站内公告。body: { title, body, lang?, pinned? } */
r.post('/announcements', async (c) => {
  const b = await readJson<{ title?: string; body?: string; lang?: string; pinned?: boolean }>(c);
  const title = String(b.title ?? '').trim().slice(0, 200);
  const bodyText = String(b.body ?? '').trim().slice(0, 4000);
  if (!title || !bodyText) return fail(ERR.PARAM, '参数不完整');
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO announcements (id, title, body, lang, pinned, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())`,
  )
    .bind(id, title, bodyText, b.lang || null, b.pinned ? 1 : 0)
    .run();
  return ok({ id });
});

/**
 * POST /admin/notify —— 给单个用户发站内消息（消息中心「消息」tab）。
 * body: { userId, title, body?, link? }。自由文本，按原样展示，不走 i18n。
 */
r.post('/notify', async (c) => {
  const b = await readJson<{ userId?: string; title?: string; body?: string; link?: string }>(c);
  const userId = String(b.userId ?? '').trim();
  const title = String(b.title ?? '').trim().slice(0, 200);
  if (!userId || !title) return fail(ERR.PARAM, '参数不完整');
  const exists = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?1`).bind(userId).first();
  if (!exists) return fail(ERR.PARAM, '用户不存在');
  await notifyUser(c.env, userId, {
    kind: 'system',
    title,
    body: String(b.body ?? '').trim().slice(0, 4000) || undefined,
    link: String(b.link ?? '').trim().slice(0, 300) || undefined,
  });
  return ok(true);
});

/** GET /admin/announcements —— 公告列表（含隐藏的）。 */
r.get('/announcements', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 300`,
  ).all();
  return ok(results ?? []);
});

/** POST /admin/announcements/:id/hide —— 下线一条公告（不物理删除）。 */
r.post('/announcements/:id/hide', async (c) => {
  await c.env.DB.prepare(`UPDATE announcements SET status = 'hidden' WHERE id = ?1`)
    .bind(c.req.param('id'))
    .run();
  return ok({});
});

/**
 * POST /admin/jobs/run —— 手动跑一个离线任务，不用等 cron。
 *
 * body: { kind: <lib/jobs.ts 里 JobMessage 的任意 kind>, limit?: number }
 *
 * 平时这些活儿由 cron 每小时/每天投进队列跑（见 lib/jobs.ts）。
 * 但改完代码要立刻看效果、或者想把存量数据一次性回填时，等一小时太慢。
 * 这个接口**同步执行**并把结果返回，方便对着看。
 *
 * 注意是同步跑，会吃 Worker 的 CPU 时间，limit 别开太大 ——
 * 大批量回填还是让 cron 慢慢投队列更稳。
 */
r.post('/jobs/run', async (c) => {
  const b = await readJson<{ kind?: string; limit?: number }>(c);
  const kind = String(b.kind || '');
  const limit = Math.min(Math.max(Number(b.limit) || 200, 1), 2000);

  const started = Date.now();
  try {
    const res = await runJobNow(c.env, kind, limit);
    return ok({ kind, ...res, ms: Date.now() - started });
  } catch (err) {
    return fail(ERR.INTERNAL, err instanceof Error ? err.message : String(err));
  }
});

/** GET /admin/webhook-events?limit= —— webhook 处理流水，排支付问题先看这里。 */
r.get('/webhook-events', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || 100), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ?1`,
  )
    .bind(limit)
    .all();
  return ok(results ?? []);
});

export default r;
