import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserProfile, UserRow } from '../lib/types';
import { sentToday, SEND_DAILY_CAP } from '../lib/mail';
import { toProfile } from '../lib/auth';
import { getAllQuotas } from '../lib/quota';
import { brandTitle, BRAND_NAME, escapeHtml, html } from '../site/layout';
import { ic } from '../site/assets';
import { appPage } from '../site/shell';
import { st, htmlLang } from '../site/i18n';
import { currentWebUser, pageLang } from '../site/session';
import { oneTapInject } from '../site/one-tap';

/**
 * /kol 应用页面。对照原站 kolsprite.com 的路由树开发（umi bundle 的 routes 配置），
 * 数据全部来自本 Worker 的 D1 —— 插件回流的达人/视频/商品、收藏、推广计划、任务。
 *
 * 原站是登录后才有数据的 SaaS；这里未登录也渲染完整页面框架 + 登录引导，
 * 登录后展示真实数据。文案全部走 st()（i18n/<lang>/site.json，9 种语言）。
 */

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();
r.use('*', pageLang);
// 未登录访客的页面注入 Google One Tap（右上角自动登录提示），见 site/one-tap.ts
r.use('*', oneTapInject);

// ── 小工具 ──────────────────────────────────────────────────────────────────

async function ctx(c: {
  env: Env;
  req: { header: (k: string) => string | undefined };
}): Promise<{ user: UserRow | null; profile: UserProfile | null }> {
  const user = await currentWebUser(c);
  return { user, profile: user ? await toProfile(c.env, user) : null };
}

function pathOf(c: { req: { path: string; url: string } }): string {
  const u = new URL(c.req.url);
  return u.pathname + u.search;
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(htmlLang());
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US');
}

function loginGate(): string {
  return `<div class="card"><div class="empty">
  <div class="big">${st('g_login_needed')}</div>
  <p style="margin:14px 0 0"><a class="btn" href="/kol/exlogin">${st('nv_login')}</a></p>
</div></div>`;
}

function emptyBlock(title: string, hint = ''): string {
  return `<div class="empty"><div class="big">${escapeHtml(title)}</div>${
    hint ? `<div style="margin-top:6px">${escapeHtml(hint)}</div>` : ''
  }</div>`;
}

const safeParse = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** 收藏 payload 里尽力抠一个可读名字出来。 */
function itemLabel(p: Record<string, unknown>, fallback: string): string {
  for (const k of ['nickname', 'name', 'title', 'uniqueId', 'productName', 'shopName']) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return fallback;
}

function tiktokLink(itemType: string, itemId: string, p: Record<string, unknown>): string | null {
  const u = typeof p.uniqueId === 'string' && p.uniqueId ? p.uniqueId : null;
  if (itemType === 'CREATOR') return u ? `https://www.tiktok.com/@${encodeURIComponent(u)}` : null;
  if (itemType === 'VIDEO' && u)
    return `https://www.tiktok.com/@${encodeURIComponent(u)}/video/${encodeURIComponent(itemId)}`;
  return null;
}

// ── 营销日历数据 ─────────────────────────────────────────────────────────────
// 名称走 i18n（cd_ev_*），日期是 2026-08 起一个滚动年的固定节点。
// 农历/宗教节日按 2026-2027 年公历实际日期写死，明年更新一次即可。

type CalType = 'ecom' | 'holiday' | 'marketing';
const CAL_EVENTS: Array<{ key: string; date: string; days?: number; type: CalType; regions: string[] }> = [
  { key: 'backtoschool', date: '2026-08-15', days: 14, type: 'marketing', regions: ['us', 'eu'] },
  { key: '99', date: '2026-09-09', type: 'ecom', regions: ['sea'] },
  { key: 'moon', date: '2026-09-25', type: 'holiday', regions: ['cn', 'sea'] },
  { key: 'golden', date: '2026-10-01', days: 7, type: 'holiday', regions: ['cn'] },
  { key: '1010', date: '2026-10-10', type: 'ecom', regions: ['sea'] },
  { key: 'halloween', date: '2026-10-31', type: 'holiday', regions: ['us', 'eu'] },
  { key: '1111', date: '2026-11-11', type: 'ecom', regions: ['global'] },
  { key: 'thanksgiving', date: '2026-11-26', type: 'holiday', regions: ['us'] },
  { key: 'blackfriday', date: '2026-11-27', days: 4, type: 'ecom', regions: ['global'] },
  { key: 'cybermonday', date: '2026-11-30', type: 'ecom', regions: ['us', 'eu'] },
  { key: '1212', date: '2026-12-12', type: 'ecom', regions: ['sea'] },
  { key: 'christmas', date: '2026-12-25', type: 'holiday', regions: ['global'] },
  { key: 'newyear', date: '2027-01-01', type: 'holiday', regions: ['global'] },
  { key: 'lunar', date: '2027-02-06', days: 7, type: 'holiday', regions: ['cn', 'sea'] },
  { key: 'ramadan', date: '2027-02-08', days: 30, type: 'holiday', regions: ['me', 'sea'] },
  { key: 'valentine', date: '2027-02-14', type: 'holiday', regions: ['global'] },
  { key: 'eid', date: '2027-03-10', days: 3, type: 'holiday', regions: ['me', 'sea'] },
  { key: 'easter', date: '2027-03-28', type: 'holiday', regions: ['eu', 'latam'] },
  { key: 'songkran', date: '2027-04-13', days: 3, type: 'holiday', regions: ['sea'] },
  { key: 'mothers', date: '2027-05-09', type: 'marketing', regions: ['global'] },
  { key: '618', date: '2027-06-18', type: 'ecom', regions: ['cn'] },
  { key: 'fathers', date: '2027-06-20', type: 'marketing', regions: ['global'] },
  { key: 'primeday', date: '2027-07-13', days: 2, type: 'ecom', regions: ['us', 'eu'] },
];

const CAL_TYPE_META: Record<CalType, { label: () => string; cls: string }> = {
  ecom: { label: () => st('cd_type_ecom'), cls: 'blue' },
  holiday: { label: () => st('cd_type_holiday'), cls: 'green' },
  marketing: { label: () => st('cd_type_marketing'), cls: 'orange' },
};

function dayDiff(dateStr: string): number {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

/** 事件相对今天的状态标签：进行中 / 明天 / N 天后 / 已结束。 */
function calCountdown(ev: { date: string; days?: number }): { text: string; cls: string } {
  const diff = dayDiff(ev.date);
  const len = ev.days ?? 1;
  if (diff <= 0 && diff > -len) return { text: st('wb_ongoing'), cls: 'green' };
  if (diff <= -len) return { text: st('cd_ended'), cls: '' };
  if (diff === 1) return { text: st('wb_tomorrow'), cls: 'orange' };
  return { text: st('wb_days_later', { n: diff }), cls: diff <= 7 ? 'orange' : '' };
}

function calRegionChips(regions: string[]): string {
  return regions.map((x) => `<span class="chip">${st('cd_r_' + x)}</span>`).join(' ');
}

// ── 工作台 ──────────────────────────────────────────────────────────────────

r.get('/kol/workbench', async (c) => {
  const { user, profile } = await ctx(c);

  // 未登录也给完整框架：快捷入口 + 日历照常，数据区换成登录引导
  let collect: Record<string, number> = {};
  let promoTotal = 0;
  let taskRows: Array<{ task_id: string; type: string; status: string; created_at: number }> = [];
  let taskTotal = 0;
  let pcByStatus: Record<string, number> = {};
  let promoRows: Array<{ id: string; name: string; status: string; created_at: number; cnt: number }> = [];
  let mailSent = 0;
  let mailReplied = 0;

  if (user) {
    const [a, b, t1, t2, pc, pr, ml] = await Promise.all([
      c.env.DB.prepare(
        `SELECT item_type t, COUNT(*) n FROM collection_items WHERE user_id = ?1 GROUP BY item_type`,
      )
        .bind(user.id)
        .all<{ t: string; n: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) n FROM promotions WHERE user_id = ?1`)
        .bind(user.id)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT task_id, type, status, created_at FROM async_tasks
         WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 6`,
      )
        .bind(user.id)
        .all<{ task_id: string; type: string; status: string; created_at: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) n FROM async_tasks WHERE user_id = ?1`)
        .bind(user.id)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT status, COUNT(*) n FROM promotion_creators WHERE user_id = ?1 GROUP BY status`,
      )
        .bind(user.id)
        .all<{ status: string; n: number }>(),
      c.env.DB.prepare(
        `SELECT p.id, p.name, p.status, p.created_at,
                (SELECT COUNT(*) FROM promotion_creators pc WHERE pc.promotion_id = p.id) cnt
         FROM promotions p WHERE p.user_id = ?1 ORDER BY p.created_at DESC LIMIT 6`,
      )
        .bind(user.id)
        .all<{ id: string; name: string; status: string; created_at: number; cnt: number }>(),
      // 建联漏斗：发出多少封、有多少条线程收到过回信
      c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM mail_messages WHERE user_id = ?1 AND dir = 'out' AND status = 'sent') sent,
           (SELECT COUNT(DISTINCT thread_id) FROM mail_messages WHERE user_id = ?1 AND dir = 'in') replied`,
      )
        .bind(user.id)
        .first<{ sent: number; replied: number }>(),
    ]);
    for (const row of a.results ?? []) collect[row.t] = row.n;
    promoTotal = b?.n ?? 0;
    taskRows = t1.results ?? [];
    taskTotal = t2?.n ?? 0;
    for (const row of pc.results ?? []) pcByStatus[row.status] = row.n;
    promoRows = pr.results ?? [];
    mailSent = ml?.sent ?? 0;
    mailReplied = ml?.replied ?? 0;
  }

  const pcTotal = Object.values(pcByStatus).reduce((s, n) => s + n, 0);
  const pool = (collect.CREATOR ?? 0) + pcTotal;
  const contacted = pcByStatus.contacted ?? 0;
  const conv = pool > 0 ? Math.round((contacted / pool) * 100) : 0;

  // 零值不画假存根条：宽度直接 0，只留轨道 —— 图上读到多少就是多少
  const funnelBar = (label: string, n: number, max: number, cls = '') => `
<div class="fn-row">
  <span class="fn-l">${escapeHtml(label)}</span>
  <div class="fn-track"><div class="fn-bar ${cls}" style="width:${n > 0 && max > 0 ? Math.max(4, Math.round((n / max) * 100)) : 0}%"></div></div>
  <span class="fn-n">${fmtNum(n)}</span>
</div>`;

  const quick: Array<[string, string, string]> = [
    ['search', st('wb_qa_kol'), '/kol/search'],
    ['video', st('wb_qa_video'), '/kol/video-search'],
    ['bag', st('wb_qa_product'), '/kol/product-search'],
    ['shop', st('wb_qa_shop'), '/kol/shop-search'],
    ['trophy', st('wb_qa_rank'), '/kol/kol-rank'],
    ['star', st('wb_qa_collect'), '/kol/collect'],
    ['megaphone', st('wb_qa_promo'), '/kol/promotional'],
    ['alert', st('wb_qa_risk'), '/kol/risk'],
    ['calendar', st('nv_calendar'), '/kol/calendar'],
    ['chat', st('nv_msg'), '/kol/message-center'],
  ];

  const upcoming = CAL_EVENTS.filter((e) => {
    const diff = dayDiff(e.date);
    return diff > -(e.days ?? 1);
  }).slice(0, 4);

  const stats: Array<[string, number, string]> = [
    [st('nv_kol_fav'), collect.CREATOR ?? 0, '/kol/collect?type=CREATOR'],
    [st('nv_video_fav'), collect.VIDEO ?? 0, '/kol/collect?type=VIDEO'],
    [st('nv_promotional'), promoTotal, '/kol/promotional'],
    [st('nv_batch_tasks'), taskTotal, '/kol/task'],
  ];

  const statusChip = (s: string) => {
    const map: Record<string, [string, string]> = {
      pending: [st('st_pending'), ''],
      running: [st('st_running'), 'blue'],
      success: [st('st_success'), 'green'],
      failed: [st('st_failed'), 'red'],
      active: [st('wb_ongoing'), 'green'],
    };
    const [label, cls] = map[s] ?? [s, ''];
    return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
  };

  const taskTable = taskRows.length
    ? `<table>
<tr><th>${st('tb_type')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th></tr>
${taskRows
  .map(
    (t) => `<tr>
  <td>${st(t.type === 'creator_similarity' ? 'tk_type_similarity' : 'tk_type_review')}</td>
  <td>${statusChip(t.status)}</td>
  <td>${fmtDate(t.created_at)}</td>
</tr>`,
  )
  .join('')}
</table>`
    : emptyBlock(st('tk_none'), st('wb_empty_hint'));

  const planTable = promoRows.length
    ? `<table>
<tr><th>${st('tb_name')}</th><th class="num">${st('tb_creator')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th></tr>
${promoRows
  .map(
    (p) => `<tr>
  <td><a href="/kol/promotional/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a></td>
  <td class="num">${fmtNum(p.cnt)}</td>
  <td>${statusChip(p.status)}</td>
  <td>${fmtDate(p.created_at)}</td>
</tr>`,
  )
  .join('')}
</table>`
    : emptyBlock(st('pm_none'), st('pm_none_hint'));

  const dataSection = user
    ? `
<div class="wb-grid">
  <div class="card">
    <div class="card-h"><h2>${st('wb_overview')}</h2></div>
    <div class="stat-grid">
      ${stats
        .map(
          ([label, n, href]) => `<a class="stat" href="${href}">
        <div class="n">${fmtNum(n)}</div><div class="l">${escapeHtml(label)}</div>
      </a>`,
        )
        .join('')}
    </div>
    <div class="funnels">
      <div>
        <div class="fn-title">${st('wb_funnel_kol')}<span class="chip blue" style="margin-left:8px">${st('wb_conv')} ${conv}%</span></div>
        ${funnelBar(st('wb_pool'), pool, pool)}
        ${funnelBar(st('wb_contacted'), contacted, pool)}
        ${funnelBar(st('wb_working'), 0, pool)}
        ${funnelBar(st('wb_done'), 0, pool)}
      </div>
      <div${mailSent ? '' : ' class="fn-dim"'}>
        <div class="fn-title">${st('wb_funnel_mail')}<span class="chip blue" style="margin-left:8px">${st('wb_reply_rate')} ${
          mailSent > 0 ? Math.round((mailReplied / mailSent) * 100) : 0
        }%</span></div>
        ${funnelBar(st('wb_sent'), mailSent, Math.max(mailSent, 1))}
        ${funnelBar(st('wb_replied'), mailReplied, Math.max(mailSent, 1))}
        <div style="font-size:12px;color:var(--muted);margin-top:8px">
          <a href="/kol/mail">${st('nv_inbox')}</a> · <a href="/kol/create-mail">${st('nv_create_mail')}</a>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-h"><h2>${st('nv_calendar')}</h2><a href="/kol/calendar" style="font-size:12px">${st('wb_cal_full')}</a></div>
    ${
      upcoming.length
        ? upcoming
            .map((e) => {
              const cd = calCountdown(e);
              return `<div class="cal-ev">
  <div class="d">${e.date.slice(5).replace('-', '/')}</div>
  <div class="m">
    <div class="t">${st('cd_ev_' + e.key)}</div>
    <div class="r">${calRegionChips(e.regions)}</div>
  </div>
  <span class="chip ${cd.cls}">${cd.text}</span>
</div>`;
            })
            .join('')
        : `<div class="empty">${st('wb_cal_empty')}</div>`
    }
  </div>
</div>

<div class="card" style="margin-top:18px">
  <div class="tabs-line" id="wb-tabs">
    <a href="#" class="on" data-t="tasks">${st('nv_batch_tasks')}<span class="chip">${fmtNum(taskTotal)}</span></a>
    <a href="#" data-t="plans">${st('wb_tab_plans')}<span class="chip">${fmtNum(promoTotal)}</span></a>
  </div>
  <div id="tab-tasks">${taskTable}</div>
  <div id="tab-plans" hidden>${planTable}</div>
</div>`
    : loginGate();

  return html(
    appPage({
      title: brandTitle(st('nv_dashboard')),
      path: pathOf(c),
      profile,
      style: `
  .hero{
    margin-bottom:20px;background:var(--card);border:1px solid var(--line);
    border-left:4px solid var(--accent);border-radius:var(--r-md);padding:14px 24px 18px;
  }
  .dateline{
    display:flex;align-items:center;gap:10px;flex-wrap:wrap;
    padding-bottom:11px;margin-bottom:14px;border-bottom:1px solid var(--line);
    font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  }
  .dateline .dl-d::before{content:'✦ ';color:var(--accent);letter-spacing:0}
  .hero-row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
  .hero h1{font-size:22px;margin:0}
  .hero h1::after{display:none}
  .hero .s{color:var(--muted);font-family:var(--mono);font-size:12px;letter-spacing:.2px;margin-top:6px}
  .qa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:20px}
  .qa{
    display:flex;flex-direction:column;align-items:center;gap:8px;padding:15px 6px 13px;
    background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);color:var(--ink);font-size:12.5px;
    text-align:center;text-decoration:none;transition:transform .13s,box-shadow .13s,border-color .13s;
  }
  .qa .ic{color:var(--muted);transition:color .13s}
  .qa:hover{color:var(--ink);transform:translateY(-2px);box-shadow:var(--hard)}
  .qa:hover .ic{color:var(--accent)}
  .wb-grid{display:grid;grid-template-columns:1fr 340px;gap:18px;align-items:start}
  @media (max-width:980px){.wb-grid{grid-template-columns:1fr}}
  .card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .card-h h2{margin:0}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px}
  .stat{
    display:block;padding:14px;border:1px solid var(--line);border-radius:var(--r-md);color:var(--ink);
    text-decoration:none;transition:transform .13s,box-shadow .13s,border-color .13s;
  }
  .stat:hover{color:var(--ink);transform:translateY(-2px);box-shadow:var(--hard)}
  .stat .n{font-family:var(--serif);font-size:26px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
  .stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-top:2px}
  .funnels{display:grid;grid-template-columns:1fr 1fr;gap:26px}
  .funnels > div:last-child{border-left:1px solid var(--line);padding-left:26px}
  .fn-dim{opacity:.68}
  @media (max-width:720px){
    .funnels{grid-template-columns:1fr}
    .funnels > div:last-child{border-left:0;padding-left:0}
  }
  .fn-title{font-size:13.5px;font-weight:700;margin-bottom:12px;display:flex;align-items:center}
  .fn-row{display:flex;align-items:center;gap:10px;margin-bottom:9px}
  .fn-l{flex:0 0 108px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fn-track{flex:1;height:13px;background:color-mix(in srgb,var(--ink) 7%,transparent);overflow:hidden}
  .fn-bar{height:100%;background:var(--rule);border-right:3px solid var(--accent)}
  .fn-n{flex:0 0 52px;text-align:right;font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums}
  .cal-ev{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}
  .cal-ev:last-child{border-bottom:0}
  .cal-ev .d{flex:0 0 48px;font-family:var(--mono);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
  .cal-ev .m{flex:1;min-width:0}
  .cal-ev .t{font-size:13px}
  .cal-ev .r{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}
  .cal-ev .chip{font-size:10px;padding:0 6px}
  #wb-tabs .chip{margin-left:7px;padding:0 6px;font-size:10px;vertical-align:1px}
`,
      body: `
<div class="hero">
  <div class="dateline">
    <span class="dl-d">${escapeHtml(
      new Date().toLocaleDateString(htmlLang(), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }),
    )}</span>
    ${profile ? `<span class="chip blue">${escapeHtml(profile.planName)}</span>` : ''}
  </div>
  <div class="hero-row">
    <h1>${st('wb_greet')}${profile ? `, ${escapeHtml(profile.username)}` : ''}</h1>
    <a class="btn ghost" href="/kol/guide">${st('nv_guide')}</a>
  </div>
  <div class="s">${st('wb_sub')}</div>
</div>

<div class="qa-grid">
${quick.map(([icon, label, href]) => `  <a class="qa" href="${href}">${ic(icon, 22)}${escapeHtml(label)}</a>`).join('\n')}
</div>

${dataSection}`,
      script: user
        ? `
document.querySelectorAll('#wb-tabs a').forEach(function(a){
  a.addEventListener('click', function(e){
    e.preventDefault();
    document.querySelectorAll('#wb-tabs a').forEach(function(x){ x.classList.toggle('on', x === a); });
    document.getElementById('tab-tasks').hidden = a.dataset.t !== 'tasks';
    document.getElementById('tab-plans').hidden = a.dataset.t !== 'plans';
  });
});`
        : undefined,
    }),
  );
});

// ── 个人中心 ─────────────────────────────────────────────────────────────────

r.get('/kol/personal', async (c) => {
  const { user, profile } = await ctx(c);
  // 用 c.redirect 而不是 Response.redirect：后者的响应头是不可变的，
  // 外层 CORS 中间件往上打头会抛 "Can't modify immutable headers."，
  // 未登录的人看到的就成了一坨 ERR_INTERNAL JSON 而不是登录页。
  if (!user || !profile) return c.redirect('/kol/exlogin', 302);

  // 扩展 popup 的「我的权益」入口带的是 ?type=rights（原站参数名），两个都认
  const tab = c.req.query('tab') || c.req.query('type') || 'account';
  const quotas = await getAllQuotas(c.env, user);

  const menu: Array<[string, string]> = [
    ['account', st('pc_menu_account')],
    ['rights', st('pc_menu_rights')],
    ['subscription', st('pc_menu_sub')],
    ['orders', st('pc_menu_orders')],
    ['coupons', st('pc_menu_coupons')],
  ];

  const ADDON_KEYS: Record<string, string> = {
    addon_transcript: 'pr_a_transcript',
    addon_similar: 'pr_a_similar',
    addon_sea: 'pr_a_sea',
    addon_outreach: 'pr_a_outreach',
    addon_bulk_download: 'pr_a_bulk',
    addon_credits: 'pr_a_credits',
  };
  const itemName = (kind: string, code: string) => {
    if (kind === 'plan') {
      const base = code.startsWith('pro') ? st('pr_plan_pro') : st('pr_plan_plus');
      return `${base} · ${code.endsWith('_year') ? st('pr_annual') : st('pr_monthly')}`;
    }
    return ADDON_KEYS[code] ? st(ADDON_KEYS[code]) : code;
  };

  const quotaTable = `<table>
<tr><th>${st('th_feature')}</th><th class="num">${st('th_remaining')}</th></tr>
${Object.entries(quotas)
  .map(
    ([k, v]) =>
      `<tr><td>${st('q_' + k)}</td><td class="num">${fmtNum(v.available)} / ${fmtNum(v.total)}</td></tr>`,
  )
  .join('')}
</table>`;

  let content = '';
  if (tab === 'account') {
    content = `
<div class="pc-profile">
  <span class="avatar big">${escapeHtml((profile.username || 'U').slice(0, 1).toUpperCase())}</span>
  <div>
    <div style="font-size:17px;font-weight:600">${escapeHtml(profile.username)}</div>
    <div style="color:var(--muted);font-size:13px">${escapeHtml(profile.email ?? '')}</div>
  </div>
  <div style="margin-left:auto;display:flex;gap:10px">
    <a class="btn ghost" href="/price">${st('pc_upgrade')}</a>
    <a class="btn" href="/price">${st('pc_buy')}</a>
  </div>
</div>
<dl class="pc-dl">
  <dt>${st('me_plan')}</dt><dd><span class="chip blue">${escapeHtml(profile.planName)}</span></dd>
  <dt>${st('pc_valid_until')}</dt><dd>${
      profile.planExpireAt ? fmtDate(profile.planExpireAt) : st('never_expire')
    }</dd>
  <dt>${st('me_created')}</dt><dd>${fmtDate(profile.createdAt)}</dd>
</dl>
<h2 style="font-size:15px;margin:22px 0 10px">${st('me_quota_h2')}</h2>
${quotaTable}`;
  } else if (tab === 'rights') {
    const unlocked = (label: string) =>
      `<div class="right-row"><span>${escapeHtml(label)}</span><span class="chip green">${st('pc_unlocked')}</span></div>`;
    content = `
<div class="rights-banner">
  <div style="font-weight:600">${st('pc_rights_current', { plan: profile.planName })}</div>
  <div style="font-size:12.5px;color:var(--muted);margin-top:3px">${st('pc_rights_banner')}。${st('pc_rights_auto')}</div>
</div>
<h2 style="font-size:15px;margin:20px 0 10px">${st('pc_rights_plugin')}</h2>
${quotaTable}
<div style="margin-top:10px">
  ${unlocked(st('pc_r_watermark'))}
  ${unlocked(st('pc_r_caption'))}
</div>
<h2 style="font-size:15px;margin:22px 0 10px">${st('pc_rights_web')}</h2>
${unlocked(st('pc_r_collect'))}
${unlocked(st('pc_r_promo'))}
${unlocked(st('pc_r_coop'))}
${unlocked(st('pc_r_export'))}
<p style="margin-top:20px"><a class="btn" href="/price">${st('pc_upgrade')}</a></p>`;
  } else if (tab === 'subscription') {
    // 订阅管理：profile 里只有套餐/到期，订阅本体（Creem subscription id、周期、
    // 续费流水）都在 orders 表。取消订阅/换卡没有后端路由，引导走联系入口。
    const [subOrder, renewals, addons] = await Promise.all([
      c.env.DB.prepare(
        `SELECT item_code, amount_cents, currency, paid_at, creem_subscription_id FROM orders
         WHERE user_id = ?1 AND kind = 'plan' AND status = 'paid' AND creem_subscription_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(user.id)
        .first<{ item_code: string; amount_cents: number; currency: string; paid_at: number | null; creem_subscription_id: string }>(),
      c.env.DB.prepare(
        `SELECT item_code, amount_cents, status, paid_at, created_at FROM orders
         WHERE user_id = ?1 AND kind = 'plan' ORDER BY created_at DESC LIMIT 12`,
      )
        .bind(user.id)
        .all<{ item_code: string; amount_cents: number; status: string; paid_at: number | null; created_at: number }>(),
      c.env.DB.prepare(
        `SELECT item_code, amount_cents, created_at FROM orders
         WHERE user_id = ?1 AND kind = 'addon' AND status = 'paid' ORDER BY created_at DESC LIMIT 20`,
      )
        .bind(user.id)
        .all<{ item_code: string; amount_cents: number; created_at: number }>(),
    ]);

    const isFree = profile.planCode === 'free';
    const daysLeft = profile.planExpireAt
      ? Math.max(0, Math.ceil((profile.planExpireAt - Date.now() / 1000) / 86400))
      : null;

    const renewRows = renewals.results ?? [];
    const addonRows = addons.results ?? [];

    content = `
<div class="rights-banner">
  <div style="font-weight:600">${st('pc_sub_current')}：<span class="chip blue">${escapeHtml(profile.planName)}</span>
    ${subOrder ? `<span class="chip green">${st('pc_sub_active')}</span>` : isFree ? '' : `<span class="chip">${st('pc_sub_onetime')}</span>`}
  </div>
  <div style="font-size:12.5px;color:var(--muted);margin-top:5px">
    ${
      isFree
        ? st('pc_sub_none')
        : `${st('pc_valid_until')}：${profile.planExpireAt ? fmtDate(profile.planExpireAt) : st('never_expire')}${
            daysLeft != null ? `（${st('wb_days_later', { n: daysLeft })}）` : ''
          }${subOrder ? ` · ${st('pc_sub_cycle')}：${subOrder.item_code.endsWith('_year') ? st('pr_annual') : st('pr_monthly')}` : ''}`
    }
  </div>
</div>
${
  renewRows.length
    ? `<h2 style="font-size:15px;margin:20px 0 10px">${st('pc_sub_history')}</h2>
<table>
<tr><th>${st('pc_o_time')}</th><th>${st('pc_o_item')}</th><th class="num">${st('pc_o_amount')}</th><th>${st('pc_o_status')}</th></tr>
${renewRows
  .map(
    (o) =>
      `<tr><td>${fmtDate(o.paid_at || o.created_at)}</td><td>${escapeHtml(itemName('plan', o.item_code))}</td>` +
      `<td class="num">$${(o.amount_cents / 100).toFixed(2)}</td><td><span class="chip ${o.status === 'paid' ? 'green' : ''}">${st(
        o.status === 'paid' ? 'pc_o_paid' : o.status === 'pending' ? 'pc_o_pending' : 'pc_o_canceled',
      )}</span></td></tr>`,
  )
  .join('')}
</table>`
    : ''
}
${
  addonRows.length
    ? `<h2 style="font-size:15px;margin:20px 0 10px">${st('pc_sub_addons')}</h2>
<table>
<tr><th>${st('pc_o_time')}</th><th>${st('pc_o_item')}</th><th class="num">${st('pc_o_amount')}</th></tr>
${addonRows
  .map(
    (o) =>
      `<tr><td>${fmtDate(o.created_at)}</td><td>${escapeHtml(itemName('addon', o.item_code))}</td><td class="num">$${(o.amount_cents / 100).toFixed(2)}</td></tr>`,
  )
  .join('')}
</table>`
    : ''
}
<p style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
  <a class="btn" href="/price">${isFree ? st('pc_upgrade') : st('pc_buy')}</a>
</p>
<p style="font-size:12.5px;color:var(--muted)">${st('pc_sub_cancel_hint')}</p>`;
  } else if (tab === 'orders') {
    // Creem 订单流水（routes/pay.ts 落库，webhook 履约后置为 paid）
    const { results: orderRows } = await c.env.DB.prepare(
      `SELECT kind, item_code, amount_cents, currency, status, created_at
       FROM orders WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<{
        kind: string;
        item_code: string;
        amount_cents: number;
        currency: string;
        status: string;
        created_at: number;
      }>();
    const rows = orderRows ?? [];

    const statusChip = (s: string) => {
      const cls = s === 'paid' ? 'chip green' : s === 'pending' ? 'chip blue' : 'chip';
      const key =
        s === 'paid' ? 'pc_o_paid' : s === 'pending' ? 'pc_o_pending' : s === 'refunded' ? 'pc_o_refunded' : 'pc_o_canceled';
      return `<span class="${cls}">${st(key)}</span>`;
    };

    content = rows.length
      ? `<table>
<tr><th>${st('pc_o_time')}</th><th>${st('pc_o_item')}</th><th class="num">${st('pc_o_amount')}</th><th>${st('pc_o_status')}</th></tr>
${rows
  .map(
    (o) =>
      `<tr><td>${fmtDate(o.created_at)}</td><td>${escapeHtml(itemName(o.kind, o.item_code))}</td>` +
      `<td class="num">$${(o.amount_cents / 100).toFixed(2)}</td><td>${statusChip(o.status)}</td></tr>`,
  )
  .join('')}
</table>`
      : emptyBlock(st('pc_orders_empty'));
  } else {
    content = emptyBlock(st('pc_coupons_empty'));
  }

  return html(
    appPage({
      title: brandTitle(st('nv_personal')),
      path: pathOf(c),
      profile,
      style: `
  .pc-wrap{display:grid;grid-template-columns:212px 1fr;gap:18px;align-items:start}
  @media (max-width:760px){.pc-wrap{grid-template-columns:1fr}}
  .pc-menu{display:flex;flex-direction:column;gap:2px;padding:12px}
  .pc-menu a{padding:9px 13px;color:var(--muted);font-size:13.5px;text-decoration:none;border-left:2px solid transparent}
  .pc-menu a:hover{color:var(--ink)}
  .pc-menu a.on{
    border-left-color:var(--accent);color:var(--ink);font-weight:700;
    background:color-mix(in srgb,var(--accent) 5%,transparent);
  }
  .pc-menu form{margin-top:8px;border-top:1px solid var(--line);padding-top:10px;padding-left:13px}
  .pc-profile{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}
  .avatar.big{width:54px;height:54px;font-size:24px;border-radius:var(--r-md)}
  .pc-dl{display:grid;grid-template-columns:auto 1fr;gap:9px 22px;margin:0;font-size:13.5px}
  .pc-dl dt{color:var(--muted);font-family:var(--mono);font-size:12px}
  .pc-dl dd{margin:0}
  .rights-banner{
    padding:14px 16px;border-left:3px solid var(--accent);
    background:color-mix(in srgb,var(--accent) 5%,transparent);
  }
  .right-row{display:flex;align-items:center;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--line);font-size:13.5px}
  .right-row:last-child{border-bottom:0}
`,
      body: `
<h1>${st('nv_personal')}</h1>
<p class="sub">${escapeHtml(profile.email ?? profile.username)}</p>
<div class="pc-wrap">
  <div class="card pc-menu">
    ${menu
      .map(([k, label]) => `<a class="${tab === k ? 'on' : ''}" href="/kol/personal?tab=${k}">${escapeHtml(label)}</a>`)
      .join('')}
    <form method="post" action="/kol/logout"><button class="linklike" type="submit">${st('nv_logout')}</button></form>
  </div>
  <div class="card">${content}</div>
</div>`,
    }),
  );
});

r.post('/kol/logout', async (c) => {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (m) await c.env.DB.prepare(`DELETE FROM web_sessions WHERE sid = ?1`).bind(m[1]).run().catch(() => {});
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
});

// ── 收藏夹 ──────────────────────────────────────────────────────────────────

const COLLECT_TABS: Array<[string, string]> = [
  ['CREATOR', 'cl_tab_creator'],
  ['VIDEO', 'cl_tab_video'],
  ['PRODUCT', 'cl_tab_product'],
  ['SHOP', 'cl_tab_shop'],
  ['CAPTION', 'cl_tab_caption'],
];

r.get('/kol/collect', async (c) => {
  const { user, profile } = await ctx(c);
  const type = (c.req.query('type') || 'CREATOR').toUpperCase();

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const [folders, items, monthNew] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, name, item_count FROM collection_folders
         WHERE user_id = ?1 AND type = ?2 ORDER BY created_at ASC`,
      )
        .bind(user.id, type)
        .all<{ id: string; name: string; item_count: number }>(),
      c.env.DB.prepare(
        `SELECT i.item_id, i.region, i.payload, i.created_at, f.name folder
         FROM collection_items i JOIN collection_folders f ON f.id = i.folder_id
         WHERE i.user_id = ?1 AND i.item_type = ?2 ORDER BY i.created_at DESC LIMIT 100`,
      )
        .bind(user.id, type)
        .all<{ item_id: string; region: string | null; payload: string | null; created_at: number; folder: string }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) n FROM collection_items
         WHERE user_id = ?1 AND item_type = ?2 AND created_at >= unixepoch('now','start of month')`,
      )
        .bind(user.id, type)
        .first<{ n: number }>(),
    ]);

    const folderName = (name: string) =>
      name === 'AITikTokDownloader_#Default' ? st('cl_default') : name;

    const rows = items.results ?? [];
    const table = rows.length
      ? `<table>
<tr><th>${st('tb_name')}</th><th>${st('cl_folders')}</th><th>${st('tb_region')}</th><th>${st('tb_created')}</th></tr>
${rows
  .map((row) => {
    const p = safeParse(row.payload);
    const label = itemLabel(p, row.item_id);
    const link = tiktokLink(type, row.item_id, p);
    return `<tr>
  <td>${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : escapeHtml(label)}</td>
  <td>${escapeHtml(folderName(row.folder))}</td>
  <td>${escapeHtml(row.region ?? '—')}</td>
  <td>${fmtDate(row.created_at)}</td>
</tr>`;
  })
  .join('')}
</table>`
      : `<div class="empty">
  <div class="big">${st('cl_empty_title')}</div>
  <div style="max-width:560px;margin:10px auto 0;text-align:left">
    ${st('cl_empty_q')}<br>${st('cl_how1')}<br>${st('cl_how2')}<br>${st('cl_how3', { brand: BRAND_NAME })}
  </div>
</div>`;

    const folderChips = (folders.results ?? [])
      .map(
        (f) =>
          `<span class="chip">${escapeHtml(folderName(f.name))} · ${fmtNum(f.item_count)}</span>`,
      )
      .join(' ');

    body = `
<div class="card">
  <div class="tabs-line">
    ${COLLECT_TABS.map(
      ([t, key]) => `<a class="${t === type ? 'on' : ''}" href="/kol/collect?type=${t}">${st(key)}</a>`,
    ).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    ${folderChips}
    <span class="chip blue">${st('cl_new_month', { num: monthNew?.n ?? 0 })}</span>
  </div>
  ${table}
</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('wb_qa_collect')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('wb_qa_collect')}</h1><p class="sub">${st('cl_empty_title')}</p>${body}`,
    }),
  );
});

// ── 搜索页（达人 / 视频 / 商品）─────────────────────────────────────────────

function searchForm(action: string, q: string): string {
  return `<form method="get" action="${action}" style="display:flex;gap:10px;margin-bottom:16px">
  <input type="search" name="q" value="${escapeHtml(q)}" placeholder="${st('sr_ph')}">
  <button class="btn" type="submit">${st('sr_btn')}</button>
</form>`;
}

/**
 * 达人 / 视频搜索：数据来自 TikTok 实时搜索（tikwm）。
 *
 * 主路径是**浏览器直连** tikwm（CSP 已放行）—— 免费额度按用户自己的出口 IP
 * 计，我们零成本；直连失败（限流/日额度/网络）时退回同源兜底
 * POST /kol/api/search（routes/site-kol-api.ts，消耗 FindKol 配额）。
 * 无论哪条路，成功结果都回灌 D1，本地索引越搜越厚。
 * 筛选（地区/粉丝量）是对已加载结果的后过滤 —— TikTok 搜索本身不支持
 * 按国家过滤，这点和原站的自建索引不同，页面上有文案说明。
 */

const SEARCH_REGIONS = [
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'BR', 'MX',
  'JP', 'KR', 'TW', 'ID', 'VN', 'TH', 'MY', 'PH', 'SG', 'SA', 'AE',
];

/** 搜索页共用的客户端工具（ES5 风格，和站内其它页面一致）。 */
function searchJsPrelude(): string {
  return `
var TK = 'https://www.tikwm.com/api/';
function nfmt(n){ if(n==null) return '—'; try{ return new Intl.NumberFormat(LANG,{notation:'compact',maximumFractionDigits:1}).format(n); }catch(e){ return String(n); } }
function regionName(code){ if(!code) return ''; try{ return new Intl.DisplayNames([LANG],{type:'region'}).of(code)||code; }catch(e){ return code; } }
function el(tag, cls, text){ var x=document.createElement(tag); if(cls) x.className=cls; if(text!=null) x.textContent=text; return x; }
function tkDirect(path, params){
  var qs=[]; for(var k in params) qs.push(encodeURIComponent(k)+'='+encodeURIComponent(params[k]));
  var ctl = new AbortController(); var tm = setTimeout(function(){ ctl.abort(); }, 12000);
  return fetch(TK+path+'?'+qs.join('&'), {signal: ctl.signal}).then(function(r){
    clearTimeout(tm);
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  }).then(function(j){
    if(!j || typeof j.code === 'undefined') throw new Error('bad json');
    if(j.code === 0) return j.data || {};
    throw new Error(j.msg || 'tikwm error');
  });
}
function post(url, body){
  return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body)})
    .then(function(r){ return r.json(); });
}
function relay(body){
  return post('/kol/api/search', body).then(function(j){
    if(j.code === 'OK') return j.data;
    var e = new Error(j.message || 'relay failed'); e.relayCode = j.code; throw e;
  });
}
function ingest(creators, videos){
  if(!SIGNED || ((creators||[]).length + (videos||[]).length) === 0) return;
  post('/kol/api/ingest', {creators: creators||[], videos: videos||[]}).catch(function(){});
}
function normUser(it){
  var u=(it&&it.user)||it||{}; var s=(it&&it.stats)||{};
  if(!u.id || !(u.uniqueId||u.unique_id)) return null;
  return { id:String(u.id), uniqueId:u.uniqueId||u.unique_id, nickname:u.nickname||'', region:u.region||null,
    followerCount:s.followerCount!=null?s.followerCount:null,
    heartCount:s.heartCount!=null?s.heartCount:(s.heart!=null?s.heart:null),
    videoCount:s.videoCount!=null?s.videoCount:null,
    signature:u.signature||'', verified:!!u.verified, avatar:u.avatarThumb||'' };
}
function normVid(v){
  if(!v || !v.video_id) return null; var a=v.author||{};
  var cover=v.cover||v.origin_cover||'';
  if(cover && cover.charAt(0)==='/') cover='https://www.tikwm.com'+cover;
  return { id:String(v.video_id), title:v.title||'', region:v.region||null, cover:cover,
    duration:v.duration!=null?v.duration:null,
    playCount:v.play_count!=null?v.play_count:null, likeCount:v.digg_count!=null?v.digg_count:null,
    commentCount:v.comment_count!=null?v.comment_count:null, shareCount:v.share_count!=null?v.share_count:null,
    createTime:v.create_time!=null?v.create_time:null,
    authorId:a.id?String(a.id):null, authorUniqueId:a.unique_id||'', authorNickname:a.nickname||'' };
}
function actBtn(label, done, fn){
  var b=el('button','btn ghost rbtn',label); b.type='button';
  b.addEventListener('click', function(){
    if(!SIGNED){ location.href='/kol/exlogin'; return; }
    b.disabled=true;
    fn().then(function(j){
      if(j && j.code==='OK'){ b.textContent=done; } else { b.disabled=false; alert((j&&j.message)||T.err); }
    }).catch(function(){ b.disabled=false; alert(T.err); });
  });
  return b;
}
function statPair(label, n){
  var d=el('span','rstat'); d.appendChild(el('b',null,nfmt(n))); d.appendChild(el('i',null,label)); return d;
}
function histLoad(key){ try{ return JSON.parse(localStorage.getItem(key)||'[]'); }catch(e){ return []; } }
function histPush(key, kw){
  var h=histLoad(key).filter(function(x){ return x!==kw; }); h.unshift(kw);
  try{ localStorage.setItem(key, JSON.stringify(h.slice(0,10))); }catch(e){}
}
`;
}

/** 搜索页共用的样式（结果卡片、筛选条）。 */
const SEARCH_CSS = `
  .sbar{display:flex;gap:10px;flex-wrap:wrap}
  .sbar select,.sbar input{padding:8px 11px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink);font-size:13.5px}
  .sbar input{flex:1;min-width:230px}
  .sflt{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .sflt label{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .sflt select{padding:6px 9px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink);font-size:12.5px}
  .schips{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .schips .lbl{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .schip{padding:3px 10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink);cursor:pointer;font-size:12px}
  .schip:hover{border-color:var(--rule)}
  .sstatus{margin-top:14px;font-size:13px;color:var(--muted)}
  .sstatus.err{color:var(--accent)}
  .res{display:flex;gap:14px;padding:14px 2px;border-bottom:1px solid var(--line)}
  .res:last-child{border-bottom:0}
  .ravatar{width:46px;height:46px;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--rule);flex:none}
  .rcover{width:74px;aspect-ratio:9/16;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--rule);flex:none}
  .rmain{flex:1;min-width:0}
  .rline1{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rname{font-weight:700;font-size:14.5px}
  .ruid{color:var(--muted);font-family:var(--mono);font-size:12px;text-decoration:none}
  .rstats{display:flex;gap:16px;margin-top:6px;flex-wrap:wrap}
  .rstat b{font-family:var(--serif);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
  .rstat i{font-style:normal;font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-left:5px}
  .rsig{margin-top:5px;font-size:12.5px;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .racts{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;flex:none}
  .rbtn{padding:5px 11px;font-size:12px}
  .smore{margin-top:16px;text-align:center}
`;

r.get('/kol/search', async (c) => {
  const { user, profile } = await ctx(c);
  const q = (c.req.query('q') || c.req.query('keyword') || '').trim().slice(0, 80);
  const mode0 = c.req.query('mode') === 'id' ? 'id' : 'kw';

  // 热门标签：回流 + 回灌数据里出现最多的话题，点了直接搜
  const { results: tagRows } = await c.env.DB.prepare(
    `SELECT tag, SUM(hit_count) n FROM creator_tags GROUP BY tag ORDER BY n DESC LIMIT 10`,
  ).all<{ tag: string; n: number }>();

  const tj = (k: string) => JSON.stringify(st(k));

  return html(
    appPage({
      title: brandTitle(st('nv_kol_search')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_kol_search') },
      profile,
      style: SEARCH_CSS,
      body: `<h1>${st('nv_kol_search')}</h1><p class="sub">${st('sr_kol_sub')}</p>
<div class="card">
  <div class="sbar">
    <select id="smode">
      <option value="kw"${mode0 === 'kw' ? ' selected' : ''}>${st('ks_mode_kw')}</option>
      <option value="id"${mode0 === 'id' ? ' selected' : ''}>${st('ks_mode_id')}</option>
    </select>
    <input type="search" id="skw" value="${escapeHtml(q)}" placeholder="${escapeHtml(st('ks_ph_kw'))}" autocomplete="off">
    <button class="btn" id="sgo" type="button">${ic('search', 16)}${st('sr_btn')}</button>
  </div>
  <div class="sflt">
    <label>${st('ks_region')}</label>
    <select id="sregion"><option value="">${st('ks_any')}</option></select>
    <label>${st('ks_fans')}</label>
    <select id="sfans">
      <option value="">${st('ks_any')}</option>
      <option value="0-10000">&lt; 10K</option>
      <option value="10000-100000">10K – 100K</option>
      <option value="100000-1000000">100K – 1M</option>
      <option value="1000000-">≥ 1M</option>
    </select>
    <label>${st('ks_sort')}</label>
    <select id="ssort">
      <option value="rel">${st('ks_sort_rel')}</option>
      <option value="fans">${st('tb_followers')}</option>
      <option value="heart">${st('ks_hearts')}</option>
    </select>
    <button class="btn ghost rbtn" id="scondsave" type="button">${st('ks_cond_save')}</button>
  </div>
  <div class="schips" id="shot" hidden><span class="lbl">${st('ks_hot')}</span></div>
  <div class="schips" id="shist" hidden><span class="lbl">${st('ks_hist')}</span></div>
  <div class="schips" id="sconds" hidden><span class="lbl">${st('ks_cond')}</span></div>
  <div class="sstatus" id="sstatus">${st('ks_live_tip')}</div>
  <div id="sres"></div>
  <div class="smore" id="smore" hidden><button class="btn ghost" id="smorebtn" type="button">${st('ks_load_more')}</button></div>
</div>`,
      script: `
var LANG = ${JSON.stringify(htmlLang())};
var SIGNED = ${user ? 'true' : 'false'};
var T = { err:${tj('ks_err')}, searching:${tj('ks_searching')},
  relayUsed:${tj('ks_relay_used')}, none:${tj('sr_none')},
  verified:${tj('ks_verified')}, followers:${tj('tb_followers')}, hearts:${tj('ks_hearts')},
  videos:${tj('ks_videos_n')}, detail:${tj('ks_detail')}, fav:${tj('ks_fav')}, faved:${tj('ks_faved')},
  plan:${tj('ks_plan')}, planned:${tj('ks_planned')}, condName:${tj('ks_cond_name')},
  liveTip:${tj('ks_live_tip')}, loginToSearch:${tj('ks_login_to_search')}, login:${tj('nv_login')},
  quotaLeft:${tj('ks_quota_left')} };
var HOT = ${JSON.stringify((tagRows ?? []).map((x) => x.tag))};
var REGIONS = ${JSON.stringify(SEARCH_REGIONS)};
${searchJsPrelude()}
var $ = function(id){ return document.getElementById(id); };
var S = { mode:'kw', keyword:'', cursor:0, items:[], seen:{}, busy:false, hasMore:false, useRelay:false, searched:false, ticket:'', quotaLeft:null };

(function initRegions(){
  var sel = $('sregion');
  REGIONS.forEach(function(code){
    var o = document.createElement('option'); o.value = code; o.textContent = regionName(code);
    sel.appendChild(o);
  });
})();

function setStatus(text, isErr){
  var s = $('sstatus'); s.textContent = text || ''; s.className = 'sstatus' + (isErr ? ' err' : '');
}
function showLoginPrompt(){
  var s = $('sstatus'); s.textContent = ''; s.className = 'sstatus err';
  s.appendChild(el('span', null, T.loginToSearch + ' '));
  var a = el('a', null, T.login); a.href = '/kol/exlogin';
  s.appendChild(a);
}
function doneStatus(){
  if (S.useRelay) return setStatus(T.relayUsed);
  if (S.quotaLeft != null) return setStatus(T.quotaLeft.split('{n}').join(String(S.quotaLeft)));
  setStatus('');
}

function fetchDirect(){
  if (S.mode === 'id') {
    return tkDirect('user/info', {unique_id: S.keyword.replace(/^@/, '')}).then(function(d){
      var one = normUser(d); ingest(one ? [one] : [], []);
      return {items: one ? [one] : [], hasMore: false, cursor: 0};
    });
  }
  return tkDirect('user/search', {keywords: S.keyword, count: '20', cursor: String(S.cursor)}).then(function(d){
    var items = (d.user_list || []).map(normUser).filter(Boolean);
    ingest(items, []);
    return {items: items, hasMore: !!d.has_more, cursor: d.cursor};
  });
}
function fetchRelay(){
  return relay({mode: S.mode === 'id' ? 'id' : 'user', keyword: S.keyword, cursor: S.cursor, ticket: S.ticket}).then(function(d){
    return {items: d.items || [], hasMore: !!d.hasMore, cursor: d.cursor};
  });
}
function loadPage(){
  if (S.busy || !S.keyword) return;
  S.busy = true; setStatus(T.searching);
  // 直连也逐页核销票据额度（和兜底同一份 8 页预算），核销不过就不发直连
  var p;
  if (S.useRelay) {
    p = fetchRelay();
  } else {
    p = post('/kol/api/search-page', {ticket: S.ticket}).then(function(j){
      if (j.code !== 'OK') { var e = new Error(j.message || T.err); e.pageGate = true; throw e; }
      return fetchDirect().catch(function(){
        S.useRelay = true;
        return fetchRelay();
      });
    });
  }
  p.then(function(res){
    var fresh = res.items.filter(function(x){ if (S.seen[x.id]) return false; S.seen[x.id] = 1; return true; });
    S.items = S.items.concat(fresh);
    S.cursor = res.cursor != null ? res.cursor : S.cursor + res.items.length;
    S.hasMore = !!res.hasMore;
    S.busy = false;
    doneStatus();
    render();
  }).catch(function(err){
    S.busy = false;
    if (err && err.pageGate) S.hasMore = false;
    setStatus((err && err.message) || T.err, true);
    render();
  });
}
function startSearch(kw){
  kw = (kw || '').trim(); if (!kw) return;
  if (!SIGNED) { showLoginPrompt(); return; }
  S.mode = $('smode').value === 'id' ? 'id' : 'kw';
  S.keyword = kw; S.cursor = 0; S.items = []; S.seen = {}; S.hasMore = false; S.searched = true;
  S.ticket = ''; S.useRelay = false;
  $('skw').value = kw;
  histPush('ks_hist_kol', kw); renderHist();
  setStatus(T.searching);
  // 搜索是会员功能：先换票（扣 1 次 FindKol），同一次搜索的翻页共用这张票
  post('/kol/api/search-ticket', {mode: S.mode, keyword: kw}).then(function(j){
    if (j.code !== 'OK') { setStatus(j.message || T.err, true); return; }
    S.ticket = j.data.ticket;
    S.quotaLeft = j.data.remaining;
    loadPage();
  }).catch(function(){ setStatus(T.err, true); });
}

function filtered(){
  var region = $('sregion').value;
  var fr = $('sfans').value.split('-');
  var min = fr[0] ? Number(fr[0]) : 0, max = fr.length > 1 && fr[1] ? Number(fr[1]) : Infinity;
  var sort = $('ssort').value;
  var out = S.items.filter(function(x){
    if (region && x.region !== region) return false;
    if ($('sfans').value){
      if (x.followerCount == null) return false;
      if (x.followerCount < min || x.followerCount >= max) return false;
    }
    return true;
  });
  if (sort === 'fans') out = out.slice().sort(function(a,b){ return (b.followerCount||0) - (a.followerCount||0); });
  if (sort === 'heart') out = out.slice().sort(function(a,b){ return (b.heartCount||0) - (a.heartCount||0); });
  return out;
}

function card(x){
  var c = el('div', 'res');
  var av = el('img', 'ravatar');
  if (x.avatar) { av.src = x.avatar; av.alt = ''; av.onerror = function(){ av.style.visibility = 'hidden'; }; }
  else av.style.visibility = 'hidden';
  c.appendChild(av);
  var m = el('div', 'rmain');
  var l1 = el('div', 'rline1');
  var nameA = el('a', 'rname', x.nickname || x.uniqueId);
  nameA.href = '/kol/kol-detail/' + encodeURIComponent(x.uniqueId);
  l1.appendChild(nameA);
  var uidA = el('a', 'ruid', '@' + x.uniqueId);
  uidA.href = 'https://www.tiktok.com/@' + encodeURIComponent(x.uniqueId);
  uidA.target = '_blank'; uidA.rel = 'noopener';
  l1.appendChild(uidA);
  if (x.verified) l1.appendChild(el('span', 'chip blue', T.verified));
  if (x.region) l1.appendChild(el('span', 'chip', regionName(x.region)));
  m.appendChild(l1);
  var stats = el('div', 'rstats');
  stats.appendChild(statPair(T.followers, x.followerCount));
  stats.appendChild(statPair(T.hearts, x.heartCount));
  stats.appendChild(statPair(T.videos, x.videoCount));
  m.appendChild(stats);
  if (x.signature) m.appendChild(el('div', 'rsig', x.signature));
  c.appendChild(m);
  var acts = el('div', 'racts');
  var det = el('a', 'btn ghost rbtn', T.detail);
  det.href = '/kol/kol-detail/' + encodeURIComponent(x.uniqueId);
  acts.appendChild(det);
  acts.appendChild(actBtn(T.fav, T.faved, function(){
    return post('/kol/api/collect', {type:'CREATOR', id:x.id, region:x.region, uniqueId:x.uniqueId,
      payload:{nickname:x.nickname, followerCount:x.followerCount}});
  }));
  acts.appendChild(actBtn(T.plan, T.planned, function(){
    return post('/kol/api/promotion-add', {creatorId:x.uniqueId, region:x.region,
      payload:{nickname:x.nickname, followerCount:x.followerCount}});
  }));
  c.appendChild(acts);
  return c;
}

function render(){
  var box = $('sres'); box.innerHTML = '';
  var rows = filtered();
  if (S.searched && !S.busy && !rows.length) {
    var em = el('div', 'empty', T.none); box.appendChild(em);
  }
  rows.forEach(function(x){ box.appendChild(card(x)); });
  $('smore').hidden = !S.hasMore;
}

function renderChips(boxId, list, fn){
  var box = $(boxId);
  while (box.children.length > 1) box.removeChild(box.lastChild);
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  list.forEach(function(item){
    var b = el('button', 'schip', item.label);
    b.type = 'button';
    b.addEventListener('click', function(){ fn(item); });
    box.appendChild(b);
  });
}
function renderHist(){
  renderChips('shist', histLoad('ks_hist_kol').map(function(k){ return {label:k, kw:k}; }), function(it){ startSearch(it.kw); });
}
function renderConds(list){
  renderChips('sconds', list.map(function(x){ return {label:x.name, cond:x}; }), function(it){
    try {
      var p = JSON.parse(it.cond.params);
      if (p.mode) $('smode').value = p.mode;
      if (p.region != null) $('sregion').value = p.region;
      if (p.fans != null) $('sfans').value = p.fans;
      if (p.sort) $('ssort').value = p.sort;
      startSearch(p.keyword || $('skw').value);
    } catch(e){}
  });
}

$('sgo').addEventListener('click', function(){ startSearch($('skw').value); });
$('skw').addEventListener('keydown', function(e){ if (e.key === 'Enter') startSearch($('skw').value); });
$('smorebtn').addEventListener('click', loadPage);
['sregion','sfans','ssort'].forEach(function(id){ $(id).addEventListener('change', render); });
$('scondsave').addEventListener('click', function(){
  if (!SIGNED) { location.href = '/kol/exlogin'; return; }
  var name = window.prompt(T.condName, $('skw').value.slice(0, 20));
  if (!name) return;
  post('/kol/api/condition', {name: name, params: {mode: $('smode').value, keyword: $('skw').value,
    region: $('sregion').value, fans: $('sfans').value, sort: $('ssort').value}})
    .then(function(j){ if (j.code === 'OK') loadConds(); else alert(j.message || T.err); })
    .catch(function(){});
});
function loadConds(){
  if (!SIGNED) return;
  fetch('/kol/api/conditions', {credentials:'same-origin'}).then(function(r){ return r.json(); })
    .then(function(j){ if (j.code === 'OK') renderConds(j.data.items || []); }).catch(function(){});
}

renderChips('shot', HOT.map(function(t){ return {label:'#'+t, kw:t}; }), function(it){ startSearch(it.kw); });
renderHist();
loadConds();
var q0 = ${JSON.stringify(q)};
if (q0) startSearch(q0);
`,
    }),
  );
});

r.get('/kol/video-search', async (c) => {
  const { user, profile } = await ctx(c);
  const q = (c.req.query('q') || c.req.query('keyword') || '').trim().slice(0, 80);
  const tj = (k: string) => JSON.stringify(st(k));

  return html(
    appPage({
      title: brandTitle(st('nv_video_search')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('sr_video_sub') },
      profile,
      style: SEARCH_CSS,
      body: `<h1>${st('nv_video_search')}</h1><p class="sub">${st('sr_video_sub')}</p>
<div class="card">
  <div class="sbar">
    <input type="search" id="skw" value="${escapeHtml(q)}" placeholder="${escapeHtml(st('sr_ph'))}" autocomplete="off">
    <button class="btn" id="sgo" type="button">${ic('search', 16)}${st('sr_btn')}</button>
  </div>
  <div class="sflt">
    <label>${st('ks_region')}</label>
    <select id="sregion"><option value="">${st('ks_any')}</option></select>
    <label>${st('ks_sort')}</label>
    <select id="ssort">
      <option value="rel">${st('ks_sort_rel')}</option>
      <option value="plays">${st('tb_plays')}</option>
      <option value="likes">${st('tb_likes')}</option>
      <option value="new">${st('ks_sort_new')}</option>
    </select>
  </div>
  <div class="schips" id="shist" hidden><span class="lbl">${st('ks_hist')}</span></div>
  <div class="sstatus" id="sstatus">${st('ks_live_tip')}</div>
  <div id="sres"></div>
  <div class="smore" id="smore" hidden><button class="btn ghost" id="smorebtn" type="button">${st('ks_load_more')}</button></div>
</div>`,
      script: `
var LANG = ${JSON.stringify(htmlLang())};
var SIGNED = ${user ? 'true' : 'false'};
var T = { err:${tj('ks_err')}, searching:${tj('ks_searching')},
  relayUsed:${tj('ks_relay_used')}, none:${tj('sr_none')}, plays:${tj('tb_plays')},
  likes:${tj('tb_likes')}, comments:${tj('tb_comments')}, detail:${tj('ks_detail')},
  fav:${tj('ks_fav')}, faved:${tj('ks_faved')}, open:${tj('sc_open')}, dl:${tj('nv_download')},
  loginToSearch:${tj('ks_login_to_search')}, login:${tj('nv_login')}, quotaLeft:${tj('ks_quota_left')} };
var REGIONS = ${JSON.stringify(SEARCH_REGIONS)};
${searchJsPrelude()}
var $ = function(id){ return document.getElementById(id); };
var S = { keyword:'', cursor:0, items:[], seen:{}, busy:false, hasMore:false, useRelay:false, searched:false, ticket:'', quotaLeft:null };

(function initRegions(){
  var sel = $('sregion');
  REGIONS.forEach(function(code){
    var o = document.createElement('option'); o.value = code; o.textContent = regionName(code);
    sel.appendChild(o);
  });
})();

function setStatus(text, isErr){
  var s = $('sstatus'); s.textContent = text || ''; s.className = 'sstatus' + (isErr ? ' err' : '');
}
function showLoginPrompt(){
  var s = $('sstatus'); s.textContent = ''; s.className = 'sstatus err';
  s.appendChild(el('span', null, T.loginToSearch + ' '));
  var a = el('a', null, T.login); a.href = '/kol/exlogin';
  s.appendChild(a);
}
function doneStatus(){
  if (S.useRelay) return setStatus(T.relayUsed);
  if (S.quotaLeft != null) return setStatus(T.quotaLeft.split('{n}').join(String(S.quotaLeft)));
  setStatus('');
}
function fetchDirect(){
  return tkDirect('feed/search', {keywords: S.keyword, count: '20', cursor: String(S.cursor)}).then(function(d){
    var items = (d.videos || []).map(normVid).filter(Boolean);
    ingest([], items);
    return {items: items, hasMore: !!d.has_more, cursor: d.cursor};
  });
}
function fetchRelay(){
  return relay({mode: 'video', keyword: S.keyword, cursor: S.cursor, ticket: S.ticket}).then(function(d){
    return {items: d.items || [], hasMore: !!d.hasMore, cursor: d.cursor};
  });
}
function loadPage(){
  if (S.busy || !S.keyword) return;
  S.busy = true; setStatus(T.searching);
  // 直连也逐页核销票据额度（和兜底同一份 8 页预算），核销不过就不发直连
  var p;
  if (S.useRelay) {
    p = fetchRelay();
  } else {
    p = post('/kol/api/search-page', {ticket: S.ticket}).then(function(j){
      if (j.code !== 'OK') { var e = new Error(j.message || T.err); e.pageGate = true; throw e; }
      return fetchDirect().catch(function(){
        S.useRelay = true;
        return fetchRelay();
      });
    });
  }
  p.then(function(res){
    var fresh = res.items.filter(function(x){ if (S.seen[x.id]) return false; S.seen[x.id] = 1; return true; });
    S.items = S.items.concat(fresh);
    S.cursor = res.cursor != null ? res.cursor : S.cursor + res.items.length;
    S.hasMore = !!res.hasMore;
    S.busy = false;
    doneStatus();
    render();
  }).catch(function(err){
    S.busy = false;
    if (err && err.pageGate) S.hasMore = false;
    setStatus((err && err.message) || T.err, true);
    render();
  });
}
function startSearch(kw){
  kw = (kw || '').trim(); if (!kw) return;
  if (!SIGNED) { showLoginPrompt(); return; }
  S.keyword = kw; S.cursor = 0; S.items = []; S.seen = {}; S.hasMore = false; S.searched = true;
  S.ticket = ''; S.useRelay = false;
  $('skw').value = kw;
  histPush('ks_hist_video', kw); renderHist();
  setStatus(T.searching);
  post('/kol/api/search-ticket', {mode: 'video', keyword: kw}).then(function(j){
    if (j.code !== 'OK') { setStatus(j.message || T.err, true); return; }
    S.ticket = j.data.ticket;
    S.quotaLeft = j.data.remaining;
    loadPage();
  }).catch(function(){ setStatus(T.err, true); });
}
function filtered(){
  var region = $('sregion').value;
  var sort = $('ssort').value;
  var out = S.items.filter(function(x){ return !region || x.region === region; });
  if (sort === 'plays') out = out.slice().sort(function(a,b){ return (b.playCount||0) - (a.playCount||0); });
  if (sort === 'likes') out = out.slice().sort(function(a,b){ return (b.likeCount||0) - (a.likeCount||0); });
  if (sort === 'new') out = out.slice().sort(function(a,b){ return (b.createTime||0) - (a.createTime||0); });
  return out;
}
function vurl(x){
  return 'https://www.tiktok.com/@' + encodeURIComponent(x.authorUniqueId || 'user') + '/video/' + encodeURIComponent(x.id);
}
function card(x){
  var c = el('div', 'res');
  var cv = el('img', 'rcover');
  if (x.cover) { cv.src = x.cover; cv.alt = ''; cv.onerror = function(){ cv.style.visibility = 'hidden'; }; }
  else cv.style.visibility = 'hidden';
  c.appendChild(cv);
  var m = el('div', 'rmain');
  var titleA = el('a', 'rname', x.title || x.id);
  titleA.href = '/kol/video-detail/' + encodeURIComponent(x.id) + (x.authorUniqueId ? '?u=' + encodeURIComponent(x.authorUniqueId) : '');
  m.appendChild(titleA);
  var l1 = el('div', 'rline1');
  if (x.authorUniqueId) {
    var au = el('a', 'ruid', '@' + x.authorUniqueId);
    au.href = '/kol/kol-detail/' + encodeURIComponent(x.authorUniqueId);
    l1.appendChild(au);
  }
  if (x.region) l1.appendChild(el('span', 'chip', regionName(x.region)));
  if (x.createTime) l1.appendChild(el('span', 'ruid', new Date(x.createTime * 1000).toLocaleDateString(LANG)));
  m.appendChild(l1);
  var stats = el('div', 'rstats');
  stats.appendChild(statPair(T.plays, x.playCount));
  stats.appendChild(statPair(T.likes, x.likeCount));
  stats.appendChild(statPair(T.comments, x.commentCount));
  m.appendChild(stats);
  c.appendChild(m);
  var acts = el('div', 'racts');
  var det = el('a', 'btn ghost rbtn', T.detail);
  det.href = titleA.href;
  acts.appendChild(det);
  var op = el('a', 'btn ghost rbtn', T.open);
  op.href = vurl(x); op.target = '_blank'; op.rel = 'noopener';
  acts.appendChild(op);
  var dl = el('a', 'btn ghost rbtn', T.dl);
  dl.href = '/tools/video-download?url=' + encodeURIComponent(vurl(x));
  acts.appendChild(dl);
  acts.appendChild(actBtn(T.fav, T.faved, function(){
    return post('/kol/api/collect', {type:'VIDEO', id:x.id, region:x.region, uniqueId:x.authorUniqueId,
      payload:{title:x.title.slice(0,120), playCount:x.playCount}});
  }));
  c.appendChild(acts);
  return c;
}
function render(){
  var box = $('sres'); box.innerHTML = '';
  var rows = filtered();
  if (S.searched && !S.busy && !rows.length) box.appendChild(el('div', 'empty', T.none));
  rows.forEach(function(x){ box.appendChild(card(x)); });
  $('smore').hidden = !S.hasMore;
}
function renderHist(){
  var box = $('shist');
  while (box.children.length > 1) box.removeChild(box.lastChild);
  var h = histLoad('ks_hist_video');
  if (!h.length) { box.hidden = true; return; }
  box.hidden = false;
  h.forEach(function(kw){
    var b = el('button', 'schip', kw); b.type = 'button';
    b.addEventListener('click', function(){ startSearch(kw); });
    box.appendChild(b);
  });
}

$('sgo').addEventListener('click', function(){ startSearch($('skw').value); });
$('skw').addEventListener('keydown', function(e){ if (e.key === 'Enter') startSearch($('skw').value); });
$('smorebtn').addEventListener('click', loadPage);
['sregion','ssort'].forEach(function(id){ $(id).addEventListener('change', render); });
renderHist();
var q0 = ${JSON.stringify(q)};
if (q0) startSearch(q0);
`,
    }),
  );
});

r.get('/kol/product-search', async (c) => {
  const { profile } = await ctx(c);
  const q = (c.req.query('q') || '').trim().slice(0, 80);

  let rows: Array<{ product_id: string; region: string; title: string | null; price: string | null; sold_count: number | null; updated_at: number }> = [];
  let total = 0;
  if (q) {
    const like = `%${q}%`;
    const [list, cnt] = await Promise.all([
      c.env.DB.prepare(
        `SELECT product_id, region, title, price, sold_count, updated_at FROM tk_products
         WHERE title LIKE ?1 ORDER BY sold_count DESC NULLS LAST LIMIT 50`,
      )
        .bind(like)
        .all<(typeof rows)[number]>(),
      c.env.DB.prepare(`SELECT COUNT(*) n FROM tk_products WHERE title LIKE ?1`)
        .bind(like)
        .first<{ n: number }>(),
    ]);
    rows = list.results ?? [];
    total = cnt?.n ?? 0;
  }

  const table = q
    ? rows.length
      ? `<p class="sub">${st('sr_results', { n: total })}</p><table>
<tr><th>${st('tb_title')}</th><th>${st('tb_region')}</th><th class="num">${st('tb_price')}</th><th class="num">${st('tb_sold')}</th><th>${st('tb_updated')}</th></tr>
${rows
  .map(
    (row) => `<tr>
  <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/kol/product-detail/${encodeURIComponent(row.product_id)}?region=${encodeURIComponent(row.region)}">${escapeHtml(row.title || row.product_id)}</a></td>
  <td>${escapeHtml(row.region)}</td>
  <td class="num">${escapeHtml(row.price ?? '—')}</td>
  <td class="num">${fmtNum(row.sold_count)}</td>
  <td>${fmtDate(row.updated_at)}</td>
</tr>`,
  )
  .join('')}
</table>`
      : `<div class="empty">${st('sr_none')}</div>`
    : `<div class="empty">${st('sr_source_tip')}</div>`;

  return html(
    appPage({
      title: brandTitle(st('nv_product_search')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('sr_video_sub') },
      profile,
      body: `<h1>${st('nv_product_search')}</h1><p class="sub">${st('sr_video_sub')}</p>
<div class="card">${searchForm('/kol/product-search', q)}${table}</div>`,
    }),
  );
});

// ── 详情页（达人 / 视频）────────────────────────────────────────────────────
// 对照原站 kol-detail / video-detail 的信息结构做简版：SSR 出 D1 里已有的
// 回流/回灌数据，达人页再由浏览器直连 tikwm user/info 刷新一次实时数据
// （user/posts 被 tikwm 加了盾，近期视频只能用库里的）。

r.get('/kol/kol-detail/:uid', async (c) => {
  const { user, profile } = await ctx(c);
  const raw = decodeURIComponent(c.req.param('uid') || '').replace(/^@/, '').trim().slice(0, 64);

  type CreatorRow = {
    creator_id: string;
    unique_id: string | null;
    nickname: string | null;
    region: string | null;
    follower_count: number | null;
    payload: string | null;
    updated_at: number;
  };
  let row: CreatorRow | null = null;
  if (/^\d{1,30}$/.test(raw)) {
    row = await c.env.DB.prepare(
      `SELECT creator_id, unique_id, nickname, region, follower_count, payload, updated_at
       FROM tk_creators WHERE creator_id = ?1`,
    )
      .bind(raw)
      .first<CreatorRow>();
  }
  if (!row && raw) {
    row = await c.env.DB.prepare(
      `SELECT creator_id, unique_id, nickname, region, follower_count, payload, updated_at
       FROM tk_creators WHERE unique_id_lower = ?1`,
    )
      .bind(raw.toLowerCase())
      .first<CreatorRow>();
  }

  const uniqueId = row?.unique_id || (/^\d{1,30}$/.test(raw) ? '' : raw);
  const p = safeParse(row?.payload ?? null);
  const heart = typeof p.heartCount === 'number' ? p.heartCount : null;
  const vids = typeof p.videoCount === 'number' ? p.videoCount : null;
  const bio = typeof p.signature === 'string' ? p.signature : '';
  const verified = p.verified === true;

  type MetricsRow = { avg_play_cnt: number | null; interaction_rate: number | null; sample_size: number };
  let metrics: MetricsRow | null = null;
  let tagRows: Array<{ tag: string; hit_count: number }> = [];
  let videoRows: Array<{ video_id: string; title: string | null; play_cnt: number | null; like_cnt: number | null; comment_cnt: number | null; pub_time: number | null }> = [];
  if (row) {
    const [m, t, v] = await Promise.all([
      c.env.DB.prepare(
        `SELECT avg_play_cnt, interaction_rate, sample_size FROM creator_metrics WHERE creator_id = ?1`,
      )
        .bind(row.creator_id)
        .first<MetricsRow>(),
      c.env.DB.prepare(
        `SELECT tag, hit_count FROM creator_tags WHERE creator_id = ?1 ORDER BY hit_count DESC LIMIT 12`,
      )
        .bind(row.creator_id)
        .all<(typeof tagRows)[number]>(),
      c.env.DB.prepare(
        `SELECT video_id, title, play_cnt, like_cnt, comment_cnt, pub_time FROM tk_videos
         WHERE creator_id = ?1 ORDER BY COALESCE(pub_time, 0) DESC, updated_at DESC LIMIT 12`,
      )
        .bind(row.creator_id)
        .all<(typeof videoRows)[number]>(),
    ]);
    metrics = m;
    tagRows = t.results ?? [];
    videoRows = v.results ?? [];
  }

  const name = row?.nickname || uniqueId || raw;
  const tj = (k: string) => JSON.stringify(st(k));
  const statCell = (id: string, label: string, val: string) =>
    `<div class="stat"><div class="n" id="${id}">${val}</div><div class="l">${escapeHtml(label)}</div></div>`;

  const videoTable = videoRows.length
    ? `<table>
<tr><th>${st('tb_title')}</th><th class="num">${st('tb_plays')}</th><th class="num">${st('tb_likes')}</th><th class="num">${st('tb_comments')}</th></tr>
${videoRows
  .map(
    (v) => `<tr>
  <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/kol/video-detail/${escapeHtml(v.video_id)}${uniqueId ? `?u=${encodeURIComponent(uniqueId)}` : ''}">${escapeHtml(v.title || v.video_id)}</a></td>
  <td class="num">${fmtNum(v.play_cnt)}</td>
  <td class="num">${fmtNum(v.like_cnt)}</td>
  <td class="num">${fmtNum(v.comment_cnt)}</td>
</tr>`,
  )
  .join('')}
</table>`
    : emptyBlock(st('kd_no_videos'), st('sr_source_tip'));

  const tagChips = tagRows.length
    ? `<div style="display:flex;gap:7px;flex-wrap:wrap">${tagRows
        .map(
          (t) =>
            `<a class="chip" href="/kol/search?q=${encodeURIComponent(t.tag)}" style="text-decoration:none">#${escapeHtml(t.tag)}</a>`,
        )
        .join('')}</div>`
    : '';

  return html(
    appPage({
      title: brandTitle(name || st('kd_title')),
      path: pathOf(c),
      profile,
      style: `
  ${SEARCH_CSS}
  .kd-head{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
  .kd-avatar{width:72px;height:72px;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--rule);flex:none}
  .kd-letter{width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:30px;font-weight:700;background:var(--rule);color:var(--paper);border-radius:var(--r-sm);flex:none}
  .kd-main{flex:1;min-width:240px}
  .kd-bio{margin-top:8px;font-size:13px;color:var(--muted);max-width:640px}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:16px}
  .stat{padding:14px;border:1px solid var(--line);border-radius:var(--r-md)}
  .stat .n{font-family:var(--serif);font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
  .stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-top:2px}
`,
      body: `<h1>${st('kd_title')}</h1>
<p class="sub">${uniqueId ? '@' + escapeHtml(uniqueId) : escapeHtml(raw)}</p>
<div class="card" style="margin-bottom:16px">
  <div class="kd-head">
    <img class="kd-avatar" id="kd-avatar" alt="" hidden>
    <div class="kd-letter" id="kd-letter">${escapeHtml((name || '?').slice(0, 1).toUpperCase())}</div>
    <div class="kd-main">
      <div class="rline1">
        <span class="rname" id="kd-name">${escapeHtml(name || '—')}</span>
        ${uniqueId ? `<a class="ruid" href="https://www.tiktok.com/@${encodeURIComponent(uniqueId)}" target="_blank" rel="noopener">@${escapeHtml(uniqueId)}</a>` : ''}
        <span class="chip blue" id="kd-verified"${verified ? '' : ' hidden'}>${st('ks_verified')}</span>
        <span class="chip" id="kd-region">${row?.region ? escapeHtml(row.region) : ''}</span>
      </div>
      <div class="kd-bio" id="kd-bio">${escapeHtml(bio)}</div>
      <div class="racts" style="margin-top:12px">
        ${uniqueId ? `<a class="btn ghost rbtn" href="https://www.tiktok.com/@${encodeURIComponent(uniqueId)}" target="_blank" rel="noopener">${st('tl_open_tiktok')}</a>` : ''}
        <a class="btn ghost rbtn" href="/kol/search?q=${encodeURIComponent(name || '')}">${st('q_FindKol')}</a>
        <button class="btn ghost rbtn" id="kd-fav" type="button"${row || uniqueId ? '' : ' hidden'}>${st('ks_fav')}</button>
        <button class="btn ghost rbtn" id="kd-plan" type="button"${uniqueId ? '' : ' hidden'}>${st('ks_plan')}</button>
      </div>
    </div>
  </div>
  <div class="stat-grid">
    ${statCell('kd-fans', st('tb_followers'), fmtNum(row?.follower_count))}
    ${statCell('kd-hearts', st('ks_hearts'), fmtNum(heart))}
    ${statCell('kd-videos', st('ks_videos_n'), fmtNum(vids))}
    ${statCell('kd-avgplay', st('kd_avg_play'), fmtNum(metrics?.avg_play_cnt ?? null))}
    ${statCell(
      'kd-interact',
      st('kd_interact'),
      metrics?.interaction_rate != null ? (metrics.interaction_rate * 100).toFixed(2) + '%' : '—',
    )}
  </div>
  <div class="sstatus" id="kd-status">${row ? st('kd_updated') + ' ' + fmtDate(row.updated_at) : ''}</div>
</div>
${tagChips ? `<div class="card" style="margin-bottom:16px"><h2 style="font-size:15px;margin:0 0 10px">${st('kd_tags')}</h2>${tagChips}</div>` : ''}
<div class="card">
  <h2 style="font-size:15px;margin:0 0 10px">${st('kd_recent')}</h2>
  ${videoTable}
</div>`,
      script: `
var LANG = ${JSON.stringify(htmlLang())};
var SIGNED = ${user ? 'true' : 'false'};
var T = { err:${tj('ks_err')}, fav:${tj('ks_fav')}, faved:${tj('ks_faved')}, plan:${tj('ks_plan')},
  planned:${tj('ks_planned')}, live:${tj('kd_live')}, loginLive:${tj('kd_login_live')}, login:${tj('nv_login')} };
${searchJsPrelude()}
var $ = function(id){ return document.getElementById(id); };
var UID = ${JSON.stringify(uniqueId)};
var CID = ${JSON.stringify(row?.creator_id ?? '')};
var CUR = { id: CID, uniqueId: UID, nickname: ${JSON.stringify(name || '')}, region: ${JSON.stringify(row?.region ?? null)}, followerCount: ${JSON.stringify(row?.follower_count ?? null)} };

function bindActs(){
  var fav = $('kd-fav'), plan = $('kd-plan');
  if (fav && !fav.dataset.bound) {
    fav.dataset.bound = '1';
    fav.addEventListener('click', function(){
      if (!SIGNED) { location.href = '/kol/exlogin'; return; }
      if (!CUR.id) return;
      fav.disabled = true;
      post('/kol/api/collect', {type:'CREATOR', id:CUR.id, region:CUR.region, uniqueId:CUR.uniqueId,
        payload:{nickname:CUR.nickname, followerCount:CUR.followerCount}})
        .then(function(j){ if (j.code==='OK') fav.textContent = T.faved; else { fav.disabled=false; alert(j.message||T.err); } })
        .catch(function(){ fav.disabled = false; alert(T.err); });
    });
  }
  if (plan && !plan.dataset.bound) {
    plan.dataset.bound = '1';
    plan.addEventListener('click', function(){
      if (!SIGNED) { location.href = '/kol/exlogin'; return; }
      plan.disabled = true;
      post('/kol/api/promotion-add', {creatorId:CUR.uniqueId, region:CUR.region,
        payload:{nickname:CUR.nickname, followerCount:CUR.followerCount}})
        .then(function(j){ if (j.code==='OK') plan.textContent = T.planned; else { plan.disabled=false; alert(j.message||T.err); } })
        .catch(function(){ plan.disabled = false; alert(T.err); });
    });
  }
}
bindActs();

// 实时刷新是会员功能：未登录只看 SSR 出的库存数据，给一行登录引导
if (UID && !SIGNED) {
  var hintEl = $('kd-status');
  hintEl.appendChild(el('span', null, ' ' + T.loginLive + ' '));
  var la = el('a', null, T.login); la.href = '/kol/exlogin';
  hintEl.appendChild(la);
}
if (UID && SIGNED) {
  var stEl = $('kd-status');
  var old = stEl.textContent;
  stEl.textContent = T.live;
  // 实时刷新也是直连 tikwm，先过每日限额闸（防脚本化免配额 ID 直查）
  post('/kol/api/detail-pass', {}).then(function(g){
    if (g.code !== 'OK') { stEl.textContent = g.message || old; throw {gated: true}; }
    return tkDirect('user/info', {unique_id: UID});
  }).then(function(d){
    var x = normUser(d);
    if (!x) { stEl.textContent = old; return; }
    CUR = x;
    $('kd-name').textContent = x.nickname || x.uniqueId;
    if (x.avatar) { var av = $('kd-avatar'); av.src = x.avatar; av.hidden = false; $('kd-letter').style.display = 'none'; }
    $('kd-verified').hidden = !x.verified;
    $('kd-region').textContent = x.region ? regionName(x.region) : '';
    if (x.signature) $('kd-bio').textContent = x.signature;
    $('kd-fans').textContent = nfmt(x.followerCount);
    $('kd-hearts').textContent = nfmt(x.heartCount);
    $('kd-videos').textContent = nfmt(x.videoCount);
    $('kd-fav').hidden = false; $('kd-plan').hidden = false;
    bindActs();
    stEl.textContent = '';
    ingest([x], []);
  }).catch(function(e){ if (!e || !e.gated) stEl.textContent = old; });
}
`,
    }),
  );
});

r.get('/kol/video-detail/:id', async (c) => {
  const { user, profile } = await ctx(c);
  const id = decodeURIComponent(c.req.param('id') || '').trim().slice(0, 30);
  const uParam = (c.req.query('u') || '').replace(/^@/, '').trim().slice(0, 64);

  const row = /^\d{1,30}$/.test(id)
    ? await c.env.DB.prepare(
        `SELECT v.video_id, v.creator_id, v.region, v.title, v.pub_time, v.play_cnt, v.like_cnt,
                v.comment_cnt, v.forward_cnt, v.updated_at, cr.unique_id author_uid, cr.nickname author_name
         FROM tk_videos v LEFT JOIN tk_creators cr ON cr.creator_id = v.creator_id
         WHERE v.video_id = ?1`,
      )
        .bind(id)
        .first<{
          video_id: string;
          creator_id: string | null;
          region: string | null;
          title: string | null;
          pub_time: number | null;
          play_cnt: number | null;
          like_cnt: number | null;
          comment_cnt: number | null;
          forward_cnt: number | null;
          updated_at: number;
          author_uid: string | null;
          author_name: string | null;
        }>()
    : null;

  const uid = row?.author_uid || uParam;
  const videoUrl = uid
    ? `https://www.tiktok.com/@${encodeURIComponent(uid)}/video/${encodeURIComponent(id)}`
    : null;
  const tj = (k: string) => JSON.stringify(st(k));
  const statCell = (elId: string, label: string, val: string) =>
    `<div class="stat"><div class="n" id="${elId}">${val}</div><div class="l">${escapeHtml(label)}</div></div>`;

  if (!row && !videoUrl) {
    return html(
      appPage({
        title: brandTitle(st('vd_title')),
        path: pathOf(c),
        profile,
        body: `<h1>${st('vd_title')}</h1><p class="sub">${escapeHtml(id)}</p>
<div class="card">${emptyBlock(st('vd_none'), st('sr_source_tip'))}
<p style="text-align:center;margin:8px 0 0"><a class="btn" href="/kol/video-search">${st('nv_video_search')}</a></p></div>`,
      }),
    );
  }

  return html(
    appPage({
      title: brandTitle(row?.title?.slice(0, 60) || st('vd_title')),
      path: pathOf(c),
      profile,
      style: `
  ${SEARCH_CSS}
  .vd-wrap{display:flex;gap:20px;flex-wrap:wrap}
  .vd-cover{width:150px;aspect-ratio:9/16;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--rule);flex:none}
  .vd-main{flex:1;min-width:260px}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:14px}
  .stat{padding:12px;border:1px solid var(--line);border-radius:var(--r-md)}
  .stat .n{font-family:var(--serif);font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}
  .stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-top:2px}
`,
      body: `<h1>${st('vd_title')}</h1><p class="sub">${escapeHtml(id)}</p>
<div class="card">
  <div class="vd-wrap">
    <img class="vd-cover" id="vd-cover" alt="" hidden>
    <div class="vd-main">
      <h2 style="font-size:15.5px;margin:0" id="vd-title">${escapeHtml(row?.title || '—')}</h2>
      <div class="rline1" style="margin-top:8px">
        ${
          uid
            ? `<a class="ruid" href="/kol/kol-detail/${encodeURIComponent(uid)}">@${escapeHtml(uid)}</a>`
            : ''
        }
        ${row?.region ? `<span class="chip">${escapeHtml(row.region)}</span>` : ''}
        ${
          row?.pub_time
            ? `<span class="ruid">${st('vd_pub')} ${escapeHtml(new Date(row.pub_time).toLocaleDateString(htmlLang()))}</span>`
            : ''
        }
      </div>
      <div class="stat-grid">
        ${statCell('vd-plays', st('tb_plays'), fmtNum(row?.play_cnt))}
        ${statCell('vd-likes', st('tb_likes'), fmtNum(row?.like_cnt))}
        ${statCell('vd-comments', st('tb_comments'), fmtNum(row?.comment_cnt))}
        ${statCell('vd-shares', st('vd_shares'), fmtNum(row?.forward_cnt))}
      </div>
      <div class="racts" style="margin-top:14px">
        ${videoUrl ? `<a class="btn rbtn" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">${st('sc_open')}</a>` : ''}
        ${videoUrl ? `<a class="btn ghost rbtn" href="/tools/video-download?url=${encodeURIComponent(videoUrl)}">${st('nv_download')}</a>` : ''}
        <button class="btn ghost rbtn" id="vd-fav" type="button">${st('ks_fav')}</button>
      </div>
      <div class="sstatus" id="vd-status"></div>
    </div>
  </div>
</div>`,
      script: `
var LANG = ${JSON.stringify(htmlLang())};
var SIGNED = ${user ? 'true' : 'false'};
var T = { err:${tj('ks_err')}, faved:${tj('ks_faved')}, live:${tj('kd_live')} };
var $ = function(id){ return document.getElementById(id); };
var VID = ${JSON.stringify(id)};
var VURL = ${JSON.stringify(videoUrl)};
var REGION = ${JSON.stringify(row?.region ?? null)};
var UID = ${JSON.stringify(uid || '')};

function post(url, body){
  return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body)})
    .then(function(r){ return r.json(); });
}
var fav = $('vd-fav');
fav.addEventListener('click', function(){
  if (!SIGNED) { location.href = '/kol/exlogin'; return; }
  fav.disabled = true;
  post('/kol/api/collect', {type:'VIDEO', id:VID, region:REGION, uniqueId:UID,
    payload:{title:$('vd-title').textContent.slice(0,120)}})
    .then(function(j){ if (j.code==='OK') fav.textContent = T.faved; else { fav.disabled=false; alert(j.message||T.err); } })
    .catch(function(){ fav.disabled = false; alert(T.err); });
});

// 有可拼的视频 URL 就用自家解析链刷新一次实时数据 + 封面（匿名有日额度闸，失败静默）
if (VURL) {
  var stEl = $('vd-status');
  stEl.textContent = T.live;
  fetch('/v1/plugin/video/fetch_video_data_by_url?url=' + encodeURIComponent(VURL), {credentials:'same-origin'})
    .then(function(r){ return r.json(); })
    .then(function(j){
      stEl.textContent = '';
      if (!j || j.code !== 'OK' || !j.data) return;
      var d = j.data;
      if (d.desc) $('vd-title').textContent = d.desc;
      var cover = (d.covers || [])[0];
      if (cover) { var cv = $('vd-cover'); cv.src = cover; cv.hidden = false; }
      if (d.playCount != null) $('vd-plays').textContent = Number(d.playCount).toLocaleString('en-US');
      if (d.likeCount != null) $('vd-likes').textContent = Number(d.likeCount).toLocaleString('en-US');
      if (d.commentCount != null) $('vd-comments').textContent = Number(d.commentCount).toLocaleString('en-US');
      if (d.shareCount != null) $('vd-shares').textContent = Number(d.shareCount).toLocaleString('en-US');
    })
    .catch(function(){ stEl.textContent = ''; });
}
`,
    }),
  );
});

// 商品详情：tk_products（插件回流）SSR。payload 是 TikTok Shop 页面上抓到的
// 原始商品结构，字段因来源页面（列表/详情/挂车）差异很大，按「有就展示」处理。
r.get('/kol/product-detail/:id', async (c) => {
  const { user, profile } = await ctx(c);
  const id = decodeURIComponent(c.req.param('id') || '').trim().slice(0, 40);
  const region = (c.req.query('region') || '').toUpperCase().slice(0, 8);

  const row = /^[\w-]{1,40}$/.test(id)
    ? await c.env.DB.prepare(
        `SELECT product_id, region, title, price, sold_count, payload, updated_at
         FROM tk_products WHERE product_id = ?1
         ORDER BY CASE WHEN region = ?2 THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
      )
        .bind(id, region)
        .first<{
          product_id: string;
          region: string;
          title: string | null;
          price: string | null;
          sold_count: number | null;
          payload: string | null;
          updated_at: number;
        }>()
    : null;

  if (!row) {
    return html(
      appPage({
        title: brandTitle(st('nv_product_detail')),
        path: pathOf(c),
        profile,
        body: `<h1>${st('nv_product_detail')}</h1><p class="sub">${escapeHtml(id)}</p>
<div class="card">${emptyBlock(st('pd_not_found'), st('sr_source_tip'))}
<p style="text-align:center;margin:8px 0 0"><a class="btn" href="/kol/product-search">${st('nv_product_search')}</a></p></div>`,
      }),
    );
  }

  const p = safeParse(row.payload);
  const pick = (o: unknown, path: (string | number)[]): unknown =>
    path.reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object') return (acc as Record<string | number, unknown>)[k];
      return undefined;
    }, o);
  const asStr = (v: unknown): string | null =>
    v == null || (typeof v === 'object' ? true : String(v) === '') ? null : String(v);

  const img = asStr(pick(p, ['image', 'url_list', 0]));
  const symbol = asStr(pick(p, ['product_price_info', 'currency_symbol'])) ?? '';
  const salePrice = asStr(pick(p, ['product_price_info', 'sale_price_format'])) ?? row.price;
  const originPrice = asStr(pick(p, ['product_price_info', 'origin_price_format']));
  const discount = asStr(pick(p, ['product_price_info', 'discount_format']));
  const score = asStr(pick(p, ['rate_info', 'score']));
  const reviewCnt = Number(pick(p, ['rate_info', 'review_count']));
  const soldRaw = Number(pick(p, ['sold_info', 'sold_count']));
  const sold = Number.isFinite(soldRaw) && soldRaw > 0 ? soldRaw : row.sold_count;
  const shopName = asStr(pick(p, ['seller_info', 'shop_name']));
  const brand = asStr(pick(p, ['brand_info', 'brand_name']));
  const canonical = asStr(pick(p, ['seo_url', 'canonical_url']));

  // 关联带货视频：挂车/anchor 数据存在 video payload 里，按商品 id 模糊匹配。
  // id 已通过 [\w-] 白名单校验，不会带 LIKE 通配符。
  const rel = await c.env.DB.prepare(
    `SELECT v.video_id, v.title, v.play_cnt, v.pub_time, cr.unique_id, cr.nickname
     FROM tk_videos v LEFT JOIN tk_creators cr ON cr.creator_id = v.creator_id
     WHERE v.payload LIKE ?1 ORDER BY v.play_cnt DESC NULLS LAST LIMIT 10`,
  )
    .bind(`%${row.product_id}%`)
    .all<{
      video_id: string;
      title: string | null;
      play_cnt: number | null;
      pub_time: number | null;
      unique_id: string | null;
      nickname: string | null;
    }>();
  const relRows = rel.results ?? [];

  const tj = (k: string) => JSON.stringify(st(k));
  const statCell = (label: string, val: string) =>
    `<div class="stat"><div class="n">${val}</div><div class="l">${escapeHtml(label)}</div></div>`;
  const kv = (label: string, val: string | null) =>
    val ? `<div class="pd-kv"><span class="k">${escapeHtml(label)}</span><span>${escapeHtml(val)}</span></div>` : '';

  const priceHtml = salePrice
    ? `${escapeHtml(symbol + salePrice)}${
        originPrice && originPrice !== salePrice
          ? ` <s style="color:var(--muted);font-size:13px;font-weight:400">${escapeHtml(symbol + originPrice)}</s>`
          : ''
      }`
    : '—';

  const relTable = relRows.length
    ? `<table>
<tr><th>${st('tb_title')}</th><th>${st('tb_creator')}</th><th class="num">${st('tb_plays')}</th><th>${st('vd_pub')}</th></tr>
${relRows
  .map(
    (v) => `<tr>
  <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/kol/video-detail/${encodeURIComponent(v.video_id)}${v.unique_id ? `?u=${encodeURIComponent(v.unique_id)}` : ''}">${escapeHtml(v.title || v.video_id)}</a></td>
  <td>${
    v.unique_id
      ? `<a href="/kol/kol-detail/${encodeURIComponent(v.unique_id)}">${escapeHtml(v.nickname || v.unique_id)}</a>`
      : escapeHtml(v.nickname || '—')
  }</td>
  <td class="num">${fmtNum(v.play_cnt)}</td>
  <td>${v.pub_time ? escapeHtml(new Date(v.pub_time).toLocaleDateString(htmlLang())) : '—'}</td>
</tr>`,
  )
  .join('')}
</table>`
    : `<div class="empty">${st('pd_no_related')}</div>`;

  return html(
    appPage({
      title: brandTitle(row.title?.slice(0, 60) || st('nv_product_detail')),
      path: pathOf(c),
      profile,
      style: `
  .pd-wrap{display:flex;gap:20px;flex-wrap:wrap}
  .pd-cover{width:150px;aspect-ratio:1;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--rule);flex:none}
  .pd-main{flex:1;min-width:260px}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:14px}
  .stat{padding:12px;border:1px solid var(--line);border-radius:var(--r-md)}
  .stat .n{font-family:var(--serif);font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}
  .stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-top:2px}
  .pd-kvs{display:flex;flex-direction:column;gap:6px;margin-top:14px;font-size:13px}
  .pd-kv .k{color:var(--muted);display:inline-block;min-width:88px}
`,
      body: `<h1>${st('nv_product_detail')}</h1><p class="sub">${escapeHtml(row.product_id)}</p>
<div class="card">
  <div class="pd-wrap">
    ${img ? `<img class="pd-cover" src="${escapeHtml(img)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ''}
    <div class="pd-main">
      <h2 style="font-size:15.5px;margin:0" id="pd-title">${escapeHtml(row.title || '—')}</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span class="chip">${escapeHtml(row.region)}</span>
        ${brand ? `<span class="chip blue">${escapeHtml(brand)}</span>` : ''}
      </div>
      <div class="stat-grid">
        ${statCell(st('pd_latest_price'), priceHtml)}
        ${statCell(st('pd_sold'), fmtNum(sold))}
        ${statCell(st('pd_rating'), score ? escapeHtml(score) : '—')}
        ${statCell(st('pd_reviews'), Number.isFinite(reviewCnt) ? fmtNum(reviewCnt) : '—')}
      </div>
      <div class="pd-kvs">
        ${kv(st('pd_discount'), discount)}
        ${kv(st('pd_shop_info'), shopName)}
        ${kv(st('pd_product_id'), row.product_id)}
        ${kv(st('tb_updated'), new Date(row.updated_at * 1000).toLocaleDateString(htmlLang()))}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        ${canonical ? `<a class="btn" href="${escapeHtml(canonical)}" target="_blank" rel="noopener">${st('pd_view_tiktok')}</a>` : ''}
        <button class="btn ghost" id="pd-fav" type="button">${st('ks_fav')}</button>
      </div>
    </div>
  </div>
</div>
<div class="card">
  <h2 style="font-size:15px;margin:0 0 12px">${st('pd_related_videos')}</h2>
  ${relTable}
</div>`,
      script: `
var SIGNED = ${user ? 'true' : 'false'};
var T = { err:${tj('ks_err')}, faved:${tj('ks_faved')} };
var fav = document.getElementById('pd-fav');
fav.addEventListener('click', function(){
  if (!SIGNED) { location.href = '/kol/exlogin'; return; }
  fav.disabled = true;
  fetch('/kol/api/collect', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body:JSON.stringify({type:'PRODUCT', id:${JSON.stringify(row.product_id)}, region:${JSON.stringify(row.region)},
      payload:{title:document.getElementById('pd-title').textContent.slice(0,120)}})})
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.code==='OK') fav.textContent = T.faved; else { fav.disabled=false; alert(j.message||T.err); } })
    .catch(function(){ fav.disabled = false; alert(T.err); });
});
`,
    }),
  );
});

// ── 榜单 ────────────────────────────────────────────────────────────────────

function rankRows<T>(rows: T[], render: (row: T, i: number) => string): string {
  return rows.map((row, i) => render(row, i)).join('');
}

// 达人榜：对齐原站的 ?type= 榜型。数据能撑的四种 —— 粉丝量（回流+回灌）、
// 平均播放 / 互动率（creator_metrics，由小时级 derive_creators 任务算）、
// 近30天涨粉（creator_snapshots 每日快照，积累 ≥2 天后有数据）。
// 原站还有带货销量榜，靠的是它家爬虫的电商数据，我们没有数据源，不列。
const KOL_RANK_TYPES = ['fansCnt', 'fansLst30d', 'videoAvgPlay', 'interactionRate'] as const;

r.get('/kol/kol-rank', async (c) => {
  const { profile } = await ctx(c);
  const type = (KOL_RANK_TYPES as readonly string[]).includes(c.req.query('type') || '')
    ? (c.req.query('type') as (typeof KOL_RANK_TYPES)[number])
    : 'fansCnt';

  type RankRow = {
    unique_id: string | null;
    nickname: string | null;
    region: string | null;
    follower_count: number | null;
    metric: number | null;
  };
  let rows: RankRow[] = [];
  if (type === 'fansCnt') {
    const { results } = await c.env.DB.prepare(
      `SELECT unique_id, nickname, region, follower_count, follower_count metric FROM tk_creators
       WHERE follower_count IS NOT NULL ORDER BY follower_count DESC LIMIT 50`,
    ).all<RankRow>();
    rows = results ?? [];
  } else if (type === 'fansLst30d') {
    // 近30天涨粉：窗口内最新快照 - 最早快照，至少要有 2 天的快照才有意义
    const { results } = await c.env.DB.prepare(
      `WITH win AS (
         SELECT creator_id,
                FIRST_VALUE(follower_count) OVER (PARTITION BY creator_id ORDER BY day ASC)  first_fc,
                FIRST_VALUE(follower_count) OVER (PARTITION BY creator_id ORDER BY day DESC) last_fc,
                COUNT(*) OVER (PARTITION BY creator_id) days
           FROM creator_snapshots WHERE day >= date('now','-30 day')
       )
       SELECT cr.unique_id, cr.nickname, cr.region, cr.follower_count,
              w.last_fc - w.first_fc metric
         FROM (SELECT DISTINCT creator_id, first_fc, last_fc, days FROM win WHERE days >= 2) w
         JOIN tk_creators cr ON cr.creator_id = w.creator_id
        WHERE w.last_fc > w.first_fc
        ORDER BY metric DESC LIMIT 50`,
    ).all<RankRow>();
    rows = results ?? [];
  } else if (type === 'videoAvgPlay') {
    const { results } = await c.env.DB.prepare(
      `SELECT cr.unique_id, cr.nickname, cr.region, cr.follower_count, m.avg_play_cnt metric
       FROM creator_metrics m JOIN tk_creators cr ON cr.creator_id = m.creator_id
       WHERE m.avg_play_cnt IS NOT NULL AND m.sample_size >= 2
       ORDER BY m.avg_play_cnt DESC LIMIT 50`,
    ).all<RankRow>();
    rows = results ?? [];
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT cr.unique_id, cr.nickname, cr.region, cr.follower_count, m.interaction_rate metric
       FROM creator_metrics m JOIN tk_creators cr ON cr.creator_id = m.creator_id
       WHERE m.interaction_rate IS NOT NULL AND m.sample_size >= 3
       ORDER BY m.interaction_rate DESC LIMIT 50`,
    ).all<RankRow>();
    rows = results ?? [];
  }

  const typeLabel: Record<(typeof KOL_RANK_TYPES)[number], string> = {
    fansCnt: st('rk_t_fans'),
    fansLst30d: st('rk_t_growth30'),
    videoAvgPlay: st('rk_t_avgplay'),
    interactionRate: st('rk_t_interact'),
  };
  const fmtMetric = (v: number | null) =>
    type === 'interactionRate'
      ? v != null
        ? (v * 100).toFixed(2) + '%'
        : '—'
      : type === 'fansLst30d' && v != null && v > 0
        ? '+' + fmtNum(v)
        : fmtNum(v);

  const tabs = `<div class="tabs-line">${KOL_RANK_TYPES.map(
    (t) => `<a class="${t === type ? 'on' : ''}" href="/kol/kol-rank?type=${t}">${typeLabel[t]}</a>`,
  ).join('')}</div>`;

  return html(
    appPage({
      title: brandTitle(st('nv_kol_rank')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_rank_kol') },
      profile,
      body: `<h1>${st('nv_kol_rank')}</h1><p class="sub">${st('rk_sub')}</p>
<div class="card">${tabs}${
        rows.length
          ? `<table>
<tr><th>${st('rk_rank')}</th><th>${st('tb_creator')}</th><th class="num">${typeLabel[type]}</th>${
              type === 'fansCnt' ? '' : `<th class="num">${st('tb_followers')}</th>`
            }<th>${st('tb_region')}</th></tr>
${rankRows(
  rows,
  (row, i) => `<tr>
  <td class="rk">${i + 1}</td>
  <td>${
    row.unique_id
      ? `<a href="/kol/kol-detail/${encodeURIComponent(row.unique_id)}">${escapeHtml(row.nickname || row.unique_id)}</a> <span style="color:var(--muted);font-size:12px">@${escapeHtml(row.unique_id)}</span>`
      : escapeHtml(row.nickname || '—')
  }</td>
  <td class="num">${fmtMetric(row.metric)}</td>
  ${type === 'fansCnt' ? '' : `<td class="num">${fmtNum(row.follower_count)}</td>`}
  <td>${escapeHtml(row.region ?? '—')}</td>
</tr>`,
)}
</table>`
          : `<div class="empty">${st('rk_building')}</div>`
      }</div>`,
    }),
  );
});

r.get('/kol/video-rank', async (c) => {
  const { profile } = await ctx(c);
  const type = c.req.query('type') === 'likeCnt' ? 'likeCnt' : 'playCnt';
  const col = type === 'likeCnt' ? 'like_cnt' : 'play_cnt';

  const { results } = await c.env.DB.prepare(
    `SELECT v.video_id, v.title, v.region, v.play_cnt, v.like_cnt, cr.unique_id author_uid FROM tk_videos v
     LEFT JOIN tk_creators cr ON cr.creator_id = v.creator_id
     WHERE v.${col} IS NOT NULL ORDER BY v.${col} DESC LIMIT 50`,
  ).all<{ video_id: string; title: string | null; region: string | null; play_cnt: number | null; like_cnt: number | null; author_uid: string | null }>();

  const rows = results ?? [];
  const tabs = `<div class="tabs-line">
  <a class="${type === 'playCnt' ? 'on' : ''}" href="/kol/video-rank?type=playCnt">${st('tb_plays')}</a>
  <a class="${type === 'likeCnt' ? 'on' : ''}" href="/kol/video-rank?type=likeCnt">${st('tb_likes')}</a>
</div>`;
  return html(
    appPage({
      title: brandTitle(st('nv_rank_videos')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_rank_video') },
      profile,
      body: `<h1>${st('nv_rank_videos')}</h1><p class="sub">${st('rk_sub')}</p>
<div class="card">${tabs}${
        rows.length
          ? `<table>
<tr><th>${st('rk_rank')}</th><th>${st('tb_title')}</th><th>${st('tb_region')}</th><th class="num">${st('tb_plays')}</th><th class="num">${st('tb_likes')}</th></tr>
${rankRows(
  rows,
  (row, i) => `<tr>
  <td class="rk">${i + 1}</td>
  <td style="max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/kol/video-detail/${escapeHtml(row.video_id)}${row.author_uid ? `?u=${encodeURIComponent(row.author_uid)}` : ''}">${escapeHtml(row.title || row.video_id)}</a></td>
  <td>${escapeHtml(row.region ?? '—')}</td>
  <td class="num">${fmtNum(row.play_cnt)}</td>
  <td class="num">${fmtNum(row.like_cnt)}</td>
</tr>`,
)}
</table>`
          : `<div class="empty">${st('rk_building')}</div>`
      }</div>`,
    }),
  );
});

r.get('/kol/product-rank', async (c) => {
  const { profile } = await ctx(c);
  const { results } = await c.env.DB.prepare(
    `SELECT product_id, region, title, price, sold_count FROM tk_products
     WHERE sold_count IS NOT NULL ORDER BY sold_count DESC LIMIT 50`,
  ).all<{ product_id: string; region: string; title: string | null; price: string | null; sold_count: number }>();

  const rows = results ?? [];
  return html(
    appPage({
      title: brandTitle(st('nv_rank_products')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_rank_product') },
      profile,
      body: `<h1>${st('nv_rank_products')}</h1><p class="sub">${st('rk_sub')}</p>
<div class="card">${
        rows.length
          ? `<table>
<tr><th>${st('rk_rank')}</th><th>${st('tb_title')}</th><th>${st('tb_region')}</th><th class="num">${st('tb_price')}</th><th class="num">${st('tb_sold')}</th></tr>
${rankRows(
  rows,
  (row, i) => `<tr>
  <td class="rk">${i + 1}</td>
  <td style="max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/kol/product-detail/${encodeURIComponent(row.product_id)}?region=${encodeURIComponent(row.region)}">${escapeHtml(row.title || row.product_id)}</a></td>
  <td>${escapeHtml(row.region)}</td>
  <td class="num">${escapeHtml(row.price ?? '—')}</td>
  <td class="num">${fmtNum(row.sold_count)}</td>
</tr>`,
)}
</table>`
          : `<div class="empty">${st('sr_source_tip')}</div>`
      }</div>`,
    }),
  );
});

// 店铺搜索 / 店铺榜 / 店铺详情：无免费店铺数据源（2026-08 调研：tikwm 无店铺端点、
// 官方 API 仅限授权店、网页端有签名墙），维持成型的「马上上线」页。
// 注意店铺功能插件里也没有，不能用 pending_body（那段声称插件可用）。
for (const [path, titleKey] of [
  ['/kol/shop-search', 'nv_shop_search'],
  ['/kol/shop-rank', 'nv_shop_rank'],
  ['/kol/shop-detail/:id', 'nv_shop_detail'],
] as const) {
  r.get(path, async (c) => {
    const { profile } = await ctx(c);
    return html(
      appPage({
        title: brandTitle(st(titleKey)),
        path: pathOf(c),
        profile,
        body: `<h1>${st(titleKey)} <span class="chip orange">${st('cm_soon')}</span></h1>
<p class="sub">${st('shop_soon_sub')}</p>
<div class="card">${emptyBlock(st('cm_soon'), st('shop_soon_body'))}</div>`,
      }),
    );
  });
}

// ── 推广计划 / 合作 ──────────────────────────────────────────────────────────

r.get('/kol/promotional', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.region, p.status, p.created_at,
              (SELECT COUNT(*) FROM promotion_creators pc WHERE pc.promotion_id = p.id) cnt
       FROM promotions p WHERE p.user_id = ?1 ORDER BY p.created_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<{ id: string; name: string; region: string | null; status: string; created_at: number; cnt: number }>();

    const rows = results ?? [];
    body = `<div class="card">${
      rows.length
        ? `<table>
<tr><th>${st('tb_name')}</th><th>${st('tb_region')}</th><th class="num">${st('tb_creator')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th></tr>
${rows
  .map(
    (p) => `<tr>
  <td><a href="/kol/promotional/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a></td>
  <td>${escapeHtml(p.region ?? '—')}</td>
  <td class="num">${fmtNum(p.cnt)}</td>
  <td><span class="chip ${p.status === 'active' ? 'green' : ''}">${p.status === 'active' ? st('wb_ongoing') : escapeHtml(p.status)}</span></td>
  <td>${fmtDate(p.created_at)}</td>
</tr>`,
  )
  .join('')}
</table>`
        : emptyBlock(st('pm_none'), st('pm_none_hint'))
    }</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_promotional')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('nv_promotional')}</h1><p class="sub">${st('pm_none_hint')}</p>${body}`,
    }),
  );
});

r.get('/kol/promotional/:id', async (c) => {
  const { user, profile } = await ctx(c);
  const id = c.req.param('id');

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const plan = await c.env.DB.prepare(
      `SELECT id, name, region, product_url, note, status, created_at FROM promotions
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(id, user.id)
      .first<{ id: string; name: string; region: string | null; product_url: string | null; note: string | null; status: string; created_at: number }>();

    if (!plan) {
      body = `<div class="card">${emptyBlock(st('sr_none'))}</div>`;
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT creator_id, status, payload, created_at FROM promotion_creators
         WHERE promotion_id = ?1 AND user_id = ?2 ORDER BY created_at DESC LIMIT 200`,
      )
        .bind(id, user.id)
        .all<{ creator_id: string; status: string; payload: string | null; created_at: number }>();

      const stageChip = (s: string) => {
        const map: Record<string, [string, string]> = {
          collected: [st('cp_stage_collected'), 'blue'],
          contacted: [st('cp_stage_contacted'), 'green'],
          ignored: [st('cp_stage_ignored'), ''],
        };
        const [label, cls] = map[s] ?? [s, ''];
        return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
      };

      const rows = results ?? [];

      // 计划概览：状态漏斗 + 地区分布，都从已取的 200 行里聚合（够用，不再多查一趟）
      const byStatus: Record<string, number> = {};
      const byRegion = new Map<string, number>();
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
        const p = safeParse(row.payload);
        const reg = typeof p.region === 'string' && p.region ? p.region.toUpperCase() : '—';
        byRegion.set(reg, (byRegion.get(reg) ?? 0) + 1);
      }
      const contacted = byStatus.contacted ?? 0;
      const conv = rows.length ? Math.round((contacted / rows.length) * 100) : 0;
      const regionChips = [...byRegion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reg, n]) => `<span class="chip">${escapeHtml(reg)} · ${fmtNum(n)}</span>`)
        .join(' ');
      const statsCard = rows.length
        ? `<div class="card" style="margin-bottom:16px">
  <h2 style="font-size:15px;margin:0 0 12px">${st('pm_stat_title')}</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <span class="chip blue">${st('cp_stage_collected')} · ${fmtNum(byStatus.collected ?? 0)}</span>
    <span class="chip green">${st('cp_stage_contacted')} · ${fmtNum(contacted)}</span>
    <span class="chip">${st('cp_stage_ignored')} · ${fmtNum(byStatus.ignored ?? 0)}</span>
    <span class="chip orange">${st('wb_conv')} ${conv}%</span>
    <span style="flex-basis:100%"></span>
    ${regionChips}
  </div>
</div>`
        : '';

      body = `
<div class="card" style="margin-bottom:16px">
  <dl style="display:grid;grid-template-columns:auto 1fr;gap:8px 20px;margin:0;font-size:13.5px">
    <dt style="color:var(--muted)">${st('tb_name')}</dt><dd style="margin:0">${escapeHtml(plan.name)}</dd>
    <dt style="color:var(--muted)">${st('tb_region')}</dt><dd style="margin:0">${escapeHtml(plan.region ?? '—')}</dd>
    <dt style="color:var(--muted)">${st('tb_created')}</dt><dd style="margin:0">${fmtDate(plan.created_at)}</dd>
    ${plan.product_url ? `<dt style="color:var(--muted)">URL</dt><dd style="margin:0"><a href="${escapeHtml(plan.product_url)}" target="_blank" rel="noopener">${escapeHtml(plan.product_url.slice(0, 80))}</a></dd>` : ''}
  </dl>
</div>
${statsCard}
<div class="card">${
        rows.length
          ? `<table>
<tr><th>${st('tb_creator')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th></tr>
${rows
  .map((row) => {
    const p = safeParse(row.payload);
    const label = itemLabel(p, row.creator_id);
    return `<tr>
  <td><a href="https://www.tiktok.com/@${encodeURIComponent(row.creator_id)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></td>
  <td>${stageChip(row.status)}</td>
  <td>${fmtDate(row.created_at)}</td>
</tr>`;
  })
  .join('')}
</table>`
          : emptyBlock(st('cl_none'))
      }</div>`;
    }
  }

  return html(
    appPage({
      title: brandTitle(st('promo_title')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('promo_title')}</h1><p class="sub">${st('promo_id')}${escapeHtml(id)}</p>${body}`,
    }),
  );
});

r.get('/kol/cooperate', async (c) => {
  const { user, profile } = await ctx(c);
  const stage = c.req.query('stage') || '';

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const filter = ['collected', 'contacted', 'ignored'].includes(stage) ? stage : null;
    const { results } = await c.env.DB.prepare(
      `SELECT pc.creator_id, pc.status, pc.payload, pc.created_at, p.name plan_name, p.id plan_id
       FROM promotion_creators pc JOIN promotions p ON p.id = pc.promotion_id
       WHERE pc.user_id = ?1 ${filter ? 'AND pc.status = ?2' : ''}
       ORDER BY pc.created_at DESC LIMIT 200`,
    )
      .bind(...(filter ? [user.id, filter] : [user.id]))
      .all<{ creator_id: string; status: string; payload: string | null; created_at: number; plan_name: string; plan_id: string }>();

    const stageChip = (s: string) => {
      const map: Record<string, [string, string]> = {
        collected: [st('cp_stage_collected'), 'blue'],
        contacted: [st('cp_stage_contacted'), 'green'],
        ignored: [st('cp_stage_ignored'), ''],
      };
      const [label, cls] = map[s] ?? [s, ''];
      return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
    };

    const rows = results ?? [];
    const tabs: Array<[string, string]> = [
      ['', st('g_all')],
      ['collected', st('cp_stage_collected')],
      ['contacted', st('cp_stage_contacted')],
      ['ignored', st('cp_stage_ignored')],
    ];
    body = `<div class="card">
  <div class="tabs-line">
    ${tabs
      .map(
        ([s, label]) =>
          `<a class="${stage === s ? 'on' : ''}" href="/kol/cooperate${s ? `?stage=${s}` : ''}">${escapeHtml(label)}</a>`,
      )
      .join('')}
  </div>
  ${
    rows.length
      ? `<table>
<tr><th>${st('tb_creator')}</th><th>${st('nv_promotional')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th><th></th></tr>
${rows
  .map((row) => {
    const p = safeParse(row.payload);
    return `<tr>
  <td><a href="https://www.tiktok.com/@${encodeURIComponent(row.creator_id)}" target="_blank" rel="noopener">${escapeHtml(itemLabel(p, row.creator_id))}</a></td>
  <td><a href="/kol/promotional/${escapeHtml(row.plan_id)}">${escapeHtml(row.plan_name)}</a></td>
  <td>${stageChip(row.status)}</td>
  <td>${fmtDate(row.created_at)}</td>
  <td><a href="/kol/cooperate/${encodeURIComponent(row.creator_id)}">${st('ks_detail')}</a></td>
</tr>`;
  })
  .join('')}
</table>`
      : emptyBlock(st('cl_none'), st('pm_none_hint'))
  }
</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_cooperate')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('nv_cooperate')}</h1><p class="sub">${st('cp_sub')}</p>${body}`,
    }),
  );
});

/**
 * 合作达人详情：按 handle 聚合该达人在所有推广计划里的状态 + 回灌库快照。
 * ID 口径：promotion_creators.creator_id 存 handle，tk_creators 里 handle 在
 * unique_id_lower（数字 id 才是主键），JOIN 走小写 handle。
 */
r.get('/kol/cooperate/:creatorId', async (c) => {
  const { user, profile } = await ctx(c);
  const handle = decodeURIComponent(c.req.param('creatorId') || '').replace(/^@/, '').slice(0, 64);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const [plansRes, cr, metrics] = await Promise.all([
      c.env.DB.prepare(
        `SELECT pc.status, pc.payload, pc.created_at, p.id plan_id, p.name plan_name, p.region plan_region
         FROM promotion_creators pc JOIN promotions p ON p.id = pc.promotion_id
         WHERE pc.user_id = ?1 AND pc.creator_id = ?2 ORDER BY pc.created_at DESC LIMIT 50`,
      )
        .bind(user.id, handle)
        .all<{ status: string; payload: string | null; created_at: number; plan_id: string; plan_name: string; plan_region: string | null }>(),
      c.env.DB.prepare(
        `SELECT creator_id, nickname, region, follower_count FROM tk_creators WHERE unique_id_lower = ?1`,
      )
        .bind(handle.toLowerCase())
        .first<{ creator_id: string; nickname: string | null; region: string | null; follower_count: number | null }>(),
      c.env.DB.prepare(
        `SELECT m.avg_play_cnt, m.interaction_rate, m.sample_size FROM creator_metrics m
         JOIN tk_creators cr ON cr.creator_id = m.creator_id WHERE cr.unique_id_lower = ?1`,
      )
        .bind(handle.toLowerCase())
        .first<{ avg_play_cnt: number | null; interaction_rate: number | null; sample_size: number }>(),
    ]);

    const plans = plansRes.results ?? [];
    const snap = plans.length ? safeParse(plans[0].payload) : {};
    const nickname = cr?.nickname || (typeof snap.nickname === 'string' ? snap.nickname : handle);

    const stageChip = (s: string) => {
      const map: Record<string, [string, string]> = {
        collected: [st('cp_stage_collected'), 'blue'],
        contacted: [st('cp_stage_contacted'), 'green'],
        ignored: [st('cp_stage_ignored'), ''],
      };
      const [label, cls] = map[s] ?? [s, ''];
      return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
    };

    body = `
<div class="card" style="margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <strong style="font-size:16px">${escapeHtml(nickname)}</strong>
    <a style="color:var(--muted);font-family:var(--mono);font-size:12.5px;text-decoration:none"
       href="https://www.tiktok.com/@${encodeURIComponent(handle)}" target="_blank" rel="noopener">@${escapeHtml(handle)}</a>
    ${cr?.region ? `<span class="chip">${escapeHtml(cr.region)}</span>` : ''}
    <span style="flex:1"></span>
    <a class="btn ghost" style="padding:5px 11px;font-size:12px" href="/kol/kol-detail/${encodeURIComponent(handle)}">${st('ks_detail')}</a>
  </div>
  <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:13px">
    <span>${st('tb_followers')} <b>${fmtNum(cr?.follower_count)}</b></span>
    <span>${st('kd_avg_play')} <b>${fmtNum(metrics?.avg_play_cnt ?? null)}</b></span>
    <span>${st('kd_interact')} <b>${
      metrics?.interaction_rate != null ? (metrics.interaction_rate * 100).toFixed(2) + '%' : '—'
    }</b></span>
  </div>
</div>
<div class="card">
  <h2 style="font-size:15px;margin:0 0 10px">${st('nv_promotional')}</h2>
  ${
    plans.length
      ? `<table>
<tr><th>${st('tb_name')}</th><th>${st('tb_region')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th></tr>
${plans
  .map(
    (p) => `<tr>
  <td><a href="/kol/promotional/${escapeHtml(p.plan_id)}">${escapeHtml(p.plan_name)}</a></td>
  <td>${escapeHtml(p.plan_region ?? '—')}</td>
  <td>${stageChip(p.status)}</td>
  <td>${fmtDate(p.created_at)}</td>
</tr>`,
  )
  .join('')}
</table>`
      : emptyBlock(st('co_none'), st('pm_none_hint'))
  }
</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('co_title')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('co_title')}</h1><p class="sub">@${escapeHtml(handle)}</p>${body}`,
    }),
  );
});

r.get('/kol/cooperateactive', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name,
              SUM(CASE WHEN pc.status = 'collected' THEN 1 ELSE 0 END) collected,
              SUM(CASE WHEN pc.status = 'contacted' THEN 1 ELSE 0 END) contacted,
              SUM(CASE WHEN pc.status = 'ignored' THEN 1 ELSE 0 END) ignored,
              COUNT(pc.id) total
       FROM promotions p LEFT JOIN promotion_creators pc ON pc.promotion_id = p.id
       WHERE p.user_id = ?1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<{ id: string; name: string; collected: number; contacted: number; ignored: number; total: number }>();

    const rows = results ?? [];
    body = `<div class="card">${
      rows.length
        ? `<table>
<tr><th>${st('tb_name')}</th><th class="num">${st('cp_stage_collected')}</th><th class="num">${st('cp_stage_contacted')}</th><th class="num">${st('cp_stage_ignored')}</th><th class="num">${st('tb_count')}</th></tr>
${rows
  .map(
    (row) => `<tr>
  <td><a href="/kol/promotional/${escapeHtml(row.id)}">${escapeHtml(row.name)}</a></td>
  <td class="num">${fmtNum(row.collected)}</td>
  <td class="num">${fmtNum(row.contacted)}</td>
  <td class="num">${fmtNum(row.ignored)}</td>
  <td class="num">${fmtNum(row.total)}</td>
</tr>`,
  )
  .join('')}
</table>`
        : emptyBlock(st('pm_none'), st('pm_none_hint'))
    }</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_coop_active')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('nv_coop_active')}</h1><p class="sub">${st('cp_sub')}</p>${body}`,
    }),
  );
});

r.get('/kol/task', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT task_id, type, status, error, created_at FROM async_tasks
       WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<{ task_id: string; type: string; status: string; error: string | null; created_at: number }>();

    const statusChip = (s: string) => {
      const map: Record<string, [string, string]> = {
        pending: [st('st_pending'), ''],
        running: [st('st_running'), 'blue'],
        success: [st('st_success'), 'green'],
        failed: [st('st_failed'), 'red'],
      };
      const [label, cls] = map[s] ?? [s, ''];
      return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
    };

    const rows = results ?? [];

    // 群发建联任务：和相似达人任务并列在这一页（原站「批量任务」也是这个位置）
    const [campaigns, sendable] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, name, status, sent_count, failed_count, total, created_at
           FROM mail_campaigns WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20`,
      )
        .bind(user.id)
        .all<{
          id: string;
          name: string;
          status: string;
          sent_count: number;
          failed_count: number;
          total: number;
          created_at: number;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) n FROM mail_contacts c
          WHERE c.user_id = ?1 AND c.email IS NOT NULL AND c.contacted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM mail_suppression s WHERE s.user_id = c.user_id AND s.email = c.email)`,
      )
        .bind(user.id)
        .first<{ n: number }>(),
    ]);
    const cpRows = campaigns.results ?? [];
    const cpStatus: Record<string, [string, string]> = {
      running: [st('cp_st_running'), 'blue'],
      paused: [st('cp_st_paused'), ''],
      done: [st('cp_st_done'), 'green'],
    };
    const campaignCard = `<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('cp_title')}</h2>
  <p class="sub" style="margin:0 0 12px">${st('cp_hint')}</p>
  ${
    sendable?.n
      ? `<form id="cp-form" style="display:flex;flex-direction:column;gap:10px">
    <input type="text" id="cp-name" placeholder="${escapeHtml(st('cp_name'))}" required>
    <input type="text" id="cp-subject" placeholder="${escapeHtml(st('ml_subject'))}" required>
    <textarea id="cp-body" rows="5" required placeholder="${escapeHtml(st('ml_tpl_vars'))}"
      style="font-size:14px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--paper);color:var(--ink);resize:vertical;font-family:inherit"></textarea>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" type="submit" id="cp-submit">${st('cp_create')}</button>
      <span class="chip">${st('cp_recipients', { n: sendable.n })}</span>
      <span id="cp-msg" style="font-size:13px;color:var(--muted)"></span>
    </div>
  </form>`
      : `<div class="empty"><div style="max-width:520px;margin:0 auto">${st('cp_need_contacts')}</div>
  <p style="margin:14px 0 0"><a class="btn" href="/kol/import">${st('ml_import_title')}</a></p></div>`
  }
  ${
    cpRows.length
      ? `<table style="margin-top:16px">
<tr><th>${st('cp_name')}</th><th>${st('tb_status')}</th><th class="num">${st('cp_progress')}</th><th>${st('tb_created')}</th><th></th></tr>
${cpRows
  .map((cp) => {
    const [label, cls] = cpStatus[cp.status] ?? [cp.status, ''];
    return `<tr>
  <td>${escapeHtml(cp.name)}</td>
  <td><span class="chip ${cls}">${escapeHtml(label)}</span></td>
  <td class="num">${fmtNum(cp.sent_count)} / ${fmtNum(cp.total)}${
      cp.failed_count ? ` <span style="color:var(--danger)">(${fmtNum(cp.failed_count)})</span>` : ''
    }</td>
  <td>${fmtDate(cp.created_at)}</td>
  <td>${
    cp.status === 'running'
      ? `<a href="#" data-cp="${escapeHtml(cp.id)}" data-to="paused">${st('cp_pause')}</a>`
      : cp.status === 'paused'
        ? `<a href="#" data-cp="${escapeHtml(cp.id)}" data-to="running">${st('cp_resume')}</a>`
        : ''
  }</td>
</tr>`;
  })
  .join('')}
</table>`
      : ''
  }
</div>`;

    // 创建入口：网页端能发起的批量任务目前是「相似达人」（评论分析要插件抓评论）
    const createCard = `${campaignCard}<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('tk_create_title')}</h2>
  <p class="sub" style="margin:0 0 12px">${st('tk_create_hint')}</p>
  <form id="tk-form" style="display:flex;flex-direction:column;gap:10px">
    <textarea id="tk-handles" rows="4" placeholder="${escapeHtml(st('tk_create_ph'))}"
      style="font-family:var(--mono);font-size:13px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--paper);color:var(--ink);resize:vertical"></textarea>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input id="tk-region" type="text" maxlength="8" placeholder="${escapeHtml(st('tk_create_region_ph'))}" style="width:180px">
      <button class="btn" type="submit" id="tk-submit">${st('tk_create_btn')}</button>
      <span id="tk-msg" style="font-size:13px;color:var(--muted)"></span>
    </div>
  </form>
</div>`;
    body = `${createCard}<div class="card">${
      rows.length
        ? `<table>
<tr><th>${st('tb_type')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th><th></th></tr>
${rows
  .map(
    (t) => `<tr>
  <td>${st(t.type === 'creator_similarity' ? 'tk_type_similarity' : 'tk_type_review')}${
      t.error ? `<div style="color:var(--danger);font-size:12px">${escapeHtml(t.error.slice(0, 120))}</div>` : ''
    }</td>
  <td>${statusChip(t.status)}</td>
  <td>${fmtDate(t.created_at)}</td>
  <td><a href="/kol/task/${escapeHtml(t.task_id)}">${st('ks_detail')}</a></td>
</tr>`,
  )
  .join('')}
</table>`
        : emptyBlock(st('tk_none'), st('wb_empty_hint'))
    }</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_batch_tasks')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('nv_batch_tasks')}</h1><p class="sub">${st('wb_empty_hint')}</p>${body}`,
      script: user
        ? `
var form = document.getElementById('tk-form');
var T = { created:${JSON.stringify(st('tk_created_n'))}, quota:${JSON.stringify(st('tk_quota_out'))},
  err:${JSON.stringify(st('ks_err'))} };
form.addEventListener('submit', function(ev){
  ev.preventDefault();
  var handles = document.getElementById('tk-handles').value.split('\\n')
    .map(function(s){ return s.trim(); }).filter(Boolean);
  var msg = document.getElementById('tk-msg');
  var btn = document.getElementById('tk-submit');
  if (!handles.length) return;
  btn.disabled = true; msg.textContent = '…';
  fetch('/kol/api/task/similar', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({handles: handles, region: document.getElementById('tk-region').value.trim()})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.code === 'OK' && j.data) {
        msg.textContent = T.created.replace('{n}', j.data.created) + (j.data.quotaExhausted ? ' · ' + T.quota : '');
        setTimeout(function(){ location.reload(); }, 1200);
      } else {
        btn.disabled = false; msg.textContent = j.message || T.err;
      }
    })
    .catch(function(){ btn.disabled = false; msg.textContent = T.err; });
});

// 群发任务：创建 + 暂停/继续
var cpForm = document.getElementById('cp-form');
if (cpForm) cpForm.addEventListener('submit', function(ev){
  ev.preventDefault();
  var msg = document.getElementById('cp-msg'), btn = document.getElementById('cp-submit');
  btn.disabled = true; msg.textContent = '…';
  fetch('/kol/api/mail/campaign', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({name:document.getElementById('cp-name').value.trim(),
      subject:document.getElementById('cp-subject').value.trim(),
      body:document.getElementById('cp-body').value})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.code === 'OK') {
        msg.textContent = ${JSON.stringify(st('cp_created'))}.replace('{n}', j.data.total);
        setTimeout(function(){ location.reload(); }, 1200);
      } else { btn.disabled = false; msg.textContent = j.message || T.err; }
    })
    .catch(function(){ btn.disabled = false; msg.textContent = T.err; });
});
document.addEventListener('click', function(ev){
  var a = ev.target.closest && ev.target.closest('[data-cp]');
  if (!a) return;
  ev.preventDefault();
  fetch('/kol/api/mail/campaign/status', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify({id:a.getAttribute('data-cp'), status:a.getAttribute('data-to')})})
    .then(function(){ location.reload(); });
});`
        : undefined,
    }),
  );
});

/**
 * 任务详情：async_tasks 单条。相似达人任务把 result（SimilarCreator[]）
 * JOIN tk_creators 补昵称/粉丝数后渲染成卡片列表，其余类型给参数与状态。
 */
r.get('/kol/task/:taskId', async (c) => {
  const { user, profile } = await ctx(c);
  const taskId = c.req.param('taskId').slice(0, 64);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const t = await c.env.DB.prepare(
      `SELECT task_id, type, status, input, result, error, created_at, updated_at
       FROM async_tasks WHERE task_id = ?1 AND user_id = ?2`,
    )
      .bind(taskId, user.id)
      .first<{
        task_id: string;
        type: string;
        status: string;
        input: string | null;
        result: string | null;
        error: string | null;
        created_at: number;
        updated_at: number;
      }>();

    if (!t) {
      body = `<div class="card">${emptyBlock(st('sr_none'))}</div>`;
    } else {
      const input = safeParse(t.input);
      const statusChip = (s: string) => {
        const map: Record<string, [string, string]> = {
          pending: [st('st_pending'), ''],
          running: [st('st_running'), 'blue'],
          success: [st('st_success'), 'green'],
          failed: [st('st_failed'), 'red'],
        };
        const [label, cls] = map[s] ?? [s, ''];
        return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
      };

      let resultBlock = '';
      if (t.type === 'creator_similarity' && t.status === 'success' && t.result) {
        let items: Array<{ creatorId: string; region?: string; avgPlayCnt?: number; avgLikeCnt?: number; avgInteractionRate?: number }> = [];
        try {
          items = JSON.parse(t.result);
        } catch {
          items = [];
        }
        // 补昵称/粉丝数：result 里只有 handle，从回灌库里 JOIN
        const handles = items.slice(0, 50).map((x) => String(x.creatorId).toLowerCase());
        const enrich = new Map<string, { nickname: string | null; follower_count: number | null }>();
        if (handles.length) {
          const qs = handles.map((_, i) => `?${i + 1}`).join(',');
          const { results } = await c.env.DB.prepare(
            `SELECT unique_id_lower, nickname, follower_count FROM tk_creators WHERE unique_id_lower IN (${qs})`,
          )
            .bind(...handles)
            .all<{ unique_id_lower: string; nickname: string | null; follower_count: number | null }>();
          for (const row of results ?? []) enrich.set(row.unique_id_lower, row);
        }
        resultBlock = items.length
          ? `<div class="card"><h2 style="font-size:15px;margin:0 0 10px">${st('kt_result', { n: items.length })}</h2>
<table>
<tr><th>${st('tb_creator')}</th><th class="num">${st('tb_followers')}</th><th class="num">${st('kd_avg_play')}</th><th class="num">${st('kd_interact')}</th><th>${st('tb_region')}</th></tr>
${items
  .map((x) => {
    const e = enrich.get(String(x.creatorId).toLowerCase());
    return `<tr>
  <td><a href="/kol/kol-detail/${encodeURIComponent(x.creatorId)}">${escapeHtml(e?.nickname || x.creatorId)}</a> <span style="color:var(--muted);font-size:12px">@${escapeHtml(x.creatorId)}</span></td>
  <td class="num">${fmtNum(e?.follower_count)}</td>
  <td class="num">${fmtNum(x.avgPlayCnt)}</td>
  <td class="num">${x.avgInteractionRate != null ? (x.avgInteractionRate * 100).toFixed(2) + '%' : '—'}</td>
  <td>${escapeHtml(x.region ?? '—')}</td>
</tr>`;
  })
  .join('')}
</table></div>`
          : `<div class="card">${emptyBlock(st('sr_none'))}</div>`;
      }

      const seed = typeof input.handleName === 'string' ? input.handleName : '';
      body = `
<div class="card" style="margin-bottom:16px">
  <dl style="display:grid;grid-template-columns:auto 1fr;gap:8px 20px;margin:0;font-size:13.5px">
    <dt style="color:var(--muted)">${st('tb_type')}</dt><dd style="margin:0">${st(t.type === 'creator_similarity' ? 'tk_type_similarity' : 'tk_type_review')}</dd>
    <dt style="color:var(--muted)">${st('tb_status')}</dt><dd style="margin:0">${statusChip(t.status)}${
        t.error ? ` <span style="color:var(--danger);font-size:12.5px">${escapeHtml(t.error.slice(0, 200))}</span>` : ''
      }</dd>
    ${seed ? `<dt style="color:var(--muted)">${st('kt_seed')}</dt><dd style="margin:0"><a href="/kol/kol-detail/${encodeURIComponent(seed)}">@${escapeHtml(seed)}</a></dd>` : ''}
    <dt style="color:var(--muted)">${st('tb_created')}</dt><dd style="margin:0">${fmtDate(t.created_at)}</dd>
  </dl>
</div>
${resultBlock}`;
    }
  }

  return html(
    appPage({
      title: brandTitle(st('kt_title')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('kt_title')}</h1><p class="sub">${escapeHtml(taskId)}</p>${body}`,
    }),
  );
});

/**
 * 风险达人简版：不是原站那种人工反馈风险库（没有数据源），而是基于
 * creator_metrics 的规则筛查 —— 帮用户在建联前排掉三类「看着大实则虚」的号：
 *   lowreach    粉丝 ≥1 万但平均播放不足粉丝数 0.5%（疑似买粉/限流）
 *   fakeengage  互动率 >25% 且样本 ≥3（远超常态，疑似刷互动）
 *   inactive    粉丝 ≥1 万且超过 60 天没发视频（合作大概率没回音）
 * 登录可见（会员功能）。
 */
r.get('/kol/risk', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT cr.unique_id, cr.nickname, cr.region, cr.follower_count,
              m.avg_play_cnt, m.interaction_rate, m.sample_size, m.last_post_at
       FROM creator_metrics m JOIN tk_creators cr ON cr.creator_id = m.creator_id
       WHERE cr.follower_count >= 10000 AND m.sample_size >= 2
       ORDER BY cr.follower_count DESC LIMIT 500`,
    ).all<{
      unique_id: string | null;
      nickname: string | null;
      region: string | null;
      follower_count: number;
      avg_play_cnt: number | null;
      interaction_rate: number | null;
      sample_size: number;
      last_post_at: number | null;
    }>();

    const now = Math.floor(Date.now() / 1000);
    const flagged = (results ?? [])
      .map((row) => {
        const risks: Array<[string, string]> = [];
        if (row.avg_play_cnt != null && row.follower_count > 0 && row.avg_play_cnt < row.follower_count * 0.005) {
          risks.push([st('rs_t_lowreach'), 'orange']);
        }
        if (row.interaction_rate != null && row.sample_size >= 3 && row.interaction_rate > 0.25) {
          risks.push([st('rs_t_fakeengage'), 'red']);
        }
        if (row.last_post_at != null && row.last_post_at > 0 && now - row.last_post_at > 60 * 86400) {
          risks.push([st('rs_t_inactive'), '']);
        }
        return { row, risks };
      })
      .filter((x) => x.risks.length)
      .slice(0, 100);

    body = `<div class="card">
  <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted)">${st('rs_rule_note')}</p>
  ${
    flagged.length
      ? `<table>
<tr><th>${st('tb_creator')}</th><th>${st('nv_risk')}</th><th class="num">${st('tb_followers')}</th><th class="num">${st('kd_avg_play')}</th><th class="num">${st('kd_interact')}</th><th>${st('rs_last_post')}</th></tr>
${flagged
  .map(
    ({ row, risks }) => `<tr>
  <td>${
    row.unique_id
      ? `<a href="/kol/kol-detail/${encodeURIComponent(row.unique_id)}">${escapeHtml(row.nickname || row.unique_id)}</a> <span style="color:var(--muted);font-size:12px">@${escapeHtml(row.unique_id)}</span>`
      : escapeHtml(row.nickname || '—')
  }</td>
  <td>${risks.map(([label, cls]) => `<span class="chip ${cls}">${escapeHtml(label)}</span>`).join(' ')}</td>
  <td class="num">${fmtNum(row.follower_count)}</td>
  <td class="num">${fmtNum(row.avg_play_cnt)}</td>
  <td class="num">${row.interaction_rate != null ? (row.interaction_rate * 100).toFixed(2) + '%' : '—'}</td>
  <td>${row.last_post_at ? fmtDate(row.last_post_at) : '—'}</td>
</tr>`,
  )
  .join('')}
</table>`
      : emptyBlock(st('rs_none'), st('rk_building'))
  }
</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_risk')),
      path: pathOf(c),
      profile,
      body: `<h1>${st('nv_risk')}</h1><p class="sub">${st('rs_sub')}</p>${body}`,
    }),
  );
});

// ── 消息中心 ─────────────────────────────────────────────────────────────────

r.get('/kol/message-center', async (c) => {
  const { user, profile } = await ctx(c);
  const tab = c.req.query('tab') === 'msg' ? 'msg' : 'ann';

  // 公告从 announcements 表读（admin POST /admin/announcements 发布）；
  // 表还没有内容时退回内置欢迎公告，页面永远不是空的。
  let annItems = '';
  if (tab === 'ann') {
    const { results } = await c.env.DB.prepare(
      `SELECT title, body, pinned, created_at FROM announcements
       WHERE status = 'published' AND (lang IS NULL OR lang = ?1)
       ORDER BY pinned DESC, created_at DESC LIMIT 30`,
    )
      .bind(htmlLang())
      .all<{ title: string; body: string; pinned: number; created_at: number }>();
    const rows = results ?? [];
    annItems = rows.length
      ? rows
          .map(
            (a) => `<div class="msg-item">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span class="chip ${a.pinned ? 'orange' : 'blue'}">${a.pinned ? st('mc_pinned') : st('mc_tab_ann')}</span>
    <strong>${escapeHtml(a.title)}</strong>
    <span style="margin-left:auto;color:var(--muted);font-size:12px">${fmtDate(a.created_at)}</span>
  </div>
  <p style="margin:8px 0 0;color:var(--muted);font-size:13.5px;white-space:pre-wrap">${escapeHtml(a.body)}</p>
</div>`,
          )
          .join('')
      : `<div class="msg-item">
  <div style="display:flex;align-items:center;gap:10px">
    <span class="chip blue">${st('mc_tab_ann')}</span>
    <strong>${st('mc_welcome_t', { brand: BRAND_NAME })}</strong>
    <span style="margin-left:auto;color:var(--muted);font-size:12px">2026-08-04</span>
  </div>
  <p style="margin:8px 0 0;color:var(--muted);font-size:13.5px">${st('mc_welcome_b')}</p>
</div>`;
  }

  // 个人消息：user_messages 表（任务完成通知、admin 手发…）。
  // 系统消息存的是 i18n key，这里按当前语言渲染；进入本 tab 即标记全部已读。
  let msgItems = '';
  let hasUnread = false;
  if (tab === 'msg' && user) {
    const { results } = await c.env.DB.prepare(
      `SELECT kind, tkey, params, title, body, link, read_at, created_at FROM user_messages
       WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<{
        kind: string;
        tkey: string | null;
        params: string | null;
        title: string | null;
        body: string | null;
        link: string | null;
        read_at: number | null;
        created_at: number;
      }>();
    const rows = results ?? [];
    hasUnread = rows.some((m) => !m.read_at);
    const kindChip: Record<string, string> = {
      task: st('nv_batch_tasks'),
      billing: st('nav_price'),
      system: st('mc_tab_msg'),
    };
    msgItems = rows.length
      ? rows
          .map((m) => {
            const vars = safeParse(m.params) as Record<string, string | number>;
            const title = m.tkey ? st(m.tkey, vars) : (m.title ?? '');
            return `<div class="msg-item"${m.read_at ? '' : ' style="background:color-mix(in srgb,var(--accent) 4%,transparent)"'}>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span class="chip ${m.read_at ? '' : 'blue'}">${escapeHtml(kindChip[m.kind] ?? m.kind)}</span>
    <strong>${m.link ? `<a href="${escapeHtml(m.link)}">${escapeHtml(title)}</a>` : escapeHtml(title)}</strong>
    <span style="margin-left:auto;color:var(--muted);font-size:12px">${fmtDate(m.created_at)}</span>
  </div>
  ${m.body ? `<p style="margin:8px 0 0;color:var(--muted);font-size:13.5px;white-space:pre-wrap">${escapeHtml(m.body)}</p>` : ''}
</div>`;
          })
          .join('')
      : emptyBlock(st('mc_none'));
  }

  const content =
    tab === 'ann' ? annItems : user ? msgItems : loginGate();

  return html(
    appPage({
      title: brandTitle(st('nv_msg')),
      path: pathOf(c),
      profile,
      style: `.msg-item{padding:14px 4px;border-bottom:1px solid var(--line)}.msg-item:last-child{border-bottom:0}`,
      body: `<h1>${st('nv_msg')}</h1><p class="sub">&nbsp;</p>
<div class="card">
  <div class="tabs-line">
    <a class="${tab === 'ann' ? 'on' : ''}" href="/kol/message-center">${st('mc_tab_ann')}</a>
    <a class="${tab === 'msg' ? 'on' : ''}" href="/kol/message-center?tab=msg">${st('mc_tab_msg')}</a>
  </div>
  ${content}
</div>`,
      // 打开「消息」tab 就把未读清掉：列表已经展示过一遍，不需要用户逐条点
      script:
        tab === 'msg' && hasUnread
          ? `fetch('/kol/api/inbox/read', {method:'POST', credentials:'same-origin'}).catch(function(){});`
          : undefined,
    }),
  );
});

// ── 营销日历 ─────────────────────────────────────────────────────────────────

r.get('/kol/calendar', async (c) => {
  const { profile } = await ctx(c);

  const byMonth = new Map<string, typeof CAL_EVENTS>();
  for (const ev of CAL_EVENTS) {
    const month = ev.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(ev);
  }

  const monthName = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(htmlLang(), {
      year: 'numeric',
      month: 'long',
    });
  };

  const sections = [...byMonth.entries()]
    .map(
      ([ym, evs]) => `<div class="cal-month">
  <h2>${escapeHtml(monthName(ym))}</h2>
  ${evs
    .map((e) => {
      const cd = calCountdown(e);
      const meta = CAL_TYPE_META[e.type];
      return `<div class="cal-row">
    <div class="d">${e.date.slice(8)}</div>
    <div class="m">
      <div class="t">${st('cd_ev_' + e.key)}</div>
      <div class="r"><span class="chip ${meta.cls}">${meta.label()}</span> ${calRegionChips(e.regions)}</div>
    </div>
    <span class="chip ${cd.cls}">${cd.text}</span>
  </div>`;
    })
    .join('')}
</div>`,
    )
    .join('');

  return html(
    appPage({
      title: brandTitle(st('nv_calendar')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('cd_sub') },
      profile,
      style: `
  .cal-month h2{margin:26px 0 4px}
  .cal-month:first-child h2{margin-top:0}
  .cal-row{display:flex;align-items:center;gap:16px;padding:11px 2px;border-bottom:1px solid var(--line)}
  .cal-row:last-child{border-bottom:0}
  .cal-row .d{
    flex:0 0 42px;font-family:var(--serif);font-size:21px;font-weight:700;
    font-variant-numeric:tabular-nums;text-align:center;
  }
  .cal-row .m{flex:1;min-width:0}
  .cal-row .t{font-size:13.5px}
  .cal-row .r{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}
  .cal-row .chip{font-size:10px;padding:0 7px}
`,
      body: `<h1>${st('nv_calendar')}</h1><p class="sub">${st('cd_sub')}</p>
<div class="card">${sections}</div>`,
    }),
  );
});

// ── 使用说明 ─────────────────────────────────────────────────────────────────

/**
 * 互动引导：对照原站 guide 的「章节 + 功能卡 + 立即使用」结构做的版本。
 * 上手四步带勾选（进度存 localStorage），功能卡直接链到站内页面，
 * 描述复用各页面已有的副标题词条 —— 不新造一批翻译。
 */
r.get('/kol/guide', async (c) => {
  const { profile } = await ctx(c);
  const steps: Array<[string, string]> = [
    [st('gd_step1_t'), st('gd_step1_b')],
    [st('gd_step2_t'), st('gd_step2_b')],
    [st('gd_step3_t'), st('gd_step3_b')],
    [st('gd_step4_t'), st('gd_step4_b')],
  ];
  const faqs: Array<[string, string]> = [
    [st('gd_faq1_q'), st('gd_faq1_a')],
    [st('gd_faq2_q'), st('gd_faq2_a')],
    [st('gd_faq3_q'), st('gd_faq3_a')],
  ];
  // [章节标题, [卡标题, 描述, 链接][]]
  const sections: Array<[string, Array<[string, string, string]>]> = [
    [
      st('gd_sec_kol'),
      [
        [st('nv_kol_search'), st('sr_kol_sub'), '/kol/search'],
        [st('nv_kol_rank'), st('rk_sub'), '/kol/kol-rank'],
        [st('nv_risk'), st('rs_sub'), '/kol/risk'],
      ],
    ],
    [
      st('gd_sec_material'),
      [
        [st('nv_video_search'), st('sr_video_sub'), '/kol/video-search'],
        [st('nv_hashtag'), st('tl_hash_sub'), '/tools/hashtag-generator'],
        [st('nv_download'), st('tl_dl_sub'), '/tools/video-download'],
      ],
    ],
    [
      st('gd_sec_coop'),
      [
        [st('nv_promotional'), st('pm_none_hint'), '/kol/promotional'],
        [st('nv_cooperate'), st('cp_sub'), '/kol/cooperate'],
        [st('nv_calendar'), st('cd_sub'), '/kol/calendar'],
      ],
    ],
  ];

  return html(
    appPage({
      title: brandTitle(st('nv_guide')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_guide') },
      profile,
      style: `
  .gd-progress{display:flex;align-items:center;gap:12px;margin-bottom:4px}
  .gd-bar{flex:1;height:10px;background:color-mix(in srgb,var(--ink) 7%,transparent);overflow:hidden}
  .gd-bar i{display:block;height:100%;width:0;background:var(--rule);border-right:3px solid var(--accent);transition:width .3s}
  .gd-pct{font-family:var(--mono);font-size:12px;color:var(--muted)}
  .step{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);cursor:pointer}
  .step:last-child{border-bottom:0}
  .step .cb{
    flex:0 0 22px;height:22px;border:1.5px solid var(--muted);border-radius:var(--r-xs);margin-top:2px;
    display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;
  }
  .step.done .cb{background:var(--primary);border-color:var(--primary)}
  .step.done .t{text-decoration:line-through;color:var(--muted)}
  .step .t{font-weight:700;font-size:14px}
  .step .b{color:var(--muted);font-size:13px;margin-top:2px}
  .gd-store-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .gd-store-link{
    display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;
    border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink);
    font-size:12px;font-weight:700;text-decoration:none;transition:transform .13s,box-shadow .13s,border-color .13s;
  }
  .gd-store-link:hover,.gd-store-link:focus-visible{
    color:var(--ink);transform:translateY(-1px);border-color:var(--primary);box-shadow:0 4px 12px rgba(0,0,0,.08);
  }
  .gd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .gd-card{
    display:block;padding:14px;border:1px solid var(--line);border-radius:var(--r-md);color:var(--ink);
    text-decoration:none;transition:transform .13s,box-shadow .13s,border-color .13s;
  }
  .gd-card:hover{color:var(--ink);transform:translateY(-2px);box-shadow:var(--hard)}
  .gd-card .t{font-weight:700;font-size:13.5px}
  .gd-card .b{color:var(--muted);font-size:12px;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .gd-card .go{margin-top:8px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
  .faq{padding:12px 0;border-bottom:1px solid var(--line)}
  .faq:last-child{border-bottom:0}
  .faq .q{font-weight:700;font-size:13.5px}
  .faq .a{color:var(--muted);font-size:13px;margin-top:4px}
`,
      body: `<h1>${st('nv_guide')}</h1><p class="sub">${st('brand_tagline')}</p>
<div class="card" style="margin-bottom:16px">
  <div class="gd-progress">
    <h2 style="font-size:15px;margin:0">${st('gd_progress')}</h2>
    <div class="gd-bar"><i id="gd-bar"></i></div>
    <span class="gd-pct" id="gd-pct">0%</span>
  </div>
${steps
  .map(
    ([t, b], i) => `<div class="step" data-i="${i}">
  <div class="cb">✓</div>
  <div><div class="t">${escapeHtml(t)}</div><div class="b">${escapeHtml(b)}</div>${
    i === 0
      ? `<div class="gd-store-links">
    <a class="gd-store-link" href="https://chromewebstore.google.com/detail/ai-tiktok-downloader-pro/cgnemfnpkodogmbpdchgejohnnpgamho" target="_blank" rel="noopener noreferrer">Chrome Web Store ↗</a>
    <a class="gd-store-link" href="https://microsoftedge.microsoft.com/addons/detail/ai-tiktok-downloader-pro/okmglmemcolofokocjhncoaibejejkkd" target="_blank" rel="noopener noreferrer">Microsoft Edge Add-ons ↗</a>
  </div>`
      : ''
  }</div>
</div>`,
  )
  .join('')}
</div>
${sections
  .map(
    ([title, cards]) => `<div class="card" style="margin-bottom:16px">
  <h2 style="font-size:15px;margin:0 0 12px">${escapeHtml(title)}</h2>
  <div class="gd-grid">
${cards
  .map(
    ([t, b, href]) => `    <a class="gd-card" href="${href}">
      <div class="t">${escapeHtml(t)}</div>
      <div class="b">${escapeHtml(b)}</div>
      <div class="go">${st('gd_go')} →</div>
    </a>`,
  )
  .join('\n')}
  </div>
</div>`,
  )
  .join('')}
<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('gd_faq_t')}</h2>
${faqs
  .map(
    ([q, a]) => `<div class="faq"><div class="q">${escapeHtml(q)}</div><div class="a">${escapeHtml(a)}</div></div>`,
  )
  .join('')}
</div>`,
      script: `
var KEY = 'kol_guide_done';
var total = ${steps.length};
function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e){ return []; } }
function save(v){ try { localStorage.setItem(KEY, JSON.stringify(v)); } catch(e){} }
function paint(){
  var done = load();
  document.querySelectorAll('.step').forEach(function(s){
    s.classList.toggle('done', done.indexOf(Number(s.dataset.i)) >= 0);
  });
  var pct = Math.round(done.length / total * 100);
  document.getElementById('gd-bar').style.width = pct + '%';
  document.getElementById('gd-pct').textContent = pct + '%';
}
document.querySelectorAll('.step').forEach(function(s){
  s.addEventListener('click', function(){
    var i = Number(s.dataset.i), done = load(), at = done.indexOf(i);
    if (at >= 0) done.splice(at, 1); else done.push(i);
    save(done); paint();
  });
});
document.querySelectorAll('.gd-store-link').forEach(function(a){
  a.addEventListener('click', function(e){ e.stopPropagation(); });
});
paint();`,
    }),
  );
});

// ── 脚本分享页 ───────────────────────────────────────────────────────────────

r.get('/kol/script-editor/share', async (c) => {
  const { profile } = await ctx(c);
  const code = (c.req.query('shareCode') || '').trim();

  let body: string;
  if (!code) {
    body = `<div class="card">${emptyBlock(st('sc_none'))}</div>`;
  } else {
    const row = await c.env.DB.prepare(
      `SELECT creator_id, video_id, region FROM caption_shares WHERE share_code = ?1`,
    )
      .bind(code)
      .first<{ creator_id: string; video_id: string; region: string | null }>();

    if (!row) {
      body = `<div class="card">${emptyBlock(st('sc_none'))}</div>`;
    } else {
      const obj = await c.env.R2.get(`caption/${row.creator_id}/${row.video_id}.json`);
      const words: Array<{ start_time: number; end_time: number; text: string }> = obj
        ? await obj.json()
        : [];

      // creator_id 是数字 id，能反查到 uniqueId 才能拼出可打开的视频链接
      const creator = row.creator_id
        ? await c.env.DB.prepare(`SELECT unique_id FROM tk_creators WHERE creator_id = ?1`)
            .bind(row.creator_id)
            .first<{ unique_id: string | null }>()
        : null;
      const videoUrl = creator?.unique_id
        ? `https://www.tiktok.com/@${encodeURIComponent(creator.unique_id)}/video/${encodeURIComponent(row.video_id)}`
        : null;

      const fmtT = (x: number) => {
        const sec = x > 36000 ? Math.floor(x / 1000) : Math.floor(x); // 兼容毫秒
        return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      };

      body = words.length
        ? `<div class="card">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
    <span class="chip blue">${st('sc_words', { n: words.length })}</span>
    ${row.region ? `<span class="chip">${escapeHtml(row.region)}</span>` : ''}
    <span style="flex:1"></span>
    ${videoUrl ? `<a class="btn ghost" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">${st('sc_open')}</a>` : ''}
    <button class="btn" id="copy-all">${st('sc_copy')}</button>
  </div>
  <div id="script-lines">
    ${words
      .map(
        (w) => `<div class="line"><span class="ts">${fmtT(w.start_time)}</span><span>${escapeHtml(w.text)}</span></div>`,
      )
      .join('')}
  </div>
</div>`
        : `<div class="card">${emptyBlock(st('sc_none'))}</div>`;
    }
  }

  return html(
    appPage({
      title: brandTitle(st('p_script_share')),
      path: pathOf(c),
      profile,
      style: `
  .line{display:flex;gap:14px;padding:7px 2px;border-bottom:1px solid var(--line);font-size:13.5px}
  .line:last-child{border-bottom:0}
  .ts{flex:0 0 46px;color:var(--muted);font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;padding-top:1px}
`,
      body: `<h1>${st('p_script_share')}</h1><p class="sub">${st('tl_script_sub')}</p>${body}`,
      script: `
var btn = document.getElementById('copy-all');
if (btn) btn.addEventListener('click', function(){
  var text = Array.prototype.map.call(document.querySelectorAll('#script-lines .line span:last-child'), function(x){ return x.textContent; }).join('\\n');
  navigator.clipboard.writeText(text).then(function(){
    btn.textContent = ${JSON.stringify(st('tl_copied'))};
  });
});`,
    }),
  );
});

// ── 工具页 ──────────────────────────────────────────────────────────────────

r.get('/tools/hashtag-generator', async (c) => {
  const { profile } = await ctx(c);
  // 数据源从 tk_video_tags 换成了 creator_tags：
  // 旧表把 kind 拼进了 tag（'challenge:xxx'），这里原样渲染出来就是
  // #challenge:xxx，用户复制到 TikTok 上根本不是个有效话题。
  // 新表 tag 只存干净的标签本体，kind 单独一列。
  //
  // 计数用 SUM(hit_count) 而不是 COUNT(*)：旧表没有唯一约束，同一个达人
  // 反复上报会重复插行把 COUNT 刷虚；新表按 (creator_id, kind, tag) 去重，
  // hit_count 才是这个标签真实的出现次数。
  const { results } = await c.env.DB.prepare(
    `SELECT tag, SUM(hit_count) n FROM creator_tags
      GROUP BY tag ORDER BY n DESC LIMIT 120`,
  ).all<{ tag: string; n: number }>();

  const rows = results ?? [];
  return html(
    appPage({
      title: brandTitle(st('nv_hashtag')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_hashtag') },
      profile,
      style: `
  .tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
  .tag{
    padding:5px 12px;border:1px solid var(--line);border-radius:var(--r-sm);cursor:pointer;
    font-family:var(--mono);font-size:12.5px;background:var(--card);color:var(--ink);
    transition:background .13s,color .13s,border-color .13s;
  }
  .tag:hover{background:var(--rule);color:var(--paper);border-color:var(--rule)}
  .tag .n{color:var(--muted);font-size:10.5px;margin-left:6px}
  .tag:hover .n{color:color-mix(in srgb,var(--paper) 70%,transparent)}
`,
      body: `<h1>${st('nv_hashtag')}</h1><p class="sub">${st('tl_hash_sub')}</p>
<div class="card">
  <input type="search" id="flt" placeholder="${st('tl_hash_ph')}">
  ${
    rows.length
      ? `<div class="tags" id="tags">
${rows
  .map(
    (row) =>
      `<button class="tag" data-tag="${escapeHtml(row.tag)}">#${escapeHtml(row.tag)}<span class="n">${fmtNum(row.n)}</span></button>`,
  )
  .join('')}
</div>`
      : `<div class="empty">${st('tl_hash_none')}</div>`
  }
</div>`,
      script: `
var flt = document.getElementById('flt');
if (flt) flt.addEventListener('input', function(){
  var q = flt.value.trim().toLowerCase();
  document.querySelectorAll('#tags .tag').forEach(function(t){
    t.style.display = !q || t.dataset.tag.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
  });
});
document.querySelectorAll('#tags .tag').forEach(function(t){
  t.addEventListener('click', function(){
    navigator.clipboard.writeText('#' + t.dataset.tag).then(function(){
      var old = t.innerHTML;
      t.textContent = ${JSON.stringify(st('tl_copied'))};
      setTimeout(function(){ t.innerHTML = old; }, 900);
    });
  });
});`,
    }),
  );
});

r.get('/tools/script-analysis', async (c) => {
  const { profile } = await ctx(c);
  const hows = [st('tl_script_how1'), st('tl_script_how2'), st('tl_script_how3')];
  return html(
    appPage({
      title: brandTitle(st('nv_ai_script')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_script') },
      profile,
      body: `<h1>${st('nv_ai_script')}</h1><p class="sub">${st('tl_script_sub')}</p>
<div class="card">
  ${hows
    .map(
      (h, i) => `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)">
    <span class="chip blue">${i + 1}</span><span style="font-size:13.5px">${escapeHtml(h)}</span>
  </div>`,
    )
    .join('')}
  <p style="margin:18px 0 0;display:flex;gap:10px">
    <a class="btn" href="https://www.tiktok.com" target="_blank" rel="noopener">${st('tl_open_tiktok')}</a>
    <a class="btn ghost" href="/kol/guide">${st('nv_guide')}</a>
  </p>
</div>`,
    }),
  );
});

/**
 * TikTok 视频下载。扩展里"下载失败点这里"的落地页 —— 原来那 18 处指向
 * mjjl.cn/DLtk37（跳原站 dl.kolsprite.com），现在指到这里。
 *
 * 解析走自己的 /v1/plugin/video/fetch_video_data_by_url（多源降级链，
 * 见 lib/tiktok-resolver.ts）；媒体字节由 /v1/plugin/video/media 同源流式转发，
 * Worker 不缓存、不落盘，避免用户浏览器直连 TikTok CDN 时整组失败。
 */
r.get('/tools/video-download', async (c) => {
  const { profile } = await ctx(c);
  const t = (k: string) => JSON.stringify(st(k));
  return html(
    appPage({
      title: brandTitle(st('nv_download')),
      path: pathOf(c),
      seo: { path: pathOf(c), desc: st('seo_desc_download') },
      profile,
      style: `
  .dlbar{display:flex;gap:10px;flex-wrap:wrap}
  .dlbar input{flex:1;min-width:260px}
  .dlres{margin-top:18px;display:none;gap:18px;flex-wrap:wrap}
  .dlres.on{display:flex}
  .dlcover{width:150px;aspect-ratio:9/16;object-fit:cover;border:1px solid var(--line);background:var(--rule)}
  .dlmeta{flex:1;min-width:240px}
  .dlmeta h3{margin:0 0 6px;font-size:15px;line-height:1.45}
  .dlstat{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-bottom:14px}
  .dlacts{display:flex;gap:10px;flex-wrap:wrap}
  .dlmsg{margin-top:14px;font-size:13px;color:var(--muted)}
  .dlmsg.err{color:var(--accent)}
`,
      body: `<h1>${st('nv_download')}</h1><p class="sub">${st('tl_dl_sub')}</p>
<div class="card">
  <div class="dlbar">
    <input type="url" id="dlurl" placeholder="${escapeHtml(st('tl_dl_ph'))}" autocomplete="off" spellcheck="false">
    <button class="btn ghost" id="dlpaste" type="button">${st('tl_dl_paste')}</button>
    <button class="btn" id="dlgo" type="button">${ic('download', 16)}${st('tl_dl_go')}</button>
  </div>
  <div class="dlmsg" id="dlmsg"></div>
  <div class="dlres" id="dlres">
    <img class="dlcover" id="dlcover" alt="">
    <div class="dlmeta">
      <h3 id="dltitle"></h3>
      <div class="dlstat" id="dlstat"></div>
      <div class="dlacts" id="dlacts"></div>
    </div>
  </div>
</div>
<p class="sub" style="margin-top:14px">${st('tl_dl_tip')}</p>
<div class="card" style="margin-top:18px">
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span class="chip blue">${st('pc_rights_plugin')}</span>
    <span style="flex:1;min-width:240px;font-size:13.5px">${st('tl_dl_ext')}</span>
    <a class="btn ghost" href="/kol/guide">${st('hm_cta_install')}</a>
  </div>
</div>`,
      script: `
var T = { url:${t('tl_dl_err_url')}, none:${t('tl_dl_err_none')}, fail:${t('tl_dl_err_fail')},
          loading:${t('tl_dl_loading')}, saving:${t('tl_dl_saving')},
          mp4:${t('tl_dl_mp4')}, hd:${t('tl_dl_hd')}, mp3:${t('tl_dl_mp3')}, cover:${t('tl_dl_cover')} };
var $ = function(id){ return document.getElementById(id); };
var msg = $('dlmsg'), res = $('dlres');

function say(text, isErr){ msg.textContent = text || ''; msg.className = 'dlmsg' + (isErr ? ' err' : ''); }

$('dlpaste').addEventListener('click', function(){
  navigator.clipboard.readText().then(function(v){ $('dlurl').value = v.trim(); }).catch(function(){});
});
$('dlurl').addEventListener('keydown', function(e){ if (e.key === 'Enter') go(); });
$('dlgo').addEventListener('click', go);

function go(){
  var raw = $('dlurl').value.trim();
  if (!/^https?:\\/\\/([a-z0-9-]+\\.)*tiktok\\.com\\//i.test(raw)) { res.className='dlres'; return say(T.url, true); }
  say(T.loading); res.className = 'dlres';
  fetch('/v1/plugin/video/fetch_video_data_by_url?url=' + encodeURIComponent(raw), { credentials:'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (!j || j.code !== 'OK') return say((j && j.message) || T.fail, true);
      if (!j.data) return say(T.none, true);
      render(j.data, raw); say('');
    })
    .catch(function(){ say(T.fail, true); });
}

function mediaUrl(sourceUrl, kind, filename){
  var q = new URLSearchParams({ url:sourceUrl, kind:kind });
  if (filename) { q.set('download', '1'); q.set('filename', filename); }
  return '/v1/plugin/video/media?' + q.toString();
}

function render(d, sourceUrl){
  var cover = (d.covers || [])[0] || '';
  var coverEl = $('dlcover');
  coverEl.style.display = cover ? '' : 'none';
  coverEl.dataset.fallback = cover;
  coverEl.dataset.triedFallback = '';
  coverEl.onerror = function(){
    if (this.dataset.fallback && !this.dataset.triedFallback) {
      this.dataset.triedFallback = '1';
      this.src = this.dataset.fallback;
      return;
    }
    this.style.display = 'none';
  };
  if (cover) coverEl.src = mediaUrl(sourceUrl, 'cover');
  $('dltitle').textContent = d.desc || '';
  var bits = [];
  if (d.authorName) bits.push('@' + (d.authorId || d.authorName));
  if (d.duration) bits.push(d.duration + 's');
  if (d.playCount) bits.push(Number(d.playCount).toLocaleString('en-US') + ' plays');
  $('dlstat').textContent = bits.join('  ·  ');

  // 文件名对齐扩展的默认规则：发布日期_作者_视频ID_标题；缺哪段省哪段，不留占位符
  var ts = Number(d.createTime) || (d.awemeId ? Math.floor(Number(d.awemeId) / 4294967296) : 0);
  var day = ts > 1420070400 && ts < Date.now() / 1000 + 172800
    ? new Date(ts * 1000).toISOString().slice(0, 10).replace(/-/g, '')
    : '';
  var title = String(d.desc || '');
  var cut = title.indexOf('#'); if (cut > 0) title = title.slice(0, cut);
  cut = title.indexOf('@'); if (cut > 0) title = title.slice(0, cut);
  title = title.replace(/[^\\p{L}\\p{N} ]+/gu, ' ').replace(/ +/g, ' ').trim().slice(0, 50);
  var name = [day, d.authorId, d.awemeId, title].filter(Boolean).join('_').slice(0, 100) || 'tiktok';
  var acts = [
    [(d.urls || [])[0], 'mp4', T.mp4, name + '.mp4', 'btn'],
    [(d.hdUrls || [])[0], 'hd', T.hd, name + '-hd.mp4', 'btn ghost'],
    [(d.musicList || [])[0], 'mp3', T.mp3, name + '.mp3', 'btn ghost'],
    [cover, 'cover', T.cover, name + '.jpg', 'btn ghost']
  ];
  // 标清和高清是同一条直链时只留一个按钮
  if (acts[1][0] && acts[1][0] === acts[0][0]) acts.splice(1, 1);

  var box = $('dlacts'); box.innerHTML = '';
  acts.forEach(function(a){
    if (!a[0]) return;
    var b = document.createElement('a');
    b.className = a[4]; b.textContent = a[2];
    b.href = mediaUrl(sourceUrl, a[1], a[3]);
    b.target = '_blank'; b.rel = 'noopener'; b.download = a[3];
    b.addEventListener('click', function(){ say(T.saving); setTimeout(function(){ say(''); }, 1800); });
    box.appendChild(b);
  });
  res.className = 'dlres on';
}

// 搜索/详情页的「去下载」带 ?url= 跳过来，预填并直接解析
var pre = new URLSearchParams(location.search).get('url');
if (pre) { $('dlurl').value = pre; go(); }`,
    }),
  );
});

// ── 邮件建联 ────────────────────────────────────────────────────────────────
//
// 发信走用户自己绑定的邮箱 SMTP（lib/mail.ts），收信走 Cloudflare Email
// Routing → Worker email handler。为什么不是平台统一代发：2026-08 调研结论，
// 所有主流 ESP 的 AUP 都禁止冷邮件与爬取来源的收件人，平台代发必被封号。

const MAIL_CSS = `
  .ml-form{display:flex;flex-direction:column;gap:12px}
  .ml-row{display:flex;gap:12px;flex-wrap:wrap}
  .ml-row>*{flex:1;min-width:200px}
  .ml-lbl{font-size:12px;color:var(--muted);margin-bottom:4px;display:block}
  .ml-form textarea{font-size:14px;padding:10px 12px;border:1px solid var(--line);
    border-radius:var(--r-sm);background:var(--paper);color:var(--ink);resize:vertical;width:100%;font-family:inherit}
  .ml-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .ml-msg{font-size:13px;color:var(--muted)}
  .ml-thread{padding:12px 4px;border-bottom:1px solid var(--line)}
  .ml-thread:last-child{border-bottom:0}
  .ml-bubble{padding:12px 14px;border-radius:var(--r-md);margin-bottom:10px;font-size:13.5px;white-space:pre-wrap;word-break:break-word}
  .ml-bubble.out{background:color-mix(in srgb,var(--accent) 7%,transparent)}
  .ml-bubble.in{border:1px solid var(--line)}
  .ml-bubble .h{font-size:11.5px;color:var(--muted);margin-bottom:6px;font-family:var(--mono)}
`;

/** 发信邮箱绑定卡片。所有邮件页共用，未绑定时显示表单，绑定后显示状态。 */
function mailAccountCard(
  account: { email: string; from_name: string | null; smtp_host: string; smtp_port: number } | null,
  used: number,
): string {
  if (account) {
    return `<div class="card">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span class="chip green">${st('ml_bound_as')}</span>
    <strong>${escapeHtml(account.email)}</strong>
    <span style="color:var(--muted);font-size:12px">${escapeHtml(account.smtp_host)}:${account.smtp_port}</span>
    <span class="chip" style="margin-left:auto">${st('ml_quota_today', { n: used, cap: SEND_DAILY_CAP })}</span>
    <button class="btn ghost" id="ml-unbind" type="button">${st('ml_unbind')}</button>
  </div>
  <p class="sub" style="margin:10px 0 0">${st('ml_cap_why')}</p>
</div>`;
  }
  return `<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('ml_bind_title')}</h2>
  <p class="sub" style="margin:0 0 14px">${st('ml_bind_hint')}</p>
  <form class="ml-form" id="ml-acct">
    <div class="ml-row">
      <div><label class="ml-lbl">${st('ml_f_email')}</label><input type="email" id="ma-email" required></div>
      <div><label class="ml-lbl">${st('ml_f_name')}</label><input type="text" id="ma-name"></div>
    </div>
    <div class="ml-row">
      <div><label class="ml-lbl">${st('ml_f_host')}</label><input type="text" id="ma-host" placeholder="smtp.gmail.com" required></div>
      <div style="max-width:120px"><label class="ml-lbl">${st('ml_f_port')}</label><input type="number" id="ma-port" value="587"></div>
    </div>
    <div class="ml-row">
      <div><label class="ml-lbl">${st('ml_f_user')}</label><input type="text" id="ma-user" placeholder="${escapeHtml(st('ml_f_user_ph'))}"></div>
      <div><label class="ml-lbl">${st('ml_f_pass')}</label><input type="password" id="ma-pass" required></div>
    </div>
    <div class="ml-acts">
      <button class="btn" type="submit">${st('ml_save')}</button>
      <span class="ml-msg" id="ma-msg">${st('ml_gmail_tip')}</span>
    </div>
  </form>
</div>`;
}

/** 绑定/解绑的前端脚本，各邮件页共用。 */
const MAIL_ACCOUNT_JS = `
var acctForm = document.getElementById('ml-acct');
if (acctForm) acctForm.addEventListener('submit', function(ev){
  ev.preventDefault();
  var msg = document.getElementById('ma-msg');
  msg.textContent = '…';
  fetch('/kol/api/mail/account', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({email:document.getElementById('ma-email').value.trim(),
      from_name:document.getElementById('ma-name').value.trim(),
      smtp_host:document.getElementById('ma-host').value.trim(),
      smtp_port:Number(document.getElementById('ma-port').value)||587,
      smtp_user:document.getElementById('ma-user').value.trim(),
      smtp_pass:document.getElementById('ma-pass').value})})
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.code==='OK') location.reload(); else msg.textContent = j.message || 'error'; })
    .catch(function(){ msg.textContent = 'error'; });
});
var unbindBtn = document.getElementById('ml-unbind');
if (unbindBtn) unbindBtn.addEventListener('click', function(){
  unbindBtn.disabled = true;
  fetch('/kol/api/mail/account/delete', {method:'POST', credentials:'same-origin'})
    .then(function(){ location.reload(); });
});
`;

type MailAcctLite = { email: string; from_name: string | null; smtp_host: string; smtp_port: number } | null;

/** 各邮件页共用的上下文：登录用户 + 绑定的发信账号 + 今日已发数。 */
async function mailCtx(c: Context<{ Bindings: Env; Variables: { user: UserRow | null } }>) {
  const { user, profile } = await ctx(c);
  if (!user) return { user: null, profile, account: null as MailAcctLite, used: 0 };
  const [account, used] = await Promise.all([
    c.env.DB.prepare(
      `SELECT email, from_name, smtp_host, smtp_port FROM mail_accounts
        WHERE user_id = ?1 AND status = 'active'`,
    )
      .bind(user.id)
      .first<NonNullable<MailAcctLite>>(),
    sentToday(c.env, user.id),
  ]);
  return { user, profile, account: account ?? null, used };
}

/** 收件箱：线程列表；带 ?thread= 时展开该线程的往来消息。 */
r.get('/kol/mail', async (c) => {
  const { user, profile, account, used } = await mailCtx(c);
  const threadId = (c.req.query('thread') || '').slice(0, 64);

  let body: string;
  let script = '';
  if (!user) {
    body = loginGate();
  } else if (threadId) {
    const thread = await c.env.DB.prepare(
      `SELECT id, peer_email, subject FROM mail_threads WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(threadId, user.id)
      .first<{ id: string; peer_email: string; subject: string | null }>();
    if (!thread) {
      body = `<div class="card">${emptyBlock(st('ml_inbox_none'))}</div>`;
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT dir, status, from_addr, subject, body_text, created_at FROM mail_messages
          WHERE thread_id = ?1 AND user_id = ?2 AND status <> 'draft' ORDER BY created_at ASC LIMIT 100`,
      )
        .bind(threadId, user.id)
        .all<{
          dir: string;
          status: string;
          from_addr: string | null;
          subject: string | null;
          body_text: string | null;
          created_at: number;
        }>();
      const msgs = (results ?? [])
        .map(
          (m) => `<div class="ml-bubble ${m.dir === 'out' ? 'out' : 'in'}">
  <div class="h">${escapeHtml(m.from_addr || '—')} · ${fmtDate(m.created_at)}${
            m.status === 'failed' ? ` · <span style="color:var(--danger)">${st('st_failed')}</span>` : ''
          }</div>
  ${m.subject ? `<strong>${escapeHtml(m.subject)}</strong><br>` : ''}${escapeHtml(m.body_text || '')}
</div>`,
        )
        .join('');
      body = `${mailAccountCard(account, used)}
<div class="card">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <strong>${escapeHtml(thread.peer_email)}</strong>
    <a class="btn ghost" style="margin-left:auto" href="/kol/create-mail?to=${encodeURIComponent(thread.peer_email)}&subject=${encodeURIComponent(thread.subject ? `Re: ${thread.subject}` : '')}">${st('ml_reply')}</a>
  </div>
  ${msgs || emptyBlock(st('ml_inbox_none'))}
</div>`;
      script = `${MAIL_ACCOUNT_JS}
fetch('/kol/api/mail/thread/read', {method:'POST', headers:{'Content-Type':'application/json'},
  credentials:'same-origin', body: JSON.stringify({threadId:${JSON.stringify(threadId)}})}).catch(function(){});`;
    }
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT id, peer_email, subject, msg_count, unread, last_at FROM mail_threads
        WHERE user_id = ?1 ORDER BY last_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<{
        id: string;
        peer_email: string;
        subject: string | null;
        msg_count: number;
        unread: number;
        last_at: number;
      }>();
    const rows = results ?? [];
    body = `${mailAccountCard(account, used)}
<div class="card">${
      rows.length
        ? rows
            .map(
              (t) => `<div class="ml-thread">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    ${t.unread ? `<span class="chip blue">${st('ml_unread')}</span>` : ''}
    <a href="/kol/mail?thread=${encodeURIComponent(t.id)}"><strong>${escapeHtml(t.peer_email)}</strong></a>
    <span style="color:var(--muted);font-size:13px">${escapeHtml(t.subject || '—')}</span>
    <span style="margin-left:auto;color:var(--muted);font-size:12px">${st('ml_msgs_n', { n: t.msg_count })} · ${fmtDate(t.last_at)}</span>
  </div>
</div>`,
            )
            .join('')
        : emptyBlock(st('ml_inbox_none'), st('ml_bind_hint'))
    }</div>`;
    script = MAIL_ACCOUNT_JS;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_inbox')),
      path: pathOf(c),
      profile,
      style: MAIL_CSS,
      body: `<h1>${st('nv_inbox')}</h1><p class="sub">${st('gp_mailbox')}</p>${body}`,
      script: script || undefined,
    }),
  );
});

/** 写信：模板套用 + 联系人选择 + 发送/存草稿。?to= &subject= &draft= 预填。 */
r.get('/kol/create-mail', async (c) => {
  const { user, profile, account, used } = await mailCtx(c);
  const preTo = (c.req.query('to') || '').slice(0, 320);
  const preSubject = (c.req.query('subject') || '').slice(0, 500);
  const draftId = (c.req.query('draft') || '').slice(0, 64);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const [tpls, contacts, draft] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, title, subject, body FROM mail_templates
          WHERE user_id IS NULL OR user_id = ?1 ORDER BY user_id IS NULL DESC, updated_at DESC LIMIT 50`,
      )
        .bind(user.id)
        .all<{ id: string; title: string; subject: string; body: string }>(),
      c.env.DB.prepare(
        `SELECT email, name, handle FROM mail_contacts
          WHERE user_id = ?1 AND email IS NOT NULL ORDER BY created_at DESC LIMIT 200`,
      )
        .bind(user.id)
        .all<{ email: string; name: string | null; handle: string | null }>(),
      draftId
        ? c.env.DB.prepare(
            `SELECT to_addr, subject, body_text FROM mail_messages
              WHERE id = ?1 AND user_id = ?2 AND status = 'draft'`,
          )
            .bind(draftId, user.id)
            .first<{ to_addr: string | null; subject: string | null; body_text: string | null }>()
        : Promise.resolve(null),
    ]);

    const tplList = tpls.results ?? [];
    const contactList = contacts.results ?? [];
    body = `${mailAccountCard(account, used)}
<div class="card">
  <form class="ml-form" id="ml-send">
    <div class="ml-row">
      <div>
        <label class="ml-lbl">${st('ml_to')}</label>
        <input type="email" id="mc-to" value="${escapeHtml(draft?.to_addr || preTo)}" required>
      </div>
      <div>
        <label class="ml-lbl">${st('ml_pick_contact')}</label>
        <select id="mc-contact">
          <option value="">—</option>
          ${contactList
            .map(
              (ct) =>
                `<option value="${escapeHtml(ct.email)}" data-name="${escapeHtml(ct.name || '')}" data-handle="${escapeHtml(ct.handle || '')}">${escapeHtml(ct.name || ct.handle || ct.email)}</option>`,
            )
            .join('')}
        </select>
      </div>
    </div>
    <div class="ml-row">
      <div>
        <label class="ml-lbl">${st('ml_use_template')}</label>
        <select id="mc-tpl"><option value="">—</option>${tplList
          .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`)
          .join('')}</select>
      </div>
    </div>
    <div>
      <label class="ml-lbl">${st('ml_subject')}</label>
      <input type="text" id="mc-subject" value="${escapeHtml(draft?.subject || preSubject)}" required>
    </div>
    <div>
      <label class="ml-lbl">${st('ml_body')}</label>
      <textarea id="mc-body" rows="12" required>${escapeHtml(draft?.body_text || '')}</textarea>
    </div>
    <div class="ml-acts">
      <button class="btn" type="submit" id="mc-send">${st('ml_send')}</button>
      <button class="btn ghost" type="button" id="mc-draft">${st('ml_save_draft')}</button>
      <span class="ml-msg" id="mc-msg"></span>
    </div>
  </form>
</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_create_mail')),
      path: pathOf(c),
      profile,
      style: MAIL_CSS,
      body: `<h1>${st('nv_create_mail')}</h1><p class="sub">${st('gp_mailbox')}</p>${body}`,
      script: user
        ? `${MAIL_ACCOUNT_JS}
var TPL = ${JSON.stringify(
            (
              await c.env.DB.prepare(
                `SELECT id, subject, body FROM mail_templates
                  WHERE user_id IS NULL OR user_id = ?1 ORDER BY user_id IS NULL DESC, updated_at DESC LIMIT 50`,
              )
                .bind(user.id)
                .all<{ id: string; subject: string; body: string }>()
            ).results ?? [],
          )};
var T = { sent:${JSON.stringify(st('ml_sent_ok'))}, saved:${JSON.stringify(st('ml_saved'))}, err:${JSON.stringify(st('ks_err'))} };
var $ = function(id){ return document.getElementById(id); };
var DRAFT_ID = ${JSON.stringify(draftId || '')};

// 选联系人：填收件人，并把正文里的 {name}/{handle} 换成这个人的信息
$('mc-contact').addEventListener('change', function(){
  var opt = this.selectedOptions[0];
  if (!opt || !opt.value) return;
  $('mc-to').value = opt.value;
  var name = opt.getAttribute('data-name') || '';
  var handle = opt.getAttribute('data-handle') || '';
  $('mc-body').value = $('mc-body').value.split('{name}').join(name).split('{handle}').join(handle);
  $('mc-subject').value = $('mc-subject').value.split('{name}').join(name).split('{handle}').join(handle);
});

$('mc-tpl').addEventListener('change', function(){
  var hit = TPL.filter(function(t){ return t.id === this.value; }.bind(this))[0];
  if (!hit) return;
  $('mc-subject').value = hit.subject;
  $('mc-body').value = hit.body;
});

function payload(){
  return { to: $('mc-to').value.trim(), subject: $('mc-subject').value.trim(),
    text: $('mc-body').value, draftId: DRAFT_ID || undefined };
}
$('ml-send').addEventListener('submit', function(ev){
  ev.preventDefault();
  var btn = $('mc-send'), msg = $('mc-msg');
  btn.disabled = true; msg.textContent = '…';
  fetch('/kol/api/mail/send', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify(payload())})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.code === 'OK') { msg.textContent = T.sent; setTimeout(function(){ location.href = '/kol/mail'; }, 800); }
      else { btn.disabled = false; msg.textContent = j.message || T.err; }
    })
    .catch(function(){ btn.disabled = false; msg.textContent = T.err; });
});
$('mc-draft').addEventListener('click', function(){
  var msg = $('mc-msg');
  var b = payload(); b.id = DRAFT_ID || undefined;
  fetch('/kol/api/mail/draft', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify(b)})
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.code === 'OK') { DRAFT_ID = j.data.id; msg.textContent = T.saved; } else msg.textContent = j.message || T.err; })
    .catch(function(){ msg.textContent = T.err; });
});`
        : undefined,
    }),
  );
});

/** 草稿箱 / 发件箱：同一张表，按 status 分。 */
for (const [path, titleKey, status, emptyKey] of [
  ['/kol/draft-mail', 'nv_drafts', 'draft', 'ml_drafts_none'],
  ['/kol/send-mail', 'nv_sent', 'sent', 'ml_sent_none'],
] as const) {
  r.get(path, async (c) => {
    const { user, profile, account, used } = await mailCtx(c);

    let body: string;
    if (!user) {
      body = loginGate();
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT id, thread_id, to_addr, subject, body_text, status, error, created_at
           FROM mail_messages
          WHERE user_id = ?1 AND dir = 'out' AND status IN (?2, 'failed')
          ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(user.id, status)
        .all<{
          id: string;
          thread_id: string | null;
          to_addr: string | null;
          subject: string | null;
          body_text: string | null;
          status: string;
          error: string | null;
          created_at: number;
        }>();
      // draft 页只列草稿；sent 页把发失败的一并列出来，否则用户不知道信没发出去
      const rows = (results ?? []).filter((m) => (status === 'draft' ? m.status === 'draft' : m.status !== 'draft'));
      body = `${mailAccountCard(account, used)}
<div class="card">${
        rows.length
          ? `<table>
<tr><th>${st('ml_to')}</th><th>${st('ml_subject')}</th><th>${st('tb_created')}</th><th></th></tr>
${rows
  .map(
    (m) => `<tr>
  <td>${escapeHtml(m.to_addr || '—')}</td>
  <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.subject || '—')}${
      m.status === 'failed'
        ? `<div style="color:var(--danger);font-size:12px">${escapeHtml((m.error || st('st_failed')).slice(0, 120))}</div>`
        : ''
    }</td>
  <td>${fmtDate(m.created_at)}</td>
  <td>${
    status === 'draft'
      ? `<a href="/kol/create-mail?draft=${encodeURIComponent(m.id)}">${st('ml_edit')}</a>
         <a href="#" data-del="${escapeHtml(m.id)}" style="margin-left:10px;color:var(--danger)">${st('ml_delete')}</a>`
      : m.thread_id
        ? `<a href="/kol/mail?thread=${encodeURIComponent(m.thread_id)}">${st('ml_open')}</a>`
        : ''
  }</td>
</tr>`,
  )
  .join('')}
</table>`
          : emptyBlock(st(emptyKey))
      }</div>`;
    }

    return html(
      appPage({
        title: brandTitle(st(titleKey)),
        path: pathOf(c),
        profile,
        style: MAIL_CSS,
        body: `<h1>${st(titleKey)}</h1><p class="sub">${st('gp_mailbox')}</p>${body}`,
        script: user
          ? `${MAIL_ACCOUNT_JS}
document.addEventListener('click', function(ev){
  var a = ev.target.closest && ev.target.closest('[data-del]');
  if (!a) return;
  ev.preventDefault();
  fetch('/kol/api/mail/draft/delete', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify({id: a.getAttribute('data-del')})})
    .then(function(){ location.reload(); });
});`
          : undefined,
      }),
    );
  });
}

/** 建联模板：系统模板 + 自定义模板。 */
r.get('/kol/temp', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT id, user_id, title, subject, body, lang, stage, updated_at FROM mail_templates
        WHERE user_id IS NULL OR user_id = ?1
        ORDER BY user_id IS NULL DESC, updated_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<{
        id: string;
        user_id: string | null;
        title: string;
        subject: string;
        body: string;
        lang: string | null;
        stage: string | null;
        updated_at: number;
      }>();
    const rows = results ?? [];
    body = `<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('ml_tpl_new')}</h2>
  <p class="sub" style="margin:0 0 12px">${st('ml_tpl_vars')}</p>
  <form class="ml-form" id="ml-tpl">
    <div class="ml-row">
      <div><label class="ml-lbl">${st('ml_tpl_title')}</label><input type="text" id="mt-title" required></div>
      <div><label class="ml-lbl">${st('ml_tpl_stage')}</label><input type="text" id="mt-stage"></div>
      <div><label class="ml-lbl">${st('ml_tpl_lang')}</label><input type="text" id="mt-lang" placeholder="en"></div>
    </div>
    <div><label class="ml-lbl">${st('ml_subject')}</label><input type="text" id="mt-subject" required></div>
    <div><label class="ml-lbl">${st('ml_body')}</label><textarea id="mt-body" rows="8" required></textarea></div>
    <div class="ml-acts">
      <button class="btn" type="submit">${st('ml_save')}</button>
      <span class="ml-msg" id="mt-msg"></span>
    </div>
  </form>
</div>
<div class="card">${
      rows.length
        ? `<table>
<tr><th>${st('ml_tpl_title')}</th><th>${st('ml_subject')}</th><th>${st('ml_tpl_stage')}</th><th>${st('tb_updated')}</th><th></th></tr>
${rows
  .map(
    (t) => `<tr>
  <td>${escapeHtml(t.title)} <span class="chip ${t.user_id ? 'blue' : ''}">${t.user_id ? st('ml_tpl_mine') : st('ml_tpl_sys')}</span></td>
  <td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.subject)}</td>
  <td>${escapeHtml(t.stage || '—')}</td>
  <td>${fmtDate(t.updated_at)}</td>
  <td>${
    t.user_id
      ? `<a href="#" data-del-tpl="${escapeHtml(t.id)}" style="color:var(--danger)">${st('ml_delete')}</a>`
      : ''
  }</td>
</tr>`,
  )
  .join('')}
</table>`
        : emptyBlock(st('ml_tpl_none'))
    }</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_temp')),
      path: pathOf(c),
      profile,
      style: MAIL_CSS,
      body: `<h1>${st('nv_temp')}</h1><p class="sub">${st('gp_mailbox')}</p>${body}`,
      script: user
        ? `
var T = { saved:${JSON.stringify(st('ml_saved'))}, err:${JSON.stringify(st('ks_err'))} };
document.getElementById('ml-tpl').addEventListener('submit', function(ev){
  ev.preventDefault();
  var msg = document.getElementById('mt-msg');
  msg.textContent = '…';
  fetch('/kol/api/mail/template', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({title:document.getElementById('mt-title').value.trim(),
      subject:document.getElementById('mt-subject').value.trim(),
      body:document.getElementById('mt-body').value,
      stage:document.getElementById('mt-stage').value.trim(),
      lang:document.getElementById('mt-lang').value.trim()})})
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.code==='OK') location.reload(); else msg.textContent = j.message || T.err; })
    .catch(function(){ msg.textContent = T.err; });
});
document.addEventListener('click', function(ev){
  var a = ev.target.closest && ev.target.closest('[data-del-tpl]');
  if (!a) return;
  ev.preventDefault();
  fetch('/kol/api/mail/template/delete', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify({id: a.getAttribute('data-del-tpl')})})
    .then(function(){ location.reload(); });
});`
        : undefined,
    }),
  );
});

/** 导入我的达人：粘贴 CSV → mail_contacts。 */
r.get('/kol/import', async (c) => {
  const { user, profile } = await ctx(c);

  let body: string;
  if (!user) {
    body = loginGate();
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT id, email, name, handle, region, contacted_at, created_at FROM mail_contacts
        WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(user.id)
      .all<{
        id: string;
        email: string | null;
        name: string | null;
        handle: string | null;
        region: string | null;
        contacted_at: number | null;
        created_at: number;
      }>();
    const rows = results ?? [];
    body = `<div class="card">
  <h2 style="font-size:15px;margin:0 0 6px">${st('ml_import_title')}</h2>
  <p class="sub" style="margin:0 0 12px">${st('ml_import_hint')}</p>
  <form class="ml-form" id="ml-imp">
    <textarea id="mi-rows" rows="8" placeholder="creator@example.com,Jane,janedoe,US"></textarea>
    <div class="ml-acts">
      <button class="btn" type="submit">${st('ml_import_btn')}</button>
      <span class="ml-msg" id="mi-msg"></span>
    </div>
  </form>
</div>
<div class="card">${
      rows.length
        ? `<table>
<tr><th>${st('ml_peer')}</th><th>${st('tb_region')}</th><th>${st('tb_status')}</th><th>${st('tb_created')}</th><th></th></tr>
${rows
  .map(
    (ct) => `<tr>
  <td>${escapeHtml(ct.name || ct.handle || ct.email || '—')}${
      ct.email
        ? `<div style="color:var(--muted);font-size:12px">${escapeHtml(ct.email)}</div>`
        : `<div><span class="chip">${st('ml_no_email')}</span></div>`
    }</td>
  <td>${escapeHtml(ct.region || '—')}</td>
  <td>${
    ct.contacted_at
      ? `<span class="chip green">${st('ml_contacted')}</span>`
      : `<span class="chip">${st('ml_not_contacted')}</span>`
  }</td>
  <td>${fmtDate(ct.created_at)}</td>
  <td>${
    ct.email
      ? `<a href="/kol/create-mail?to=${encodeURIComponent(ct.email)}">${st('ml_write_to')}</a>`
      : ct.handle
        ? `<a href="/kol/kol-detail/${encodeURIComponent(ct.handle)}">${st('ks_detail')}</a>`
        : ''
  }</td>
</tr>`,
  )
  .join('')}
</table>`
        : emptyBlock(st('ml_contacts_none'))
    }</div>`;
  }

  return html(
    appPage({
      title: brandTitle(st('nv_import')),
      path: pathOf(c),
      profile,
      style: MAIL_CSS,
      body: `<h1>${st('nv_import')}</h1><p class="sub">${st('gp_mailbox')}</p>${body}`,
      script: user
        ? `
var T = { done:${JSON.stringify(st('ml_import_done'))}, err:${JSON.stringify(st('ks_err'))} };
document.getElementById('ml-imp').addEventListener('submit', function(ev){
  ev.preventDefault();
  var msg = document.getElementById('mi-msg');
  // CSV 解析放前端：每行 email,name,handle,region；带表头也没关系，
  // 首行如果不含 @ 且没有 handle 会被后端当无效行丢掉
  var rows = document.getElementById('mi-rows').value.split('\\n')
    .map(function(line){ return line.split(','); })
    .filter(function(cols){ return cols.length && cols.join('').trim(); })
    .map(function(cols){
      return { email:(cols[0]||'').trim(), name:(cols[1]||'').trim(),
        handle:(cols[2]||'').trim(), region:(cols[3]||'').trim() };
    });
  if (!rows.length) return;
  msg.textContent = '…';
  fetch('/kol/api/mail/contacts/import', {method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'same-origin', body: JSON.stringify({rows: rows})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.code === 'OK') {
        msg.textContent = T.done.replace('{received}', j.data.received).replace('{added}', j.data.added);
        setTimeout(function(){ location.reload(); }, 1000);
      } else msg.textContent = j.message || T.err;
    })
    .catch(function(){ msg.textContent = T.err; });
});`
        : undefined,
    }),
  );
});

export default r;
