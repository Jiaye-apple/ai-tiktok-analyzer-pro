/**
 * 入站邮件回流：Cloudflare Email Routing 的 `reply@` 规则 -> Worker email() handler。
 *
 * 单独成文件（不和发信的 mail.ts 合并）是刻意的：发信依赖 worker-mailer，
 * 而它 require('cloudflare:sockets')，在 Node 里加载不了。拆开之后
 * 归线程逻辑可以直接跑单元测试（scripts/mail-inbound.test.mjs）。
 *
 * 归线程优先级：收件地址 reply+{threadId}@ > In-Reply-To 匹配我们发过的 Message-ID
 * （listmonk 的「header 优先、兜底再来一次」归因思路）。
 */
import PostalMime from 'postal-mime';
import type { Env } from './types';
import { uuid } from './auth';
import { notifyUser } from './inbox';

/** 正文入库截断。完整内容在 R2 的原始 .eml 里。 */
const BODY_MAX = 32_000;

/**
 * 入站邮件（Cloudflare Email Routing 的 reply@ 规则 -> Worker email handler）。
 *
 * 归线程优先级：收件地址 reply+{threadId}@ > In-Reply-To 匹配我们发过的 Message-ID。
 * 都对不上就丢（打日志）—— 收信域会收到大量垃圾，入库反而是污染。
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const rcpt = (message.to || '').toLowerCase();

  let thread: { id: string; user_id: string; unread: number } | null = null;

  // plus addressing：`reply+{threadId}@<域>`。Email Routing 按 `reply@` 匹配规则，
  // `+` 后面的线程 id 原样留在 message.to 里 —— 这是唯一不依赖 catch-all 的归线程方式
  // （catch-all 只能建在 zone apex，见 lib/mail.ts 里 replyTo 的注释）。
  const alias = rcpt.match(/^reply\+([\w-]{10,64})@/);
  if (alias) {
    thread = await env.DB.prepare(`SELECT id, user_id, unread FROM mail_threads WHERE id = ?1`)
      .bind(alias[1])
      .first<{ id: string; user_id: string; unread: number }>();
  }

  const parsed = await PostalMime.parse(message.raw);

  if (!thread && parsed.inReplyTo) {
    const hit = await env.DB.prepare(
      `SELECT t.id, t.user_id, t.unread FROM mail_messages m
         JOIN mail_threads t ON t.id = m.thread_id
        WHERE m.message_id = ?1 AND m.dir = 'out' LIMIT 1`,
    )
      .bind(parsed.inReplyTo.trim())
      .first<{ id: string; user_id: string; unread: number }>();
    if (hit) thread = hit;
  }

  if (!thread) {
    console.log('inbound mail 无法归线程，丢弃', rcpt, parsed.from?.address ?? '');
    return;
  }

  const dbId = uuid();
  const rawKey = `mail/raw/${thread.user_id}/${dbId}.eml`;
  try {
    // 原始 .eml 完整存 R2（含附件），列表页只用 D1 里的文本摘要
    await env.R2.put(rawKey, message.raw, {
      httpMetadata: { contentType: 'message/rfc822' },
    });
  } catch (e) {
    console.error('inbound mail R2 写入失败', e);
  }

  const bodyText = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, BODY_MAX);
  const fromAddr = (parsed.from?.address || '').toLowerCase();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mail_messages
         (id, thread_id, user_id, dir, status, from_addr, to_addr, subject, body_text,
          message_id, in_reply_to, raw_key)
       VALUES (?1, ?2, ?3, 'in', 'received', ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      dbId,
      thread.id,
      thread.user_id,
      fromAddr,
      rcpt,
      (parsed.subject || '').slice(0, 500),
      bodyText,
      parsed.messageId ?? null,
      parsed.inReplyTo ?? null,
      rawKey,
    ),
    env.DB.prepare(
      `UPDATE mail_threads SET msg_count = msg_count + 1, unread = unread + 1,
              last_at = unixepoch() WHERE id = ?1`,
    ).bind(thread.id),
  ]);

  await notifyUser(env, thread.user_id, {
    kind: 'system',
    tkey: 'nt_mail_reply',
    params: { from: fromAddr || rcpt },
    link: `/kol/mail?thread=${thread.id}`,
  });
}
