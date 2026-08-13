import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { toProfile, uuid } from '../lib/auth';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../lib/password';
import { brandTitle, BRAND_NAME, CANONICAL_ORIGIN, escapeHtml, html, page } from '../site/layout';
import { ogImageBytes } from '../site/og-image';
import { st } from '../site/i18n';
import { currentLang } from '../lib/i18n';
import { currentWebUser, issueLoginCode, newSession, pageLang, sessionCookie } from '../site/session';
import { ic } from '../site/assets';
import { accessIdentityBlocked } from '../lib/owner';
import {
  authorizeUrl,
  callbackUrl,
  exchangeCode,
  googleEnabled,
  verifyIdToken,
  GOOGLE_CALLBACK_PATH,
  type GoogleIdentity,
} from '../lib/google-oauth';
import { oneTapInject } from '../site/one-tap';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * Google 官方那个四色 G。内联而不是引 CDN 图 ——
 * 页面有 CSP，外链图会被拦，而且登录页多一个外部请求也没必要。
 */
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

/**
 * 官网页面。扩展会跳到这些地址，缺了用户点了就是 404。
 *
 * 最关键的是 /kol/exlogin —— 登录闭环有一半在这个页面上：
 *
 *   1. 扩展 sendMessage({task:"toLogin", url:"<站点>/kol/exlogin?utm_source=CJ&lang=xx"})
 *   2. 用户在这个页面登录
 *   3. 页面派发 CustomEvent("loginSuccess", { detail: <一次性码> })
 *   4. content script（注入在本域名下）接住 -> POST /v1/plugin/public/token/exchange
 *   5. 换到长期 token -> GET /v1/plugin/user/detail 拿会员信息
 *   6. 扩展回派发 CustomEvent("flishLogin") 并让 service worker 关掉本页
 *
 * 第 3 步的 origin 校验在 content.ts.js:569：`a.target.origin.includes(SITE_HOST)`，
 * 所以这个页面必须由 SITE_ORIGIN 那个域名提供，不能放别处。
 */

/**
 * 页面语言。
 *
 * 全局中间件（index.ts）已经按 `lang` 头 / Accept-Language 定过一次，
 * 但页面是浏览器直接导航打开的，扩展没法给它加自定义头 —— 只能塞在 URL 上。
 * 扩展跳登录页时带的就是 ?lang=zh-CN / en-US（见 site.ts 顶部注释的第 1 步），
 * 有它就以它为准，没有就退回 Accept-Language。
 *
 * 只对页面生效：/kol/exlogin/auth 是 fetch 出来的，会继承页面的 ?lang 转发。
 */
// 会话与语言逻辑在 src/site/session.ts，和 site-kol.ts 共用
r.use('*', pageLang);

/** 当前请求的 path?query，喂给 page({seo}) 做 canonical/hreflang。 */
function reqPath(c: { req: { url: string } }): string {
  const u = new URL(c.req.url);
  return u.pathname + u.search;
}

// ── SEO 基建：分享图 / robots / sitemap ──────────────────────
//
// 这三个路由必须在 Worker 里应答：全局 notFound 返回的是 200+JSON
// （index.ts，扩展兼容），爬虫会把它当正常页面收录（软 404）。
// robots.txt 还有一层：Cloudflare 的 Managed robots.txt 会把托管段
// **拼在源站响应前面**——以前源站 404 JSON 被原样拼进 robots.txt 尾部。

r.get('/og.png', () => {
  return new Response(ogImageBytes(), {
    headers: {
      'Content-Type': 'image/png',
      // 内容随部署变，不带指纹，给 7 天足够：改图后最迟一周所有分享卡换新
      'Cache-Control': 'public, max-age=604800',
    },
  });
});

r.get('/robots.txt', () => {
  const body = `User-agent: *
Allow: /
# 后台与纯功能端点，爬了也是登录墙/JSON
Disallow: /admin
Disallow: /wish/admin
Disallow: /feedback/admin
Disallow: /v1/
Disallow: /kol/exlogin

Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
});

/**
 * 站点地图：只列公开可索引页。每个 URL 附 9 个 hreflang 变体 + x-default，
 * 和页面 <head> 里的 hreflang 互相印证（Google 两处任一都认，双写更稳）。
 * 页面集合与 head 的 noindex 判定必须同步维护：加公开页时两处一起加。
 */
const SITEMAP_PATHS: string[] = [
  '/',
  '/price',
  '/tools/video-download',
  '/tools/script-analysis',
  '/tools/hashtag-generator',
  '/tiktok-test',
  '/kol/guide',
  '/kol/search',
  '/kol/video-search',
  '/kol/product-search',
  '/kol/kol-rank',
  '/kol/video-rank',
  '/kol/product-rank',
  '/kol/calendar',
];

r.get('/sitemap.xml', () => {
  const langs = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'id-ID', 'es-ES', 'pt-PT'];
  const hreflangOf: Record<string, string> = {
    'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko',
    'vi-VN': 'vi', 'id-ID': 'id', 'es-ES': 'es', 'pt-PT': 'pt',
  };
  // Google 推荐：每个语言版本各占一个 <url>，都带同一套 alternate 块
  const urls = SITEMAP_PATHS.flatMap((p) => {
    const alts = [
      ...langs.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflangOf[l]}" href="${CANONICAL_ORIGIN}${p}?lang=${l}"/>`,
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${CANONICAL_ORIGIN}${p}"/>`,
    ].join('\n');
    const locs = [`${CANONICAL_ORIGIN}${p}`, ...langs.map((l) => `${CANONICAL_ORIGIN}${p}?lang=${l}`)];
    return locs.map((loc) => `  <url>\n    <loc>${loc.replace(/&/g, '&amp;')}</loc>\n${alts}\n  </url>`);
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
});
// 未登录访客的页面注入 Google One Tap（右上角自动登录提示），见 site/one-tap.ts
r.use('*', oneTapInject);

// --- 登录页 -----------------------------------------------------------------

r.get('/kol/exlogin', async (c) => {
  const user = await currentWebUser(c);
  // 扩展跳过来时带 ?lang=，没带就用中间件从 Accept-Language 定的那个。
  // 之前这里写死 'zh-CN' —— 日语用户直接从官网打开登录页，
  // 提交表单时会把 lang=zh-CN 带给后端，报错就成了中文。
  const lang = c.req.query('lang') || currentLang().replace('_', '-');

  // 已经登录过的直接发码，页面一打开就同步给扩展，不用再输一次密码
  const preCode = user ? await issueLoginCode(c.env, user.id) : '';

  // 没配 GOOGLE_CLIENT_ID/SECRET 就整块不渲染 —— 按钮点了必失败，不如别出现
  const googleOn = googleEnabled(c.env);
  // Google 登录中途失败会跳回来带 ?gerr=1，页面用当前语言提示一句
  const googleErr = c.req.query('gerr') ? st('err_google') : '';

  return html(
    page({
      title: brandTitle(st('login_page_title')),
      seo: { path: reqPath(c), noindex: true },
      nav: `<a href="/">${st('nav_home')}</a><a href="/price">${st('nav_price')}</a>`,
      style: `
  main{max-width:432px;padding-top:44px}
  .benefit{
    margin:20px 0 0;padding:13px 15px;border-left:3px solid var(--accent);
    background:color-mix(in srgb,var(--accent) 5%,transparent);
    font-size:13px;color:var(--muted);line-height:1.7
  }
  .wx{display:flex;gap:14px;align-items:center;margin-top:22px;padding-top:20px;border-top:1px solid var(--line)}
  .wx img{width:78px;height:78px;border-radius:var(--r-sm);border:1px solid var(--line);display:block}
  .wx a{color:var(--accent);font-weight:600}
  .wx div{font-size:13px;color:var(--muted);line-height:1.6}
  .syncing{text-align:center;padding:24px 0}
  .spinner{
    width:26px;height:26px;margin:0 auto 16px;border:2px solid var(--line);
    border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .hint{font-size:12px;color:var(--muted);margin-top:12px;text-align:center;line-height:1.7}
  /* Google 按钮走「次要动作」的样式：白底描边，别和主按钮抢焦点 */
  .gbtn{
    display:flex;align-items:center;justify-content:center;gap:10px;
    width:100%;margin:4px 0 0;padding:11px;font-size:15px;font-weight:600;
    color:var(--ink);background:var(--card);border:1px solid var(--line);
    border-radius:var(--r-md);cursor:pointer;text-decoration:none;
    transition:background .15s,border-color .15s;
  }
  .gbtn:hover{background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink);text-decoration:none}
  .gbtn svg{flex:none}
  .or{
    display:flex;align-items:center;gap:12px;
    margin:20px 0 2px;font-size:12px;color:var(--muted)
  }
  .or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
`,
      body: `
<div class="card">
  <div id="auth-view">
    <h1>${st('login_title')}</h1>
    <p class="sub">${BRAND_NAME}<br>${st('login_sub')}</p>

    ${
      googleOn
        ? `<a class="gbtn" href="/kol/exlogin/google?lang=${encodeURIComponent(lang)}">${GOOGLE_G}${st('btn_google')}</a>
    <div class="or">${st('login_or')}</div>`
        : ''
    }

    <div class="tabs">
      <button type="button" id="tab-login" class="on">${st('tab_login')}</button>
      <button type="button" id="tab-reg">${st('tab_reg')}</button>
    </div>

    <label for="email">${st('label_email')}</label>
    <input id="email" type="email" autocomplete="username" placeholder="you@example.com" spellcheck="false">

    <label for="pw">${st('label_pw')}</label>
    <input id="pw" type="password" autocomplete="current-password" placeholder="${st('ph_pw')}">

    <div id="reg-only" hidden>
      <label for="pw2">${st('label_pw2')}</label>
      <input id="pw2" type="password" autocomplete="new-password" placeholder="${st('ph_pw2')}">
    </div>

    <button id="submit">${st('btn_login')}</button>
    <div id="msg" class="msg"></div>

    <div class="benefit">${st('benefit')}</div>

    <div class="wx">
      <img src="/img/support-qr.png" alt="WhatsApp">
      <div>${st('support_text')}<br><a href="mailto:support@poviai.com">support@poviai.com</a></div>
    </div>
  </div>

  <div id="sync-view" hidden>
    <div class="syncing">
      <div class="spinner"></div>
      <div id="sync-text">${st('syncing')}</div>
      <div class="hint" id="sync-hint"></div>
    </div>
  </div>
</div>`,
      script: `
(function(){
  var lang = ${JSON.stringify(lang)};
  var preCode = ${JSON.stringify(preCode)};
  // 页面脚本里的文案统一从这儿取，服务端按语言渲染好再注进来
  var T = ${JSON.stringify({
      login: st('btn_login'), reg: st('btn_reg'), working: st('btn_working'),
      syncOk: st('sync_ok'), syncOkHint: st('sync_ok_hint'),
      syncFail: st('sync_fail'),
      syncFailHint: st('sync_fail_hint') + `<a href="javascript:location.reload()">${st('retry_once')}</a>`,
      needBoth: st('err_need_both'), pwMismatch: st('err_pw_mismatch'),
      generic: st('err_generic'), network: st('err_network'),
    })};
  var mode = 'login';

  var $ = function(id){ return document.getElementById(id); };
  var msg = $('msg');
  function say(t, kind){ msg.textContent = t; msg.className = 'msg show ' + kind; }
  function clear(){ msg.className = 'msg'; }

  function setMode(m){
    mode = m;
    $('tab-login').classList.toggle('on', m === 'login');
    $('tab-reg').classList.toggle('on', m === 'reg');
    $('reg-only').hidden = m !== 'reg';
    $('submit').textContent = m === 'login' ? T.login : T.reg;
    $('pw').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    clear();
  }
  $('tab-login').onclick = function(){ setMode('login'); };
  $('tab-reg').onclick = function(){ setMode('reg'); };

  // --- 把一次性码交给扩展 -------------------------------------------------
  // 这里踩过两个坑，别改回一次性 dispatch：
  //
  // ① 时序：扩展的 content.ts-loader.js 是 await import(...) 异步加载主逻辑的，
  //    页面同步 dispatch 的话监听器还没注册上，事件直接丢了，而且**没有任何报错**。
  // ② content script 装载完 1 秒会派发 kolContentReady（content.ts.js:698，
  //    在逗号表达式顶层，任何页面都会发，不限 tiktok.com），这是现成的就绪信号。
  //
  // 所以：收到 kolContentReady 就立刻发；同时每 400ms 重发一次兜底
  //（万一我们的监听器注册得比它还晚，就会错过那一次信号）。
  // 扩展换完 token 会回派发 flishLogin，收到就停。
  function handoff(code){
    $('auth-view').hidden = true;
    $('sync-view').hidden = false;

    var done = false, timer = null, tries = 0, t0 = Date.now();

    function stop(){ if (timer) { clearInterval(timer); timer = null; } }

    // 兜底重发要按**墙上时间**收尾，不能只数次数（2026-08-07）：
    // 标签页切到后台后 Chrome 把 setInterval 降频到 1 分钟一次，30 次就摊成
    // 半小时，迟到的那几发会拿着早就过期的码去兑换，扩展弹「登录码无效或已过期」。
    // 20 秒是上限：前台 30 次 400ms 只用 12 秒，正常路径一次也不会被砍。
    function expired(){ return Date.now() - t0 > 20000; }

    function fire(){
      tries++;
      window.dispatchEvent(new CustomEvent('loginSuccess', { detail: code }));
    }

    window.addEventListener('flishLogin', function(){
      done = true; stop();
      $('sync-text').textContent = T.syncOk;
      $('sync-hint').textContent = T.syncOkHint;
    });

    // 就绪信号来了立刻发一次
    window.addEventListener('kolContentReady', function(){ if (!done && !expired()) fire(); });

    fire();
    timer = setInterval(function(){
      if (done || tries > 30 || expired()) { stop(); return; }
      fire();
    }, 400);

    // 15 秒还没响应，基本可以断定插件那边没接上
    setTimeout(function(){
      if (done) return;
      stop();
      $('sync-text').textContent = T.syncFail;
      $('sync-hint').innerHTML = T.syncFailHint;
    }, 15000);
  }

  // One Tap（未登录时 site/one-tap.ts 注入右上角提示）登录成功会带回
  // loginCode —— 在这个页面上不刷新，直接走同一条交接流程给扩展
  window.__kolOneTapDone = function(d){
    if (d && d.loginCode) { handoff(d.loginCode); }
    else { location.reload(); }
  };

  // 已经有会话的话，页面一打开就直接交接
  if (preCode) { handoff(preCode); }

  // Google 登录半路失败跳回来的，先把原因说清楚再让用户选下一步
  var googleErr = ${JSON.stringify(googleErr)};
  if (googleErr && !preCode) { say(googleErr, 'err'); }

  // --- 提交 ---------------------------------------------------------------
  $('submit').onclick = async function(){
    var email = $('email').value.trim();
    var pw = $('pw').value;
    if (!email || !pw) { say(T.needBoth, 'err'); return; }
    if (mode === 'reg' && pw !== $('pw2').value) { say(T.pwMismatch, 'err'); return; }

    var btn = this;
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = T.working;
    try {
      // 带上 ?lang：中间件靠它决定 fail() 的 message 用哪种语言。
      // 不带的话会退回浏览器的 Accept-Language —— 插件界面是英文、
      // 浏览器是中文的用户就会看到中文报错。
      var res = await fetch('/kol/exlogin/auth?lang=' + encodeURIComponent(lang), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode, email: email, password: pw, lang: lang })
      });
      var j = await res.json();
      if (j && j.code === 'OK' && j.data && j.data.loginCode) {
        handoff(j.data.loginCode);
      } else {
        say((j && j.message) || T.generic, 'err');
      }
    } catch (e) {
      say(T.network, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };

  ['email','pw','pw2'].forEach(function(id){
    var el = $(id);
    if (el) el.addEventListener('keydown', function(e){ if (e.key === 'Enter') $('submit').click(); });
  });
})();
`,
    }),
  );
});

/**
 * POST /kol/exlogin/auth
 * 登录或注册，成功后直接返回一次性码。
 *
 * 一次性码在这里生成而不是让页面去调 /public/login-code —— 那个接口要 ADMIN_KEY，
 * 能给任意 userId 发 token，绝不能出现在浏览器里。
 */
r.post('/kol/exlogin/auth', async (c) => {
  const b = await readJson<{ mode?: string; email?: string; password?: string }>(c);
  const email = (b.email || '').trim().toLowerCase();
  const password = b.password || '';

  if (!email || !password) return fail(ERR.PARAM, '邮箱和密码都要填');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(ERR.PARAM, '邮箱格式不对');

  const ip = c.req.header('CF-Connecting-IP') || '';
  const ua = c.req.header('User-Agent') || '';

  // 简单的暴力破解防护：同一 IP 15 分钟内最多 20 次
  const rlKey = `login-rl:${ip}`;
  const tries = Number((await c.env.KV.get(rlKey)) || '0');
  if (tries > 20) return fail(ERR.RATE_LIMITED, '尝试次数过多，请 15 分钟后再试');
  await c.env.KV.put(rlKey, String(tries + 1), { expirationTtl: 900 });

  let user: UserRow | null;

  if (b.mode === 'reg') {
    const weak = checkPasswordStrength(password);
    if (weak) return fail(ERR.PARAM, weak);

    const dup = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(email).first();
    if (dup) return fail(ERR.PARAM, '这个邮箱已经注册过了，直接登录吧');

    const { hash, salt } = await hashPassword(password);
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, email, plan_code, password_hash, password_salt)
       VALUES (?1, ?2, ?3, 'free', ?4, ?5)`,
    )
      .bind(id, email.split('@')[0], email, hash, salt)
      .run();
    user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<UserRow>();
  } else {
    user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?1`)
      .bind(email)
      .first<UserRow>();
    // 用户不存在和密码错误返回同一句话，避免被拿来枚举邮箱
    const okPw =
      user && (await verifyPassword(password, user.password_hash ?? null, user.password_salt ?? null));
    if (!user || !okPw) return fail(ERR.UNAUTHORIZED, '邮箱或密码不对');
    if (user.status !== 'active') return fail(ERR.UNAUTHORIZED, '账号已被禁用');
  }

  if (!user) return fail(ERR.INTERNAL, '账号创建失败');

  await c.env.DB.prepare(`UPDATE users SET last_login_at = unixepoch() WHERE id = ?1`)
    .bind(user.id)
    .run();

  const sid = await newSession(c.env, user.id, ip, ua);
  const loginCode = await issueLoginCode(c.env, user.id);

  const res = ok({ loginCode });
  res.headers.append('Set-Cookie', sessionCookie(sid));
  return res;
});

// --- Google 登录 -------------------------------------------------------------

/**
 * Google 登录只补「怎么证明你是你」这一段，后面完全走已有的闭环：
 * 建 web_sessions -> 种 sid cookie -> 302 回 /kol/exlogin。
 * 登录页一打开就发现有会话，自动 issueLoginCode + handoff 给扩展 ——
 * 和邮箱密码登录走的是同一条路，扩展那边不用改一行。
 */

/** state cookie：防 CSRF，回调时必须和 URL 上的 state 一致。10 分钟够走完授权。 */
function stateCookie(state: string): string {
  return `gstate=${state}; Path=/kol/exlogin; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}
const CLEAR_STATE_COOKIE = 'gstate=; Path=/kol/exlogin; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

/**
 * 回调和 One Tap 共用的认人/建号。
 * 认人顺序：先 sub（用户在谷歌改了邮箱也认得出），再 email
 * （老的密码账号首次用谷歌登录，直接绑上）。
 */
async function upsertGoogleUser(env: Env, who: GoogleIdentity): Promise<UserRow | null> {
  let user =
    (await env.DB.prepare(`SELECT * FROM users WHERE google_sub = ?1`)
      .bind(who.sub)
      .first<UserRow>()) ||
    (await env.DB.prepare(`SELECT * FROM users WHERE email = ?1`)
      .bind(who.email)
      .first<UserRow>());

  if (user) {
    // 已存在的账号：补 google_sub，顺手把还没头像的补上（不覆盖用户自己设过的）
    await env.DB.prepare(
      `UPDATE users
          SET google_sub = ?1,
              head_url = COALESCE(NULLIF(head_url, ''), ?2),
              last_login_at = unixepoch(),
              updated_at = unixepoch()
        WHERE id = ?3`,
    )
      .bind(who.sub, who.picture, user.id)
      .run();
  } else {
    // 新用户：没有密码，只能靠谷歌登录进来（想用密码登录就去走找回密码/改密码）
    const id = uuid();
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, head_url, plan_code, google_sub, last_login_at)
       VALUES (?1, ?2, ?3, ?4, 'free', ?5, unixepoch())`,
    )
      .bind(id, who.name || who.email.split('@')[0], who.email, who.picture, who.sub)
      .run();
    user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<UserRow>();
  }
  return user;
}

/** 出错一律回登录页并带上 ?gerr=1，由页面用当前语言提示，不给用户看裸报错。 */
function googleFailed(lang: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/kol/exlogin?lang=${encodeURIComponent(lang)}&gerr=1`,
      'Set-Cookie': CLEAR_STATE_COOKIE,
    },
  });
}

r.get('/kol/exlogin/google', async (c) => {
  const lang = c.req.query('lang') || currentLang().replace('_', '-');
  if (!googleEnabled(c.env)) return googleFailed(lang);

  const state = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
  // 语言存 KV 而不是塞进 state：state 要参与 CSRF 比对，越不可预测越好
  await c.env.KV.put(`glogin:${state}`, lang, { expirationTtl: 600 });

  const url = authorizeUrl({
    clientId: c.env.GOOGLE_CLIENT_ID!,
    redirectUri: callbackUrl(c.req.raw),
    state,
    lang,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Set-Cookie': stateCookie(state) },
  });
});

r.get(GOOGLE_CALLBACK_PATH, async (c) => {
  const state = c.req.query('state') || '';
  const lang = (state && (await c.env.KV.get(`glogin:${state}`))) || currentLang().replace('_', '-');
  if (state) await c.env.KV.delete(`glogin:${state}`);

  if (!googleEnabled(c.env)) return googleFailed(lang);

  // 用户在谷歌那边点了「取消」也会跳回来，带的是 ?error=access_denied
  const code = c.req.query('code') || '';
  if (!code) return googleFailed(lang);

  // CSRF：cookie 里的 state 必须和 URL 上的对得上。
  // 少了这步，攻击者可以把自己的 code 塞给受害者，让受害者登进攻击者的账号。
  const cookieState = (c.req.header('Cookie') || '').match(/(?:^|;\s*)gstate=([^;]+)/)?.[1] || '';
  if (!state || state !== cookieState) return googleFailed(lang);

  const who = await exchangeCode(c.env, code, callbackUrl(c.req.raw));
  // email_verified=false 的邮箱不能拿来认人 —— 否则谁都能声称自己是那个邮箱的主人
  if (!who || !who.emailVerified) return googleFailed(lang);

  const user = await upsertGoogleUser(c.env, who);
  if (!user) return googleFailed(lang);
  if (user.status !== 'active') return googleFailed(lang);

  const sid = await newSession(
    c.env,
    user.id,
    c.req.header('CF-Connecting-IP') || '',
    c.req.header('User-Agent') || '',
  );

  const res = new Response(null, {
    status: 302,
    headers: { Location: `/kol/exlogin?lang=${encodeURIComponent(lang)}` },
  });
  res.headers.append('Set-Cookie', sessionCookie(sid));
  res.headers.append('Set-Cookie', CLEAR_STATE_COOKIE);
  return res;
});

/**
 * POST /kol/exlogin/google/onetap
 * One Tap 的 credential 落地：验签 → 认人/建号 → 种会话 → 返回一次性码。
 *
 * credential 是浏览器转手 POST 来的，谁都能打这个接口 ——
 * 验签（verifyIdToken：RS256 + iss/aud/exp）就是全部的信任来源。
 * 返回 loginCode 是给 /kol/exlogin 页面直接 handoff 给扩展用的；
 * 其它页面拿到 OK 直接刷新变成已登录态。
 */
r.post('/kol/exlogin/google/onetap', async (c) => {
  if (!googleEnabled(c.env)) return fail(ERR.PARAM, 'Google 登录未配置');

  // 和 /kol/exlogin/auth 同一道闸：不登录就能打的接口都得限速
  const ip = c.req.header('CF-Connecting-IP') || '';
  const rlKey = `login-rl:${ip}`;
  const tries = Number((await c.env.KV.get(rlKey)) || '0');
  if (tries > 20) return fail(ERR.RATE_LIMITED, '尝试次数过多，请 15 分钟后再试');
  await c.env.KV.put(rlKey, String(tries + 1), { expirationTtl: 900 });

  const b = await readJson<{ credential?: string }>(c);
  const who = await verifyIdToken(c.env, b.credential || '');
  if (!who || !who.emailVerified) return fail(ERR.UNAUTHORIZED, 'Google 凭证校验失败');

  const user = await upsertGoogleUser(c.env, who);
  if (!user || user.status !== 'active') return fail(ERR.UNAUTHORIZED, '账号不可用');

  const sid = await newSession(c.env, user.id, ip, c.req.header('User-Agent') || '');
  const loginCode = await issueLoginCode(c.env, user.id);

  const res = ok({ loginCode });
  res.headers.append('Set-Cookie', sessionCookie(sid));
  return res;
});

// --- 其它扩展会跳的页面 ------------------------------------------------------

/**
 * 定价页 —— 对照 kolsprite.com/price（2026-08-05 抓取）一比一还原：
 * Trial / Plus / Pro 三档 + 月付年付切换 + 周年促销价 + 完整对比表 +
 * 六个加油包 + FAQ + 精灵点数使用规则。仅去掉了我们没有的 MCP 入口和
 * Discord 送会员行（等有社群链接再加回）。
 *
 * 价格数字只在这里和 Creem 商品上出现；配额数字改 migrations/0005_billing.sql。
 * 购买动作 POST /pay/checkout（routes/pay.ts），Trial 按钮走登录/权益页。
 */

/** 卡片上的价签。promo = 现价（Creem 实际收的），list = 划线原价。 */
const PRICE_TAGS = {
  plus: {
    month: { promo: '$19.9', list: '$ 49', tagKey: 'pr_tag_60off' },
    year: { promo: '$199.9', list: '$ 499', tagKey: 'pr_tag_60off' },
  },
  pro: {
    month: { promo: '$49', list: '$ 69', tagKey: 'pr_tag_save20' },
    year: { promo: '$499', list: '$ 699', tagKey: 'pr_tag_save200' },
  },
} as const;

r.get('/price', async (c) => {
  const user = await currentWebUser(c);
  const profile = user ? await toProfile(c.env, user) : null;
  const lv = profile?.LV ?? null;

  // ---- 文案小工具：数字进模板，语言无关；句式走词典 ----
  const day = (n: string) => st('pr_v_per_day', { n });
  const mon = (n: string) => st('pr_v_per_month', { n });
  const first = (n: string) => st('pr_v_first', { n });
  const maxDay = (n: string) => st('pr_v_max_day', { n });
  const maxMon = (n: string) => st('pr_v_max_month', { n });
  const perAction = (n: string) => st('pr_v_per_action', { n });
  const credits = (n: string) => st('pr_v_credits_month', { n });
  const UNLIM = st('pr_v_unlimited');
  const CHECK = '<span class="pv-check">✓</span>';
  const CROSS = '<span class="pv-cross">✕</span>';
  const DASH = '<span class="pv-dash">—</span>';
  const sub = (s: string) => `<span class="pv-sub">${s}</span>`;

  // ---- 三张卡的功能矩阵（结构与原站一致：Common / Extension / Advanced）----
  type Row = [string, string, string, string]; // label, trial, plus, pro
  const cardCommon: Row[] = [
    ['pr_f_search', day('10') + sub(first('20')), day('200') + sub(first('500')), day('300') + sub(first('1,000'))],
    ['pr_f_rank', first('20'), first('100'), first('100')],
    ['pr_f_filters', st('pr_v_top_cat'), UNLIM, UNLIM],
    ['pr_f_detail', day('10'), day('500'), day('1,000')],
    ['pr_f_export', '0', mon('100') + sub(perAction('300')), mon('300') + sub(perAction('800'))],
  ];
  const cardExt: Row[] = [
    ['pr_f_basic_view', CHECK, CHECK, CHECK],
    ['pr_f_batch', mon('10'), mon('200'), mon('1,000')],
    ['pr_f_sea', mon('20'), mon('500'), mon('2,500')],
    ['pr_f_script', mon('50'), mon('600'), mon('3,000')],
    ['pr_f_similar', st('pr_v_day_each'), mon('50'), mon('200')],
    ['pr_f_review', st('pr_v_limited_content'), maxMon('50'), maxMon('150')],
  ];
  const cardAdv: Row[] = [
    ['pr_f_seats', DASH, '0', '2'],
    ['pr_f_credits', DASH, credits('1000'), credits('3000')],
    ['pr_f_import', CROSS, CHECK, CHECK],
    ['pr_f_outreach', mon('100') + sub(maxDay('20')), mon('10,000') + sub(maxDay('2,000')), mon('20,000') + sub(maxDay('3,000'))],
    ['pr_f_ai_script', st('pr_v_same_as_plugin'), st('pr_v_same_as_plugin'), st('pr_v_same_as_plugin')],
    ['pr_f_download', st('pr_v_logged_in', { n: '20' }), UNLIM, UNLIM],
    ['pr_f_addons_row', st('pr_v_limited'), CHECK, CHECK],
  ];

  const section = (titleKey: string, rows: Row[], col: 1 | 2 | 3) => `
    <div class="pc-sec">${st(titleKey)}</div>
    ${rows.map((row) => `<div class="pc-row"><span>${st(row[0])}</span><b>${row[col]}</b></div>`).join('')}`;

  const planCard = (
    key: 'trial' | 'plus' | 'pro',
    col: 1 | 2 | 3,
  ) => {
    const isCur =
      (key === 'trial' && lv === 'F') || (key === 'plus' && lv === 'P') || (key === 'pro' && lv === 'V');
    const head =
      key === 'trial'
        ? `
      <div class="pc-price"><span class="pc-big">${st('pr_free')}</span></div>
      <button class="pc-btn ghost" onclick="location.href='${user ? '/kol/personal?tab=rights' : '/kol/exlogin'}'">${
        isCur ? st('pr_current') : st('pr_start')
      }</button>
      <div class="pc-list">${st('pr_list_price')} <s>$ 0</s> <em>${st('pr_free')}</em></div>`
        : `
      <div class="pc-price">
        <span class="pc-big" data-price="${key}"></span><span class="pc-per" data-per></span>
      </div>
      <button class="pc-btn main" data-buy-plan="${key}">${st('pr_unlock')}</button>
      <div class="pc-list">${st('pr_list_price')} <s data-list="${key}"></s> <em data-tag="${key}"></em></div>
      <button class="pc-btn ghost" data-buy-plan="${key}">${isCur ? st('pr_renew') : st('pr_upgrade')}</button>`;

    const ribbon =
      key === 'plus'
        ? `<div class="pc-ribbon" data-annual-only>${st('pr_best_value')}</div>`
        : key === 'pro'
          ? `<div class="pc-ribbon alt" data-annual-only>${st('pr_pro_seats')}</div>`
          : '';

    return `
  <div class="pcard${isCur ? ' cur' : ''}">
    ${ribbon}
    <h3>${st(`pr_plan_${key}`)}</h3>
    ${head}
    ${section('pr_sec_common', cardCommon, col)}
    ${section('pr_sec_ext', cardExt, col)}
    ${section('pr_sec_adv', cardAdv, col)}
  </div>`;
  };

  // ---- 完整对比表（原站 Full Comparison，含它自己的口径差异，原样照抄）----
  type CRow = [string, string, string, string];
  const cmp: Array<{ sec: string; rows: CRow[] }> = [
    {
      sec: 'pr_c_account',
      rows: [
        ['pr_r_main', '1', '1', '1'],
        ['pr_f_seats', DASH, st('pr_v_need_purchase', { n: '0' }), '2'],
        ['pr_f_credits', DASH, credits('1000'), credits('3000')],
      ],
    },
    {
      sec: 'pr_c_ext',
      rows: [
        ['pr_r_insights', st('pr_r_fst'), st('pr_r_fst'), st('pr_r_fst')],
        ['pr_r_excel', '0', mon('500'), mon('1,000')],
        ['pr_r_single', CHECK, CHECK, CHECK],
        ['pr_f_batch', mon('10'), mon('200'), mon('1,000')],
        ['pr_f_sea', mon('20'), mon('500'), mon('2,500')],
        ['pr_f_script', mon('50'), mon('600'), mon('3000')],
        ['pr_r_bulk_analysis', CHECK, CHECK, CHECK],
        ['pr_r_save', st('pr_v_folder_limits'), UNLIM, UNLIM],
        ['pr_f_similar', st('pr_v_day_each'), mon('50'), mon('200')],
        ['pr_f_review', st('pr_v_limited_content'), maxMon('50'), maxMon('150')],
      ],
    },
    {
      sec: 'pr_c_web',
      rows: [
        ['pr_r_search_limit', day('10'), day('200'), day('300')],
        ['pr_r_results_limit', first('20'), first('500'), first('1,000')],
        ['pr_r_ranking', first('20'), first('100'), first('100')],
        ['pr_r_filter_access', st('pr_v_top_cat') + sub(st('pr_v_no_time_filter')), UNLIM, UNLIM],
        ['pr_r_risk', first('200') + sub(st('pr_v_search_locked')), first('2,000'), UNLIM],
        ['pr_r_detail_access', day('10'), day('2,000'), UNLIM],
      ],
    },
    {
      sec: 'pr_c_crm',
      rows: [
        ['pr_r_collections', '100', '8,000', '15,000'],
        ['pr_f_outreach', mon('100') + sub(maxDay('20')), mon('10,000') + sub(maxDay('2,000')), mon('20,000') + sub(maxDay('3,000'))],
        ['pr_r_campaign', st('pr_v_results', { n: '10' }), UNLIM, UNLIM],
        ['pr_f_import', DASH, CHECK, CHECK],
        ['pr_r_templates', st('pr_v_fixed'), UNLIM, UNLIM],
        ['pr_r_dashboard', DASH, CHECK, CHECK],
      ],
    },
    {
      sec: 'pr_c_growth',
      rows: [
        ['pr_f_export', DASH, mon('100') + sub(perAction('300')), mon('300') + sub(perAction('800'))],
        ['pr_r_nowm', st('pr_v_guest', { n: '10' }) + sub(st('pr_v_logged_in', { n: '20' })), UNLIM, UNLIM],
        ['pr_r_campaign', st('pr_v_results', { n: '10' }), UNLIM, UNLIM],
        ['pr_r_tags', CHECK, CHECK, CHECK],
        ['pr_r_templates', st('pr_v_fixed'), UNLIM, UNLIM],
        ['pr_r_ai_video_script', mon('50') + sub(maxDay('10')), mon('600') + sub(maxDay('50')), mon('3000') + sub(maxDay('200'))],
        ['pr_r_contact_export', DASH, DASH, st('pr_v_not_available')],
        ['pr_r_addons_avail', st('pr_v_limited'), CHECK, CHECK],
      ],
    },
  ];

  const cmpHtml = `
<table class="cmp-table">
<thead><tr><th></th><th>${st('pr_plan_trial')}</th><th>${st('pr_plan_plus')}</th><th>${st('pr_plan_pro')}</th></tr></thead>
<tbody>
${cmp
  .map(
    (g) => `<tr class="cmp-sec"><td colspan="4">${st(g.sec)}</td></tr>
${g.rows
  .map(
    (row) =>
      `<tr><td>${st(row[0])}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td></tr>`,
  )
  .join('\n')}`,
  )
  .join('\n')}
</tbody>
</table>`;

  // ---- 加油包（价格与原站一致；未上线的展示但不可买）----
  const addons: Array<{ code: string; nameKey: string; price: string; unitKey: string; n: string }> = [
    { code: 'addon_transcript', nameKey: 'pr_a_transcript', price: '$ 15', unitKey: 'pr_a_uses', n: '200' },
    { code: 'addon_similar', nameKey: 'pr_a_similar', price: '$ 29', unitKey: 'pr_a_uses', n: '50' },
    { code: 'addon_sea', nameKey: 'pr_a_sea', price: '$ 15', unitKey: 'pr_a_uses', n: '500' },
    { code: 'addon_outreach', nameKey: 'pr_a_outreach', price: '$ 29', unitKey: 'pr_a_emails', n: '5,000' },
    { code: 'addon_bulk_download', nameKey: 'pr_a_bulk', price: '$ 15', unitKey: 'pr_a_items', n: '1,250' },
    { code: 'addon_credits', nameKey: 'pr_a_credits', price: '$ 29', unitKey: 'pr_a_credits_u', n: '5,000' },
  ];

  const faq: Array<[string, string]> = [
    ['pr_q_invoice', 'pr_q_invoice_a'],
    ['pr_q_discount', 'pr_q_discount_a'],
    ['pr_q_refund', 'pr_q_refund_a'],
    ['pr_q_devices', 'pr_q_devices_a'],
    ['pr_q_support', 'pr_q_support_a'],
  ];

  return html(
    page({
      title: brandTitle(st('price_page_title')),
      seo: { path: reqPath(c), desc: st('seo_desc_price') },
      style: `
  main{max-width:1120px}
  .pr-head{text-align:center;margin-bottom:6px}
  .pr-head h1{display:inline-block}
  .pr-promo{text-align:center;font-size:13px;color:var(--accent);margin:6px 0 18px}
  .pr-toggle{display:flex;justify-content:center;align-items:center;gap:0;margin-bottom:30px}
  .pr-toggle .opt{
    padding:8px 22px;border:1px solid var(--line);font-size:13px;font-weight:500;cursor:pointer;
    background:var(--card);user-select:none;
  }
  .pr-toggle .opt:first-child{border-radius:var(--r-full) 0 0 var(--r-full)}
  .pr-toggle .opt:last-child{border-radius:0 var(--r-full) var(--r-full) 0;border-left:0}
  .pr-toggle .opt.on{background:var(--primary);border-color:var(--primary);color:#fff;font-weight:600}
  .pr-toggle .pr-badge{
    margin-left:12px;padding:3px 12px;background:color-mix(in srgb,var(--ok) 10%,transparent);
    color:var(--ok);font-size:12px;font-weight:600;border-radius:var(--r-full);
  }
  .pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;align-items:start}
  .pcard{
    position:relative;background:var(--card);border:0;border-radius:var(--r-lg);padding:24px 22px;
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 1px 3px rgba(0,0,0,.06);
    transition:transform .15s,box-shadow .15s;
  }
  .pcard:hover{transform:translateY(-3px);box-shadow:var(--hard)}
  .pcard.cur{box-shadow:0 0 0 2px var(--primary),var(--hard)}
  .pcard h3{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em}
  .pc-ribbon{
    position:absolute;top:16px;right:16px;padding:2px 11px;
    font-size:11px;font-weight:600;background:var(--primary);color:#fff;border-radius:var(--r-full);
  }
  .pc-ribbon.alt{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
  .pc-price{margin:10px 0 4px;min-height:44px}
  .pc-big{font-family:var(--serif);font-size:34px;font-weight:700;letter-spacing:-.02em}
  .pc-per{font-family:var(--mono);font-size:12px;color:var(--muted);margin-left:4px}
  .pc-list{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin:8px 0 2px}
  .pc-list s{opacity:.75}
  .pc-list em{font-style:normal;color:var(--accent);font-weight:700;margin-left:6px}
  .pc-btn{
    width:100%;margin-top:10px;padding:11px;font-size:14px;font-weight:600;font-family:var(--sans);
    border-radius:var(--r-md);cursor:pointer;border:0;transition:background .15s;
  }
  .pc-btn.main{background:var(--primary);color:#fff}
  .pc-btn.main:hover:not(:disabled){background:var(--primary-dark)}
  .pc-btn.ghost{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}
  .pc-btn.ghost:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 12%,transparent)}
  .pc-btn:disabled{opacity:.5;cursor:default}
  .pc-sec{
    margin:18px 0 6px;padding-top:14px;border-top:1px solid var(--line);
    font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);
  }
  .pc-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4.5px 0}
  .pc-row span{color:var(--muted)}
  .pc-row b{font-weight:600;text-align:right}
  .pv-sub{display:block;font-size:11px;color:var(--muted);font-weight:400}
  .pv-check{color:var(--ok);font-weight:700}
  .pv-cross{color:var(--danger)}
  .pv-dash{color:var(--muted)}
  .cmp-wrap{margin-top:34px;text-align:center}
  .cmp-body{display:none;margin-top:18px;overflow-x:auto}
  .cmp-body.show{display:block}
  .cmp-table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);font-size:13px;min-width:640px}
  .cmp-table th,.cmp-table td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:center}
  .cmp-table td:first-child{text-align:left;color:var(--muted)}
  .cmp-table thead th{font-family:var(--serif);font-size:15px}
  .cmp-table .cmp-sec td{
    background:color-mix(in srgb,var(--ink) 5%,transparent);
    font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:left;
  }
  .toggle-link{
    display:inline-block;padding:9px 20px;border:1px solid var(--line);border-radius:var(--r-full);background:var(--card);
    cursor:pointer;font-size:13px;font-weight:500;
  }
  .toggle-link:hover{border-color:var(--muted)}
  .addons{margin-top:40px}
  .addons h2,.faq-wrap h2{font-family:var(--serif);font-size:20px;margin:0 0 14px}
  .agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
  .acard{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:16px;display:flex;flex-direction:column;gap:8px}
  .acard .an{font-weight:600;font-size:13.5px;min-height:2.4em}
  .acard .ap{font-family:var(--mono);font-size:13px;color:var(--accent);font-weight:700}
  .acard button{margin:0;padding:8px;font-size:13px;width:100%}
  .faq-wrap{margin-top:40px}
  .faq-wrap details{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:8px;padding:0 16px}
  .faq-wrap summary{cursor:pointer;padding:12px 0;font-weight:600;font-size:14px;list-style:none}
  .faq-wrap summary::before{content:'▸ ';color:var(--accent)}
  .faq-wrap details[open] summary::before{content:'▾ '}
  .faq-wrap .fa{padding:0 0 14px;color:var(--muted);font-size:13.5px;line-height:1.9;white-space:pre-line}
  @media (max-width:560px){.pc-big{font-size:28px}}
`,
      body: `
<div class="pr-head"><h1>${st('pr_h1')}</h1></div>
<p class="pr-promo" id="promoLine">${st('pr_promo_annual')}</p>
<div class="pr-toggle">
  <span class="opt" id="optM">${st('pr_monthly')}</span><span class="opt on" id="optY">${st('pr_annual')}</span>
  <span class="pr-badge">${st('pr_promo_badge')}</span>
</div>
<div class="pgrid">
${planCard('trial', 1)}
${planCard('plus', 2)}
${planCard('pro', 3)}
</div>

<div class="cmp-wrap">
  <span class="toggle-link" id="cmpToggle">${st('pr_cmp_toggle')}</span>
  <div class="cmp-body" id="cmpBody">
    <h2 style="font-family:var(--serif);font-size:20px;margin:6px 0 14px">${st('pr_cmp_title')}</h2>
    ${cmpHtml}
  </div>
</div>

<div class="addons">
  <h2>${st('pr_a_title')}</h2>
  <div class="agrid">
  ${addons
    .map(
      (a) => `
    <div class="acard">
      <div class="an">${st(a.nameKey)}</div>
      <div class="ap">${a.price} / ${st(a.unitKey, { n: a.n })}</div>
      <button class="pc-btn ghost" data-buy="${a.code}">${st('pr_a_buy')}</button>
    </div>`,
    )
    .join('')}
  </div>
</div>

<div class="faq-wrap">
  <h2>${st('pr_faq')}</h2>
  ${faq.map(([q, a]) => `<details><summary>${st(q)}</summary><div class="fa">${st(a)}</div></details>`).join('')}
  <details><summary>${st('pr_rules_t')}</summary><div class="fa">1. ${st('pr_rule1')}
2. ${st('pr_rule2')}
3. ${st('pr_rule3')}</div></details>
</div>`,
      script: `
(function(){
  var TAGS=${JSON.stringify({
    plus: {
      month: { promo: PRICE_TAGS.plus.month.promo, list: PRICE_TAGS.plus.month.list, tag: st(PRICE_TAGS.plus.month.tagKey) },
      year: { promo: PRICE_TAGS.plus.year.promo, list: PRICE_TAGS.plus.year.list, tag: st(PRICE_TAGS.plus.year.tagKey) },
    },
    pro: {
      month: { promo: PRICE_TAGS.pro.month.promo, list: PRICE_TAGS.pro.month.list, tag: st(PRICE_TAGS.pro.month.tagKey) },
      year: { promo: PRICE_TAGS.pro.year.promo, list: PRICE_TAGS.pro.year.list, tag: st(PRICE_TAGS.pro.year.tagKey) },
    },
  })};
  var PER={month:${JSON.stringify(st('pr_per_month'))},year:${JSON.stringify(st('pr_per_year'))}};
  var PROMO={month:${JSON.stringify(st('pr_promo_monthly'))},year:${JSON.stringify(st('pr_promo_annual'))}};
  var period='year';
  function apply(){
    ['plus','pro'].forEach(function(k){
      var t=TAGS[k][period];
      document.querySelector('[data-price="'+k+'"]').textContent=t.promo;
      document.querySelector('[data-list="'+k+'"]').textContent=t.list+PER[period];
      document.querySelector('[data-tag="'+k+'"]').textContent='【'+t.tag+'】';
    });
    document.querySelectorAll('[data-per]').forEach(function(el){el.textContent=PER[period]});
    document.querySelectorAll('[data-annual-only]').forEach(function(el){el.style.display=period==='year'?'':'none'});
    document.getElementById('promoLine').textContent=PROMO[period];
    document.getElementById('optM').className='opt'+(period==='month'?' on':'');
    document.getElementById('optY').className='opt'+(period==='year'?' on':'');
  }
  document.getElementById('optM').onclick=function(){period='month';apply()};
  document.getElementById('optY').onclick=function(){period='year';apply()};
  apply();

  document.getElementById('cmpToggle').onclick=function(){
    var b=document.getElementById('cmpBody');
    b.classList.toggle('show');
    this.textContent=b.classList.contains('show')?${JSON.stringify(st('pr_cmp_hide'))}:${JSON.stringify(st('pr_cmp_toggle'))};
  };

  function buy(item){
    fetch('/pay/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:item})})
      .then(function(r){return r.json()})
      .then(function(res){
        if(res&&res.code==='OK'&&res.data&&res.data.url){location.href=res.data.url;return}
        if(res&&res.code==='ERR_GLOBAL_SESSION_EXPIRED'){location.href='/kol/exlogin';return}
        alert((res&&res.message)||'error');
      })
      .catch(function(){alert('network error')});
  }
  document.querySelectorAll('[data-buy-plan]').forEach(function(b){
    b.onclick=function(){buy(b.getAttribute('data-buy-plan')+'_'+(period==='year'?'year':'month'))};
  });
  document.querySelectorAll('[data-buy]').forEach(function(b){
    b.onclick=function(){buy(b.getAttribute('data-buy'))};
  });
  // 未映射 Creem 商品或未上线的，按钮置灰
  fetch('/pay/items').then(function(r){return r.json()}).then(function(res){
    if(!res||!res.data||!res.data.items)return;
    var m=res.data.items;
    document.querySelectorAll('[data-buy]').forEach(function(b){
      var code=b.getAttribute('data-buy');
      if(m[code]===false){b.disabled=true;b.textContent=${JSON.stringify(st('pr_a_soon'))}}
    });
    ['plus','pro'].forEach(function(k){
      var off=(m[k+'_month']===false)&&(m[k+'_year']===false);
      if(off)document.querySelectorAll('[data-buy-plan="'+k+'"]').forEach(function(b){b.disabled=true});
    });
  }).catch(function(){});
})();`,
    }),
  );
});

// /kol/personal 及其它应用页在 routes/site-kol.ts

// 扩展各处还写死着原站的 /blog/* 教程路径（User-Guide、extension-update、
// 各功能 guide）。新站没有 blog，先统一 302 到使用指南页，免得全是 404。
r.get('/blog/*', (c) => c.redirect('/kol/guide', 302));

// ── 功能许愿 ────────────────────────────────────────────────────────────────
// 扩展的「功能许愿」入口原来指着原作者的飞书表单，现在收回到自己站上。
// 页面固定英文：全球用户共用一张表，不走 st() 词典。落库 feature_wishes
//（migrations/0003_wishes.sql），读端在 /admin/wishes，查看页在 /wish/admin。

r.get('/wish', () =>
  html(
    page({
      title: brandTitle('Feature Wishlist'),
      seo: { path: '/wish', noindex: true },
      style: `
  main{max-width:560px;padding-top:44px}
  textarea{
    width:100%;padding:10px 12px;margin-bottom:18px;border:1px solid var(--line);
    border-radius:var(--r-sm);background:var(--paper);color:inherit;font:inherit;
    font-size:14px;line-height:1.6;resize:vertical;min-height:132px
  }
  textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
  .hp{position:absolute;left:-9999px;top:auto}
`,
      body: `<div class="card">
  <h1>Feature Wishlist</h1>
  <p class="sub">Tell us what ${BRAND_NAME} should do next. We read every wish.</p>

  <label for="wish-msg">What would you like us to build?</label>
  <textarea id="wish-msg" maxlength="2000" placeholder="Describe the feature and how you would use it"></textarea>

  <label for="wish-mail">Email for updates (optional)</label>
  <input id="wish-mail" type="email" placeholder="you@example.com" spellcheck="false">

  <input id="wish-web" class="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">

  <button id="wish-send">Send wish</button>
  <div id="msg" class="msg"></div>
</div>`,
      script: `
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var msg = $('msg');
  function say(t, kind){ msg.textContent = t; msg.className = 'msg show ' + kind; }

  $('wish-send').onclick = async function(){
    var text = $('wish-msg').value.trim();
    if (text.length < 5) { say('Please describe the feature first.', 'err'); return; }

    var btn = this;
    btn.disabled = true;
    try {
      var res = await fetch('/wish/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          contact: $('wish-mail').value.trim(),
          website: $('wish-web').value,
          lang: new URLSearchParams(location.search).get('lang') || navigator.language || ''
        })
      });
      var j = await res.json();
      if (j && j.code === 'OK') {
        say('Wish received — thank you! We read every one.', 'ok');
        $('wish-msg').value = '';
        $('wish-mail').value = '';
      } else {
        say((j && j.message) || 'Something went wrong, please try again.', 'err');
      }
    } catch (e) {
      say('Network error, please try again.', 'err');
    }
    btn.disabled = false;
  };
})();
`,
    }),
  ),
);

r.post('/wish/submit', async (c) => {
  const b = await readJson<{ message?: string; contact?: string; lang?: string; website?: string }>(
    c,
  );

  // 蜜罐：真人看不见 website 字段，填了的都是机器人，假装成功打发走
  if (b.website) return ok({});

  const message = (b.message || '').trim();
  if (message.length < 5) return fail(ERR.PARAM, 'Please describe the feature (at least 5 characters).');
  if (message.length > 2000) return fail(ERR.PARAM, 'Please keep it under 2000 characters.');

  // 同一 IP 一小时最多 5 条，够真人用，挡得住脚本灌水
  const ip = c.req.header('CF-Connecting-IP') || '';
  const rlKey = `wish-rl:${ip}`;
  const n = Number((await c.env.KV.get(rlKey)) || '0');
  if (n >= 5) return fail(ERR.RATE_LIMITED, 'Too many wishes from this network — please try again in an hour.');
  await c.env.KV.put(rlKey, String(n + 1), { expirationTtl: 3600 });

  await c.env.DB.prepare(`INSERT INTO feature_wishes (message, contact, lang) VALUES (?1, ?2, ?3)`)
    .bind(
      message,
      (b.contact || '').trim().slice(0, 200) || null,
      (b.lang || '').slice(0, 16) || null,
    )
    .run();

  return ok({});
});

// 查看页走 Cloudflare Access 邮箱验证（One-Time PIN，只放行属主邮箱，
// 会话 30 天），门卫逻辑统一在 lib/owner.ts：没带合法身份头的请求
// （没登录、没挂 Access、伪造头、别名域探测）一律拿到假 404。
r.get('/wish/admin', (c) => {
  const blocked = accessIdentityBlocked(c);
  if (blocked) return blocked;

  return html(
    page({
      title: brandTitle('Feature Wishes Admin'),
      nav: '',
      style: `
  main{max-width:760px;padding-top:44px}
  .count{font-size:12px;color:var(--muted);margin:14px 0 4px}
  .row{border-bottom:1px solid var(--line);padding:12px 2px}
  .row .meta{font-size:12px;color:var(--muted);margin-bottom:4px}
  .row .body{font-size:14px;line-height:1.6;white-space:pre-wrap}
`,
      body: `<div class="card">
  <h1>Feature Wishes</h1>
  <p class="sub">Signed in via Cloudflare Access. Newest first.</p>
  <div id="msg" class="msg"></div>
  <div class="count" id="count"></div>
  <div id="list"></div>
</div>`,
      script: `
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var msg = $('msg');
  function say(t, kind){ msg.textContent = t; msg.className = 'msg show ' + kind; }

  (async function(){
    try {
      var res = await fetch('/wish/admin/data?limit=200');
      var j = await res.json();
      if (!j || j.code !== 'OK') { say((j && j.message) || 'Request failed.', 'err'); return; }
      var list = $('list');
      list.textContent = '';
      $('count').textContent = j.data.total ? j.data.total + ' wishes, newest first' : 'No wishes yet.';
      j.data.items.forEach(function(w){
        var row = document.createElement('div'); row.className = 'row';
        var meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = '#' + w.id + ' \\u00b7 ' + w.createdAt + ' UTC'
          + (w.lang ? ' \\u00b7 ' + w.lang : '') + (w.contact ? ' \\u00b7 ' + w.contact : '');
        var body = document.createElement('div'); body.className = 'body';
        body.textContent = w.message;
        row.appendChild(meta); row.appendChild(body); list.appendChild(row);
      });
    } catch (e) {
      say('Network error.', 'err');
    }
  })();
})();
`,
    }),
  );
});

// 数据接口和页面同一套门卫（路径在 /wish/admin 之下，同被 Access 覆盖）
r.get('/wish/admin/data', async (c) => {
  const blocked = accessIdentityBlocked(c);
  if (blocked) return blocked;

  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT id, message, contact, lang, created_at AS createdAt
     FROM feature_wishes ORDER BY id DESC LIMIT ?1`,
  )
    .bind(limit)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM feature_wishes`).first<{
    n: number;
  }>();

  return ok({ total: total?.n ?? 0, items: results });
});

// ── 意见反馈 ────────────────────────────────────────────────────────────────
// 扩展 popup 的「意见反馈」原来指着原作者的飞书表单（中/英/日三张），
// 现在收回到自己站上。页面固定英文（面向海外用户），三段式：
// 反馈内容 / 相关截图 / 联系方式（WhatsApp 或邮箱）。
// 截图存 R2（feedback/ 前缀，仅 Access 门卫后的 /feedback/admin/shot 可读），
// 正文落库 messages 表（type='feedback'，和 /v1/plugin/message/feedback 同一张表，
// 截图 key 记在 extra JSON 里）。查看后台在 /feedback/admin。

const FEEDBACK_SHOT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

r.get('/feedback', () =>
  html(
    page({
      title: brandTitle('Feedback'),
      seo: { path: '/feedback', noindex: true },
      style: `
  main{max-width:560px;padding-top:44px}
  .sec{display:flex;gap:12px;margin-top:26px}
  .sec:first-of-type{margin-top:8px}
  .sec .num{
    flex:none;width:26px;height:26px;border:1px solid var(--muted);border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:var(--mono);font-size:13px;font-weight:700;margin-top:1px
  }
  .sec .body{flex:1;min-width:0}
  .sec h2{font-family:var(--serif);font-size:16px;margin:2px 0 2px}
  .sec .hint{font-size:12.5px;color:var(--muted);margin:0 0 10px}
  .req{color:var(--accent)}
  textarea{
    width:100%;padding:10px 12px;border:1px solid var(--line);
    border-radius:var(--r-sm);background:var(--paper);color:inherit;font:inherit;
    font-size:14px;line-height:1.6;resize:vertical;min-height:120px
  }
  textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
  .shots{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  .shot{position:relative;width:84px;height:84px;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
  .shot img{width:100%;height:100%;object-fit:cover;display:block}
  .shot .rm{
    position:absolute;top:2px;right:2px;width:20px;height:20px;margin:0;padding:0;
    border-radius:50%;font-size:12px;line-height:1;background:rgba(0,0,0,.62);color:#fff;border:0
  }
  .shot .rm:hover{transform:none;box-shadow:none;background:var(--danger)}
  .pick{
    display:inline-block;padding:9px 14px;border:1px dashed var(--muted);border-radius:var(--r-sm);
    font-family:var(--mono);font-size:12.5px;cursor:pointer;user-select:none
  }
  .pick:hover{color:var(--accent);border-color:var(--accent)}
  .picks{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .paste{font-size:12.5px;color:var(--muted)}
  .paste kbd{
    font-family:var(--mono);font-size:11.5px;padding:1px 5px;
    border:1px solid var(--line);border-bottom-width:2px;border-radius:5px
  }
  .alt{margin-top:18px;text-align:center;font-size:12.5px;color:var(--muted)}
  .hp{position:absolute;left:-9999px;top:auto}
`,
      body: `<div class="card">
  <h1>Feedback</h1>
  <p class="sub">We read and act on every single message ❤️</p>

  <div class="sec">
    <span class="num">1</span>
    <div class="body">
      <h2>Your feedback <span class="req">*</span></h2>
      <p class="hint">Feature requests, bugs, anything on your mind — we want to hear it.</p>
      <textarea id="fb-msg" maxlength="4000" placeholder="What happened, or what would make ${BRAND_NAME} better for you?"></textarea>
    </div>
  </div>

  <div class="sec">
    <span class="num">2</span>
    <div class="body">
      <h2>Screenshots</h2>
      <p class="hint">Optional — up to 3 images (PNG / JPG / WebP / GIF, 5 MB each) showing the issue.</p>
      <div class="picks">
        <label class="pick" for="fb-file">+ Add screenshots</label>
        <span class="paste">or just paste with <kbd>${'⌘'}/Ctrl</kbd> + <kbd>V</kbd></span>
      </div>
      <input id="fb-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display:none">
      <div class="shots" id="fb-shots"></div>
    </div>
  </div>

  <div class="sec">
    <span class="num">3</span>
    <div class="body">
      <h2>Contact</h2>
      <p class="hint">Optional — leave a WhatsApp number or email if you'd like a reply.</p>
      <input id="fb-contact" type="text" maxlength="200" placeholder="WhatsApp / email" spellcheck="false">
    </div>
  </div>

  <input id="fb-web" class="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">

  <button id="fb-send">Send feedback</button>
  <div id="msg" class="msg"></div>

  <p class="alt">Prefer to chat? <a href="https://wa.me/qr/EWIFXEU2SCR6B1" target="_blank" rel="noreferrer">Message us on WhatsApp</a> or email <a href="mailto:support@poviai.com">support@poviai.com</a></p>
</div>`,
      script: `
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var msg = $('msg');
  function say(t, kind){ msg.textContent = t; msg.className = 'msg show ' + kind; }

  var files = [];
  var MAX = 3, MAX_SIZE = 5 * 1024 * 1024;
  var OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  function renderShots(){
    var box = $('fb-shots');
    box.textContent = '';
    files.forEach(function(f, idx){
      var d = document.createElement('div'); d.className = 'shot';
      var img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.onload = function(){ URL.revokeObjectURL(img.src); };
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'rm'; rm.textContent = '\\u00d7';
      rm.title = 'Remove';
      rm.onclick = function(){ files.splice(idx, 1); renderShots(); };
      d.appendChild(img); d.appendChild(rm); box.appendChild(d);
    });
  }

  // 选文件和粘贴走同一条收口：先卡数量/类型/大小，再渲染缩略图
  function addFiles(picked){
    var added = 0;
    for (var i = 0; i < picked.length; i++) {
      var f = picked[i];
      if (!f) continue;
      if (files.length >= MAX) { say('Up to ' + MAX + ' screenshots.', 'err'); break; }
      if (OK_TYPES.indexOf(f.type) < 0) { say('Only PNG / JPG / WebP / GIF images are supported.', 'err'); continue; }
      if (f.size > MAX_SIZE) { say('Each screenshot must be under 5 MB.', 'err'); continue; }
      files.push(f); added++;
    }
    renderShots();
    return added;
  }

  $('fb-file').onchange = function(){
    var picked = Array.prototype.slice.call(this.files || []);
    this.value = '';
    addFiles(picked);
  };

  // 直接 Ctrl/⌘+V 贴截图：剪贴板里的图没有文件名，这里补一个带后缀的
  document.addEventListener('paste', function(e){
    var cb = e.clipboardData;
    if (!cb) return;
    var items = cb.items || [];
    var picked = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind !== 'file') continue;
      var f = items[i].getAsFile();
      if (!f || OK_TYPES.indexOf(f.type) < 0) continue;
      if (!f.name) {
        var ext = f.type.split('/')[1].replace('jpeg', 'jpg');
        f = new File([f], 'pasted-' + (files.length + picked.length + 1) + '.' + ext, { type: f.type });
      }
      picked.push(f);
    }
    if (!picked.length) return;
    e.preventDefault();
    if (addFiles(picked)) say(picked.length > 1 ? 'Screenshots pasted.' : 'Screenshot pasted.', 'ok');
  });

  $('fb-send').onclick = async function(){
    var text = $('fb-msg').value.trim();
    if (text.length < 5) { say('Please describe your feedback first.', 'err'); return; }

    var q = new URLSearchParams(location.search);
    var fd = new FormData();
    fd.append('message', text);
    fd.append('contact', $('fb-contact').value.trim());
    fd.append('website', $('fb-web').value);
    fd.append('lang', q.get('lang') || navigator.language || '');
    fd.append('version', q.get('v') || '');
    files.forEach(function(f){ fd.append('shots', f, f.name); });

    var btn = this;
    btn.disabled = true;
    try {
      var res = await fetch('/feedback/submit', { method: 'POST', body: fd });
      var j = await res.json();
      if (j && j.code === 'OK') {
        say('Feedback received \\u2014 thank you! We read every single one.', 'ok');
        $('fb-msg').value = ''; $('fb-contact').value = '';
        files = []; renderShots();
      } else {
        say((j && j.message) || 'Something went wrong, please try again.', 'err');
      }
    } catch (e) {
      say('Network error, please try again.', 'err');
    }
    btn.disabled = false;
  };
})();
`,
    }),
  ),
);

r.post('/feedback/submit', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return fail(ERR.PARAM, 'Bad form data.');
  }

  // 蜜罐：真人看不见 website 字段，填了的都是机器人，假装成功打发走
  if (String(form.get('website') || '')) return ok({});

  const message = String(form.get('message') || '').trim();
  if (message.length < 5) return fail(ERR.PARAM, 'Please describe your feedback (at least 5 characters).');
  if (message.length > 4000) return fail(ERR.PARAM, 'Please keep it under 4000 characters.');

  // 同一 IP 一小时最多 5 条，够真人用，挡得住脚本灌水
  const ip = c.req.header('CF-Connecting-IP') || '';
  const rlKey = `fb-rl:${ip}`;
  const n = Number((await c.env.KV.get(rlKey)) || '0');
  if (n >= 5) return fail(ERR.RATE_LIMITED, 'Too many submissions from this network — please try again in an hour.');
  await c.env.KV.put(rlKey, String(n + 1), { expirationTtl: 3600 });

  // 截图（最多 3 张、各 5MB、只收常见图片格式）。key 里带随机段，
  // 只有 Access 门卫后的 /feedback/admin/shot 会去读，桶本身不公开。
  const shots: string[] = [];
  const raw = form.getAll('shots').filter((f): f is File => f instanceof File && f.size > 0);
  if (raw.length > 3) return fail(ERR.PARAM, 'Up to 3 screenshots.');
  const batch = uuid();
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    const ext = FEEDBACK_SHOT_TYPES[f.type];
    if (!ext) return fail(ERR.PARAM, 'Only PNG / JPG / WebP / GIF images are supported.');
    if (f.size > 5 * 1024 * 1024) return fail(ERR.PARAM, 'Each screenshot must be under 5 MB.');
    const key = `feedback/${batch}/${i + 1}.${ext}`;
    await c.env.R2.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    shots.push(key);
  }

  const user = await currentWebUser(c);
  await c.env.DB.prepare(
    `INSERT INTO messages (user_id, type, content, contact, extra) VALUES (?1, 'feedback', ?2, ?3, ?4)`,
  )
    .bind(
      user?.id ?? null,
      message,
      String(form.get('contact') || '').trim().slice(0, 200) || null,
      JSON.stringify({
        lang: String(form.get('lang') || '').slice(0, 16),
        version: String(form.get('version') || '').slice(0, 32),
        shots,
        source: 'site',
      }),
    )
    .run();

  return ok({});
});

// 查看后台：和 /wish/admin 同一套 Cloudflare Access 门卫（lib/owner.ts）。
// 处理器导出给 routes/admin.ts 复用（挂在 /admin/feedback* 下）：
// /admin 的边缘 Access 应用早就建好，而管理 Access 的 API token 权限缺失时
// /feedback/admin 建不了新应用 —— 挂进已有墙内就零配置可用。
// 页面脚本里的 data/shot 路径按 location.pathname 自适应，两处挂载共用一份实现。
type SiteCtx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;

export const feedbackAdminPage = (c: SiteCtx) => {
  const blocked = accessIdentityBlocked(c);
  if (blocked) return blocked;

  return html(
    page({
      title: brandTitle('Feedback Admin'),
      nav: '',
      style: `
  main{max-width:760px;padding-top:44px}
  .count{font-size:12px;color:var(--muted);margin:14px 0 4px}
  .row{border-bottom:1px solid var(--line);padding:12px 2px}
  .row .meta{font-size:12px;color:var(--muted);margin-bottom:4px}
  .row .body{font-size:14px;line-height:1.6;white-space:pre-wrap}
  .row .shots{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .row .shots img{height:96px;border:1px solid var(--line);border-radius:var(--r-sm);display:block}
`,
      body: `<div class="card">
  <h1>Feedback</h1>
  <p class="sub">Signed in via Cloudflare Access. Newest first.</p>
  <div id="msg" class="msg"></div>
  <div class="count" id="count"></div>
  <div id="list"></div>
</div>`,
      script: `
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var msg = $('msg');
  function say(t, kind){ msg.textContent = t; msg.className = 'msg show ' + kind; }

  var base = location.pathname.replace(/\\/+$/, '');
  (async function(){
    try {
      var res = await fetch(base + '/data?limit=200');
      var j = await res.json();
      if (!j || j.code !== 'OK') { say((j && j.message) || 'Request failed.', 'err'); return; }
      var list = $('list');
      list.textContent = '';
      $('count').textContent = j.data.total ? j.data.total + ' messages, newest first' : 'No feedback yet.';
      j.data.items.forEach(function(w){
        var row = document.createElement('div'); row.className = 'row';
        var meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = '#' + w.id + ' \\u00b7 ' + w.createdAt
          + (w.lang ? ' \\u00b7 ' + w.lang : '') + (w.version ? ' \\u00b7 v' + w.version : '')
          + (w.userId ? ' \\u00b7 user:' + w.userId : '') + (w.contact ? ' \\u00b7 ' + w.contact : '');
        var body = document.createElement('div'); body.className = 'body';
        body.textContent = w.content;
        row.appendChild(meta); row.appendChild(body);
        if (w.shots && w.shots.length) {
          var shots = document.createElement('div'); shots.className = 'shots';
          w.shots.forEach(function(k){
            var a = document.createElement('a');
            a.href = base + '/shot?key=' + encodeURIComponent(k);
            a.target = '_blank';
            var im = document.createElement('img');
            im.src = a.href; im.loading = 'lazy';
            a.appendChild(im); shots.appendChild(a);
          });
          row.appendChild(shots);
        }
        list.appendChild(row);
      });
    } catch (e) {
      say('Network error.', 'err');
    }
  })();
})();
`,
    }),
  );
};
r.get('/feedback/admin', feedbackAdminPage);

export const feedbackAdminData = async (c: SiteCtx) => {
  const blocked = accessIdentityBlocked(c);
  if (blocked) return blocked;

  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, content, contact, extra, created_at
     FROM messages WHERE type = 'feedback' ORDER BY id DESC LIMIT ?1`,
  )
    .bind(limit)
    .all<{ id: number; user_id: string | null; content: string; contact: string | null; extra: string | null; created_at: number }>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE type = 'feedback'`).first<{
    n: number;
  }>();

  const items = results.map((m) => {
    let extra: { lang?: string; version?: string; shots?: string[] } = {};
    try {
      extra = JSON.parse(m.extra || '{}');
    } catch {}
    return {
      id: m.id,
      userId: m.user_id,
      content: m.content,
      contact: m.contact,
      lang: extra.lang || '',
      version: extra.version || '',
      shots: Array.isArray(extra.shots) ? extra.shots : [],
      createdAt: new Date(m.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    };
  });

  return ok({ total: total?.n ?? 0, items });
};
r.get('/feedback/admin/data', feedbackAdminData);

// 截图只从这里出：路径必须落在 feedback/ 前缀里，别的 R2 对象一概不给
export const feedbackAdminShot = async (c: SiteCtx) => {
  const blocked = accessIdentityBlocked(c);
  if (blocked) return blocked;

  const key = c.req.query('key') || '';
  if (!/^feedback\/[A-Za-z0-9-]+\/\d+\.(png|jpg|webp|gif)$/.test(key)) {
    return c.notFound();
  }
  const obj = await c.env.R2.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
r.get('/feedback/admin/shot', feedbackAdminShot);

r.get('/kol/uninstall', () =>
  html(
    page({
      title: brandTitle(st('uninstall_page_title')),
      seo: { path: '/kol/uninstall', noindex: true },
      style: `
  main{max-width:640px;padding-top:64px}
`,
      body: `<div class="card" style="text-align:center">
  <h1>${st('uninstall_h1', { brand: BRAND_NAME })}</h1>
  <p class="sub">${st('uninstall_sub')}</p>
  <p style="color:var(--muted);font-size:14px">${st('uninstall_how')}</p>
</div>`,
    }),
  ),
);

r.get('/tiktok-test', () =>
  html(
    page({
      title: brandTitle(st('nettest_page_title')),
      seo: { path: '/tiktok-test', desc: st('seo_desc_nettest') },
      style: `
  main{max-width:680px;padding-top:56px}
  #rst{font-family:var(--mono);font-weight:600}
`,
      body: `<div class="card">
  <h1>${st('nettest_h1')}</h1>
  <p class="sub">${st('nettest_sub')}</p>
  <p style="font-size:14px;line-height:1.9;color:var(--muted)">
    ${st('nettest_body')}<span id="rst">${st('nettest_checking')}</span>
  </p>
</div>`,
      script: `
var OK = ${JSON.stringify(`<span style="color:var(--ok)">${st('nettest_ok')}</span>`)};
var BAD = ${JSON.stringify(`<span style="color:var(--danger)">${st('nettest_bad')}</span>`)};
fetch('https://www.tiktok.com', { mode:'no-cors', signal: AbortSignal.timeout(5000) })
  .then(function(){ document.getElementById('rst').innerHTML = OK; })
  .catch(function(){ document.getElementById('rst').innerHTML = BAD; });
`,
    }),
  ),
);

// 应用页（工作台 / 收藏夹 / 搜索 / 推广计划 / 工具…）全部在 routes/site-kol.ts

// 首页：产品营销页。报纸头版式 hero + 跑马灯 + 划线功能格 + 链接页脚
r.get('/', (c) => {
  const feats: Array<[string, string, string]> = [
    ['download', st('hm_feat_dl_t'), st('hm_feat_dl_b')],
    ['chat', st('hm_feat_cap_t'), st('hm_feat_cap_b')],
    ['chart', st('hm_feat_data_t'), st('hm_feat_data_b')],
    ['sparkle', st('hm_feat_ai_t'), st('hm_feat_ai_b')],
  ];
  const showcase: Array<[string, string]> = [
    ['/site/showcase/scene-open.webp', st('brand_tagline')],
    ['/site/showcase/scene-profile.webp', st('hm_feat_data_t')],
    ['/site/showcase/scene-rankings.webp', st('nv_kol_rank')],
    ['/site/showcase/scene-download.webp', st('nv_download')],
    ['/site/showcase/scene-batch.webp', st('nv_download')],
    ['/site/showcase/scene-script.webp', st('nv_ai_script')],
    ['/site/showcase/scene-rewrite.webp', st('hm_feat_ai_t')],
    ['/site/showcase/scene-analysis.webp', st('hm_feat_data_t')],
    ['/site/showcase/scene-tasks.webp', st('nv_batch_tasks')],
    ['/site/showcase/scene-relay-create.webp', st('hm_feat_ai_t')],
    ['/site/showcase/scene-relay-plan.webp', st('nv_calendar')],
    ['/site/showcase/scene-outro.webp', st('hm_gallery_t')],
  ];
  const showcaseCards = (duplicate = false) => showcase
    .map(([src, label]) => {
      const accessibility = duplicate
        ? ' aria-hidden="true" tabindex="-1"'
        : ` aria-label="${escapeHtml(`${st('hm_gallery_expand')}: ${label}`)}"`;
      return `<button class="shot" type="button" data-lightbox="${src}" data-caption="${escapeHtml(label)}"${accessibility}><img src="${src}" alt="${duplicate ? '' : escapeHtml(label)}" loading="lazy" decoding="async"><span>${escapeHtml(label)}<em>${escapeHtml(st('hm_gallery_expand'))}</em></span></button>`;
    })
    .join('\n');

  // 保留原有评论墙；新增媒体展廊只能向下扩充首页，不能替换既有内容。
  const REVIEWER_NAMES = [
    'Marcus T.',
    '@linh.sourcing',
    'Renata S.',
    'Jake W.',
    'Priya N.',
    'Tomás R.',
    '@kenji.creates',
    'Amelia B.',
  ];
  const reviews: Array<[string, string, string]> = REVIEWER_NAMES.map((name, i) => [
    st(`hm_rv${i + 1}_q`),
    name,
    st(`hm_rv${i + 1}_r`),
  ]);
  const rvCard = ([q, name, role]: [string, string, string], i: number) => `<figure class="rv">
    <blockquote>${escapeHtml(q)}</blockquote>
    <figcaption>
      <span class="av a${i % 3}">${escapeHtml(name.replace(/^@/, '').slice(0, 1).toUpperCase())}</span>
      <span><b>${escapeHtml(name)}</b><i>${escapeHtml(role)}</i></span>
    </figcaption>
  </figure>`;
  const rvRow = (list: typeof reviews, rev: boolean) => {
    const seg = `<div class="wall-seg">${list.map(rvCard).join('')}</div>`;
    return `<div class="wall-row${rev ? ' rev' : ''}">${seg}<div aria-hidden="true">${seg}</div></div>`;
  };

  const cols: Array<[string, Array<[string, string]>]> = [
    [st('nv_influencers'), [
      [st('nv_kol_search'), '/kol/search'],
      [st('nv_kol_rank'), '/kol/kol-rank'],
      [st('nv_kol_fav'), '/kol/collect?type=CREATOR'],
    ]],
    [st('ft_col_outreach'), [
      [st('nv_promotional'), '/kol/promotional'],
      [st('nv_coop_active'), '/kol/cooperateactive'],
      [st('nv_batch_tasks'), '/kol/task'],
    ]],
    [st('ft_col_product'), [
      [st('nv_product_search'), '/kol/product-search'],
      [st('nv_video_search'), '/kol/video-search'],
      [st('nv_calendar'), '/kol/calendar'],
    ]],
    [st('ft_col_tools'), [
      [st('nv_download'), '/tools/video-download'],
      [st('nv_ai_script'), '/tools/script-analysis'],
      [st('nv_hashtag'), '/tools/hashtag-generator'],
      [st('nettest_h1'), '/tiktok-test'],
      [st('nv_guide'), '/kol/guide'],
    ]],
  ];

  return html(
    page({
      // 首页 title 品牌在前（截断时保住品牌），其他页走 brandTitle() 的「页名 · 品牌」
      title: `${BRAND_NAME} — ${st('seo_title_home')}`,
      seo: {
        path: reqPath(c),
        desc: st('seo_desc_home'),
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: BRAND_NAME,
            url: `${CANONICAL_ORIGIN}/`,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: BRAND_NAME,
            operatingSystem: 'Chrome',
            applicationCategory: 'BrowserApplication',
            url: `${CANONICAL_ORIGIN}/`,
            image: `${CANONICAL_ORIGIN}/og.png`,
            description: st('seo_desc_home'),
            // 插件免费装、有免费额度，付费在 /price —— price 0 是真实的入门价
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          },
        ],
      },
      nav: `<a href="/kol/workbench">${st('nv_dashboard')}</a><a href="/price">${st('nav_price')}</a><a href="/kol/personal">${st('nav_me')}</a>`,
      style: `
  html,body{overflow-x:clip}
  main{max-width:1180px;padding-top:20px}
  .hero{position:relative;padding:46px 0 38px}
  .hero-grid{display:grid;grid-template-columns:minmax(0,.82fr) minmax(520px,1.18fr);gap:44px;align-items:center}
  .hero h1{font-size:clamp(34px,6.4vw,58px);line-height:1.08;letter-spacing:-.025em;margin:0;max-width:16ch}
  .tagline{max-width:640px;margin:22px 0 0;font-size:17px;line-height:1.7;color:var(--ink)}
  .herosub{max-width:640px;margin:12px 0 0;font-size:13.5px;color:var(--muted)}
  .ctas{display:flex;gap:14px;margin-top:32px;flex-wrap:wrap}
  .cta{
    display:inline-block;padding:12px 28px;background:var(--primary);color:#fff;border:0;
    border-radius:var(--r-full);font-size:14.5px;font-weight:600;text-decoration:none;white-space:nowrap;
    transition:background .15s;
  }
  .cta:hover{color:#fff;background:var(--primary-dark);text-decoration:none}
  .cta:active{transform:scale(.99)}
  .cta.ghost{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}
  .cta.ghost:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 12%,transparent)}
  .trust{margin:18px 0 0;font-family:var(--mono);font-size:11.5px;letter-spacing:.05em;color:var(--muted)}
  .hero-media{
    position:relative;display:block;width:100%;padding:0;overflow:hidden;cursor:pointer;
    aspect-ratio:16/9;border:1px solid color-mix(in srgb,var(--ink) 5%,transparent);
    border-radius:26px;background:#12141a;color:#fff;box-shadow:0 24px 64px rgba(18,20,26,.12);
    text-align:left;isolation:isolate;
  }
  .hero-media video{display:block;width:100%;height:100%;object-fit:contain;background:#12141a}
  .hero-media::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 54%,rgba(7,9,13,.58));pointer-events:none}
  .media-kicker{position:absolute;left:20px;top:18px;z-index:2;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c6d0ff}
  .media-play{position:absolute;left:20px;right:20px;bottom:17px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:18px}
  .media-play b{font-family:var(--serif);font-size:18px;line-height:1.2;color:#fff}
  .play-dot{width:44px;height:44px;flex:0 0 44px;border-radius:50%;display:grid;place-items:center;background:#fff;color:#12141a;box-shadow:0 8px 30px rgba(0,0,0,.22)}
  .hero-media:hover .play-dot,.hero-media:focus-visible .play-dot{transform:scale(1.08)}
  @media (max-width:960px){
    .hero-grid{grid-template-columns:1fr;gap:34px}.hero-copy{max-width:760px}.hero-media{max-width:820px}
  }
  @media (max-width:620px){
    .hero{padding-top:30px}.hero-grid{gap:26px}.media-kicker{left:14px;top:13px}.media-play{left:14px;right:14px;bottom:12px}.media-play b{font-size:15px}.play-dot{width:38px;height:38px;flex-basis:38px}
  }
  .ticker{
    margin:34px calc(50% - 50vw) 0;background:var(--rule);color:var(--paper);overflow:hidden;
    border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);
  }
  .ticker-in{display:flex;width:max-content;white-space:nowrap}
  .tk-copy{display:inline-flex;align-items:center;gap:36px;padding:9px 36px 9px 0}
  .tk-copy i{color:var(--accent);font-style:normal}
  .tk-copy span{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
  @media (prefers-reduced-motion:no-preference){
    .ticker-in{animation:tick 30s linear infinite}
    @keyframes tick{to{transform:translateX(-50%)}}
  }
  .feats{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1px;
    margin:48px 0;background:var(--line);border:1px solid var(--line);
    border-radius:var(--r-lg);overflow:hidden;
  }
  .feat{background:var(--card);padding:26px 24px;transition:background .18s,color .18s}
  .feat .top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
  .feat .top .ic{color:var(--accent)}
  .feat .no{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--muted)}
  .feat h3{font-family:var(--serif);font-size:16.5px;margin:0 0 7px}
  .feat p{font-size:13px;color:var(--muted);margin:0;line-height:1.8;transition:color .18s}
  .feat:hover{background:var(--rule);color:var(--paper)}
  .feat:hover h3{color:var(--paper)}
  .feat:hover p{color:color-mix(in srgb,var(--paper) 72%,transparent)}
  .sec-h{font-size:23px;font-weight:700;letter-spacing:-.015em;margin:0 0 22px}
  .wall{margin:0 calc(50% - 50vw) 52px;overflow:hidden;padding:4px 0}
  .wall-row{display:flex;width:max-content;margin-bottom:14px}
  .wall-row:last-child{margin-bottom:0}
  .wall-row > [aria-hidden]{display:contents}
  .wall-seg{display:flex;gap:14px;padding-right:14px}
  @media (prefers-reduced-motion:no-preference){
    .wall-row{animation:tick 52s linear infinite}
    .wall-row.rev{animation-direction:reverse}
    .wall-row:hover{animation-play-state:paused}
  }
  @media (prefers-reduced-motion:reduce){
    .wall-row{flex-wrap:wrap;width:auto;margin:0 20px 14px}
    .wall-row > [aria-hidden]{display:none}
    .wall-seg{flex-wrap:wrap}
  }
  .rv{
    width:330px;margin:0;background:var(--card);border:0;border-radius:var(--r-lg);
    padding:18px 20px 16px;display:flex;flex-direction:column;gap:14px;
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 1px 3px rgba(0,0,0,.06);
    transition:transform .15s,box-shadow .15s;
  }
  .rv:hover{transform:translateY(-3px);box-shadow:var(--hard)}
  .rv blockquote{margin:0;font-family:var(--serif);font-size:14px;line-height:1.75;white-space:normal}
  .rv blockquote::before{content:'\\201C';display:block;font-family:var(--serif);font-size:36px;line-height:.55;color:var(--accent);margin-bottom:10px}
  .rv figcaption{display:flex;align-items:center;gap:10px;margin-top:auto}
  .rv .av{width:30px;height:30px;flex:0 0 30px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;border-radius:var(--r-full);background:var(--rule);color:var(--paper)}
  .rv .av.a1{background:var(--primary);color:#fff}
  .rv .av.a2{background:transparent;color:var(--ink);border:1px solid var(--muted)}
  .rv b{display:block;font-size:12.5px;line-height:1.4}
  .rv i{font-style:normal;font-family:var(--mono);font-size:10px;letter-spacing:.05em;color:var(--muted);text-transform:uppercase}
  .showcase{margin:62px calc(50% - 50vw) 66px;padding:48px max(24px,calc((100vw - 1180px)/2));background:#12141a;color:#fff}
  .showcase-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:24px}
  .showcase-head h2{font-family:var(--serif);font-size:clamp(28px,4vw,48px);line-height:1;margin:0;color:#fff}
  .showcase-head p{max-width:520px;margin:10px 0 0;color:#aeb3be;font-size:13px;line-height:1.7}
  .rail-controls{display:flex;gap:8px}
  .rail-btn{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:transparent;color:#fff;cursor:pointer;font-size:18px}
  .rail-btn:hover,.rail-btn:focus-visible{background:#fff;color:#12141a}
  .showcase-rail{overflow-x:auto;scrollbar-width:none;padding:5px 1px 16px;overscroll-behavior-inline:contain}
  .showcase-rail::-webkit-scrollbar{display:none}
  .showcase-track{display:flex;width:max-content}
  .showcase-segment{display:flex;gap:18px;padding-right:18px}
  .shot{position:relative;flex:0 0 min(76vw,660px);padding:0;border:1px solid rgba(255,255,255,.08);border-radius:20px;overflow:hidden;background:#f3f2ed;color:#fff;cursor:zoom-in;text-align:left;box-shadow:0 16px 42px rgba(0,0,0,.16)}
  .shot img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#f3f2ed;transition:transform .35s ease}
  .shot span{position:absolute;left:14px;right:14px;bottom:13px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(12,14,19,.84);backdrop-filter:blur(12px);font-size:12px;font-weight:650}
  .shot:hover img,.shot:focus-visible img{transform:scale(1.018)}
  .shot em{font-style:normal;color:#aebcff;font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase}
  @media (prefers-reduced-motion:reduce){.showcase-segment[aria-hidden="true"]{display:none}}
  @media (max-width:620px){.showcase{padding-top:36px;padding-bottom:38px}.showcase-head{align-items:flex-start}.rail-controls{display:none}.shot{flex-basis:88vw}}
  .media-dialog{width:min(1100px,calc(100vw - 28px));max-width:none;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid rgba(255,255,255,.07);border-radius:22px;background:#0f1116;color:#fff;box-shadow:0 34px 100px rgba(0,0,0,.38);animation:none;overflow:hidden}
  .media-dialog[open]{display:flex;flex-direction:column}
  .media-dialog::backdrop{background:rgba(7,8,11,.78);backdrop-filter:blur(12px)}
  .dialog-bar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.12)}
  .dialog-bar b{font-family:var(--serif);font-size:15px;color:#fff}
  .dialog-close{width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:20px;line-height:1}
  .dialog-close:hover,.dialog-close:focus-visible{background:#fff;color:#111318}
  .promo-stage{position:relative;flex:1 1 auto;min-height:0;aspect-ratio:16/9;background:#0b0d11 url(/site/showcase/promo-poster.webp) center/contain no-repeat}
  .promo-stage iframe,.promo-stage video{display:block;width:100%;height:100%;border:0;object-fit:contain;background:#0b0d11}
  .promo-stage iframe[hidden],.promo-stage video[hidden]{display:none}
  .promo-options{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1);font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
  .promo-options button,.promo-options a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 13px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:transparent;color:#d8dbe4;text-decoration:none;cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit}
  .promo-options button:hover,.promo-options button:focus-visible,.promo-options a:hover,.promo-options a:focus-visible{background:#fff;color:#111318}
  .media-dialog .lightbox-img{display:block;width:100%;flex:1 1 auto;min-height:0;object-fit:contain;background:#0b0d11}
  .cols{
    display:flex;gap:70px;flex-wrap:wrap;justify-content:center;
    border-top:1px solid var(--line);padding-top:30px
  }
  .cols .col{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:13px;text-align:center}
  .cols .t{
    font-size:12px;font-weight:600;
    color:var(--muted);margin-bottom:4px;
  }
  .cols a{color:var(--ink);text-decoration:none}
  .cols a:hover{color:var(--accent)}
`,
      body: `
<div class="hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <h1>${BRAND_NAME}</h1>
      <p class="tagline">${st('brand_tagline')}</p>
      <p class="herosub">${st('hm_hero_sub')}</p>
      <div class="ctas">
        <a class="cta" href="/kol/guide">${st('hm_cta_install')}</a>
        <a class="cta ghost" href="/kol/workbench">${st('hm_cta_web')}</a>
      </div>
      <p class="trust">${st('hm_trust')}</p>
    </div>
    <button class="hero-media" type="button" data-open-promo aria-label="${escapeHtml(st('hm_media_play'))}">
      <video id="heroVideo" autoplay muted loop playsinline preload="metadata" poster="/site/showcase/promo-poster.webp" aria-hidden="true">
        <source src="/site/showcase/promo-loop.webm" type="video/webm">
        <source src="/site/showcase/promo-loop.mp4" type="video/mp4">
      </video>
      <span class="media-kicker">${escapeHtml(st('hm_media_eyebrow'))}</span>
      <span class="media-play"><b>${escapeHtml(st('hm_media_play'))}</b><i class="play-dot" aria-hidden="true">▶</i></span>
    </button>
  </div>
</div>
<div class="ticker" aria-hidden="true"><div class="ticker-in">
${(() => {
  const copy = feats.map(([, t]) => `<span>${escapeHtml(t)}</span>`).join('<i>✦</i>');
  return `<div class="tk-copy">${copy}<i>✦</i></div><div class="tk-copy">${copy}<i>✦</i></div>`;
})()}
</div></div>
<div class="feats">
${feats
  .map(
    ([icon, t, b], i) => `  <div class="feat">
    <div class="top">${ic(icon, 24)}<span class="no">${String(i + 1).padStart(2, '0')}</span></div>
    <h3>${escapeHtml(t)}</h3><p>${escapeHtml(b)}</p>
  </div>`,
  )
  .join('\n')}
</div>
<h2 class="sec-h">${st('hm_reviews_t')}</h2>
<div class="wall">
${rvRow(reviews.slice(0, 4), false)}
${rvRow(reviews.slice(4), true)}
</div>
<section class="showcase" aria-labelledby="showcaseTitle">
  <div class="showcase-head">
    <div><h2 id="showcaseTitle">${escapeHtml(st('hm_gallery_t'))}</h2><p>${escapeHtml(st('hm_gallery_sub'))}</p></div>
    <div class="rail-controls" aria-label="${escapeHtml(st('hm_gallery_t'))}"><button class="rail-btn" type="button" data-rail-prev aria-label="${escapeHtml(st('hm_gallery_prev'))}">←</button><button class="rail-btn" type="button" data-rail-next aria-label="${escapeHtml(st('hm_gallery_next'))}">→</button></div>
  </div>
  <div class="showcase-rail" tabindex="0">
    <div class="showcase-track">
      <div class="showcase-segment">${showcaseCards()}</div>
      <div class="showcase-segment" aria-hidden="true">${showcaseCards(true)}</div>
    </div>
  </div>
</section>
<div class="cols">
${cols
  .map(
    ([t, links]) => `  <div class="col"><div class="t">${escapeHtml(t)}</div>${links
      .map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`)
      .join('')}</div>`,
  )
  .join('\n')}
</div>
<dialog id="promoDialog" class="media-dialog" aria-label="${escapeHtml(st('hm_modal_title', { brand: BRAND_NAME }))}">
  <div class="dialog-bar"><b>${escapeHtml(st('hm_modal_title', { brand: BRAND_NAME }))}</b><button class="dialog-close" type="button" data-close-dialog aria-label="${escapeHtml(st('hm_modal_close'))}">×</button></div>
  <div class="promo-stage">
    <iframe id="promoYoutube" title="${escapeHtml(st('hm_modal_title', { brand: BRAND_NAME }))}" allow="autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" data-src="https://www.youtube-nocookie.com/embed/5BJ64T5X1WE?autoplay=1&amp;rel=0&amp;playsinline=1&amp;enablejsapi=1&amp;origin=https%3A%2F%2Ftiktok.poviai.com"></iframe>
    <video id="promoFull" controls playsinline preload="none" poster="/site/showcase/promo-poster.webp" data-src="/site/showcase/promo-full.mp4" hidden></video>
  </div>
  <div class="promo-options"><button type="button" data-promo-fallback>MP4 backup</button><a href="https://youtu.be/5BJ64T5X1WE" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div>
</dialog>
<dialog id="imageDialog" class="media-dialog" aria-label="${escapeHtml(st('hm_gallery_t'))}">
  <div class="dialog-bar"><b id="imageCaption">${escapeHtml(st('hm_gallery_t'))}</b><button class="dialog-close" type="button" data-close-dialog aria-label="${escapeHtml(st('hm_modal_close'))}">×</button></div>
  <img id="lightboxImage" class="lightbox-img" alt="">
</dialog>`,
      script: `
(function(){
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var heroVideo = document.getElementById('heroVideo');
  if (reduceMotion && heroVideo) heroVideo.pause();

  var promoDialog = document.getElementById('promoDialog');
  var promoYoutube = document.getElementById('promoYoutube');
  var promoFull = document.getElementById('promoFull');
  var youtubeReady = false;
  var youtubeTimer;
  var youtubePing;

  function stopYoutube(){
    window.clearTimeout(youtubeTimer);
    window.clearInterval(youtubePing);
    promoYoutube.removeAttribute('src');
  }
  function markYoutubeReady(){
    youtubeReady = true;
    window.clearTimeout(youtubeTimer);
    window.clearInterval(youtubePing);
  }
  function pingYoutube(){
    if (!promoYoutube.contentWindow) return;
    promoYoutube.contentWindow.postMessage(JSON.stringify({event:'listening', id:'promoYoutube', channel:'promo'}), 'https://www.youtube-nocookie.com');
  }
  function playBackup(automatic){
    if (automatic && youtubeReady) return;
    stopYoutube();
    promoYoutube.hidden = true;
    promoFull.hidden = false;
    if (!promoFull.getAttribute('src')) {
      promoFull.setAttribute('src', promoFull.dataset.src);
      promoFull.load();
    }
    promoFull.play().catch(function(){});
  }
  function playYoutube(){
    youtubeReady = false;
    promoFull.pause();
    promoFull.hidden = true;
    promoYoutube.hidden = false;
    // 预热本地片源：YT 走不通时（超时/onError）兜底能立即起播，而不是从零开始缓冲。
    if (!promoFull.getAttribute('src')) {
      promoFull.preload = 'auto';
      promoFull.setAttribute('src', promoFull.dataset.src);
      promoFull.load();
    }
    // origin 必须是页面实际域名：写死会让 YT 拒绝建立消息通道，本地/别名域上永远收不到事件。
    promoYoutube.setAttribute('src', promoYoutube.dataset.src.replace(/origin=[^&]*/, 'origin=' + encodeURIComponent(location.origin)));
    window.clearTimeout(youtubeTimer);
    window.clearInterval(youtubePing);
    youtubeTimer = window.setTimeout(function(){ playBackup(true); }, 4000);
    youtubePing = window.setInterval(pingYoutube, 500);
  }
  window.addEventListener('message', function(event){
    if (event.origin !== 'https://www.youtube.com' && event.origin !== 'https://www.youtube-nocookie.com') return;
    var message = event.data;
    if (typeof message === 'string') {
      try { message = JSON.parse(message); } catch (_) { return; }
    }
    if (!message) return;
    // onError（101/150/153 = 拒绝嵌入播放）立即切本地片源，不再黑屏干等。
    if (message.event === 'onError' && promoDialog.open && !promoYoutube.hidden) { playBackup(false); return; }
    if (message.event === 'onReady' || message.event === 'initialDelivery' || message.event === 'infoDelivery') markYoutubeReady();
  });
  promoYoutube.addEventListener('load', pingYoutube);
  promoYoutube.addEventListener('error', function(){ playBackup(true); });
  document.querySelector('[data-promo-fallback]').addEventListener('click', function(){ playBackup(false); });
  document.querySelector('[data-open-promo]').addEventListener('click', function(){
    promoDialog.showModal();
    playYoutube();
  });

  var imageDialog = document.getElementById('imageDialog');
  var lightboxImage = document.getElementById('lightboxImage');
  var imageCaption = document.getElementById('imageCaption');
  document.querySelectorAll('[data-lightbox]').forEach(function(button){
    button.addEventListener('click', function(){
      lightboxImage.src = button.dataset.lightbox;
      lightboxImage.alt = button.dataset.caption || '';
      imageCaption.textContent = button.dataset.caption || '';
      imageDialog.showModal();
    });
  });

  document.querySelectorAll('[data-close-dialog]').forEach(function(button){
    button.addEventListener('click', function(){ button.closest('dialog').close(); });
  });
  document.querySelectorAll('dialog').forEach(function(dialog){
    dialog.addEventListener('click', function(event){
      var rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  promoDialog.addEventListener('close', function(){ stopYoutube(); promoFull.pause(); });

  var rail = document.querySelector('.showcase-rail');
  var railLastTime = 0;
  var railPaused = reduceMotion;
  var railResumeTimer;
  var railRampStart = 0;
  var railPosition = rail.scrollLeft;
  function railLoopWidth(){ return rail.scrollWidth / 2; }
  function animateRail(time){
    if (!railPaused) {
      if (!railRampStart) railRampStart = time;
      if (railLastTime) {
        var ramp = Math.min(1, (time - railRampStart) / 700);
        railPosition += (time - railLastTime) * 0.018 * ramp * ramp;
      }
      var width = railLoopWidth();
      if (width && railPosition >= width) railPosition -= width;
      rail.scrollLeft = railPosition;
    }
    railLastTime = time;
    window.requestAnimationFrame(animateRail);
  }
  function pauseRail(){ railPaused = true; railLastTime = 0; railRampStart = 0; railPosition = rail.scrollLeft; window.clearTimeout(railResumeTimer); }
  function resumeRail(delay){
    window.clearTimeout(railResumeTimer);
    if (reduceMotion) return;
    railResumeTimer = window.setTimeout(function(){ railPaused = false; railLastTime = 0; railRampStart = 0; railPosition = rail.scrollLeft; }, delay || 0);
  }
  function nudgeRail(direction){
    pauseRail();
    var width = railLoopWidth();
    // 复制段只在非 reduce-motion 下存在，两处循环回跳都以此为前提。
    if (!reduceMotion && width && rail.scrollLeft >= width) rail.scrollLeft -= width;
    if (!reduceMotion && direction < 0 && width && rail.scrollLeft < rail.clientWidth * .8) rail.scrollLeft += width;
    var cards = rail.querySelectorAll('.shot');
    if (!cards.length) return;
    var railRect = rail.getBoundingClientRect();
    var viewCenter = rail.scrollLeft + rail.clientWidth / 2;
    var centers = [];
    var nearest = 0;
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      centers[i] = rect.left - railRect.left + rail.scrollLeft + rect.width / 2;
      if (Math.abs(centers[i] - viewCenter) < Math.abs(centers[nearest] - viewCenter)) nearest = i;
    }
    var target = Math.min(cards.length - 1, Math.max(0, nearest + direction));
    var left = Math.max(0, Math.min(centers[target] - rail.clientWidth / 2, rail.scrollWidth - rail.clientWidth));
    rail.scrollTo({left: left, behavior: reduceMotion ? 'auto' : 'smooth'});
    resumeRail(1600);
  }
  document.querySelector('[data-rail-prev]').addEventListener('click', function(){ nudgeRail(-1); });
  document.querySelector('[data-rail-next]').addEventListener('click', function(){ nudgeRail(1); });
  rail.addEventListener('pointerenter', pauseRail);
  rail.addEventListener('pointerleave', function(){ resumeRail(0); });
  rail.addEventListener('focusin', pauseRail);
  rail.addEventListener('focusout', function(){ resumeRail(0); });
  rail.addEventListener('touchstart', pauseRail, {passive:true});
  rail.addEventListener('touchend', function(){ resumeRail(1200); }, {passive:true});
  rail.addEventListener('scroll', function(){ if (railPaused) railPosition = rail.scrollLeft; }, {passive:true});
  document.addEventListener('visibilitychange', function(){ railLastTime = 0; railRampStart = 0; });
  window.requestAnimationFrame(animateRail);
})();
`,
    }),
  );
});

export default r;
