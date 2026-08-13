import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ok } from '../lib/response';
import { readJson } from '../lib/req';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * POST /message/send
 *
 * 前端异常上报。调用方是 React ErrorBoundary（index.js:191415），
 * 只有登录用户才会发，且带 hide:true —— 失败也不弹提示。
 *
 * body: { browser_lang, extend_name, version, os, userid, page, url, error, stack }
 *
 * 不要求登录：上报本身就可能发生在登录态异常的时候。
 */
r.post('/send', async (c) => {
  const b = await readJson<Record<string, unknown>>(c);
  const user = c.get('user');

  await c.env.DB.prepare(
    `INSERT INTO messages (user_id, type, content, contact, extra) VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      user?.id ?? (b.userid ? String(b.userid) : null),
      'client_error',
      String(b.error ?? '').slice(0, 4000),
      null,
      JSON.stringify({
        page: b.page,
        url: b.url,
        stack: String(b.stack ?? '').slice(0, 8000),
        version: b.version,
        os: b.os,
        browserLang: b.browser_lang,
        extendName: b.extend_name,
      }),
    )
    .run()
    .catch((e) => console.error('message insert failed', e));

  return ok(true);
});

/** 用户主动反馈，官网/popup 可以调。原扩展没用到，但迁移后有用。 */
r.post('/feedback', async (c) => {
  const b = await readJson<{ content?: string; contact?: string; type?: string }>(c);
  const user = c.get('user');

  await c.env.DB.prepare(
    `INSERT INTO messages (user_id, type, content, contact, extra) VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      user?.id ?? null,
      b.type || 'feedback',
      String(b.content ?? '').slice(0, 4000),
      b.contact ?? null,
      JSON.stringify({ version: c.req.header('X-Version'), lang: c.req.header('lang') }),
    )
    .run();

  return ok(true);
});

export default r;
