import type { UserProfile } from '../lib/types';
import { st, htmlLang } from './i18n';
import { escapeHtml, BASE_CSS, BRAND_NAME, LANG_MENU, langHref, seoHead, type SeoMeta } from './layout';
import { LOGO_ICON, ic } from './assets';

/**
 * /kol 应用页的外壳：顶部导航（对照原站 kolsprite.com 的菜单结构）+ 页脚。
 *
 * 原站是 umi SPA，导航是「看板 / 选品 / 找达人 / 建联 / 工具」五个一级项，
 * 后四个 hover 展开分组面板（menu 数据见 umi bundle 里的 `ve` 数组）。
 * 这里用纯 CSS 的 :hover/:focus-within 还原同样的结构，不引任何 JS 框架。
 *
 * 视觉体系见 layout.ts 顶部注释（「情报纸」，BASE_CSS 是共用底座）。
 * 组件类名（.card/.chip/.btn/.tabs-line/.empty…）保持稳定，
 * 各页面的局部样式都建立在这套类名和 CSS 变量上。
 *
 * 登录态由调用方传 profile（null = 未登录，右上角显示登录按钮）。
 */

interface NavLink {
  label: string;
  href: string;
}
interface NavGroup {
  title: string;
  links: NavLink[];
}
interface NavItem {
  label: string;
  href?: string;
  groups?: NavGroup[];
}

function navData(): NavItem[] {
  return [
    { label: st('nv_dashboard'), href: '/kol/workbench' },
    {
      label: st('nv_products'),
      groups: [
        {
          title: st('gp_product_lib'),
          links: [
            { label: st('nv_product_search'), href: '/kol/product-search' },
            { label: st('nv_shop_search'), href: '/kol/shop-search' },
            { label: st('nv_product_fav'), href: '/kol/collect?type=PRODUCT' },
            { label: st('nv_shop_fav'), href: '/kol/collect?type=SHOP' },
          ],
        },
        {
          title: st('gp_video_lib'),
          links: [
            { label: st('nv_video_search'), href: '/kol/video-search' },
            { label: st('nv_video_fav'), href: '/kol/collect?type=VIDEO' },
            { label: st('nv_script_fav'), href: '/kol/collect?type=CAPTION' },
          ],
        },
        {
          title: st('gp_ranks'),
          links: [
            { label: st('nv_rank_products'), href: '/kol/product-rank' },
            { label: st('nv_rank_videos'), href: '/kol/video-rank' },
            { label: st('nv_calendar'), href: '/kol/calendar' },
          ],
        },
      ],
    },
    {
      label: st('nv_influencers'),
      groups: [
        {
          title: st('nv_kol_search'),
          links: [
            { label: st('nv_kol_search'), href: '/kol/search' },
            { label: st('nv_kol_fav'), href: '/kol/collect?type=CREATOR' },
          ],
        },
        {
          title: st('gp_ranks'),
          links: [
            { label: st('rk_t_fans'), href: '/kol/kol-rank?type=fansCnt' },
            { label: st('rk_t_growth30'), href: '/kol/kol-rank?type=fansLst30d' },
            { label: st('rk_t_avgplay'), href: '/kol/kol-rank?type=videoAvgPlay' },
            { label: st('rk_t_interact'), href: '/kol/kol-rank?type=interactionRate' },
          ],
        },
        {
          title: st('gp_kol_manage'),
          links: [
            { label: st('nv_cooperate'), href: '/kol/cooperate' },
            { label: st('nv_risk'), href: '/kol/risk' },
          ],
        },
      ],
    },
    {
      label: st('nv_outreach'),
      groups: [
        {
          title: st('gp_campaign'),
          links: [
            { label: st('nv_promotional'), href: '/kol/promotional' },
            { label: st('nv_coop_active'), href: '/kol/cooperateactive' },
            { label: st('nv_batch_tasks'), href: '/kol/task' },
          ],
        },
        {
          title: st('gp_mailbox'),
          links: [
            { label: st('nv_create_mail'), href: '/kol/create-mail' },
            { label: st('nv_inbox'), href: '/kol/mail' },
            { label: st('nv_drafts'), href: '/kol/draft-mail' },
            { label: st('nv_sent'), href: '/kol/send-mail' },
            { label: st('nv_temp'), href: '/kol/temp' },
            { label: st('nv_import'), href: '/kol/import' },
          ],
        },
      ],
    },
    {
      label: st('nv_tools'),
      groups: [
        {
          title: st('gp_utils'),
          links: [
            { label: st('nv_download'), href: '/tools/video-download' },
            { label: st('nv_ai_script'), href: '/tools/script-analysis' },
            { label: st('nv_hashtag'), href: '/tools/hashtag-generator' },
            { label: st('nettest_h1'), href: '/tiktok-test' },
            { label: st('nv_guide'), href: '/kol/guide' },
          ],
        },
      ],
    },
  ];
}

export interface AppPageOptions {
  title: string;
  /** 当前请求的 path?query，用于导航高亮和语言切换回跳 */
  path: string;
  profile: UserProfile | null;
  body: string;
  /**
   * SEO 头。工作台页大多要登录、内容对爬虫是空壳，所以**默认 noindex**；
   * 公开且有内容的页（/tools/*、/kol/guide、/kol/search 落地页）显式传
   * { path, desc } 开启索引。
   */
  seo?: SeoMeta;
  style?: string;
  script?: string;
}

export function appPage(o: AppPageOptions): string {
  const curPath = o.path.split('?')[0];
  const nav = navData()
    .map((item) => {
      if (!item.groups) {
        const on = curPath === item.href;
        return `<a class="nv${on ? ' on' : ''}" href="${item.href}">${escapeHtml(item.label)}</a>`;
      }
      const on = item.groups.some((g) => g.links.some((l) => l.href.split('?')[0] === curPath));
      return `<div class="dd">
  <span class="nv${on ? ' on' : ''}" tabindex="0">${escapeHtml(item.label)}<i class="car"></i></span>
  <div class="dd-panel">
    <div class="dd-mm">
    ${item.groups
      .map(
        (g) => `<div class="dd-g">
      <div class="dd-t">${escapeHtml(g.title)}</div>
      ${g.links.map((l) => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('')}
    </div>`,
      )
      .join('')}
    </div>
  </div>
</div>`;
    })
    .join('');

  const userArea = o.profile
    ? `<div class="dd right-dd">
  <span class="avatar" tabindex="0" title="${escapeHtml(o.profile.email ?? o.profile.username)}">${escapeHtml(
        (o.profile.username || 'U').slice(0, 1).toUpperCase(),
      )}</span>
  <div class="dd-panel user-panel">
    <div class="dd-g">
      <div class="dd-t" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(
        o.profile.email ?? o.profile.username,
      )}</div>
      <div class="plan-chip">${escapeHtml(o.profile.planName)}</div>
      <a href="/kol/personal">${st('nv_personal')}</a>
      <a href="/price">${st('nav_price')}</a>
      <form method="post" action="/kol/logout" style="margin:0">
        <button class="linklike" type="submit">${st('nv_logout')}</button>
      </form>
    </div>
  </div>
</div>`
    : `<a class="login-btn" href="/kol/exlogin">${st('nv_login')}</a>`;

  const langArea = `<div class="dd right-dd">
  <span class="nv" tabindex="0" role="button" aria-label="${escapeHtml(st('nv_lang'))}">${ic('globe', 17)}<i class="car"></i></span>
  <div class="dd-panel lang-panel">
    <div class="dd-g">
      ${LANG_MENU.map(([code, name]) => `<a href="${escapeHtml(langHref(o.path, code))}">${name}</a>`).join('')}
    </div>
  </div>
</div>`;

  return `<!doctype html>
<html lang="${htmlLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)}</title>
${seoHead(o.title, o.seo ?? { path: o.path, noindex: true })}<link rel="icon" href="${LOGO_ICON}">
<style>
${BASE_CSS}
  body{display:flex;flex-direction:column}
  h1{font-size:23px}

  /* ── 顶部导航 ─────────────────────────────── */
  header{
    position:sticky; top:0; z-index:50; display:flex; align-items:center; gap:4px;
    padding:0 20px; height:54px; border-bottom:1px solid var(--line); background:var(--paper);
  }
  @supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){
    header{
      background:color-mix(in srgb,var(--paper) 72%,transparent);
      -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
    }
  }
  @media (prefers-reduced-transparency:reduce){
    header{background:var(--paper);-webkit-backdrop-filter:none;backdrop-filter:none}
  }
  header .logo{display:flex;align-items:center;gap:9px;margin-right:14px;text-decoration:none}
  header .logo:hover{color:inherit;text-decoration:none}
  header .logo img{height:24px;display:block}
  .brand{font-size:14px;font-weight:600;color:var(--ink);letter-spacing:-.2px;white-space:nowrap}
  @media (max-width:900px){.brand{display:none}}
  header .grow{flex:1}
  .nv{
    position:relative; display:inline-flex; align-items:center; gap:5px; padding:7px 11px;
    color:var(--ink); font-size:13px;
    cursor:pointer; white-space:nowrap; text-decoration:none;
  }
  .nv:hover{text-decoration:none}
  .nv::after{
    content:''; position:absolute; left:11px; right:11px; bottom:2px; height:2px; background:var(--accent);
    transform:scaleX(0); transform-origin:left; transition:transform .18s;
  }
  .nv:hover{color:var(--ink)}
  .nv:hover::after{transform:scaleX(1)}
  .nv.on{font-weight:700}
  .nv.on::after{transform:scaleX(1)}
  .car{
    width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
    border-top:5px solid currentColor;opacity:.55;margin-top:1px;
  }
  .dd{position:relative}
  .dd-panel{
    position:absolute; top:100%; left:50%; transform:translate(-50%,6px); padding-top:9px; z-index:60;
    display:flex; visibility:hidden; opacity:0; pointer-events:none;
    transition:opacity .16s, transform .16s, visibility .16s;
    width:max-content; max-width:calc(100vw - 24px);
  }
  .dd:hover .dd-panel, .dd:focus-within .dd-panel{visibility:visible;opacity:1;transform:translate(-50%,0);pointer-events:auto}
  .right-dd .dd-panel{left:auto;right:0;transform:translate(0,6px)}
  .right-dd:hover .dd-panel, .right-dd:focus-within .dd-panel{transform:translate(0,0)}
  .dd-panel > *{
    background:var(--card); border:1px solid var(--line); border-radius:var(--r-lg);
    box-shadow:var(--hard); padding:15px 18px; display:flex; gap:28px; flex-wrap:wrap;
  }
  .dd-g{display:flex;flex-direction:column;gap:8px;min-width:132px}
  .dd-t{
    font-size:12px;font-weight:600;
    color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:6px;white-space:nowrap;
  }
  .dd-g a{color:var(--ink);font-size:13px;white-space:nowrap;text-decoration:none;transition:transform .12s}
  .dd-g a:hover{color:var(--accent);transform:translateX(3px);text-decoration:none}
  .avatar{
    width:30px;height:30px;border-radius:var(--r-full);background:var(--primary);color:#fff;
    display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
    font-size:14px;font-weight:600;
  }
  .plan-chip{
    align-self:flex-start;padding:1px 9px;border-radius:var(--r-full);font-size:11px;font-family:var(--mono);
    letter-spacing:.05em;text-transform:uppercase;
    border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent);
  }
  .login-btn{
    padding:7px 18px;border-radius:var(--r-full);background:var(--primary);color:#fff;font-size:13px;font-weight:600;
    white-space:nowrap;text-decoration:none;transition:background .15s;
  }
  .login-btn:hover{color:#fff;background:var(--primary-dark);text-decoration:none}
  .linklike{
    background:none;border:0;padding:0;font:inherit;color:var(--danger);cursor:pointer;text-align:left;font-size:13px;
  }
  .linklike:hover{text-decoration:underline}

  /* ── 主体 ────────────────────────────────── */
  main{flex:1;width:100%;max-width:1180px;margin:0 auto;padding:28px 20px 56px}
  .card{
    background:var(--card);border:0;border-radius:var(--r-md);padding:22px 24px;
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 1px 3px rgba(0,0,0,.06);
  }
  .card h2{font-size:15px;font-weight:600;letter-spacing:-.01em}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{
    font-size:12px;
    color:var(--muted);font-weight:600;white-space:nowrap;border-bottom:1px solid var(--line);
  }
  tr:last-child td{border-bottom:0}
  tr:hover td{background:color-mix(in srgb,var(--ink) 3%,transparent)}
  .num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:12.5px}
  th.num{text-align:right;font-size:12px}
  .rk{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
  tr:nth-child(n+2):nth-child(-n+4) .rk{color:var(--accent)}
  .chip{
    display:inline-block;padding:1px 9px;border-radius:var(--r-full);white-space:nowrap;
    font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
    border:1px solid color-mix(in srgb,var(--muted) 50%,transparent);color:var(--muted);
    background:color-mix(in srgb,var(--muted) 6%,transparent);
  }
  .chip.blue{border-color:color-mix(in srgb,var(--info) 50%,transparent);color:var(--info);background:color-mix(in srgb,var(--info) 6%,transparent)}
  .chip.green{border-color:color-mix(in srgb,var(--ok) 50%,transparent);color:var(--ok);background:color-mix(in srgb,var(--ok) 6%,transparent)}
  .chip.orange{border-color:color-mix(in srgb,var(--warn) 50%,transparent);color:var(--warn);background:color-mix(in srgb,var(--warn) 7%,transparent)}
  .chip.red{border-color:color-mix(in srgb,var(--danger) 50%,transparent);color:var(--danger);background:color-mix(in srgb,var(--danger) 6%,transparent)}
  .empty{text-align:center;color:var(--muted);padding:36px 16px 40px;font-size:13px;line-height:2}
  .empty::before{content:'※';display:block;font-size:22px;color:color-mix(in srgb,var(--muted) 60%,transparent);margin-bottom:8px}
  .empty .big{font-family:var(--serif);font-size:16.5px;color:var(--ink);font-weight:700}
  .tabs-line{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
  .tabs-line a{
    padding:8px 13px;color:var(--muted);font-size:13px;font-weight:500;
    text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px;
  }
  .tabs-line a:hover{color:var(--ink);text-decoration:none}
  .tabs-line a.on{color:var(--ink);border-bottom-color:var(--accent);font-weight:700}
  .btn{
    display:inline-block;padding:8px 18px;border-radius:var(--r-sm);background:var(--primary);color:#fff;
    font-size:13px;font-weight:600;border:0;cursor:pointer;text-decoration:none;
    white-space:nowrap;transition:background .15s;
  }
  .btn:hover{color:#fff;background:var(--primary-dark);text-decoration:none}
  .btn:active{transform:scale(.98)}
  .btn.ghost{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}
  .btn.ghost:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 12%,transparent)}
  input[type=text],input[type=search],input[type=url],input[type=email],input[type=password],input[type=number],select{
    padding:9px 13px;font-size:14px;font-family:var(--sans);border:1px solid var(--line);border-radius:var(--r-sm);
    background:var(--paper);color:var(--ink);width:100%;
  }
  /* select 默认高度和内边距跟 input 对不齐，且系统箭头在暗色下看不见，统一画一个 */
  select{
    appearance:none;padding-right:32px;cursor:pointer;
    background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
    background-position:calc(100% - 17px) calc(50% + 1px),calc(100% - 12px) calc(50% + 1px);
    background-size:5px 5px,5px 5px;background-repeat:no-repeat;
  }
  input:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}

  footer{border-top:1px solid var(--line);background:var(--paper);padding:30px 20px 26px}
  .ft-cols{max-width:1180px;margin:0 auto;display:flex;gap:64px;flex-wrap:wrap;justify-content:center}
  .ft-cols .col{display:flex;flex-direction:column;gap:8px;font-size:13px}
  .ft-cols .t{
    font-size:12px;font-weight:600;
    color:var(--muted);margin-bottom:4px;
  }
  .ft-cols a{color:var(--ink);text-decoration:none}
  .ft-cols a:hover{color:var(--accent);text-decoration:none}
  .ft-bottom{
    max-width:1180px;margin:22px auto 0;color:var(--muted);border-top:1px solid var(--line);padding-top:16px;
    font-size:12px;text-align:center;
  }
  @media (max-width:760px){
    header{overflow-x:auto;scrollbar-width:none}
    header::-webkit-scrollbar{display:none}
    .dd-panel{position:fixed;left:12px;right:12px;top:54px;transform:none;max-width:none;width:auto}
    .dd:hover .dd-panel,.dd:focus-within .dd-panel{transform:none}
    .right-dd .dd-panel{transform:none}
  }
${o.style ?? ''}
</style>
</head>
<body>
<header>
  <a class="logo" href="/"><img src="${LOGO_ICON}" alt=""><span class="brand">${BRAND_NAME}</span></a>
  ${nav}
  <div class="grow"></div>
  <a class="nv" href="/price">${st('nav_price')}</a>
  <a class="nv${curPath === '/kol/message-center' ? ' on' : ''}" href="/kol/message-center">${st('nv_msg')}</a>
  ${langArea}
  ${userArea}
</header>
<main>${o.body}</main>
<footer>
  <div class="ft-cols">
    <div class="col">
      <div class="t">${st('nv_influencers')}</div>
      <a href="/kol/search">${st('nv_kol_search')}</a>
      <a href="/kol/kol-rank">${st('nv_kol_rank')}</a>
      <a href="/kol/collect?type=CREATOR">${st('nv_kol_fav')}</a>
      <a href="/kol/risk">${st('nv_risk')}</a>
    </div>
    <div class="col">
      <div class="t">${st('ft_col_outreach')}</div>
      <a href="/kol/promotional">${st('nv_promotional')}</a>
      <a href="/kol/cooperateactive">${st('nv_coop_active')}</a>
      <a href="/kol/task">${st('nv_batch_tasks')}</a>
    </div>
    <div class="col">
      <div class="t">${st('ft_col_product')}</div>
      <a href="/kol/product-search">${st('nv_product_search')}</a>
      <a href="/kol/video-search">${st('nv_video_search')}</a>
      <a href="/kol/calendar">${st('nv_calendar')}</a>
    </div>
    <div class="col">
      <div class="t">${st('ft_col_tools')}</div>
      <a href="/tools/video-download">${st('nv_download')}</a>
      <a href="/tools/script-analysis">${st('nv_ai_script')}</a>
      <a href="/tools/hashtag-generator">${st('nv_hashtag')}</a>
      <a href="/tiktok-test">${st('nettest_h1')}</a>
      <a href="/kol/guide">${st('nv_guide')}</a>
    </div>
  </div>
  <div class="ft-bottom">${st('footer', { brand: BRAND_NAME })}</div>
</footer>
${o.script ? `<script>${o.script}</script>` : ''}
</body>
</html>`;
}
