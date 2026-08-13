import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { issueToken } from '../lib/auth';
import { LOGIN_CODE_FIRST_USE_SECONDS, issueLoginCode } from '../site/session';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * POST /v1/plugin/public/token/exchange?token=<一次性码>
 *
 * 登录闭环（原样保留，不用改扩展）：
 *   1. 扩展让 background 打开 <站点>/kol/exlogin?utm_source=CJ&lang=xx
 *   2. 官网登录完成后，在页面里 dispatch 一个 CustomEvent('loginSuccess')，
 *      detail 就是这个一次性码
 *   3. content script（也注入在站点域名下）收到后调本接口换长期 token
 *   4. 拿到 token 再调 /user/detail 补用户信息，然后发 {task:"flishLogin"} 关掉登录页
 *
 * 一次性码放 D1 的 login_codes（见 migrations/0015 和 site/session.ts 的
 * issueLoginCode）。
 *
 * ⚠️ 不是严格一次性：登录页会把同一个码每 400ms 兜底重发（扩展的监听器是
 * 异步加载的，页面不知道它什么时候就绪），慢网络下会有并发重复兑换。
 * 之前「读到就删」的做法会让先到的删码、后到的全部失败，扩展那边就永远
 * 停在「正在同步网页登录信息…」。所以首次兑换把 token 缓存进 token 列，
 * 重复兑换返回同一个 token —— 码本身只在自家页面和 content script 之间
 * 流转，重放窗口没有实质变化。
 *
 * 两个窗口分开（2026-08-07）：
 *   · 首次兑换只认 5 分钟（created_at + LOGIN_CODE_FIRST_USE_SECONDS）；
 *   · 已经兑过的码在行还在的 30 分钟里重复兑换都返回同一个 token。
 * 原来两者都是 5 分钟：登录页的兜底 setInterval 在后台标签页被 Chrome 降频到
 * 1 分钟一次，30 次兜底摊成半小时，5 分钟后迟到的那几发全部撞 ERR_UNAUTHORIZED，
 * 扩展弹出「登录码无效或已过期」—— 而那时候用户其实早就登录成功了。
 */
r.post('/token/exchange', async (c) => {
  const code = c.req.query('token') || '';
  if (!code) return fail(ERR.PARAM, '缺少 token 参数');

  const row = await c.env.DB.prepare(
    `SELECT user_id, token, created_at FROM login_codes
     WHERE code = ?1 AND expires_at > unixepoch()`,
  )
    .bind(code)
    .first<{ user_id: string; token: string | null; created_at: number }>();

  // 部署切换期的兜底：切到 D1 之前发出的码还躺在 KV 里（TTL 5 分钟），
  // 认一下，窗口过了自然失效。之后这段永远走不到，但留着无害。
  if (!row) {
    const kvUser = await c.env.KV.get(`login:${code}`);
    if (!kvUser) return fail(ERR.UNAUTHORIZED, '登录码无效或已过期');
    const kvOk = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?1 AND status = 'active'`)
      .bind(kvUser)
      .first<{ id: string }>();
    if (!kvOk) return fail(ERR.UNAUTHORIZED, '用户不存在或已禁用');
    const kvToken = await issueToken(c.env, kvUser, c.req.header('X-Version') || '');
    return ok(kvToken);
  }

  // 重复兑换（页面的 400ms 兜底重发，后台标签页会被降频拖长）：
  // 直接返回首次发出的那个 token，不看首兑窗口
  if (row.token) return ok(row.token);

  // 还没兑过的码超过首兑窗口就不认了 —— 行留着只是为了让重复兑换幂等
  if (row.created_at + LOGIN_CODE_FIRST_USE_SECONDS < Math.floor(Date.now() / 1000)) {
    return fail(ERR.UNAUTHORIZED, '登录码无效或已过期');
  }

  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?1 AND status = 'active'`)
    .bind(row.user_id)
    .first<{ id: string }>();
  if (!user) return fail(ERR.UNAUTHORIZED, '用户不存在或已禁用');

  const token = await issueToken(c.env, row.user_id, c.req.header('X-Version') || '');
  // 真正并发的首兑只允许第一条写入 canonical token；其余请求读取第一条的值，
  // 并删除自己尚未对外暴露的临时 token，保证所有响应严格幂等。
  await c.env.DB.prepare(`UPDATE login_codes SET token = ?2 WHERE code = ?1 AND token IS NULL`)
    .bind(code, token)
    .run();
  const canonical = await c.env.DB.prepare(`SELECT token FROM login_codes WHERE code = ?1`)
    .bind(code)
    .first<{ token: string | null }>();
  const exchangedToken = canonical?.token || token;
  if (exchangedToken !== token) {
    await c.env.DB.prepare(`DELETE FROM user_tokens WHERE token = ?1`).bind(token).run();
  }

  // 注意：data 必须直接是 token 字符串。
  // content.ts.js 里是 `const e = await i1(t); await j(e.data)`，
  // 拿 e.data 当 token 用，包成对象会登录失败。
  return ok(exchangedToken);
});

/**
 * GET /v1/plugin/public/regions
 *
 * 返回按业务类型分桶、桶内按大洲分组的地区树。
 * 前端默认取 data.creator，结构不能变：
 *   { creator: [{ continentLabelCn, continentLabelEn, regions: [{code, name, labelCn}] }] }
 */
r.get('/regions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT code, name_en, name_zh, continent_en, continent_zh, biz_type
     FROM regions WHERE enabled = 1 ORDER BY sort_order ASC`,
  ).all<{
    code: string;
    name_en: string;
    name_zh: string | null;
    continent_en: string;
    continent_zh: string;
    biz_type: string;
  }>();

  const buckets: Record<string, Array<{
    continentLabelCn: string;
    continentLabelEn: string;
    regions: Array<{ code: string; name: string; labelCn: string }>;
  }>> = {};

  for (const row of results ?? []) {
    const bucket = (buckets[row.biz_type] ??= []);
    let group = bucket.find((g) => g.continentLabelEn === row.continent_en);
    if (!group) {
      group = {
        continentLabelCn: row.continent_zh,
        continentLabelEn: row.continent_en,
        regions: [],
      };
      bucket.push(group);
    }
    group.regions.push({
      code: row.code,
      name: row.name_en,
      labelCn: row.name_zh ?? row.name_en,
    });
  }

  return ok(buckets);
});

/**
 * 供官网登录页调用，换取一次性登录码。
 * 用 ADMIN_KEY 保护 —— 这个接口能给任意 userId 发码，绝不能公开。
 */
r.post('/login-code', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  if (!c.env.ADMIN_KEY || adminKey !== c.env.ADMIN_KEY) {
    return fail(ERR.UNAUTHORIZED, '无权限');
  }
  const body = await c.req.json<{ userId?: string }>().catch(() => ({}) as { userId?: string });
  if (!body.userId) return fail(ERR.PARAM, '缺少 userId');

  const code = await issueLoginCode(c.env, body.userId);
  return ok({ code, expiresIn: 300 });
});

export default r;
