import { st, htmlLang } from './i18n';
import { LOGO_ICON, ic } from './assets';

/**
 * 官网页面的公共外壳（登录 / 套餐 / 卸载 / 网络检测 / 首页）。
 *
 * 视觉体系（2026-08 起）：苹果式浅灰纸面 —— #f5f5f7 页面底 + 纯白卡片 +
 * #1d1d1f 墨色，主色是品牌蓝（对齐插件 popup 的 #436ff6，取 #3a5fe0
 * 保证白字/白底两个方向的对比度都 ≥4.5:1）。圆角按尺寸分级
 * （--r-xs..--r-full），阴影宽而软，吸顶导航是磨砂材质。
 * 暗色 = 同一套语义 token 翻转（黑底 + #1c1c1e 卡片），不是简单反色。
 *
 * 旧「情报纸」的等宽数据排版保留（--mono 仍是数据/标签的脸），
 * --serif 令牌名保留但值已指向系统 San Francisco 栈 —— 各页面局部样式
 * 无需改动即整体换肤。CSP 禁外链资源，字体只能走系统字体栈。
 */

export const BRAND = {
  paper: '#f5f5f7',
  ink: '#1d1d1f',
  accent: '#3a5fe0',
  muted: '#6e6e73',
};

/** 全站唯一品牌名；标题、页头、页脚及 i18n 句内品牌都从这里注入。 */
export const BRAND_NAME = 'AI TikTok Downloader Pro';

export function brandTitle(title?: string): string {
  return title ? `${title} · ${BRAND_NAME}` : BRAND_NAME;
}

/**
 * 两套外壳（本文件的营销页 + shell.ts 的工作台页）共用的设计系统底座：
 * 令牌、暗色映射、排版、链接、选中色、入场动画。改这里等于全站换肤。
 */
export const BASE_CSS = `
  :root{
    --paper:#f5f5f7; --card:#ffffff; --ink:#1d1d1f; --muted:#6e6e73;
    --line:#d2d2d7; --rule:#1d1d1f;
    --accent:#3a5fe0; --accent-dark:#2b4bc4;
    --ok:#1e7d3b; --warn:#b25000; --info:#3a5fe0; --danger:#d70015;
    --primary:#3a5fe0; --primary-dark:#2b4bc4;
    --r-xs:6px; --r-sm:8px; --r-md:12px; --r-lg:16px; --r-full:999px;
    --hard:0 2px 4px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.08);
    --serif:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue','Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;
    --sans:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue','Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;
    --mono:ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --paper:#000000; --card:#1c1c1e; --ink:#f5f5f7; --muted:#a1a1a6;
      --line:#38383a; --rule:#f5f5f7;
      --accent:#7c9dff; --accent-dark:#9db4ff;
      --ok:#30d158; --warn:#ff9f0a; --info:#7c9dff; --danger:#ff453a;
      --primary:#3f64e6; --primary-dark:#5c7ef0;
      --hard:0 2px 4px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.45);
    }
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background-color:var(--paper); color:var(--ink); min-height:100vh;
    font:14px/1.7 var(--sans);
    -webkit-font-smoothing:antialiased;
  }
  ::selection{background:var(--primary);color:#fff}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .ic{vertical-align:-4px}
  h1{font-family:var(--serif);font-weight:700;letter-spacing:-.015em;line-height:1.25;margin:0 0 6px;word-break:break-word}
  .sub{font-size:13px;color:var(--muted);margin:0 0 22px}
  @media (prefers-reduced-motion:no-preference){
    main>*{animation:rise .45s cubic-bezier(.32,.72,0,1) backwards}
    main>*:nth-child(2){animation-delay:.06s}
    main>*:nth-child(3){animation-delay:.12s}
    main>*:nth-child(4){animation-delay:.18s}
    main>*:nth-child(n+5){animation-delay:.24s}
    @keyframes rise{from{opacity:0;transform:translateY(8px)}}
  }
`;

/**
 * SEO 头部：canonical / hreflang / description / OG / Twitter / JSON-LD / noindex。
 *
 * 域名收敛到 CANONICAL_ORIGIN —— tk.poviai.com 是给扩展用的别名（见 memory：
 * 登录握手必须留在 tiktok.poviai.com），浏览器两个域都能打开，搜索引擎只认这一个，
 * 靠 canonical 合并权重，不做跳转以免碰扩展。
 *
 * 语言方案：pageLang 按 ?lang= > plang cookie > Accept-Language 定语言，
 * 爬虫无 cookie，所以 `?lang=xx` 是九个语言版本的稳定入口 ——
 * hreflang 全部指向 ?lang= 变体，x-default 指裸路径（自动按 Accept-Language）。
 * canonical 只保留 lang 参数，utm_source 之类一律剥掉。
 */
export const CANONICAL_ORIGIN = 'https://tiktok.poviai.com';

/** [?lang= 参数值, hreflang 标注]。中文分简繁必须带地区，其余用大语种码覆盖更广。 */
const HREFLANG: Array<[string, string]> = [
  ['zh-CN', 'zh-CN'],
  ['zh-TW', 'zh-TW'],
  ['en-US', 'en'],
  ['ja-JP', 'ja'],
  ['ko-KR', 'ko'],
  ['vi-VN', 'vi'],
  ['id-ID', 'id'],
  ['es-ES', 'es'],
  ['pt-PT', 'pt'],
];

export interface SeoMeta {
  /** 当前请求的 path?query（canonical/hreflang 的原料） */
  path: string;
  /** 功能页（登录/表单/后台/账户）标 true：只输出 noindex，别的都省 */
  noindex?: boolean;
  /** i18n 过的 meta description；索引页应该都有 */
  desc?: string;
  /** 额外的 JSON-LD 对象（首页放 WebSite/SoftwareApplication） */
  jsonLd?: unknown[];
}

/** page()/appPage() 内部用：title 由外壳传入，别在路由里重复拼。 */
export function seoHead(title: string, seo: SeoMeta | undefined): string {
  if (!seo) return '';
  if (seo.noindex) return '<meta name="robots" content="noindex">\n';

  const [p, q = ''] = seo.path.split('?');
  const lang = new URLSearchParams(q).get('lang');
  const canonical = `${CANONICAL_ORIGIN}${p}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`;

  const parts: string[] = [];
  if (seo.desc) parts.push(`<meta name="description" content="${escapeHtml(seo.desc)}">`);
  parts.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  for (const [code, tag] of HREFLANG)
    parts.push(`<link rel="alternate" hreflang="${tag}" href="${escapeHtml(`${CANONICAL_ORIGIN}${p}?lang=${code}`)}">`);
  parts.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${CANONICAL_ORIGIN}${p}`)}">`);

  parts.push(`<meta property="og:type" content="website">`);
  parts.push(`<meta property="og:site_name" content="${escapeHtml(BRAND_NAME)}">`);
  parts.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
  if (seo.desc) parts.push(`<meta property="og:description" content="${escapeHtml(seo.desc)}">`);
  parts.push(`<meta property="og:url" content="${escapeHtml(canonical)}">`);
  parts.push(`<meta property="og:image" content="${CANONICAL_ORIGIN}/og.png">`);
  parts.push(`<meta property="og:image:width" content="1200">`);
  parts.push(`<meta property="og:image:height" content="630">`);
  parts.push(`<meta name="twitter:card" content="summary_large_image">`);
  parts.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`);
  if (seo.desc) parts.push(`<meta name="twitter:description" content="${escapeHtml(seo.desc)}">`);
  parts.push(`<meta name="twitter:image" content="${CANONICAL_ORIGIN}/og.png">`);

  for (const block of seo.jsonLd ?? [])
    parts.push(
      `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    );
  return parts.join('\n') + '\n';
}

/** 语言切换菜单：显示本族语名，点击带 ?lang= 回到当前页（plang cookie 会记住）。 */
export const LANG_MENU: Array<[string, string]> = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en-US', 'English'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['vi-VN', 'Tiếng Việt'],
  ['id-ID', 'Bahasa Indonesia'],
  ['es-ES', 'Español'],
  ['pt-PT', 'Português'],
];

export function langHref(path: string, code: string): string {
  const [p, q = ''] = path.split('?');
  const params = new URLSearchParams(q);
  params.set('lang', code);
  return `${p}?${params.toString()}`;
}

/**
 * 营销壳的语言下拉。没有服务端 path 可用，链接先写成 ?lang=xx
 * （浏览器按当前路径解析），页脚的小脚本再把当前 query 补回去，
 * 避免切语言时丢掉 utm_source 之类的参数。
 */
export function langNav(): string {
  return `<div class="lg-dd">
  <span class="lg-btn" tabindex="0" role="button" aria-label="${escapeHtml(st('nv_lang'))}">${ic('globe', 17)}<i class="lg-car"></i></span>
  <div class="lg-panel">
    ${LANG_MENU.map(([code, name]) => `<a href="?lang=${code}" data-lang="${code}">${name}</a>`).join('')}
  </div>
</div>`;
}

/** 把当前页面的 query 参数补回语言链接（保留 utm_source 等）。 */
export const LANG_LINK_SCRIPT = `document.querySelectorAll('a[data-lang]').forEach(function(a){
  try{var u=new URL(location.href);u.searchParams.set('lang',a.getAttribute('data-lang'));a.href=u.pathname+u.search;}catch(e){}
});`;

export interface PageOptions {
  title: string;
  /** 页面主体 HTML */
  body: string;
  /** SEO 头（canonical/hreflang/description/OG…）；不传 = 头部维持最小集 */
  seo?: SeoMeta;
  /** 额外的 <style> */
  style?: string;
  /** 额外的 <script>（不转义，自己保证安全） */
  script?: string;
  /** 顶部导航右侧内容 */
  nav?: string;
}

export function page(o: PageOptions): string {
  return `<!doctype html>
<html lang="${htmlLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)}</title>
${seoHead(o.title, o.seo)}<link rel="icon" href="${LOGO_ICON}">
<style>
${BASE_CSS}
  h1{font-size:26px}
  header{
    position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;
    padding:0 22px;height:52px;background:var(--paper);border-bottom:1px solid var(--line);
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
  header img{height:24px;display:block}
  .brand-link{display:flex;align-items:center;gap:9px;text-decoration:none}
  .brand-link:hover{color:inherit;text-decoration:none}
  .brand{font-size:15px;font-weight:600;color:var(--ink);letter-spacing:-.2px;white-space:nowrap}
  header nav{display:flex;gap:20px;align-items:center;height:100%}
  header nav a{
    display:inline-flex;align-items:center;height:52px;padding:0 2px;
    font-size:13px;color:var(--ink);text-decoration:none;white-space:nowrap;
  }
  header nav a:hover{color:var(--accent);text-decoration:none}
  .lg-dd{position:relative;height:52px;display:inline-flex;align-items:center}
  .lg-btn{display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:0 2px;height:52px;color:var(--ink)}
  .lg-btn:hover{color:var(--accent)}
  .lg-car{
    width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
    border-top:5px solid currentColor;opacity:.55;margin-top:1px;
  }
  .lg-panel{
    position:absolute;top:100%;right:-6px;z-index:60;display:none;flex-direction:column;
    background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);
    box-shadow:var(--hard);padding:8px;min-width:160px;max-height:min(70vh,430px);overflow:auto;
  }
  .lg-dd:hover .lg-panel,.lg-dd:focus-within .lg-panel{display:flex}
  .lg-panel a{padding:7px 12px;border-radius:var(--r-xs);color:var(--ink);text-decoration:none;font-size:13px;white-space:nowrap}
  .lg-panel a:hover{background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink);text-decoration:none}
  @media (max-width:640px){
    header{padding:0 16px}
    header nav{gap:14px}
    .brand{display:none}
  }
  main{max-width:1040px;margin:0 auto;padding:44px 20px 60px}
  .card{
    background:var(--card);border:0;border-radius:var(--r-lg);padding:32px;
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 1px 3px rgba(0,0,0,.06);
  }
  label{
    display:block;font-size:13px;font-weight:500;
    color:var(--muted);margin:18px 0 7px;
  }
  input{
    width:100%;padding:11px 13px;font-size:15px;font-family:var(--sans);
    border:1px solid var(--line);border-radius:var(--r-sm);background:var(--paper);color:var(--ink);
  }
  input:focus{outline:2px solid var(--accent);outline-offset:-1px}
  button{
    width:100%;margin-top:24px;padding:12px;font-size:15px;font-weight:600;font-family:var(--sans);
    color:#fff;background:var(--primary);border:0;border-radius:var(--r-md);cursor:pointer;
    transition:background .15s;
  }
  button:hover:not(:disabled){background:var(--primary-dark)}
  button:active:not(:disabled){transform:scale(.99)}
  button:disabled{opacity:.55;cursor:default}
  .msg{margin-top:16px;padding:11px 13px;border-radius:var(--r-sm);font-size:14px;display:none;white-space:pre-wrap}
  .msg.show{display:block}
  .msg.err{background:color-mix(in srgb,var(--danger) 8%,transparent);color:var(--danger)}
  .msg.ok{background:color-mix(in srgb,var(--ok) 9%,transparent);color:var(--ok)}
  footer{
    border-top:1px solid var(--line);margin-top:20px;
    text-align:center;color:var(--muted);padding:26px 20px 30px;word-break:break-word;
    font-size:12px;
  }
  footer .legal-links{margin-top:8px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
  footer .legal-links a{color:var(--muted);text-decoration:none}
  footer .legal-links a:hover{color:var(--accent);text-decoration:underline}
  .tabs{display:flex;border-bottom:1px solid var(--line);margin-bottom:4px}
  .tabs button{
    flex:1;width:auto;margin:0;padding:10px;background:transparent;color:var(--muted);
    font-size:13.5px;font-weight:500;border:0;border-bottom:2px solid transparent;border-radius:0;
  }
  .tabs button:hover:not(.on){color:var(--ink);background:transparent}
  .tabs button.on{color:var(--ink);font-weight:700;border-bottom-color:var(--accent)}
${o.style ?? ''}
</style>
</head>
<body>
<header>
  <a class="brand-link" href="/"><img src="${LOGO_ICON}" alt=""><span class="brand">${BRAND_NAME}</span></a>
  <nav>${
    o.nav ??
    `<a href="/">${st('nav_home')}</a><a href="/kol/workbench">${st('nv_dashboard')}</a><a href="/price">${st('nav_price')}</a><a href="/kol/personal">${st('nav_me')}</a>`
  }${langNav()}</nav>
</header>
<main>${o.body}</main>
<footer>${st('footer', { brand: BRAND_NAME })}<div class="legal-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refund">Refund</a><a href="mailto:support@poviai.com">support@poviai.com</a></div></footer>
<script>${LANG_LINK_SCRIPT}${o.script ? `\n${o.script}` : ''}</script>
</body>
</html>`;
}

/**
 * 全局 404 的形状判定：浏览器**导航**请求给带 404 状态码的品牌页
 * （不修的话所有乱 URL 都是 200+JSON，搜索引擎当正常页收录 = 全站软 404）；
 * 扩展/接口调用一律维持 200+JSON 信封 —— 扩展只看 body.code，
 * 某些环境还会拦 4xx（见 lib/response.ts fail 的注释），这条不能破。
 *
 * fetch 默认 Accept 是 * / *，只有地址栏/链接导航才带 text/html，
 * 以此区分；/v1/、/webhooks/、/kol/api/ 前缀再兜一层底。
 *
 * ⚠️ lib/owner.ts 的 fake404() 必须和这里逐字节同形（admin 路径伪装成不存在），
 * 两处都走这两个函数，改一处等于改两处。
 */
export function isHtmlNavigation(req: {
  method: string;
  path: string;
  header(name: string): string | undefined;
}): boolean {
  if (req.method !== 'GET') return false;
  if (!(req.header('Accept') || '').includes('text/html')) return false;
  const p = req.path;
  return !p.startsWith('/v1/') && !p.startsWith('/webhooks/') && !p.startsWith('/kol/api/');
}

export function notFoundHtml(): Response {
  return html(
    page({
      title: brandTitle(st('nf_title')),
      body: `<div class="card" style="text-align:center;max-width:520px;margin:40px auto">
  <div style="font-family:var(--mono);font-size:44px;font-weight:700;color:var(--muted)">404</div>
  <h1 style="font-size:22px;margin:10px 0 8px">${escapeHtml(st('nf_title'))}</h1>
  <p style="color:var(--muted);font-size:14px;margin:0 0 24px">${escapeHtml(st('nf_body'))}</p>
  <a class="btn-home" href="/" style="display:inline-block;padding:11px 26px;background:var(--primary);color:#fff;border-radius:var(--r-full);font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(st('nf_back'))}</a>
</div>`,
    }),
    404,
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // 页面自己没有任何外部资源（logo 是 data URI），本可以收得更紧，
      // 但**必须放行 chrome-extension:** —— 扩展的 content.ts-loader.js 是用
      //   import(chrome.runtime.getURL("assets/content.ts.js"))
      // 动态加载主逻辑的，这个 import 会走页面的 CSP 检查。
      // 不放行的话 content script 根本起不来，登录握手直接失效，
      // 而且浏览器只在控制台报一条 CSP 违规，页面上什么都看不出来。
      // Cloudflare 会自动往 HTML 里注入 static.cloudflareinsights.com 的统计脚本
      // （Web Analytics），不放行的话每个页面都会在 Console 里刷一条 CSP 违规 ——
      // 功能上无害，但会淹没真正的报错，排查问题时很干扰。
      // tikwm / TikTok CDN 的放行给两类页面用：
      //   - 达人/视频搜索：浏览器直连 tikwm（额度按用户出口 IP 算，绕开 CF 边缘
      //     共享 IP 烧日额度的坑），头像/封面直链 TikTok CDN；
      //   - 视频下载页：封面 img + fetch 直链转 Blob 另存（此前就被 'self' 拦着）。
      // accounts.google.com 的四条给 Google One Tap（site/one-tap.ts 注入的
      // GSI 脚本）：script 是 gsi/client 本体，frame 是提示框 iframe，
      // connect/style 是它内部的请求和样式。少任何一条 One Tap 都不出现，
      // 且只在 Console 报 CSP 违规，页面上毫无痕迹。
      'Content-Security-Policy': [
        "default-src 'none'",
      // blob: 给 /feedback 的截图预览用（URL.createObjectURL 的缩略图）
        "img-src 'self' data: blob: https://www.tikwm.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com",
        "media-src 'self'",
        "style-src 'unsafe-inline' chrome-extension: https://accounts.google.com/gsi/style",
        "script-src 'unsafe-inline' chrome-extension: https://static.cloudflareinsights.com https://accounts.google.com/gsi/client",
        "font-src chrome-extension: data:",
        "connect-src 'self' https://www.tiktok.com https://cloudflareinsights.com https://accounts.google.com/gsi/ https://www.tikwm.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com",
        "frame-src https://accounts.google.com/gsi/ https://www.youtube.com https://www.youtube-nocookie.com",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  });
}
