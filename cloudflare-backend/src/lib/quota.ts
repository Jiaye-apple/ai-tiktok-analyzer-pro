import type { Env, QuotaState, UserRow } from './types';
import { QUOTA_TYPES, POINTS } from './types';
import { effectivePlanCode, uuid } from './auth';

/**
 * 配额。原后台是**两层**结构，不是简单的每功能计数：
 *
 *   ① 每个功能有自己的月度次数（ExcelExport 500 次/月 这种）
 *   ② 另外有一个全局共享的「通用积分」池
 *
 * 2026-08 改版后又叠了两件事（对照 kolsprite.com/price 的公开规则）：
 *
 *   ③ 加油包池：买加油包得到的次数/点数记在 period_key='all' 的行里，
 *      不随月重置、随会员期长期有效 —— 消耗顺序是「月度赠送优先，
 *      加油包殿后」，对应原站积分规则第 2、3 条。
 *   ④ 日上限：quota_daily_limits 表按套餐限制某些类型一天最多用几次
 *      （原站「Max 10/day」那排小字）。日计数记在 period_key=当天 的行里。
 *
 * 所以一次预扣最多同时动 5 行：功能月度行、功能加油包行、点数月度行、
 * 点数加油包行、日计数行。每笔各扣多少记进 quota_record_ext，
 * release 才能原路退回。
 *
 * 前端的调用节奏固定三步，改动要小心：
 *   1. checkQuota()  -> GET  /quota/new/{type}          看 data.available
 *   2. useQuota(n)   -> POST /quota/acquire/{type}/{n}  返回预扣记录 id
 *   3. 出错时 cancelQuota() -> POST /quota/release  body {id}
 * acquire 是**预扣**不是直接消费，失败要能原样退回。
 *
 * 但预扣只是前端自觉 —— 真正的拦截在 consumeQuota()：干活的接口
 * （ASR、评论分析、批量解析）在服务端调它，有近期预扣就核销掉，
 * 没有就当场扣，扣不动就拒绝。直连 API 绕过前端也白嫖不到。
 */

export function periodKey(period: string, at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  if (period === 'day') return `${y}-${m}-${d}`;
  if (period === 'forever') return 'all';
  return `${y}-${m}`;
}

/** 加油包池统一记在这个 period_key 下。 */
const ADDON_KEY = 'all';

interface RuleRow {
  quota_type: string;
  total: number;
  period: string;
  points: number;
}

async function loadRules(env: Env, planCode: string): Promise<Map<string, RuleRow>> {
  const { results } = await env.DB.prepare(
    `SELECT quota_type, total, period, points FROM quota_rules WHERE plan_code = ?1`,
  )
    .bind(planCode)
    .all<RuleRow>();

  const map = new Map<string, RuleRow>();
  for (const r of results ?? []) map.set(r.quota_type, r);

  // 规则表里没配的类型给个兜底，避免前端拿到 undefined 直接报错
  for (const t of QUOTA_TYPES) {
    if (!map.has(t)) map.set(t, { quota_type: t, total: 0, period: 'month', points: 1 });
  }
  return map;
}

async function readUsage(
  env: Env,
  userId: string,
  quotaType: string,
  periodKeyValue: string,
): Promise<{ used: number; extra: number }> {
  const row = await env.DB.prepare(
    `SELECT used, extra FROM quota_usage WHERE user_id = ?1 AND quota_type = ?2 AND period_key = ?3`,
  )
    .bind(userId, quotaType, periodKeyValue)
    .first<{ used: number; extra: number }>();
  return { used: row?.used ?? 0, extra: row?.extra ?? 0 };
}

/** 某类型两个池子的余量。month = 套餐送的（含当月临时加赠），addon = 加油包。 */
async function poolsOf(
  env: Env,
  userId: string,
  rule: RuleRow,
): Promise<{
  pk: string;
  monthTotal: number;
  monthUsed: number;
  monthLeft: number;
  addonLeft: number;
}> {
  const pk = periodKey(rule.period);
  const [m, a] = await Promise.all([
    readUsage(env, userId, rule.quota_type, pk),
    readUsage(env, userId, rule.quota_type, ADDON_KEY),
  ]);
  const monthTotal = rule.total + m.extra;
  return {
    pk,
    monthTotal,
    monthUsed: m.used,
    monthLeft: Math.max(0, monthTotal - m.used),
    addonLeft: Math.max(0, a.extra - a.used),
  };
}

/** 点数池当前总余额（月度 + 加油包）。 */
async function pointsBalance(
  env: Env,
  user: UserRow,
  rules: Map<string, RuleRow>,
): Promise<{ monthLeft: number; addonLeft: number; balance: number; pk: string }> {
  const rule = rules.get(POINTS)!;
  const p = await poolsOf(env, user.id, rule);
  return { monthLeft: p.monthLeft, addonLeft: p.addonLeft, balance: p.monthLeft + p.addonLeft, pk: p.pk };
}

/** 日上限。没配行 = 不限制，返回 null。 */
export async function dailyLimitOf(
  env: Env,
  planCode: string,
  quotaType: string,
): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT daily_limit FROM quota_daily_limits WHERE plan_code = ?1 AND quota_type = ?2`,
  )
    .bind(planCode, quotaType)
    .first<{ daily_limit: number }>();
  return row ? row.daily_limit : null;
}

export async function getQuota(env: Env, user: UserRow, quotaType: string): Promise<QuotaState> {
  const planCode = effectivePlanCode(user);
  const rules = await loadRules(env, planCode);
  const rule = rules.get(quotaType) ?? {
    quota_type: quotaType,
    total: 0,
    period: 'month',
    points: 1,
  };
  const p = await poolsOf(env, user.id, rule);

  // Points 自己就是点数池，不能再拿点数换算自己
  if (quotaType === POINTS) {
    return {
      total: p.monthTotal + p.addonLeft,
      used: p.monthUsed,
      available: p.monthLeft + p.addonLeft,
      points: 1,
      period: rule.period,
    };
  }

  const cost = Math.max(1, rule.points);
  const { balance } = await pointsBalance(env, user, rules);
  const fromPoints = Math.floor(balance / cost);

  return {
    /**
     * total 是「套餐次数 + 加油包 + 点数能换的次数」，也就是本周期的总容量。
     *
     * 以前这里多加了一个 p.monthUsed —— 而 monthTotal 本身
     * （poolsOf: rule.total + extra）已经包含了已用的部分，等于把 used 计了两遍：
     * 用掉 2 次之后 total 从 3100 变成 3102，进度条的分母跟着用量一起涨，
     * 用户看到的用量比实际低。total 应该是个常量，只有加油包/点数变动时才变。
     */
    total: p.monthTotal + p.addonLeft + fromPoints,
    used: p.monthUsed,
    available: p.monthLeft + p.addonLeft + fromPoints,
    points: cost,
    period: rule.period,
  };
}

export async function getAllQuotas(env: Env, user: UserRow): Promise<Record<string, QuotaState>> {
  const out: Record<string, QuotaState> = {};
  for (const t of QUOTA_TYPES) out[t] = await getQuota(env, user, t);
  return out;
}

export interface AcquireResult {
  okToUse: boolean;
  recordId: string | null;
  state: QuotaState;
  /** true = 不是额度不够，是撞了日上限（额度还有，明天再来） */
  dailyExceeded?: boolean;
}

/**
 * 预扣。顺序：功能月度 → 功能加油包 → 点数月度 → 点数加油包。
 * 每一段扣了多少记进 quota_record_ext，否则 release 退不回去。
 */
export async function acquireQuota(
  env: Env,
  user: UserRow,
  quotaType: string,
  amount: number,
): Promise<AcquireResult> {
  const n = Math.max(1, Math.floor(amount || 1));
  const planCode = effectivePlanCode(user);
  const rules = await loadRules(env, planCode);
  const rule = rules.get(quotaType) ?? {
    quota_type: quotaType,
    total: 0,
    period: 'month',
    points: 1,
  };
  const state = await getQuota(env, user, quotaType);
  if (state.available < n) {
    return { okToUse: false, recordId: null, state };
  }

  // 日上限（独立于额度池，是「今天最多几次」的闸）
  const dayLimit = await dailyLimitOf(env, planCode, quotaType);
  const dayKey = periodKey('day');
  if (dayLimit !== null && rule.period !== 'day') {
    const day = await readUsage(env, user.id, quotaType, dayKey);
    if (day.used + n > dayLimit) {
      return { okToUse: false, recordId: null, state, dailyExceeded: true };
    }
  }

  const p = await poolsOf(env, user.id, rule);

  const fromOwn = Math.min(n, p.monthLeft);
  const fromAddon = Math.min(n - fromOwn, p.addonLeft);
  const restCount = n - fromOwn - fromAddon;

  let pMonthSpent = 0;
  let pAddonSpent = 0;
  if (restCount > 0) {
    if (quotaType === POINTS) return { okToUse: false, recordId: null, state };
    const cost = Math.max(1, rule.points);
    const needed = restCount * cost;
    const pb = await pointsBalance(env, user, rules);
    if (pb.balance < needed) return { okToUse: false, recordId: null, state };
    pMonthSpent = Math.min(needed, pb.monthLeft);
    pAddonSpent = needed - pMonthSpent;
  }

  const id = uuid();
  const pointsSpentTotal = pMonthSpent + pAddonSpent;
  const ppk = periodKey(rules.get(POINTS)!.period);
  const trackDay = dayLimit !== null && rule.period !== 'day';

  const bump = (type: string, key: string, by: number) =>
    env.DB.prepare(
      `INSERT INTO quota_usage (user_id, quota_type, period_key, used, extra, updated_at)
       VALUES (?1, ?2, ?3, ?4, 0, unixepoch())
       ON CONFLICT(user_id, quota_type, period_key)
       DO UPDATE SET used = used + ?4, updated_at = unixepoch()`,
    ).bind(user.id, type, key, by);

  const stmts = [
    env.DB.prepare(
      `INSERT INTO quota_records
         (id, user_id, quota_type, amount, period_key, status, points_spent, points_period_key)
       VALUES (?1, ?2, ?3, ?4, ?5, 'held', ?6, ?7)`,
    ).bind(id, user.id, quotaType, n, p.pk, pointsSpentTotal, pointsSpentTotal > 0 ? ppk : null),
    env.DB.prepare(
      `INSERT INTO quota_record_ext
         (id, own_spent, addon_spent, points_month_spent, points_addon_spent, day_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(id, fromOwn, fromAddon, pMonthSpent, pAddonSpent, trackDay ? dayKey : null),
  ];
  if (fromOwn > 0) stmts.push(bump(quotaType, p.pk, fromOwn));
  if (fromAddon > 0) stmts.push(bump(quotaType, ADDON_KEY, fromAddon));
  if (pMonthSpent > 0) stmts.push(bump(POINTS, ppk, pMonthSpent));
  if (pAddonSpent > 0) stmts.push(bump(POINTS, ADDON_KEY, pAddonSpent));
  if (trackDay) stmts.push(bump(quotaType, dayKey, n));

  await env.DB.batch(stmts);

  return {
    okToUse: true,
    recordId: id,
    state: { ...state, used: state.used + n, available: state.available - n },
  };
}

interface RecordRow {
  id: string;
  user_id: string;
  quota_type: string;
  amount: number;
  period_key: string;
  status: string;
  points_spent: number | null;
  points_period_key: string | null;
}

interface ExtRow {
  own_spent: number;
  addon_spent: number;
  points_month_spent: number;
  points_addon_spent: number;
  day_key: string | null;
}

/** 按记录原路退回。fromStatuses 控制哪些状态允许退（幂等，重复调无害）。 */
async function refundRecord(
  env: Env,
  rec: RecordRow,
  fromStatuses: string[],
): Promise<boolean> {
  if (!fromStatuses.includes(rec.status)) return false;

  const unbump = (type: string, key: string, by: number) =>
    env.DB.prepare(
      `UPDATE quota_usage SET used = MAX(0, used - ?1), updated_at = unixepoch()
       WHERE user_id = ?2 AND quota_type = ?3 AND period_key = ?4`,
    ).bind(by, rec.user_id, type, key);

  const stmts = [
    env.DB.prepare(
      `UPDATE quota_records SET status = 'released', settled_at = unixepoch()
       WHERE id = ?1 AND status IN (${fromStatuses.map((s) => `'${s}'`).join(',')})`,
    ).bind(rec.id),
  ];

  const ext = await env.DB.prepare(`SELECT * FROM quota_record_ext WHERE id = ?1`)
    .bind(rec.id)
    .first<ExtRow>();

  if (ext) {
    if (ext.own_spent > 0) stmts.push(unbump(rec.quota_type, rec.period_key, ext.own_spent));
    if (ext.addon_spent > 0) stmts.push(unbump(rec.quota_type, ADDON_KEY, ext.addon_spent));
    if (ext.points_month_spent > 0 && rec.points_period_key)
      stmts.push(unbump(POINTS, rec.points_period_key, ext.points_month_spent));
    if (ext.points_addon_spent > 0) stmts.push(unbump(POINTS, ADDON_KEY, ext.points_addon_spent));
    if (ext.day_key) stmts.push(unbump(rec.quota_type, ext.day_key, rec.amount));
  } else {
    // 老记录（没有 ext 行）：按旧引擎的两段式退
    stmts.push(unbump(rec.quota_type, rec.period_key, rec.amount));
    if (rec.points_spent && rec.points_period_key)
      stmts.push(unbump(POINTS, rec.points_period_key, rec.points_spent));
  }

  await env.DB.batch(stmts);
  return true;
}

/** 前端的退还入口。只有 held 状态能退 —— committed 是服务端核销过的，不给退。 */
export async function releaseQuota(env: Env, user: UserRow, recordId: string): Promise<boolean> {
  if (!recordId) return false;
  const rec = await env.DB.prepare(`SELECT * FROM quota_records WHERE id = ?1 AND user_id = ?2`)
    .bind(recordId, user.id)
    .first<RecordRow>();
  if (!rec) return false;
  return refundRecord(env, rec, ['held']);
}

/** 确认消费。任务真正完成后由服务端调用。 */
export async function commitQuota(env: Env, recordId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE quota_records SET status = 'committed', settled_at = unixepoch()
     WHERE id = ?1 AND status = 'held'`,
  )
    .bind(recordId)
    .run();
}

// ---------------------------------------------------------------------------
// 服务端硬扣
// ---------------------------------------------------------------------------

export interface ConsumeResult {
  ok: boolean;
  /** 核销/扣费的记录 id，失败时退款用 */
  recordId: string | null;
  /** true = 用的是前端 acquire 的预扣记录（正常流程），false = 服务端现场扣的 */
  prepaid: boolean;
  state?: QuotaState;
  dailyExceeded?: boolean;
}

/**
 * 干活的接口在动手前调它：
 *
 *   1. 15 分钟内有本人同类型、数量够的 held 预扣 → 原子核销成 committed
 *      （正常的「前端 acquire → 调接口」流程，不会双扣）
 *   2. 没有 → 服务端当场 acquire 并立即 committed（直连 API 的调用方）
 *   3. 扣不动 → ok:false，调用方返回 QUOTA_EXHAUSTED + 升级引导
 *
 * 干活失败要调 refundConsumed() 把这笔退回去。
 * 核销成 committed 之后前端再调 /quota/release 是无效的（只退 held），
 * 所以不存在「服务端退一次、前端再退一次」的双退。
 */
export async function consumeQuota(
  env: Env,
  user: UserRow,
  quotaType: string,
  amount = 1,
): Promise<ConsumeResult> {
  const n = Math.max(1, Math.floor(amount || 1));

  const claimed = await env.DB.prepare(
    `UPDATE quota_records SET status = 'committed', settled_at = unixepoch()
     WHERE id = (
       SELECT id FROM quota_records
       WHERE user_id = ?1 AND quota_type = ?2 AND status = 'held'
         AND amount >= ?3 AND created_at > unixepoch() - 900
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING id`,
  )
    .bind(user.id, quotaType, n)
    .first<{ id: string }>();

  if (claimed) return { ok: true, recordId: claimed.id, prepaid: true };

  const res = await acquireQuota(env, user, quotaType, n);
  if (!res.okToUse || !res.recordId) {
    return {
      ok: false,
      recordId: null,
      prepaid: false,
      state: res.state,
      dailyExceeded: res.dailyExceeded,
    };
  }
  await commitQuota(env, res.recordId);
  return { ok: true, recordId: res.recordId, prepaid: false };
}

/** consumeQuota 之后干活失败的退款。held / committed 都能退，幂等。 */
export async function refundConsumed(env: Env, userId: string, recordId: string): Promise<boolean> {
  if (!recordId) return false;
  const rec = await env.DB.prepare(`SELECT * FROM quota_records WHERE id = ?1 AND user_id = ?2`)
    .bind(recordId, userId)
    .first<RecordRow>();
  if (!rec) return false;
  return refundRecord(env, rec, ['held', 'committed']);
}

/**
 * 纯日上限计数（没有月度池的类型：SingleVideoDownload / AiCopy）。
 * 没配限制行 = 不限。超限返回 exceeded，不产生记录、不用退。
 */
export async function bumpDailyOnly(
  env: Env,
  user: UserRow,
  quotaType: string,
  n = 1,
): Promise<{ limited: boolean; exceeded: boolean; used: number; limit: number }> {
  const planCode = effectivePlanCode(user);
  const limit = await dailyLimitOf(env, planCode, quotaType);
  if (limit === null) return { limited: false, exceeded: false, used: 0, limit: 0 };

  const dayKey = periodKey('day');
  const { used } = await readUsage(env, user.id, quotaType, dayKey);
  if (used + n > limit) return { limited: true, exceeded: true, used, limit };

  await env.DB.prepare(
    `INSERT INTO quota_usage (user_id, quota_type, period_key, used, extra, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, unixepoch())
     ON CONFLICT(user_id, quota_type, period_key)
     DO UPDATE SET used = used + ?4, updated_at = unixepoch()`,
  )
    .bind(user.id, quotaType, dayKey, n)
    .run();
  return { limited: true, exceeded: false, used: used + n, limit };
}

/** 加油包 / 后台手动补额度。period 传 'forever' 就是长期有效的加油包池。 */
export async function grantExtra(
  env: Env,
  userId: string,
  quotaType: string,
  amount: number,
  period = 'month',
): Promise<void> {
  const pk = periodKey(period);
  await env.DB.prepare(
    `INSERT INTO quota_usage (user_id, quota_type, period_key, used, extra, updated_at)
     VALUES (?1, ?2, ?3, 0, ?4, unixepoch())
     ON CONFLICT(user_id, quota_type, period_key)
     DO UPDATE SET extra = extra + ?4, updated_at = unixepoch()`,
  )
    .bind(userId, quotaType, pk, amount)
    .run();
}
