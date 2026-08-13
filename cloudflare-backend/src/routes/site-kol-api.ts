import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { consumeQuota, getQuota, refundConsumed } from '../lib/quota';
import { findSimilarCreators } from '../lib/similarity';
import { notifyUser } from '../lib/inbox';
import { encryptSecret } from '../lib/mailcrypt';
import { sendOutreachMail, sentToday, SEND_DAILY_CAP } from '../lib/mail';
import { currentWebUser, pageLang } from '../site/session';

/**
 * 官网搜索页的同源 JSON API（cookie 会话鉴权，和 /v1/plugin 的 Token 头是两套）。
 *
 * 搜索数据源是 tikwm（TikTok 公开搜索）。主路径是浏览器直连 tikwm ——
 * 额度按用户自己的出口 IP 算，我们零成本；这里的 /search 只是直连失败时的
 * 服务器兜底，Workers 边缘出口是共享 IP、日额度常被别人烧光（见
 * lib/tiktok-resolver.ts 的注释与 6ec7b17），所以兜底必须挂配额闸门。
 *
 * 无论直连还是兜底，成功结果都回灌 D1（tk_creators source='search'）——
 * 本地索引随使用滚雪球，榜单/详情/相似达人的候选池都吃这份数据。
 */

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();
r.use('*', pageLang);

// ── 小工具 ──────────────────────────────────────────────────────────────────

/**
 * 同源写接口的 CSRF 闸：sid cookie 是 SameSite=Lax，跨站 fetch 本就带不上，
 * 这里再把带着异常 Sec-Fetch-Site / Origin 的请求拒掉一层。
 * 两个头都没有的老客户端放行 —— 鉴权本体始终是 cookie。
 */
function crossSite(c: { req: { header: (k: string) => string | undefined; url: string } }): boolean {
  const sfs = c.req.header('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return true;
  const origin = c.req.header('Origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function requireUser(c: {
  env: Env;
  req: { header: (k: string) => string | undefined; url: string };
}): Promise<UserRow | Response> {
  if (crossSite(c)) return fail(ERR.PARAM, '请求不合法');
  const user = await currentWebUser(c);
  if (!user) return fail(ERR.UNAUTHORIZED, '请先登录');
  return user;
}

const isDigits = (s: unknown): s is string => typeof s === 'string' && /^\d{1,30}$/.test(s);
const asCount = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const asRegion = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;

// ── tikwm 服务端调用（兜底路径）────────────────────────────────────────────
// 重试口径对齐 lib/tiktok-resolver.ts：每秒限流退避重试，日额度打满立刻放弃
// （Workers 出口是共享 IP，重试只会白等）。

async function tikwmGet(env: Env, path: string, params: Record<string, string>): Promise<unknown> {
  const base = (env.TIKWM_API_URL || 'https://www.tikwm.com/api/').replace(/\/$/, '');
  const qs = new URLSearchParams(params);
  if (env.TIKWM_API_KEY) qs.set('api_key', env.TIKWM_API_KEY);
  const url = `${base}/${path}?${qs}`;

  let lastMsg = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`tikwm http ${res.status}`);
    const body = (await res.json().catch(() => null)) as
      | { code?: number; msg?: string; data?: unknown }
      | null;
    if (!body) throw new Error('tikwm 返回非 JSON');
    if (body.code === 0) return body.data;

    lastMsg = String(body.msg || '');
    const m = lastMsg.toLowerCase();
    if (m.includes('day') || m.includes('daily')) throw new Error(`tikwm 当日额度已用尽: ${lastMsg}`);
    if (m.includes('limit') || m.includes('frequen') || m.includes('busy')) {
      await new Promise((rs) => setTimeout(rs, 1100 * attempt));
      continue;
    }
    return null; // 明确的「没有结果」
  }
  throw new Error(`tikwm rate limited after retries: ${lastMsg}`);
}

// ── 结果归一化 + 回灌 ───────────────────────────────────────────────────────

/** 搜索结果里达人的展示子集。浏览器直连时由前端归一化出同样的形状再回灌。 */
type CreatorItem = {
  id: string;
  uniqueId: string;
  nickname: string;
  region: string | null;
  followerCount: number | null;
  heartCount: number | null;
  videoCount: number | null;
  signature: string;
  verified: boolean;
  avatar: string;
};

type VideoItem = {
  id: string;
  title: string;
  region: string | null;
  cover: string;
  duration: number | null;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  createTime: number | null;
  authorId: string | null;
  authorUniqueId: string;
  authorNickname: string;
};

function normCreator(raw: unknown): CreatorItem | null {
  const o = raw as { user?: Record<string, unknown>; stats?: Record<string, unknown> };
  const u = o?.user ?? (raw as Record<string, unknown>);
  const s = o?.stats ?? (raw as { stats?: Record<string, unknown> })?.stats ?? {};
  if (!u || !isDigits(String(u.id ?? ''))) return null;
  const uniqueId = typeof u.uniqueId === 'string' ? u.uniqueId : String(u.unique_id ?? '');
  if (!/^[\w.\-]{1,64}$/.test(uniqueId)) return null;
  return {
    id: String(u.id),
    uniqueId,
    nickname: String(u.nickname ?? uniqueId).slice(0, 120),
    region: asRegion(u.region),
    followerCount: asCount((s as Record<string, unknown>).followerCount),
    heartCount: asCount((s as Record<string, unknown>).heartCount ?? (s as Record<string, unknown>).heart),
    videoCount: asCount((s as Record<string, unknown>).videoCount),
    signature: String(u.signature ?? '').slice(0, 300),
    verified: u.verified === true,
    avatar: typeof u.avatarThumb === 'string' ? u.avatarThumb : '',
  };
}

function normVideo(raw: unknown): VideoItem | null {
  const v = raw as Record<string, unknown>;
  const author = (v.author ?? {}) as Record<string, unknown>;
  const id = String(v.video_id ?? v.id ?? '');
  if (!isDigits(id)) return null;
  const cover = [v.cover, v.origin_cover, v.ai_dynamic_cover].find(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return {
    id,
    title: String(v.title ?? '').slice(0, 400),
    region: asRegion(v.region),
    cover: cover ? (cover.startsWith('/') ? `https://www.tikwm.com${cover}` : cover) : '',
    duration: asCount(v.duration),
    playCount: asCount(v.play_count),
    likeCount: asCount(v.digg_count),
    commentCount: asCount(v.comment_count),
    shareCount: asCount(v.share_count),
    createTime: asCount(v.create_time),
    authorId: isDigits(String(author.id ?? '')) ? String(author.id) : null,
    authorUniqueId: /^[\w.\-]{1,64}$/.test(String(author.unique_id ?? ''))
      ? String(author.unique_id)
      : '',
    authorNickname: String(author.nickname ?? '').slice(0, 120),
  };
}

/**
 * 回灌 tk_creators。source='search'：数据来自 TikTok 搜索，统计字段可信直接覆盖，
 * 但 payload 不许冲掉主页回流（source='profile'）攒下的完整资料。
 */
function creatorStmts(env: Env, items: CreatorItem[]): D1PreparedStatement[] {
  return items.map((x) =>
    env.DB.prepare(
      `INSERT INTO tk_creators
         (creator_id, unique_id, unique_id_lower, nickname, region, follower_count, payload, source, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'search', unixepoch())
       ON CONFLICT(creator_id) DO UPDATE SET
         unique_id = excluded.unique_id,
         unique_id_lower = excluded.unique_id_lower,
         nickname = excluded.nickname,
         region = COALESCE(excluded.region, tk_creators.region),
         follower_count = COALESCE(excluded.follower_count, tk_creators.follower_count),
         payload = CASE WHEN tk_creators.source = 'profile' THEN tk_creators.payload ELSE excluded.payload END,
         source = CASE WHEN tk_creators.source = 'profile' THEN 'profile' ELSE 'search' END,
         updated_at = unixepoch()`,
    ).bind(
      x.id,
      x.uniqueId,
      x.uniqueId.toLowerCase(),
      x.nickname,
      x.region,
      x.followerCount,
      JSON.stringify({
        uniqueId: x.uniqueId,
        nickname: x.nickname,
        region: x.region,
        followerCount: x.followerCount,
        heartCount: x.heartCount,
        videoCount: x.videoCount,
        signature: x.signature,
        verified: x.verified,
      }).slice(0, 900_000),
    ),
  );
}

/** 回灌 tk_videos。payload 带 author，小时级 derive_creators 任务会顺着补达人。 */
function videoStmts(env: Env, items: VideoItem[]): D1PreparedStatement[] {
  return items.map((x) =>
    env.DB.prepare(
      `INSERT INTO tk_videos
         (video_id, creator_id, region, title, pub_time, play_cnt, like_cnt, comment_cnt, forward_cnt, payload, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
       ON CONFLICT(video_id) DO UPDATE SET
         creator_id = COALESCE(?2, tk_videos.creator_id),
         region = COALESCE(?3, tk_videos.region),
         title = COALESCE(?4, tk_videos.title),
         pub_time = COALESCE(?5, tk_videos.pub_time),
         play_cnt = MAX(COALESCE(?6, 0), COALESCE(tk_videos.play_cnt, 0)),
         like_cnt = MAX(COALESCE(?7, 0), COALESCE(tk_videos.like_cnt, 0)),
         comment_cnt = MAX(COALESCE(?8, 0), COALESCE(tk_videos.comment_cnt, 0)),
         forward_cnt = MAX(COALESCE(?9, 0), COALESCE(tk_videos.forward_cnt, 0)),
         payload = COALESCE(?10, tk_videos.payload),
         updated_at = unixepoch()`,
    ).bind(
      x.id,
      x.authorId,
      x.region,
      x.title || null,
      x.createTime ? x.createTime * 1000 : null,
      x.playCount,
      x.likeCount,
      x.commentCount,
      x.shareCount,
      JSON.stringify({
        author: { id: x.authorId, unique_id: x.authorUniqueId, nickname: x.authorNickname },
        duration: x.duration,
        cover: x.cover ? 1 : 0, // 封面是限时签名 URL，存了也会过期，只记有无
      }).slice(0, 400_000),
    ),
  );
}

async function ingestBoth(env: Env, creators: CreatorItem[], videos: VideoItem[]): Promise<void> {
  const stmts = [...creatorStmts(env, creators.slice(0, 40)), ...videoStmts(env, videos.slice(0, 40))];
  if (stmts.length) await env.DB.batch(stmts);
}

// ── 批量任务：网页端发起相似达人 ────────────────────────────────────────────

/**
 * POST /kol/api/task/similar  body: { handles: string[], region?: string }
 *
 * 网页端「批量任务」创建入口：每个 handle 建一个 creator_similarity 任务，
 * 与插件端 /creator/similarity/async 同一口径 —— 每个达人扣 1 次 FindKol
 * 配额（consumeQuota 硬拦截），任务本体在 waitUntil 里跑，失败退配额。
 * 额度中途用完就停：已建的照常跑，返回 quotaExhausted 让前端提示。
 */
r.post('/kol/api/task/similar', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ handles?: unknown; region?: string }>(c);
  const handles = [
    ...new Set(
      (Array.isArray(b.handles) ? b.handles : [])
        .map((h) => String(h ?? '').trim().replace(/^@/, '').toLowerCase())
        .filter((h) => /^[\w.]{2,64}$/.test(h)),
    ),
  ].slice(0, 10);
  if (!handles.length) return fail(ERR.PARAM, '缺少达人标识');
  const region = String(b.region ?? '').trim().toUpperCase().slice(0, 8) || undefined;

  const created: string[] = [];
  let quotaExhausted = false;
  let dailyExceeded = false;
  for (const handle of handles) {
    const consumed = await consumeQuota(c.env, user, 'FindKol', 1);
    if (!consumed.ok) {
      quotaExhausted = true;
      dailyExceeded = Boolean(consumed.dailyExceeded);
      break;
    }
    const taskId = uuid();
    const input = { handleName: handle, region };
    await c.env.DB.prepare(
      `INSERT INTO async_tasks (task_id, user_id, type, status, input, creator_id, quota_record_id)
       VALUES (?1, ?2, 'creator_similarity', 'pending', ?3, ?4, ?5)`,
    )
      .bind(taskId, user.id, JSON.stringify(input), handle, consumed.recordId)
      .run();

    // 和插件端同一约束：任务绝对不能停在 pending，必须落终态，失败要退配额
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const list = await findSimilarCreators(c.env, user.id, input);
          await c.env.DB.prepare(
            `UPDATE async_tasks SET status = 'success', result = ?2, updated_at = unixepoch()
              WHERE task_id = ?1`,
          )
            .bind(taskId, JSON.stringify(list))
            .run();
          await notifyUser(c.env, user.id, {
            kind: 'task',
            tkey: 'nt_task_done',
            params: { handle, n: list.length },
            link: `/kol/task/${taskId}`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('web similarity 任务失败', taskId, msg);
          await c.env.DB.prepare(
            `UPDATE async_tasks SET status = 'failed', error = ?2, updated_at = unixepoch()
              WHERE task_id = ?1`,
          )
            .bind(taskId, msg.slice(0, 500))
            .run()
            .catch(() => {});
          await refundConsumed(c.env, user.id, consumed.recordId ?? '').catch(() => {});
          await notifyUser(c.env, user.id, {
            kind: 'task',
            tkey: 'nt_task_failed',
            params: { handle },
            link: `/kol/task/${taskId}`,
          });
        }
      })(),
    );
    created.push(taskId);
  }

  if (!created.length && quotaExhausted) {
    return fail(
      ERR.QUOTA_EXHAUSTED,
      dailyExceeded ? '今日次数已达上限，请明天再试或升级套餐' : '本月额度已用完，请升级套餐或购买加油包',
    );
  }
  return ok({ created: created.length, quotaExhausted });
});

/** POST /kol/api/inbox/read —— 把当前用户的站内消息全部标为已读。 */
r.post('/kol/api/inbox/read', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  await c.env.DB.prepare(
    `UPDATE user_messages SET read_at = unixepoch() WHERE user_id = ?1 AND read_at IS NULL`,
  )
    .bind(user.id)
    .run();
  return ok(true);
});

// ── 邮件建联（一期：绑定 SMTP / 单发 / 草稿 / 模板 / 导入联系人）──────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /kol/api/mail/account —— 绑定/更新发信邮箱。
 * body: { email, from_name?, smtp_host, smtp_port?, smtp_user?, smtp_pass }
 * 密码 AES-GCM 加密入库（lib/mailcrypt.ts）。端口只放行 SMTP 提交口
 * （465/587/2525），25 端口 Workers 出站本来就封。
 */
r.post('/kol/api/mail/account', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{
    email?: string;
    from_name?: string;
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    smtp_pass?: string;
  }>(c);
  const email = String(b.email ?? '').trim().toLowerCase();
  const host = String(b.smtp_host ?? '').trim().toLowerCase();
  const port = Number(b.smtp_port) || 587;
  const pass = String(b.smtp_pass ?? '');
  if (!EMAIL_RE.test(email) || !host || !pass) return fail(ERR.PARAM, '参数不完整');
  if (![465, 587, 2525].includes(port)) return fail(ERR.PARAM, '参数不完整');

  const enc = await encryptSecret(c.env, pass);
  await c.env.DB.prepare(
    `INSERT INTO mail_accounts (id, user_id, email, from_name, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(user_id) DO UPDATE SET
       email = ?3, from_name = ?4, smtp_host = ?5, smtp_port = ?6, smtp_user = ?7,
       smtp_pass = ?8, status = 'active'`,
  )
    .bind(
      uuid(),
      user.id,
      email,
      String(b.from_name ?? '').trim().slice(0, 100) || null,
      host.slice(0, 200),
      port,
      String(b.smtp_user ?? '').trim().slice(0, 200) || null,
      enc,
    )
    .run();
  return ok(true);
});

/** POST /kol/api/mail/account/delete —— 解绑发信邮箱。 */
r.post('/kol/api/mail/account/delete', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  await c.env.DB.prepare(`DELETE FROM mail_accounts WHERE user_id = ?1`).bind(user.id).run();
  return ok(true);
});

/**
 * POST /kol/api/mail/send —— 单发一封建联信。
 * body: { to, subject, text, draftId? }。发成功后顺手删掉对应草稿。
 */
r.post('/kol/api/mail/send', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ to?: string; subject?: string; text?: string; draftId?: string }>(c);
  const to = String(b.to ?? '').trim().toLowerCase();
  const subject = String(b.subject ?? '').trim().slice(0, 500);
  const text = String(b.text ?? '').trim().slice(0, 100_000);
  if (!EMAIL_RE.test(to) || !subject || !text) return fail(ERR.PARAM, '参数不完整');

  const res = await sendOutreachMail(c.env, user, { to, subject, text });
  if (!res.ok) {
    if (res.reason === 'no_account') return fail(ERR.PARAM, '请先绑定发信邮箱');
    if (res.reason === 'daily_cap') return fail(ERR.RATE_LIMITED, '今日发信已达上限，明天再继续吧');
    return fail(ERR.INTERNAL, '发送失败，请检查邮箱配置');
  }

  if (b.draftId) {
    await c.env.DB.prepare(
      `DELETE FROM mail_messages WHERE id = ?1 AND user_id = ?2 AND status = 'draft'`,
    )
      .bind(String(b.draftId).slice(0, 64), user.id)
      .run()
      .catch(() => {});
  }
  const used = await sentToday(c.env, user.id);
  return ok({ threadId: res.threadId, sentToday: used, cap: SEND_DAILY_CAP });
});

/** POST /kol/api/mail/draft —— 存草稿。body: { id?, to?, subject?, text? } */
r.post('/kol/api/mail/draft', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ id?: string; to?: string; subject?: string; text?: string }>(c);
  const to = String(b.to ?? '').trim().toLowerCase().slice(0, 320);
  const subject = String(b.subject ?? '').trim().slice(0, 500);
  const text = String(b.text ?? '').slice(0, 100_000);
  if (!to && !subject && !text) return fail(ERR.PARAM, '参数不完整');

  const id = String(b.id ?? '').slice(0, 64) || uuid();
  await c.env.DB.prepare(
    `INSERT INTO mail_messages (id, user_id, dir, status, to_addr, subject, body_text)
     VALUES (?1, ?2, 'out', 'draft', ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET
       to_addr = ?3, subject = ?4, body_text = ?5, updated_at = unixepoch()
     WHERE mail_messages.user_id = ?2 AND mail_messages.status = 'draft'`,
  )
    .bind(id, user.id, to, subject, text)
    .run();
  return ok({ id });
});

/** POST /kol/api/mail/draft/delete —— 删草稿。body: { id } */
r.post('/kol/api/mail/draft/delete', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ id?: string }>(c);
  if (!b.id) return fail(ERR.PARAM, '参数不完整');
  await c.env.DB.prepare(
    `DELETE FROM mail_messages WHERE id = ?1 AND user_id = ?2 AND status = 'draft'`,
  )
    .bind(String(b.id).slice(0, 64), user.id)
    .run();
  return ok(true);
});

/**
 * POST /kol/api/mail/template —— 建/改自定义模板。
 * body: { id?, title, subject, body, lang?, stage? }。系统模板（user_id IS NULL）不可改。
 */
r.post('/kol/api/mail/template', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{
    id?: string;
    title?: string;
    subject?: string;
    body?: string;
    lang?: string;
    stage?: string;
  }>(c);
  const title = String(b.title ?? '').trim().slice(0, 200);
  const subject = String(b.subject ?? '').trim().slice(0, 500);
  const body = String(b.body ?? '').trim().slice(0, 100_000);
  if (!title || !subject || !body) return fail(ERR.PARAM, '参数不完整');

  const id = String(b.id ?? '').slice(0, 64) || uuid();
  await c.env.DB.prepare(
    `INSERT INTO mail_templates (id, user_id, title, subject, body, lang, stage)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       title = ?3, subject = ?4, body = ?5, lang = ?6, stage = ?7, updated_at = unixepoch()
     WHERE mail_templates.user_id = ?2`,
  )
    .bind(
      id,
      user.id,
      title,
      subject,
      body,
      String(b.lang ?? '').trim().slice(0, 16) || null,
      String(b.stage ?? '').trim().slice(0, 40) || null,
    )
    .run();
  return ok({ id });
});

/** POST /kol/api/mail/template/delete —— 删自定义模板（系统模板删不掉）。 */
r.post('/kol/api/mail/template/delete', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ id?: string }>(c);
  if (!b.id) return fail(ERR.PARAM, '参数不完整');
  await c.env.DB.prepare(`DELETE FROM mail_templates WHERE id = ?1 AND user_id = ?2`)
    .bind(String(b.id).slice(0, 64), user.id)
    .run();
  return ok(true);
});

/**
 * POST /kol/api/mail/contacts/import —— 批量导入联系人。
 * body: { rows: Array<{ email?, name?, handle?, region?, note? }> }，单次 ≤1000。
 * CSV 解析在页面里做，这里只收结构化 JSON。按 (email, handle) 去重（INSERT OR IGNORE）。
 */
r.post('/kol/api/mail/contacts/import', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ rows?: unknown }>(c);
  const rows = (Array.isArray(b.rows) ? b.rows : [])
    .slice(0, 1000)
    .map((r0) => {
      const r0x = (r0 ?? {}) as Record<string, unknown>;
      const email = String(r0x.email ?? '').trim().toLowerCase().slice(0, 320);
      return {
        email: EMAIL_RE.test(email) ? email : null,
        name: String(r0x.name ?? '').trim().slice(0, 120) || null,
        handle: String(r0x.handle ?? '').trim().replace(/^@/, '').slice(0, 80) || null,
        region: String(r0x.region ?? '').trim().toUpperCase().slice(0, 8) || null,
        note: String(r0x.note ?? '').trim().slice(0, 500) || null,
      };
    })
    .filter((r1) => r1.email || r1.handle);
  if (!rows.length) return fail(ERR.PARAM, '参数不完整');

  let added = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const res = await c.env.DB.batch(
      rows.slice(i, i + 100).map((r1) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO mail_contacts (id, user_id, email, name, handle, region, note, source)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'import')`,
        ).bind(uuid(), user.id, r1.email, r1.name, r1.handle, r1.region, r1.note),
      ),
    );
    for (const r2 of res) added += r2.meta?.changes ?? 0;
  }
  return ok({ received: rows.length, added });
});

/**
 * POST /kol/api/mail/campaign —— 建一个群发任务。
 * body: { name, subject, body }。收件人 = 我的联系人里「有邮箱且未联系过」的，
 * 不在建任务时快照，而是每轮发送时实时筛（达人回信/被压制后自动跳过）。
 */
r.post('/kol/api/mail/campaign', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ name?: string; subject?: string; body?: string }>(c);
  const name = String(b.name ?? '').trim().slice(0, 200);
  const subject = String(b.subject ?? '').trim().slice(0, 500);
  const body = String(b.body ?? '').trim().slice(0, 100_000);
  if (!name || !subject || !body) return fail(ERR.PARAM, '参数不完整');

  const acct = await c.env.DB.prepare(
    `SELECT id FROM mail_accounts WHERE user_id = ?1 AND status = 'active'`,
  )
    .bind(user.id)
    .first();
  if (!acct) return fail(ERR.PARAM, '请先绑定发信邮箱');

  const target = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM mail_contacts c
      WHERE c.user_id = ?1 AND c.email IS NOT NULL AND c.contacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM mail_suppression s WHERE s.user_id = c.user_id AND s.email = c.email)`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  if (!target?.n) return fail(ERR.PARAM, '没有可发送的联系人');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO mail_campaigns (id, user_id, name, subject, body, total) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, user.id, name, subject, body, target.n)
    .run();
  return ok({ id, total: target.n });
});

/** POST /kol/api/mail/campaign/status —— 暂停/继续/结束。body: { id, status } */
r.post('/kol/api/mail/campaign/status', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ id?: string; status?: string }>(c);
  const status = String(b.status ?? '');
  if (!b.id || !['running', 'paused', 'done'].includes(status)) return fail(ERR.PARAM, '参数不完整');
  await c.env.DB.prepare(
    `UPDATE mail_campaigns SET status = ?3, updated_at = unixepoch() WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(String(b.id).slice(0, 64), user.id, status)
    .run();
  return ok(true);
});

/** POST /kol/api/mail/thread/read —— 线程标记已读。body: { threadId } */
r.post('/kol/api/mail/thread/read', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ threadId?: string }>(c);
  if (!b.threadId) return fail(ERR.PARAM, '参数不完整');
  await c.env.DB.prepare(
    `UPDATE mail_threads SET unread = 0 WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(String(b.threadId).slice(0, 64), user.id)
    .run();
  return ok(true);
});

// ── 搜索票据 + 兜底中转 ─────────────────────────────────────────────────────

/**
 * 搜索是会员功能，直连 tikwm 的路径不经过我们服务器，闸门只能设在
 * 「开始一次搜索」这一步：POST /kol/api/search-ticket 消耗 1 次 FindKol
 * 配额（口径抄原站：free 1/天、plus 50/月、pro 200/月，点数可折算），
 * 换一张 15 分钟内有效的票，同一次搜索的翻页（直连或兜底）都记在票上，
 * 不再重复扣费。前端拿不到票就不发起直连 —— 想绕过页面直接薅 tikwm 的人
 * 薅的是 tikwm 的公开接口，不消耗我们任何资源。
 */
const TICKET_PAGES = 8;

r.post('/kol/api/search-ticket', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ mode?: string; keyword?: string }>(c);
  if (!String(b.keyword ?? '').trim()) return fail(ERR.PARAM, '请输入搜索关键词');

  const consumed = await consumeQuota(c.env, user, 'FindKol', 1);
  if (!consumed.ok) {
    return fail(
      ERR.QUOTA_EXHAUSTED,
      consumed.dailyExceeded ? '今日次数已达上限，请明天再试或升级套餐' : '本月额度已用完，请升级套餐或购买加油包',
    );
  }
  const ticket = uuid();
  const [, state] = await Promise.all([
    c.env.KV.put(`skt:${ticket}`, JSON.stringify({ uid: user.id, pages: TICKET_PAGES }), {
      expirationTtl: 900,
    }),
    getQuota(c.env, user, 'FindKol').catch(() => null),
  ]);
  return ok({ ticket, remaining: state?.available ?? null });
});

/** 校验并核销一页票额。返回 true 表示这一页由票据覆盖，不用再扣配额。 */
async function spendTicketPage(env: Env, userId: string, ticket: string | undefined): Promise<boolean> {
  if (!ticket || !/^[\w-]{10,60}$/.test(ticket)) return false;
  const raw = await env.KV.get(`skt:${ticket}`);
  if (!raw) return false;
  try {
    const t = JSON.parse(raw) as { uid?: string; pages?: number };
    if (t.uid !== userId || !t.pages || t.pages <= 0) return false;
    await env.KV.put(`skt:${ticket}`, JSON.stringify({ uid: t.uid, pages: t.pages - 1 }), {
      expirationTtl: 900,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /kol/api/search-page  body: { ticket }
 * 直连路径的逐页核销：浏览器每翻一页（包括第一页）先来这里从票据额度里
 * 扣一页，扣成功才允许直连 tikwm。这样直连和兜底吃的是同一份 8 页预算，
 * 拿到一张票就无限翻的口子就堵上了 —— 页面上的「加载更多」在额度用完时
 * 提示重新搜索（重新搜索 = 重新扣一次 FindKol）。
 */
r.post('/kol/api/search-page', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ ticket?: string }>(c);
  const okPage = await spendTicketPage(c.env, user.id, b.ticket);
  if (!okPage) return fail(ERR.QUOTA_EXHAUSTED, '本次搜索的翻页额度已用完，请重新搜索');
  return ok({});
});

/**
 * POST /kol/api/search  body: { mode: 'user'|'video'|'id', keyword, cursor?, ticket? }
 * 直连失败时的服务器兜底。带有效票据的翻页不重复扣费；没票（老客户端 /
 * 直接调 API 的脚本）按次消耗 FindKol。上游全挂时退款。
 */
r.post('/kol/api/search', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ mode?: string; keyword?: string; cursor?: number; ticket?: string }>(c);
  const mode = b.mode === 'video' ? 'video' : b.mode === 'id' ? 'id' : 'user';
  const keyword = String(b.keyword ?? '').trim().slice(0, 80);
  const cursor = asCount(b.cursor) ?? 0;
  if (!keyword) return fail(ERR.PARAM, '请输入搜索关键词');

  const viaTicket = await spendTicketPage(c.env, user.id, b.ticket);
  let consumed: Awaited<ReturnType<typeof consumeQuota>> | null = null;
  if (!viaTicket) {
    consumed = await consumeQuota(c.env, user, 'FindKol', 1);
    if (!consumed.ok) {
      return fail(
        ERR.QUOTA_EXHAUSTED,
        consumed.dailyExceeded ? '今日次数已达上限，请明天再试或升级套餐' : '本月额度已用完，请升级套餐或购买加油包',
      );
    }
  }
  const refund = () =>
    consumed?.recordId ? refundConsumed(c.env, user.id, consumed.recordId).catch(() => {}) : Promise.resolve();

  try {
    if (mode === 'video') {
      const data = (await tikwmGet(c.env, 'feed/search', {
        keywords: keyword,
        count: '20',
        cursor: String(cursor),
      })) as { videos?: unknown[]; cursor?: number; has_more?: boolean } | null;
      const items = (data?.videos ?? []).map(normVideo).filter((x): x is VideoItem => !!x);
      c.executionCtx.waitUntil(ingestBoth(c.env, [], items));
      return ok({ mode, items, cursor: asCount(data?.cursor) ?? cursor + items.length, hasMore: !!data?.has_more });
    }

    if (mode === 'id') {
      const data = (await tikwmGet(c.env, 'user/info', { unique_id: keyword.replace(/^@/, '') })) as
        | { user?: unknown; stats?: unknown }
        | null;
      const one = data ? normCreator(data) : null;
      const items = one ? [one] : [];
      c.executionCtx.waitUntil(ingestBoth(c.env, items, []));
      return ok({ mode, items, cursor: 0, hasMore: false });
    }

    const data = (await tikwmGet(c.env, 'user/search', {
      keywords: keyword,
      count: '20',
      cursor: String(cursor),
    })) as { user_list?: unknown[]; cursor?: number; has_more?: boolean } | null;
    const items = (data?.user_list ?? []).map(normCreator).filter((x): x is CreatorItem => !!x);
    c.executionCtx.waitUntil(ingestBoth(c.env, items, []));
    return ok({ mode, items, cursor: asCount(data?.cursor) ?? cursor + items.length, hasMore: !!data?.has_more });
  } catch (e) {
    await refund();
    console.error('site search relay failed:', (e as Error).message);
    return fail(ERR.INTERNAL, '上游服务暂时不可用，请稍后重试');
  }
});

/**
 * POST /kol/api/detail-pass  body: {}
 * 达人详情页「实时刷新」的闸：也是浏览器直连 tikwm（user/info），不计数的话
 * 等于给登录用户留了一条免配额的 ID 直查通道。按用户按天封顶，超了前端
 * 只展示库存数据。上限给得宽（正常翻详情页根本碰不到），只拦脚本化薅法。
 */
const DETAIL_REFRESH_DAILY = 60;

r.post('/kol/api/detail-pass', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const day = new Date().toISOString().slice(0, 10);
  const key = `kdp:${user.id}:${day}`;
  const used = Number((await c.env.KV.get(key)) || 0);
  if (used >= DETAIL_REFRESH_DAILY) {
    return fail(ERR.RATE_LIMITED, '今日实时刷新次数已达上限，请明天再试');
  }
  await c.env.KV.put(key, String(used + 1), { expirationTtl: 172_800 });
  return ok({});
});

// ── 直连结果回灌 ────────────────────────────────────────────────────────────

/**
 * POST /kol/api/ingest  body: { creators?: CreatorItem[], videos?: VideoItem[] }
 * 浏览器直连 tikwm 成功后把结果交回来。逐条重新校验（客户端给什么都不信），
 * 登录可用，KV 记每日回灌行数上限，防灌垃圾。
 */
r.post('/kol/api/ingest', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ creators?: unknown[]; videos?: unknown[] }>(c);
  const creators = (b.creators ?? []).slice(0, 40).map(normCreator).filter((x): x is CreatorItem => !!x);
  const videos = (b.videos ?? []).slice(0, 40).map(normVideo).filter((x): x is VideoItem => !!x);
  const rows = creators.length + videos.length;
  if (!rows) return ok({ ingested: 0 });

  const day = new Date().toISOString().slice(0, 10);
  const key = `ski:${user.id}:${day}`;
  const used = Number((await c.env.KV.get(key)) || 0);
  if (used >= 1000) return ok({ ingested: 0 }); // 静默丢弃，不给探测面
  await c.env.KV.put(key, String(used + rows), { expirationTtl: 172_800 });

  await ingestBoth(c.env, creators, videos);
  return ok({ ingested: rows });
});

// ── 收藏 / 加入推广计划（网页端按钮）────────────────────────────────────────
// 表和插件侧完全同一套（collection_items / promotion_creators），
// 写入口径对齐 routes/collection.ts、routes/promotion.ts。

const DEFAULT_FOLDER = 'AITikTokDownloader_#Default';

async function ensureDefaultFolder(env: Env, userId: string, type: string): Promise<string> {
  const found = await env.DB.prepare(
    `SELECT id FROM collection_folders WHERE user_id = ?1 AND type = ?2 AND name = ?3`,
  )
    .bind(userId, type, DEFAULT_FOLDER)
    .first<{ id: string }>();
  if (found) return found.id;
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO collection_folders (id, user_id, name, type) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, userId, DEFAULT_FOLDER, type)
    .run();
  return id;
}

/** POST /kol/api/collect  body: { type: 'CREATOR'|'VIDEO', id, region?, uniqueId?, payload? } */
r.post('/kol/api/collect', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{
    type?: string;
    id?: string;
    region?: string;
    uniqueId?: string;
    payload?: Record<string, unknown>;
  }>(c);
  const type = (b.type || '').toUpperCase();
  const id = String(b.id ?? '').trim();
  if (!['CREATOR', 'VIDEO', 'PRODUCT'].includes(type) || !id || id.length > 80) {
    return fail(ERR.PARAM, '收藏内容不能为空');
  }

  const region = asRegion(b.region);
  const folderId = await ensureDefaultFolder(c.env, user.id, type);
  const payload = JSON.stringify({
    uniqueId: typeof b.uniqueId === 'string' ? b.uniqueId.slice(0, 64) : null,
    region,
    ...(typeof b.payload === 'object' && b.payload ? b.payload : {}),
  }).slice(0, 10_000);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO collection_items (folder_id, user_id, item_type, item_id, region, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(folder_id, item_type, item_id) DO UPDATE SET payload = ?6`,
    ).bind(folderId, user.id, type, id, region, payload),
    c.env.DB.prepare(
      `UPDATE collection_folders
       SET item_count = (SELECT COUNT(*) FROM collection_items WHERE folder_id = collection_folders.id),
           updated_at = unixepoch()
       WHERE user_id = ?1`,
    ).bind(user.id),
  ]);
  return ok({ added: 1 });
});

/** POST /kol/api/promotion-add  body: { creatorId(handle), region?, payload? } */
r.post('/kol/api/promotion-add', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ creatorId?: string; region?: string; payload?: Record<string, unknown> }>(c);
  const creatorId = String(b.creatorId ?? '').trim();
  if (!/^[\w.\-]{1,64}$/.test(creatorId)) return fail(ERR.PARAM, '达人列表为空');

  let planId: string;
  const def = await c.env.DB.prepare(
    `SELECT id FROM promotions WHERE user_id = ?1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
  )
    .bind(user.id)
    .first<{ id: string }>();
  if (def) {
    planId = def.id;
  } else {
    planId = uuid();
    await c.env.DB.prepare(`INSERT INTO promotions (id, user_id, name) VALUES (?1, ?2, '默认计划')`)
      .bind(planId, user.id)
      .run();
  }

  const payload = JSON.stringify({
    creatorId,
    region: asRegion(b.region),
    ...(typeof b.payload === 'object' && b.payload ? b.payload : {}),
  }).slice(0, 10_000);

  await c.env.DB.prepare(
    `INSERT INTO promotion_creators (promotion_id, user_id, creator_id, status, payload)
     VALUES (?1, ?2, ?3, 'collected', ?4)
     ON CONFLICT(promotion_id, creator_id) DO UPDATE SET status = 'collected', payload = ?4`,
  )
    .bind(planId, user.id, creatorId, payload)
    .run();
  return ok({ added: 1 });
});

// ── 保存的搜索条件（对照原站 /v1/creator/condition/*）────────────────────────

/** GET /kol/api/conditions */
r.get('/kol/api/conditions', async (c) => {
  const user = await currentWebUser(c);
  if (!user) return ok({ items: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, params FROM search_conditions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; params: string }>();
  return ok({ items: results ?? [] });
});

/** POST /kol/api/condition  body: { name, params } */
r.post('/kol/api/condition', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const b = await readJson<{ name?: string; params?: Record<string, unknown> }>(c);
  const name = String(b.name ?? '').trim().slice(0, 40);
  if (!name || typeof b.params !== 'object' || !b.params) return fail(ERR.PARAM, '参数错误');

  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) n FROM search_conditions WHERE user_id = ?1`)
    .bind(user.id)
    .first<{ n: number }>();
  if ((cnt?.n ?? 0) >= 20) return fail(ERR.PARAM, '保存的条件已达上限，请先删除一些');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO search_conditions (id, user_id, name, params, created_at)
     VALUES (?1, ?2, ?3, ?4, unixepoch())`,
  )
    .bind(id, user.id, name, JSON.stringify(b.params).slice(0, 2000))
    .run();
  return ok({ id, name });
});

/** POST /kol/api/condition/delete  body: { id } */
r.post('/kol/api/condition/delete', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const b = await readJson<{ id?: string }>(c);
  if (!b.id) return fail(ERR.PARAM, '参数错误');
  await c.env.DB.prepare(`DELETE FROM search_conditions WHERE id = ?1 AND user_id = ?2`)
    .bind(String(b.id), user.id)
    .run();
  return ok({});
});

export default r;
