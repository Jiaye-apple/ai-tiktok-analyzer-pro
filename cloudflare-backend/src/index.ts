import { Hono } from 'hono';
import type { Env, UserRow } from './lib/types';
import { extractToken, getUserByToken } from './lib/auth';
import { ERR, fail, ok } from './lib/response';
import { parseLang, withLang } from './lib/i18n';
import { handleQueue, handleScheduled } from './lib/jobs';
import { handleInboundEmail } from './lib/mail-inbound';
import { isHtmlNavigation, notFoundHtml } from './site/layout';

import publicRoutes from './routes/public';
import userRoutes from './routes/user';
import quotaRoutes from './routes/quota';
import activationRoutes from './routes/activation';
import collectionRoutes from './routes/collection';
import promotionRoutes from './routes/promotion';
import creatorRoutes from './routes/creator';
import videoRoutes from './routes/video';
import captionRoutes from './routes/caption';
import copyScriptRoutes from './routes/copy-script';
import productRoutes from './routes/product';
import cooperateRoutes from './routes/cooperate';
import messageRoutes from './routes/message';
import ingestRoutes from './routes/ingest';
import adminRoutes from './routes/admin';
import payRoutes from './routes/pay';
import legalRoutes from './routes/legal';
import siteRoutes from './routes/site';
import siteKolRoutes from './routes/site-kol';
import siteKolApiRoutes from './routes/site-kol-api';

export type Vars = { user: UserRow | null };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * CORS。请求实际是 service worker 发出的（扩展 background 页），
 * Origin 会是 chrome-extension://<id>，所以不能用白名单域名，直接放开。
 * 真正的鉴权靠 Token 头，不靠 Origin。
 */
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Token,X-Version,lang,Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  // Response.redirect() / R2 直出这类响应的头是不可变的，直接 set 会抛
  // "Can't modify immutable headers." 把整个请求打成 500。重建一份再打头。
  try {
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
  } catch {
    const res = new Response(c.res.body, c.res);
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
    c.res = res;
  }
});

/**
 * 把当前用户和界面语言挂到请求上下文。
 *
 * 语言用 AsyncLocalStorage 存，这样 response.ts 的 fail()/ok() 不用拿到 c
 * 就能翻译 message —— 扩展会把后端返回的 message 直接弹给用户
 * （hosts.js 的 gi.error(k.message)），不翻译的话英文界面会弹中文。
 *
 * lang 头由扩展带上（hosts.js:55648），形如 en-US / zh-CN。
 */
app.use('*', async (c, next) => {
  const lang = parseLang(c.req.header('lang') || c.req.header('Accept-Language'));
  await withLang(lang, async () => {
    const token = extractToken(c.req.raw);
    c.set('user', token ? await getUserByToken(c.env, token) : null);
    await next();
  });
});

app.onError((err, c) => {
  console.error('unhandled', c.req.method, c.req.path, err);
  return fail(ERR.INTERNAL, err instanceof Error ? err.message : '服务器内部错误');
});

// 根路径给官网首页占着（见下面的 siteRoutes），这里只留健康检查
app.get('/health', (c) => ok({ ok: true, ts: Date.now() }));

/**
 * 所有插件接口都挂在 /v1/plugin 下。
 * 扩展的 URL 拼接规则见 hosts.js H5o()：
 *   以 http 开头        -> 原样请求
 *   以 /v1/plugin 开头  -> 拼 <站点根域>
 *   其它                -> 拼 <站点根域>/v1/plugin
 * 所以两种形式都会打到这里，前缀必须是 /v1/plugin。
 */
const api = new Hono<{ Bindings: Env; Variables: Vars }>();

api.route('/public', publicRoutes);
api.route('/user', userRoutes);
api.route('/quota', quotaRoutes);
api.route('/activation', activationRoutes);
api.route('/collection', collectionRoutes);
api.route('/promotion', promotionRoutes);
// creator 里既有业务接口（sts / similarity）也有回流接口（save / video/tag）
api.route('/creator', creatorRoutes);
// video 里嵌了 /video/review/*，以及回流的 /video/analysis、/video/detail、/video/label/add
api.route('/video', videoRoutes);
api.route('/caption', captionRoutes);
api.route('/copy-script', copyScriptRoutes);
// product 内部把 /product/data/* 注册在 /product/:region/* 之前，
// 否则 "data" 会被 :region 吃掉
api.route('/product', productRoutes);
api.route('/cooperate', cooperateRoutes);
api.route('/message', messageRoutes);
api.route('/data', ingestRoutes);

app.route('/v1/plugin', api);
// 子应用里的 '/' 只能匹配到不带斜杠的 /admin，手输地址多带一个斜杠就吃 404。
// 归一化掉，别让人对着假 404 猜是没权限还是地址错。
app.get('/admin/', (c) => c.redirect('/admin', 301));
app.route('/admin', adminRoutes);
// 支付：/pay/checkout、/pay/success、/webhooks/creem。挂在站点路由之前。
app.route('/', payRoutes);

// 官网页面。挂在根路径上，必须放在 notFound 之前。
// /kol/exlogin 是登录闭环的一半，扩展会跳过来 —— 详见 routes/site.ts 顶部注释。
// site-kol-api 是搜索页的同源 JSON API（cookie 会话），要排在页面路由前面。
// site-kol 是应用页（工作台/收藏/搜索…），site 是登录页/套餐/首页等营销页。
app.route('/', siteKolApiRoutes);
app.route('/', siteKolRoutes);
app.route('/', legalRoutes);
app.route('/', siteRoutes);

app.notFound((c) => {
  console.warn('404', c.req.method, c.req.path);
  // 浏览器导航给真 404 状态 + 品牌页（否则乱 URL 全是 200，搜索引擎收一堆软 404）；
  // 扩展/接口调用维持 200+JSON —— 判定与 lib/owner.ts 的 fake404() 共用，改要一起改。
  if (isHtmlNavigation(c.req)) return notFoundHtml();
  return fail('ERR_GLOBAL_404', `接口不存在: ${c.req.method} ${c.req.path}`, 200);
});

/**
 * 除了 HTTP，这个 Worker 还要当队列消费者和定时任务跑。
 *
 * 注意不能再直接 `export default app` —— wrangler.jsonc 里声明了 queue consumer
 * 和 triggers.crons，Worker 必须同时导出 queue() 和 scheduled()，否则部署会被拒。
 */
export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
  // 邮件建联的收信回流：Cloudflare Email Routing 把 *@MAIL_DOMAIN 投到这里
  email: handleInboundEmail,
};
