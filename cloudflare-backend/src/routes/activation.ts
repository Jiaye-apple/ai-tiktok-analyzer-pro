import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { toProfile } from '../lib/auth';
import { translate } from '../lib/i18n';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * 激活码。原后台没有这套东西（全站 grep 不到「激活/兑换/卡密」相关文案），
 * 是这次新加的能力：发卡、代理商分销、售后补偿都能用。
 *
 * 前端接入点在扩展 popup 里新增的「激活码」入口，
 * 见 kolsprite-2.1.3-editable/assets/backend-config.js 同目录的改动说明。
 */

const CODE_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * POST /v1/plugin/activation/redeem
 * body: { code }
 *
 * 成功后直接返回最新的 userProfile，前端可以原地刷新会员状态，
 * 不用再多跑一次 /user/detail。
 */
r.post('/redeem', requireAuth, async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string });
  const code = normalize(body.code || '');

  if (!code) return fail(ERR.PARAM, '请输入激活码');
  if (!CODE_RE.test(code)) return fail(ERR.PARAM, '激活码格式不正确');

  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare(`SELECT * FROM activation_codes WHERE code = ?1`)
    .bind(code)
    .first<{
      code: string;
      plan_code: string;
      duration_days: number;
      max_uses: number;
      used_count: number;
      status: string;
      expire_at: number | null;
    }>();

  if (!row) return fail(ERR.NOT_FOUND, '激活码不存在');
  if (row.status === 'disabled') return fail(ERR.PARAM, '激活码已作废');
  if (row.expire_at && row.expire_at < now) return fail(ERR.PARAM, '激活码已过期');

  // 重复使用要先于「已用完」判断：单次码被自己用掉之后两个条件都成立，
  // 但「你已经用过了」比「已被使用」更能让用户明白发生了什么。
  const dup = await c.env.DB.prepare(
    `SELECT 1 FROM activation_records WHERE code = ?1 AND user_id = ?2`,
  )
    .bind(code, user.id)
    .first();
  if (dup) return fail(ERR.PARAM, '该激活码你已经使用过了');

  if (row.used_count >= row.max_uses) return fail(ERR.PARAM, '激活码已被使用');

  // 续期规则：还在有效期内就往后叠加，已过期则从当下重新起算
  const base = user.plan_expire_at && user.plan_expire_at > now ? user.plan_expire_at : now;
  const expireAfter = base + row.duration_days * 86400;

  const willBeUsedUp = row.used_count + 1 >= row.max_uses;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE activation_codes
       SET used_count = used_count + 1, status = ?2
       WHERE code = ?1 AND used_count < max_uses`,
    ).bind(code, willBeUsedUp ? 'used' : 'unused'),
    c.env.DB.prepare(
      `INSERT INTO activation_records
         (code, user_id, plan_code, days, expire_before, expire_after, ip)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      code,
      user.id,
      row.plan_code,
      row.duration_days,
      user.plan_expire_at,
      expireAfter,
      c.req.header('CF-Connecting-IP') || '',
    ),
    c.env.DB.prepare(
      `UPDATE users SET plan_code = ?2, plan_expire_at = ?3, updated_at = unixepoch() WHERE id = ?1`,
    ).bind(user.id, row.plan_code, expireAfter),
  ]);

  const fresh = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?1`)
    .bind(user.id)
    .first<UserRow>();

  return ok({
    activated: true,
    planCode: row.plan_code,
    days: row.duration_days,
    expireAt: expireAfter,
    profile: fresh ? await toProfile(c.env, fresh) : null,
  });
});

/**
 * GET /v1/plugin/activation/records
 * 我的激活历史，用于「会员中心」展示。
 */
r.get('/records', requireAuth, async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT code, plan_code AS planCode, days, expire_after AS expireAt, created_at AS createdAt
     FROM activation_records WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all();
  return ok(results ?? []);
});

/**
 * GET /v1/plugin/activation/check?code=XXXX-XXXX-XXXX-XXXX
 * 不登录也能查一张码有没有效，用于购卡后先验证。
 */
r.get('/check', async (c) => {
  const code = normalize(c.req.query('code') || '');
  if (!CODE_RE.test(code)) return fail(ERR.PARAM, '激活码格式不正确');

  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare(
    `SELECT c.plan_code, c.duration_days, c.max_uses, c.used_count, c.status, c.expire_at, p.name
     FROM activation_codes c LEFT JOIN plans p ON p.code = c.plan_code
     WHERE c.code = ?1`,
  )
    .bind(code)
    .first<{
      plan_code: string;
      duration_days: number;
      max_uses: number;
      used_count: number;
      status: string;
      expire_at: number | null;
      name: string | null;
    }>();

  if (!row) return ok({ valid: false, reason: 'not_found' });
  if (row.status === 'disabled') return ok({ valid: false, reason: 'disabled' });
  if (row.expire_at && row.expire_at < now) return ok({ valid: false, reason: 'expired' });
  if (row.used_count >= row.max_uses) return ok({ valid: false, reason: 'used_up' });

  return ok({
    valid: true,
    planCode: row.plan_code,
    planName: translate(row.name ?? row.plan_code),
    days: row.duration_days,
    remainingUses: row.max_uses - row.used_count,
  });
});

export default r;
