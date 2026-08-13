import type { Env } from '../lib/types';
import { googleEnabled } from '../lib/google-oauth';

/**
 * Google One Tap（GIS）：未登录访客打开任意官网页面时，右上角自动弹
 * Google 账号提示，一键（或 auto_select 直接免点）登录，不用进登录页。
 *
 * 接法是「响应后处理」中间件而不是改每个页面模板 —— 官网有两套壳
 * （layout.page 营销页 + shell.appPage 工作台页）合计 30+ 个调用点，
 * 在出口统一往 </body> 前塞一段脚本，一处实现全站生效。
 *
 * 判断「未登录」用的是有没有 sid cookie，不查库：cookie 的 Max-Age 和
 * 会话 TTL 同为 30 天，基本对齐；会话刚好失效而 cookie 还在的边缘情况，
 * 用户点导航栏「登录」走老路即可，不值得为它每个页面查一次 D1。
 *
 * ⚠️ GCP 后台（poviai-kol-web 客户端）必须把两个站点域名加进
 * 「Authorized JavaScript origins」，否则 GSI 脚本报
 * "The given origin is not allowed for the given client ID"，One Tap 不出现。
 */

/** 页面端引导脚本。credential 回传 /kol/exlogin/google/onetap 换会话。 */
function oneTapSnippet(clientId: string): string {
  return `<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>(function(){
  var booted = false;
  function boot(){
    if (booted || !(window.google && google.accounts && google.accounts.id)) return;
    booted = true;
    google.accounts.id.initialize({
      client_id: ${JSON.stringify(clientId)},
      callback: function(resp){
        if (!resp || !resp.credential) return;
        var lang = document.documentElement.lang || '';
        fetch('/kol/exlogin/google/onetap?lang=' + encodeURIComponent(lang), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: resp.credential })
        }).then(function(r){ return r.json(); }).then(function(j){
          if (j && j.code === 'OK') {
            if (typeof window.__kolOneTapDone === 'function') window.__kolOneTapDone(j.data || {});
            else location.reload();
          }
        }).catch(function(){});
      },
      auto_select: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: false,
      context: 'signin'
    });
    google.accounts.id.prompt();
  }
  var s = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
  if (s) s.addEventListener('load', boot);
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();</script>`;
}

/**
 * 响应后处理：未登录访客的 HTML 页面，在 </body> 前注入 One Tap 引导。
 * 挂在 site.ts / site-kol.ts 两个页面路由上（r.use('*', oneTapInject)）。
 */
export async function oneTapInject(
  c: {
    env: Env;
    req: { header: (k: string) => string | undefined; path: string };
    res: Response;
  },
  next: () => Promise<void>,
): Promise<void> {
  await next();

  if (!googleEnabled(c.env)) return;
  // 有 sid cookie 视为已登录（见文件头注释）
  if (/(?:^|;\s*)sid=/.test(c.req.header('Cookie') || '')) return;
  // 管理页（/wish/admin、/feedback/admin）在 Access 墙后，别往里塞登录提示
  if (c.req.path.includes('/admin')) return;
  const ct = c.res.headers.get('Content-Type') || '';
  if (!ct.includes('text/html')) return;

  const body = await c.res.text();
  const idx = body.lastIndexOf('</body>');
  // site.ts 和 site-kol.ts 都挂了本中间件，而两个路由器都 mount 在 '/'——
  // site.ts 的页面会把两层都走一遍（Hono 按注册顺序串联匹配的 use('*')）。
  // 注入前先查一遍，保证不管挂载顺序怎么调都只注入一次。
  const already = body.includes('accounts.google.com/gsi/client');
  // text() 已把原 body 消费掉，无论注不注入都必须重建响应
  const out =
    idx < 0 || already
      ? body
      : body.slice(0, idx) + oneTapSnippet(c.env.GOOGLE_CLIENT_ID!) + body.slice(idx);
  const res = new Response(out, c.res);
  res.headers.delete('Content-Length');
  c.res = res;
}
