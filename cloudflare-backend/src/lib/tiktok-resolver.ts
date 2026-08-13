import type { Env } from './types';
import { periodKey } from './quota';

/**
 * TikTok 无水印直链解析。
 *
 * 和 AI_CHAIN / ASR_CHAIN 一样是**供应商链**：按 TK_CHAIN 顺序试，
 * 谁先给出可用直链就用谁，全挂了才算失败。默认 `tikwm,kolsprite`。
 *
 * 为什么是链而不是单源（2026-08-05 实测）：
 *   - kolsprite：原站工具页 dl.kolsprite.com 的后端，匿名可调，但额度极紧
 *     —— 同一 IP 打到第 8 次就返回 RESOURCE_CREATE_LIMIT，之后持续 ERR_RATE_LIMIT。
 *     只能当兜底，不能当主力。
 *   - tikwm：公开解析 API，出参最全（play/hdplay/wmplay/music/images + 统计），
 *     直链是可移植的 tiktokcdn-us 地址，实测 206 video/mp4 能直接下。当主力。
 *   - TIKTOK_PROXY_URL：自建解析服务，配了就排在最前面（见 routes/video.ts）。
 *
 * 为什么不自己解析 TikTok（都试过了，此路不通）：
 *   - 网页版 __UNIVERSAL_DATA_FOR_REHYDRATION__ 里的 playAddr 是**会话绑定**的，
 *     换个 IP/无 cookie 取回来一律 403，给不了用户。
 *   - 移动端 /aweme/v1/feed/ 现在要 X-Gorgon/X-Argus 签名，不带签名返回空体，
 *     自己实现就是无止境的对抗，维护成本高于收益。
 *   要彻底自主，正路是买/自建解析服务后配 TIKTOK_PROXY_URL，而不是绕别人风控。
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
const CACHE_MAX_TTL = 1800;
/**
 * 解析不到时的缓存时长。
 *
 * 原来是 600 秒，问题是这个 miss 缓存键**不带用户和出口维度**：
 * 一个用户因为地区限制解析失败，全站所有用户接下来 10 分钟都拿不到这条视频，
 * 而这 10 分钟里每次请求照样扣配额。东南亚视频正是最容易命中这条路的。
 * 缩到 90 秒 —— 够挡住死链接的反复重试，又不至于把临时性失败放大成全站不可用。
 */
const MISS_TTL = 90;
const DEFAULT_CHAIN = 'tikwm,kolsprite';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 出参契约，对齐原站 /api/v2 的同名接口，工具页前端照这个渲染。
 *  createTime 是我们加的（unix 秒）：下载文件名要用发布日期，原站契约里没有。 */
export interface TkVideoData {
  awemeId: string;
  region: string | null;
  duration: number | null;
  awemeType: number | null;
  desc: string | null;
  covers: string[];
  urls: string[];
  hdUrls: string[];
  images: string[] | null;
  musicList: string[];
  authorName: string | null;
  authorId: string | null;
  authorAvatar: string | null;
  playCount: number | null;
  likeCount: number | null;
  createTime: number | null;
}

/** 扩展 fetch_video_data 需要的子集。desc/authorId/createTime 给下载文件名用。 */
export interface ResolvedVideo {
  awemeId: string;
  covers: string[];
  urls: string[];
  hdUrls: string[];
  /**
   * 图集/slideshow 的原图。
   *
   * 以前这个字段只存在于 TkVideoData（by_url 路径用），按 awemeId 批量解析时
   * 被整个丢掉了 —— 于是图集帖走 fetch_video_data 拿回来的是全空数组，
   * 而图集在东南亚带货内容里很常见。null 表示这不是图集。
   */
  images: string[] | null;
  musicList: string[];
  desc: string | null;
  authorId: string | null;
  createTime: number | null;
}

/** TikTok 视频 id 高 32 位就是发布时间的 unix 秒，供应商没给 createTime 时用它兜底。 */
export function awemeIdToSec(id: string | null | undefined): number | null {
  const n = Number(id);
  if (!n || !isFinite(n)) return null;
  const s = Math.floor(n / 4294967296);
  return s > 1420070400 && s < Date.now() / 1000 + 172_800 ? s : null;
}

function ensureCreateTime(d: TkVideoData): TkVideoData {
  if (d.createTime) return d;
  const s = awemeIdToSec(d.awemeId);
  return s ? { ...d, createTime: s } : d;
}

/** 配额用尽。路由层要把它翻成 ERR_RATE_LIMITED，别当 500。 */
export class QuotaExceeded extends Error {
  constructor() {
    super('quota exceeded');
    this.name = 'QuotaExceeded';
  }
}

export function isTikTokUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'tiktok.com' || h.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

/**
 * 解析入口。命中缓存直接返回，不消耗任何配额；
 * 真要出网时先调 opts.beforeUpstream（配额闸门在这儿，抛 QuotaExceeded 就中止）。
 * 返回 null = 各家都说解析不到（视频已删/私密）。全部供应商异常则抛错。
 */
/**
 * 短链域名。东南亚分享出来的链接基本都是这几个。
 *
 * 这些链接里没有 awemeId，缓存键会退化成整条 URL 的哈希，
 * 同一个视频换个短链就重新解析一次；而且能不能解全看上游认不认这个域名。
 * 所以先自己跟一次 302 把真实地址拿到手。
 */
const SHORT_HOSTS = new Set([
  'vt.tiktok.com',
  'vm.tiktok.com',
  'vn.tiktok.com',
  'vd.tiktok.com',
  't.tiktok.com',
]);

/**
 * 展开短链。跟随失败就原样返回，交给上游去赌 —— 不比现在更差。
 */
async function expandShortUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (!SHORT_HOSTS.has(u.hostname.toLowerCase())) return raw;

  let current = raw;
  // 短链偶尔会连跳两次（vt -> www -> 带 query 的规范地址），最多跟 3 跳
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(8000),
      });
      const loc = res.headers.get('location');
      if (!loc) break;
      current = new URL(loc, current).toString();
      if (!SHORT_HOSTS.has(new URL(current).hostname.toLowerCase())) break;
    } catch (e) {
      console.warn('短链展开失败，按原链接继续', raw, String(e).slice(0, 80));
      return raw;
    }
  }
  // 展开后带一堆追踪参数（?is_from_webapp=...&sender_device=...），
  // 去掉它们才能让缓存键稳定命中同一个视频
  try {
    const out = new URL(current);
    out.search = '';
    out.hash = '';
    return out.toString();
  } catch {
    return current;
  }
}

export async function resolveTikTokUrl(
  env: Env,
  rawUrl: string,
  opts: { beforeUpstream?: () => Promise<void>; skipCache?: boolean } = {},
): Promise<TkVideoData | null> {
  const url = await expandShortUrl(rawUrl.trim());
  const cacheKey = await keyFor(url);

  const cached = opts.skipCache
    ? null
    : await env.KV.get<{ miss?: boolean; data?: TkVideoData }>(cacheKey, 'json');
  // 老缓存条目可能没有 createTime，读出来时补一次
  if (cached) return cached.miss || !cached.data ? null : ensureCreateTime(cached.data);

  if (opts.beforeUpstream) await opts.beforeUpstream();

  const chain = (env.TK_CHAIN || DEFAULT_CHAIN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let lastError: unknown = null;
  let sawExplicitMiss = false;

  for (const name of chain) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    try {
      const data = await provider(env, url);
      if (data && (data.urls.length || data.hdUrls.length || data.images?.length)) {
        const shaped = ensureCreateTime(data);
        await cacheData(env, cacheKey, shaped);
        return shaped;
      }
      // 供应商明确说"没有这个视频"，记下来但继续问下一家 —— 有的源对
      // 冷门/地区限制视频会误报空
      sawExplicitMiss = true;
    } catch (e) {
      lastError = e;
      console.error(`tiktok provider ${name} failed`, e);
    }
  }

  if (sawExplicitMiss) {
    // 解析不到也缓存一会儿，免得死链接反复把整条链跑一遍
    await env.KV.put(cacheKey, JSON.stringify({ miss: true }), { expirationTtl: MISS_TTL });
    return null;
  }
  throw lastError instanceof Error ? lastError : new Error('all tiktok providers failed');
}

/** 按 awemeId 批量解析，扩展的 fetch_video_data / batch_fetch_video_data 走这里。 */
export async function resolveByAwemeIds(env: Env, awemeIds: string[]): Promise<ResolvedVideo[]> {
  // 并发压到 2。tikwm 免费档是 1 请求/秒，开 4 路只会稳定撞限流，
  // 每条最多退避重试 4 次 —— 30 条最坏情况能打出 120 次上游请求，
  // 既拖慢响应又逼近 Worker 的子请求上限。降下来反而更快出结果。
  const results = await mapLimit(awemeIds, 2, async (id) => {
    try {
      // 上游只认视频 id，用户名随便填也能解析（实测），所以老协议不用改
      const data = await resolveTikTokUrl(env, `https://www.tiktok.com/@x/video/${id}`);
      if (!data) return null;
      return {
        awemeId: data.awemeId || id,
        covers: data.covers,
        urls: data.urls,
        hdUrls: data.hdUrls,
        images: data.images,
        musicList: data.musicList,
        desc: data.desc,
        authorId: data.authorId,
        createTime: data.createTime ?? awemeIdToSec(data.awemeId || id),
      };
    } catch (e) {
      console.error('resolveByAwemeIds failed', id, e);
      return null;
    }
  });
  return results.filter((v): v is ResolvedVideo => v !== null);
}

// --- 供应商 --------------------------------------------------------------

type Provider = (env: Env, url: string) => Promise<TkVideoData | null>;

const PROVIDERS: Record<string, Provider> = {
  /**
   * 公开解析 API，主力。
   *
   * 免费档有**两道**限制，返回都是 code -1，靠 msg 区分，处理方式完全不同：
   *   1. "Free Api Limit: 1 request/second."      —— 每秒限流，等一下重试就行
   *   2. "Free Api Limit: 10000 request/ 1 day."  —— **当日额度打满，重试没有意义**
   *
   * 第 2 种在 Cloudflare Workers 上是常态：边缘出口 IP 是共享的，
   * 同一批 IP 上其他人也在打 tikwm，日额度经常在我们用之前就被烧光。
   * （线上实测：本机直连三条视频全部成功，同样三条走 Worker 全部拿到这个错误。）
   * 以前这里把两种都当限流，白白多打 3 次请求，既拖慢响应又加速烧额度。
   *
   * 要根治只有两条路：配 TIKWM_API_KEY 买付费档，或者配 TIKTOK_PROXY_URL
   * 走自建/采购的解析服务（video.ts 里那条路径优先级最高，配上即生效）。
   */
  async tikwm(env, url) {
    const base = env.TIKWM_API_URL || 'https://www.tikwm.com/api/';
    // 付费档的 key。没配就是免费档，会撞上面那两道限制。
    const key = env.TIKWM_API_KEY ? `&api_key=${encodeURIComponent(env.TIKWM_API_KEY)}` : '';

    let lastMsg = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(1100 * attempt); // 1.1s / 2.2s / 3.3s

      const res = await fetch(`${base}?url=${encodeURIComponent(url)}&hd=1${key}`, {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`tikwm http ${res.status}`);

      const body = await res.json<{ code?: number; msg?: string; data?: TikwmData }>();
      if (body.code === 0 && body.data) return shapeTikwm(body.data);

      // code -1 既可能是"限流"也可能是"视频不存在"，靠 msg 区分：
      // 限流要等一下重试，视频不存在是真的 miss，立刻返回
      lastMsg = body.msg || '';
      const msg = lastMsg.toLowerCase();

      // 当日额度打满：等多久都没用，立刻放弃这家去问下一家
      if (msg.includes('day') || msg.includes('daily')) {
        throw new Error(`tikwm 当日额度已用尽: ${lastMsg}`);
      }

      const rateLimited =
        msg.includes('limit') || msg.includes('frequen') || msg.includes('busy');
      if (!rateLimited) return null;
    }
    throw new Error(`tikwm rate limited after retries: ${lastMsg}`);
  },

  /**
   * 原站匿名接口。**几乎指望不上**：实测 Worker 出口打到第 6 次就
   * RESOURCE_CREATE_LIMIT，且一小时后不恢复（按天计）。留着只是万一 tikwm 整个挂掉时
   * 还能出几条，别把它当容量。
   */
  async kolsprite(env, url) {
    const base =
      env.TIKTOK_UPSTREAM_URL || 'https://www.kolsprite.com/api/v2/video/fetch_video_data_by_url';
    const res = await fetch(`${base}?url=${encodeURIComponent(url)}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://dl.kolsprite.com/',
        'User-Agent': BROWSER_UA,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`kolsprite http ${res.status}`);

    const body = await res.json<{ code?: string; success?: boolean; data?: TkVideoData | null }>();
    // 限流码要抛错（让上层知道这家不可用），不能当成"视频不存在"
    if (body.code !== 'OK' || !body.success) throw new Error(`kolsprite code ${body.code}`);
    if (!body.data) return null;

    const d = body.data;
    return {
      ...d,
      covers: d.covers ?? [],
      urls: d.urls ?? [],
      hdUrls: d.hdUrls ?? [],
      musicList: d.musicList ?? [],
      images: d.images ?? null,
      createTime: d.createTime ?? null,
    };
  },
};

/** tikwm 出参 -> 我们的契约。play/cover 偶尔是站内相对路径，要补全域名。 */
function shapeTikwm(d: TikwmData): TkVideoData {
  const abs = (u?: string | null): string | null => {
    if (!u) return null;
    return u.startsWith('/') ? `https://www.tikwm.com${u}` : u;
  };
  const play = abs(d.play);
  const hd = abs(d.hdplay);
  const author = d.author || {};
  return {
    awemeId: String(d.id ?? ''),
    region: d.region ?? null,
    duration: numOrNull(d.duration),
    awemeType: d.images?.length ? 2 : null,
    desc: d.title ?? null,
    covers: [abs(d.cover), abs(d.origin_cover)].filter((v): v is string => !!v),
    urls: [play].filter((v): v is string => !!v),
    hdUrls: [hd ?? play].filter((v): v is string => !!v),
    images: d.images?.length ? d.images.map((i) => abs(i)).filter((v): v is string => !!v) : null,
    musicList: [abs(d.music)].filter((v): v is string => !!v),
    authorName: author.nickname ?? author.unique_id ?? null,
    authorId: author.unique_id ?? null,
    authorAvatar: abs(author.avatar),
    playCount: numOrNull(d.play_count),
    likeCount: numOrNull(d.digg_count),
    createTime: numOrNull(d.create_time),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TikwmData {
  id?: string | number;
  region?: string;
  title?: string;
  cover?: string;
  origin_cover?: string;
  duration?: number;
  play?: string;
  hdplay?: string;
  music?: string;
  images?: string[];
  play_count?: number;
  digg_count?: number;
  create_time?: number;
  author?: { unique_id?: string; nickname?: string; avatar?: string };
}

// --- 匿名配额 ------------------------------------------------------------

/**
 * 匿名额度闸门。**只在真要出网时调**，命中缓存不消耗。
 *
 * 两层，缺一不可：
 *   ① 设备（cookie 里的随机 id）—— 主闸门。同一台机器一天能解析多少。
 *   ② IP/64 —— 只是防刷底线，额度给得很宽。
 * 为什么不能只按 IP：办公室、学校、运营商 NAT 后面成百上千人共用一个出口 IP，
 * 单按 IP 卡 30 次等于整栋楼一天只能下 30 个视频。反过来只按 cookie 也不行，
 * cookie 一清就重来，所以要 IP 兜底。
 *
 * KV 的 get/put 不是原子的，并发下会少计几次；这是礼貌性闸门不是计费，够用。
 */
export interface AnonGate {
  /** 真要出网前调它；超限抛 QuotaExceeded */
  charge: () => Promise<void>;
  /** 首次访问要给浏览器种 id，返回 Set-Cookie 值；老访客返回 null */
  setCookie: string | null;
}

// 对照原站 price 页「No-Watermark Download — Guest: 10 / day」。
// IP 桶只是防刷底线，给宽（NAT 后面可能是一栋楼）。
const DEVICE_DAILY = 10;
const IP_DAILY = 400;
const DID_COOKIE = 'tkdl_did';

export function anonGate(env: Env, req: Request): AnonGate {
  const existing = readCookie(req, DID_COOKIE);
  const did = existing || crypto.randomUUID();
  const day = periodKey('day');
  const ipKey = ipBucket(req);

  return {
    setCookie: existing
      ? null
      : `${DID_COOKIE}=${did}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`,
    charge: async () => {
      const okDevice = await bump(env, `tkdl:rl:d:${day}:${did}`, DEVICE_DAILY);
      if (!okDevice) throw new QuotaExceeded();
      const okIp = await bump(env, `tkdl:rl:i:${day}:${ipKey}`, IP_DAILY);
      if (!okIp) throw new QuotaExceeded();
    },
  };
}

async function bump(env: Env, key: string, limit: number): Promise<boolean> {
  const used = Number((await env.KV.get(key)) || 0);
  if (used >= limit) return false;
  await env.KV.put(key, String(used + 1), { expirationTtl: 172_800 });
  return true;
}

/** IPv6 按 /64 归桶：同一户人家每台设备一个地址，按整地址算等于没限。 */
function ipBucket(req: Request): string {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':') + '::/64';
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      const val = v.join('=');
      // 只认我们自己种的 uuid，防止别人塞个超长垃圾把 KV key 撑爆
      return /^[0-9a-f-]{36}$/i.test(val) ? val : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

async function cacheData(env: Env, cacheKey: string, data: TkVideoData): Promise<void> {
  const ttl = cacheTtl(data);
  const payload = JSON.stringify({ data });
  await env.KV.put(cacheKey, payload, { expirationTtl: ttl });
  // 短链（vm.tiktok.com/xxx）是按 url 哈希存的，补一份 awemeId 键让两种入口都命中
  const idKey = `tkdl:v1:${data.awemeId}`;
  if (data.awemeId && idKey !== cacheKey) {
    await env.KV.put(idKey, payload, { expirationTtl: ttl });
  }
}

async function keyFor(url: string): Promise<string> {
  const idMatch = url.match(/\/(?:video|photo)\/(\d{5,})/);
  if (idMatch) return `tkdl:v1:${idMatch[1]}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tkdl:v1:u:${hex.slice(0, 32)}`;
}

/** 直链带 x-expires（unix 秒），缓存别活得比签名久。 */
function cacheTtl(data: TkVideoData): number {
  const first = data.urls[0] || data.hdUrls[0] || '';
  const m = first.match(/[?&]x-expires=(\d{10})/);
  if (!m) return 900;
  const remain = Number(m[1]) - Math.floor(Date.now() / 1000) - 600;
  return Math.max(60, Math.min(CACHE_MAX_TTL, remain));
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
