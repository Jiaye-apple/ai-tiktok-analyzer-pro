/**
 * 邮件建联的发信侧（收信侧在 mail-inbound.ts，刻意分开 —— worker-mailer
 * require('cloudflare:sockets')，混在一起会让收信逻辑没法跑单元测试）。
 *
 * 为什么是「用户自带邮箱」：2026-08 调研结论 —— 所有主流 ESP
 * （Resend/SES/Postmark/SendGrid/Brevo）的 AUP 都明文禁止冷邮件和爬取来源的
 * 收件人，平台统一代发必被封号。成熟 outreach SaaS（Instantly/Smartlead）的
 * 共同架构就是平台只做编排、用用户自己的邮箱发。发信信誉风险归用户邮箱，
 * SMTP 凭据加密存储（lib/mailcrypt.ts）。
 *
 * 收信闭环：发信时 Reply-To 指到 reply+{threadId}@<MAIL_DOMAIN>（plus addressing）；
 * Cloudflare Email Routing 的一条 `reply@` 规则把来信投给 email() handler，
 * 按地址里的 threadId 归线程，In-Reply-To 头兜底（listmonk 的归因思路）。
 */
import { WorkerMailer } from 'worker-mailer';
import type { Env, UserRow } from './types';
import { uuid } from './auth';
import { decryptSecret } from './mailcrypt';

/**
 * 单邮箱每日发信上限。
 * warmup 调研结论：养熟的邮箱冷邮件天花板约 30-40 封/天，超发直接损伤
 * 用户自己邮箱的信誉。这是产品内置的保护性硬限，不是配额商品。
 */
export const SEND_DAILY_CAP = 40;

/** 正文入库截断。完整内容（入站）在 R2 的原始 .eml 里。 */
const BODY_MAX = 32_000;

export interface MailAccountRow {
  id: string;
  user_id: string;
  email: string;
  from_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_pass: string;
  status: string;
  last_ok_at: number | null;
}

export async function getMailAccount(env: Env, userId: string): Promise<MailAccountRow | null> {
  return env.DB.prepare(`SELECT * FROM mail_accounts WHERE user_id = ?1`)
    .bind(userId)
    .first<MailAccountRow>();
}

export async function sentToday(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) n FROM mail_messages
      WHERE user_id = ?1 AND dir = 'out' AND status = 'sent'
        AND created_at >= unixepoch('now','start of day')`,
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 找到（或建出）「我 × 对方地址」的线程。 */
export async function ensureThread(
  env: Env,
  userId: string,
  peerEmail: string,
  subject: string | null,
): Promise<string> {
  const peer = peerEmail.toLowerCase();
  const hit = await env.DB.prepare(
    `SELECT id FROM mail_threads WHERE user_id = ?1 AND peer_email = ?2 LIMIT 1`,
  )
    .bind(userId, peer)
    .first<{ id: string }>();
  if (hit) return hit.id;
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO mail_threads (id, user_id, peer_email, subject) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, userId, peer, subject)
    .run();
  return id;
}

export type SendResult =
  | { ok: true; threadId: string; messageDbId: string }
  | { ok: false; reason: 'no_account' | 'daily_cap' | 'smtp_failed'; error?: string };

/**
 * 用绑定的 SMTPaccount 发一封建联信并入库。
 * 失败也入库（status=failed），发信历史对用户可见、可排查。
 */
export async function sendOutreachMail(
  env: Env,
  user: UserRow,
  input: { to: string; subject: string; text: string },
): Promise<SendResult> {
  const account = await getMailAccount(env, user.id);
  if (!account || account.status !== 'active') return { ok: false, reason: 'no_account' };

  const used = await sentToday(env, user.id);
  if (used >= SEND_DAILY_CAP) return { ok: false, reason: 'daily_cap' };

  const threadId = await ensureThread(env, user.id, input.to, input.subject);
  const dbId = uuid();
  const domain = (env.MAIL_DOMAIN || '').trim();
  const messageId = `<${dbId}@${domain || 'invalid.local'}>`;
  /**
   * 回信回流的关键：Reply-To 指到自家收信域的线程别名。
   *
   * 用 plus addressing（RFC 5233 子地址）而不是 `re-{id}@` 这种独立地址 ——
   * Cloudflare Email Routing 的 **catch-all 只能建在 zone apex**，给子域建不了，
   * 而线程 id 是随机的、不可能一条条建规则。子地址正好绕开这个限制：
   * 只需建一条 `reply@<域>` 规则，`reply+任意内容@<域>` 都会命中，
   * 且 `+` 后面的内容原样保留在 `message.to` 里给 Worker 读。
   * ⚠️ 需要在 Email Routing 设置里打开 Subaddressing 开关（2025-07 上线的功能）。
   */
  const replyTo = domain ? `reply+${threadId}@${domain}` : account.email;

  let smtpError: string | null = null;
  try {
    await WorkerMailer.send(
      {
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        startTls: account.smtp_port !== 465,
        credentials: {
          username: account.smtp_user || account.email,
          password: await decryptSecret(env, account.smtp_pass),
        },
        authType: ['plain', 'login'],
        socketTimeoutMs: 30_000,
      },
      {
        from: account.from_name ? { name: account.from_name, email: account.email } : account.email,
        to: input.to,
        reply: replyTo,
        subject: input.subject,
        text: input.text,
        headers: { 'Message-ID': messageId },
      },
    );
  } catch (err) {
    smtpError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  const status = smtpError ? 'failed' : 'sent';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mail_messages
         (id, thread_id, user_id, dir, status, from_addr, to_addr, subject, body_text, message_id, error)
       VALUES (?1, ?2, ?3, 'out', ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      dbId,
      threadId,
      user.id,
      status,
      account.email,
      input.to.toLowerCase(),
      input.subject,
      input.text.slice(0, BODY_MAX),
      messageId,
      smtpError,
    ),
    env.DB.prepare(
      `UPDATE mail_threads SET msg_count = msg_count + 1, subject = COALESCE(subject, ?2),
              last_at = unixepoch() WHERE id = ?1`,
    ).bind(threadId, input.subject),
    ...(smtpError
      ? []
      : [
          env.DB.prepare(
            `UPDATE mail_accounts SET last_ok_at = unixepoch() WHERE id = ?1`,
          ).bind(account.id),
          env.DB.prepare(
            `UPDATE mail_contacts SET contacted_at = unixepoch()
              WHERE user_id = ?1 AND lower(email) = ?2`,
          ).bind(user.id, input.to.toLowerCase()),
        ]),
  ]);

  if (smtpError) return { ok: false, reason: 'smtp_failed', error: smtpError };
  return { ok: true, threadId, messageDbId: dbId };
}

// ---------------------------------------------------------------------------
// 批量建联（群发任务）
// ---------------------------------------------------------------------------

/**
 * 一次 cron tick 单个任务最多投递多少封。
 *
 * 小批量是刻意的：cron 每小时跑一次，一天 24 次 × 2 封 ≈ 48 封，
 * 正好压在单邮箱 40 封/天的硬限附近，由 SEND_DAILY_CAP 兜底卡死。
 * 一次发太多既容易触发对方限流，也会把 Worker 的 CPU 时间耗光。
 */
const CAMPAIGN_BATCH = 2;

export interface CampaignRow {
  id: string;
  user_id: string;
  subject: string;
  body: string;
  sent_count: number;
  failed_count: number;
  cursor_id: string | null;
}

/** {name} / {handle} 插值。收件人没有名字时退回 handle，都没有就留空。 */
function render(tpl: string, contact: { name: string | null; handle: string | null }): string {
  return tpl
    .split('{name}')
    .join(contact.name || contact.handle || '')
    .split('{handle}')
    .join(contact.handle || '');
}

/**
 * 推进一个群发任务：取下一批未联系过的联系人，逐个发信。
 *
 * 每封都过 sendOutreachMail —— 也就是说 SEND_DAILY_CAP 的日限、
 * 失败入库、线程归位这些逻辑和单发完全共用，不会出现「群发绕过限额」。
 * 返回这一轮实际发出的封数；0 表示没有可发的了（额度用尽或名单发完）。
 */
export async function runCampaignBatch(
  env: Env,
  user: UserRow,
  campaign: CampaignRow,
): Promise<{ sent: number; failed: number; exhausted: boolean }> {
  // 收件人条件实时判断（不做快照）：已联系过的、在压制表里的，这一刻就跳过
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.email, c.name, c.handle FROM mail_contacts c
      WHERE c.user_id = ?1 AND c.email IS NOT NULL AND c.contacted_at IS NULL
        AND (?2 IS NULL OR c.id > ?2)
        AND NOT EXISTS (
          SELECT 1 FROM mail_suppression s WHERE s.user_id = c.user_id AND s.email = c.email
        )
      ORDER BY c.id ASC LIMIT ?3`,
  )
    .bind(user.id, campaign.cursor_id, CAMPAIGN_BATCH)
    .all<{ id: string; email: string; name: string | null; handle: string | null }>();

  const batch = results ?? [];
  if (!batch.length) return { sent: 0, failed: 0, exhausted: true };

  let sent = 0;
  let failed = 0;
  let cursor = campaign.cursor_id;
  let capHit = false;

  for (const contact of batch) {
    const res = await sendOutreachMail(env, user, {
      to: contact.email,
      subject: render(campaign.subject, contact),
      text: render(campaign.body, contact),
    });
    if (res.ok) {
      sent += 1;
    } else if (res.reason === 'daily_cap' || res.reason === 'no_account') {
      // 额度到顶/账号没了：这一位还没发，游标不能往前推，下次从他继续
      capHit = true;
      break;
    } else {
      failed += 1;
    }
    cursor = contact.id;
  }

  await env.DB.prepare(
    `UPDATE mail_campaigns SET sent_count = sent_count + ?2, failed_count = failed_count + ?3,
            cursor_id = ?4, updated_at = unixepoch() WHERE id = ?1`,
  )
    .bind(campaign.id, sent, failed, cursor)
    .run();

  // 这一批取满了说明后面还有；取不满且没撞额度就是名单发完了
  return { sent, failed, exhausted: !capHit && batch.length < CAMPAIGN_BATCH };
}

/**
 * cron 入口：推进所有 running 的群发任务。
 *
 * 每个任务只推进一小批，多轮 cron 慢慢发完 —— 这既是限速手段，
 * 也让「用户中途暂停」能及时生效。
 */
export async function tickCampaigns(env: Env): Promise<{ campaigns: number; sent: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, subject, body, sent_count, failed_count, cursor_id
       FROM mail_campaigns WHERE status = 'running' ORDER BY updated_at ASC LIMIT 20`,
  ).all<CampaignRow>();

  let totalSent = 0;
  let n = 0;
  for (const campaign of results ?? []) {
    const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?1`)
      .bind(campaign.user_id)
      .first<UserRow>();
    if (!user) {
      await env.DB.prepare(`UPDATE mail_campaigns SET status = 'done' WHERE id = ?1`)
        .bind(campaign.id)
        .run();
      continue;
    }
    try {
      const res = await runCampaignBatch(env, user, campaign);
      totalSent += res.sent;
      n += 1;
      if (res.exhausted) {
        await env.DB.prepare(
          `UPDATE mail_campaigns SET status = 'done', updated_at = unixepoch() WHERE id = ?1`,
        )
          .bind(campaign.id)
          .run();
      }
    } catch (e) {
      console.error('campaign tick 失败', campaign.id, e);
    }
  }
  return { campaigns: n, sent: totalSent };
}
