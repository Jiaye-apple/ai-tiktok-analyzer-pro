/**
 * 用户维度站内消息（消息中心「消息」tab）。
 *
 * 系统产生的消息存 i18n key（tkey + params），渲染时按用户当前语言取词；
 * admin 手发的自由文本走 title/body。写入失败一律吞掉 —— 通知是锦上添花，
 * 绝不能因为发通知失败把主流程（任务、支付…）带崩。
 */
import type { Env } from './types';
import { uuid } from './auth';

export interface InboxMessage {
  kind?: 'system' | 'task' | 'billing';
  /** site.json 词条 key（与 title 二选一） */
  tkey?: string;
  params?: Record<string, string | number>;
  title?: string;
  body?: string;
  /** 站内跳转路径，如 /kol/task/xxx */
  link?: string;
}

export async function notifyUser(env: Env, userId: string, msg: InboxMessage): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO user_messages (id, user_id, kind, tkey, params, title, body, link)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        uuid(),
        userId,
        msg.kind ?? 'system',
        msg.tkey ?? null,
        msg.params ? JSON.stringify(msg.params) : null,
        msg.title ?? null,
        msg.body ?? null,
        msg.link ?? null,
      )
      .run();
  } catch (e) {
    console.error('notifyUser failed', userId, e);
  }
}
