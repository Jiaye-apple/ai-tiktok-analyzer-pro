import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, notImplemented, ok } from '../lib/response';
import { readJson, readArray } from '../lib/req';
import { bumpDailyOnly, consumeQuota, refundConsumed } from '../lib/quota';
import { currentUser, requireAuth } from '../middleware/require-auth';
import { effectivePlanCode } from '../lib/auth';
import {
  anonGate,
  awemeIdToSec,
  isTikTokUrl,
  QuotaExceeded,
  resolveByAwemeIds,
  resolveTikTokUrl,
  type ResolvedVideo,
} from '../lib/tiktok-resolver';
import reviewRoutes from './review';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/** AI 看懂评论区那一组挂在 /video/review 下面 */
r.route('/review', reviewRoutes);

/**
 * GET /video/parse_pass?awemeId={id}
 *
 * 「SVIP 本地直连」的资格判定：付费会员的插件解析优先在**用户自己的浏览器**
 * 直连 tikwm（额度算用户出口 IP，快且不烧 Workers 共享 IP 的日额度——线上
 * 解析失败的根因见 lib/tiktok-resolver.ts 注释），我们的解析链只做兜底。
 *
 * 返回 { direct: boolean }。付费档（plus/pro）direct=true 并记一笔
 * SingleVideoDownload 日计数（付费档无日限，只做用量统计）；免费档
 * direct=false 且**不扣任何额度**——他们照旧走 /video/fetch_video_data，
 * 额度在那边扣，不会双扣。
 */
r.get('/parse_pass', requireAuth, async (c) => {
  const user = currentUser(c);
  const paid = effectivePlanCode(user) !== 'free';
  if (paid) await bumpDailyOnly(c.env, user, 'SingleVideoDownload').catch(() => {});
  return ok({ direct: paid });
});

/**
 * GET /video/fetch_video_data?awemeId={id}
 *
 * 无水印直链解析，插件最核心的付费能力之一。
 * data 结构固定：{ covers[], urls[], hdUrls[], musicList[] }
 * 前端只取每个数组的第 0 项，并把 `&amp;` 反转义（index.js:187087-187099）。
 * 返回空数组时前端会自动降级到 tiksave.io。
 */
r.get('/fetch_video_data', requireAuth, async (c) => {
  const awemeId = c.req.query('awemeId') || '';
  if (!awemeId) return fail(ERR.PARAM, '缺少 awemeId');

  // 原站规则：登录用户免费档 20 次/天，付费无限（quota_daily_limits 没配行 = 不限）
  const gate = await bumpDailyOnly(c.env, currentUser(c), 'SingleVideoDownload');
  if (gate.exceeded) {
    return fail(ERR.QUOTA_EXHAUSTED, '今日下载次数已达上限，请升级套餐解锁无限下载');
  }

  const data = await resolveVideo(c.env, [awemeId]);
  if (!data) {
    // 解析不到（视频已删/上游临时不可用）。
    // 返回空数组比返回错误好 —— 前端会自动走 tiksave.io 降级，功能不至于全废。
    return ok({
      covers: [],
      urls: [],
      hdUrls: [],
      musicList: [],
      awemeId,
      desc: null,
      authorId: null,
      createTime: awemeIdToSec(awemeId),
    });
  }
  const first = data[0];

  /**
   * 四个数组不能有"空洞"，否则前端会下错文件。
   *
   * 前端（index.js 的 Hrt 播放弹窗）是这么用的：
   *   const k = [covers[0], urls[0], hdUrls[0], musicList[0]].filter(Boolean)
   * 然后**按下标**取：k[1]=普通直链、k[2]=高清直链、k[3]=音乐，
   * 「下载视频」按钮优先推 k[2] 再退 k[1]。
   *
   * filter(Boolean) 会让数组塌陷 —— 只要前面任何一个是空的，后面全部左移一位。
   * 比如 covers 空而其余都有，k 就变成 [urls0, hd0, music0]，
   * k[2] 是音乐地址，用户点「下载视频」拿到的是一个 .mp4 后缀的 mp3。
   *
   * 上游确实会出现这种情况：tikwm 偶尔只给 hdplay 不给 play，
   * 那样 urls 就是空的而 hdUrls 有值。所以这里互相兜底，保证前三位都占住。
   * musicList 在最后一位，空了不会让别人错位，可以留空。
   */
  const covers = first?.covers ?? [];
  const urls = first?.urls ?? [];
  const hdUrls = first?.hdUrls ?? [];
  const safeUrls = urls.length ? urls : hdUrls;
  const safeHdUrls = hdUrls.length ? hdUrls : urls;
  // 封面实在没有就拿视频直链顶位 —— 位置对了比图对了更重要，
  // 错位会让用户把音频当视频下走，而封面只是弹窗里的一张预览图
  const safeCovers = covers.length ? covers : safeHdUrls.slice(0, 1);

  return ok({
    covers: safeCovers,
    urls: safeUrls,
    hdUrls: safeHdUrls,
    // 图集帖：以前这里没有 images，图集走这个接口拿回来的全是空数组。
    // 老前端不认识这个字段会直接忽略，不影响它；新前端要下图集就靠它。
    images: first?.images ?? null,
    musicList: first?.musicList ?? [],
    awemeId: first?.awemeId ?? awemeId,
    desc: first?.desc ?? null,
    authorId: first?.authorId ?? null,
    createTime: first?.createTime ?? awemeIdToSec(awemeId),
  });
});

/**
 * GET /video/fetch_video_data_by_url?url=<TikTok链接>
 *
 * 官网"下载失败兜底页"（替换 mjjl.cn 旧短链的落地页）的解析接口。
 * 出参对齐原站 www.kolsprite.com/api/v2 的同名接口（TkVideoData 全字段），
 * 以后照搬他们工具页前端时 1:1 能用。
 *
 * 匿名可调：额度按「设备 cookie + IP/64 兜底」两层算，且只在真正出网时才扣
 * —— 命中缓存不消耗，同一视频重复下载不吃额度。
 * 登录用户按套餐限：免费档 20/天（原站 Logged-in: 20/day），付费无限。
 * data 为 null 表示解析不到（视频不存在/已删除），前端展示"解析失败"即可。
 */
r.get('/fetch_video_data_by_url', async (c) => {
  const url = (c.req.query('url') || '').trim();
  if (!url || url.length > 500 || !isTikTokUrl(url)) {
    return fail(ERR.PARAM, '请提供正确的 TikTok 视频链接');
  }

  const user = currentUser(c);
  const gate = user ? null : anonGate(c.env, c.req.raw);
  // 和匿名闸门一样只在真正出网时计数，命中缓存不吃额度
  const memberCharge = user
    ? async () => {
        const g = await bumpDailyOnly(c.env, user, 'SingleVideoDownload');
        if (g.exceeded) throw new QuotaExceeded();
      }
    : undefined;

  try {
    const data = await resolveTikTokUrl(c.env, url, {
      beforeUpstream: gate?.charge ?? memberCharge,
    });
    const res = ok(data);
    if (gate?.setCookie) res.headers.append('Set-Cookie', gate.setCookie);
    return res;
  } catch (e) {
    if (e instanceof QuotaExceeded) {
      return fail(
        ERR.RATE_LIMITED,
        user ? '今日下载次数已达上限，请升级套餐解锁无限下载' : '今日免费解析次数已用完，请登录后继续',
      );
    }
    console.error('fetch_video_data_by_url failed', e);
    return fail(ERR.INTERNAL, '解析服务暂时不可用，请稍后再试');
  }
});

type MediaKind = 'cover' | 'mp4' | 'hd' | 'mp3';

/**
 * GET /video/media?url=<TikTok链接>&kind=cover|mp4|hd|mp3[&download=1&filename=...]
 *
 * 官网下载页的同源媒体流。解析结果仍来自上面的多源链，但文件字节由 Worker
 * 直接流式转发，避免用户浏览器因 TikTok CDN 的地区路由、CORS 或临时签名问题
 * 同时丢失封面和下载。这里不缓存、不读入 ArrayBuffer，只转发 ReadableStream。
 *
 * 入口只接受 TikTok 原始链接；最终地址必须是解析器返回且经过 CDN 域名白名单
 * 校验的 URL，不能把这个接口当任意 URL 代理使用。
 */
r.get('/media', async (c) => {
  const url = (c.req.query('url') || '').trim();
  const kind = c.req.query('kind') as MediaKind | undefined;
  if (!url || url.length > 500 || !isTikTokUrl(url)) {
    return fail(ERR.PARAM, '请提供正确的 TikTok 视频链接', 400);
  }
  if (!kind || !MEDIA_KINDS.has(kind)) {
    return fail(ERR.PARAM, '不支持的媒体类型', 400);
  }

  const user = currentUser(c);
  const gate = user ? null : anonGate(c.env, c.req.raw);
  const memberCharge = user
    ? async () => {
        const g = await bumpDailyOnly(c.env, user, 'SingleVideoDownload');
        if (g.exceeded) throw new QuotaExceeded();
      }
    : undefined;
  const charge = gate?.charge ?? memberCharge;
  let chargePromise: Promise<void> | null = null;
  const chargeOnce = charge
    ? () => {
        chargePromise ??= charge();
        return chargePromise;
      }
    : undefined;

  try {
    let data = await resolveTikTokUrl(c.env, url, { beforeUpstream: chargeOnce });
    let mediaUrl = pickMediaUrl(data, kind);
    let upstream = mediaUrl && isAllowedMediaUrl(mediaUrl)
      ? await fetchMedia(mediaUrl, c.req.header('Range'))
      : null;

    // TikTok CDN 地址是限时签名。KV 里的解析结果可能还在 TTL 内，但 CDN 已提前
    // 失效；同一次请求绕过缓存刷新一次，覆盖旧值后再试，且 chargeOnce 不会重复计费。
    if (!upstream || (upstream.status !== 200 && upstream.status !== 206)) {
      await upstream?.body?.cancel().catch(() => {});
      data = await resolveTikTokUrl(c.env, url, {
        beforeUpstream: chargeOnce,
        skipCache: true,
      });
      mediaUrl = pickMediaUrl(data, kind);
      upstream = mediaUrl && isAllowedMediaUrl(mediaUrl)
        ? await fetchMedia(mediaUrl, c.req.header('Range'))
        : null;
    }

    if (!upstream || (upstream.status !== 200 && upstream.status !== 206)) {
      await upstream?.body?.cancel().catch(() => {});
      return fail(
        data ? ERR.INTERNAL : ERR.NOT_FOUND,
        data ? '媒体源暂时不可用，请稍后重试' : '没有找到可下载的媒体文件',
        data ? 502 : 404,
      );
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    if (!matchesMediaType(kind, contentType)) {
      await upstream.body?.cancel().catch(() => {});
      return fail(ERR.INTERNAL, '媒体源返回了无效文件', 502);
    }

    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
    });
    for (const name of ['Content-Range', 'ETag', 'Last-Modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    if (c.req.query('download') === '1') {
      const filename = downloadFilename(c.req.query('filename'), kind, contentType);
      const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      headers.set(
        'Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
    } else {
      headers.set('Content-Disposition', 'inline');
    }

    const res = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
    if (gate?.setCookie) res.headers.append('Set-Cookie', gate.setCookie);
    return res;
  } catch (e) {
    if (e instanceof QuotaExceeded) {
      return fail(
        ERR.RATE_LIMITED,
        user ? '今日下载次数已达上限，请升级套餐解锁无限下载' : '今日免费解析次数已用完，请登录后继续',
        429,
      );
    }
    console.error('video media proxy failed', e);
    return fail(ERR.INTERNAL, '媒体下载服务暂时不可用，请稍后重试', 502);
  }
});

/**
 * POST /video/batch_fetch_video_data
 * body: { awemeIds: [] }
 * data: [{ awemeId, hdUrls }]，前端按 awemeId 匹配回填。
 * 东南亚带货视频批量下载用，扣的是 SeaProductVideo 配额。
 */
r.post('/batch_fetch_video_data', requireAuth, async (c) => {
  const user = currentUser(c);
  const b = await readJson<{ awemeIds?: string[] }>(c);
  // 每个 id 都是一次真实解析（2~13 秒/个，并发 4），一批放太多会拖死请求也烧上游额度
  const ids = (b.awemeIds ?? []).map(String).filter(Boolean).slice(0, 30);
  if (!ids.length) return fail(ERR.PARAM, '缺少 awemeIds');

  /**
   * 计费单位是「每 2 条视频算 1 次」，不是每条 1 次。
   *
   * 这是对齐前端的：扩展在弹窗里预扣的是 `Math.ceil(r.length / 2)`
   * （index.js 的 dke），而这里原来按 ids.length 扣。
   * consumeQuota 认领前端那笔 held 记录的条件是 `amount >= 本次要扣的数`，
   * ceil(n/2) 永远小于 n —— 于是永远认领不上，后端又新扣一笔，
   * 用户实际被扣 ceil(n/2) + n，接近三倍。口径必须和前端一致。
   */
  const cost = (n: number) => Math.ceil(n / 2);

  const consumed = await consumeQuota(c.env, user, 'SeaProductVideo', cost(ids.length));
  if (!consumed.ok) {
    return fail(ERR.QUOTA_EXHAUSTED, '本月额度已用完，请升级套餐或购买加油包');
  }

  const data = await resolveVideo(c.env, ids);
  const got = data?.length ?? 0;

  /**
   * 按实际解出来的条数结算，而不是按请求条数一把扣光。
   *
   * 东南亚视频恰恰是失败率最高的一类：30 条解出 3 条也照扣 30 条额度，
   * 用户会在拿不到东西的同时把额度烧光。这里把没解出来的那部分退回去。
   *
   * 退款是整笔退（refundConsumed 按 recordId 退），所以先整笔退掉，
   * 再按实际条数重新扣一次。两步都失败也不至于多收钱。
   */
  if (cost(got) < cost(ids.length) && consumed.recordId) {
    await refundConsumed(c.env, user.id, consumed.recordId).catch(() => {});
    if (got > 0) {
      await consumeQuota(c.env, user, 'SeaProductVideo', cost(got)).catch(() => {});
    }
  }
  if (!data || got === 0) return ok([]);

  // hdUrls 之外补上 images —— 图集帖没有视频直链，只有原图
  return ok(data.map((d) => ({ awemeId: d.awemeId, hdUrls: d.hdUrls, images: d.images ?? null })));
});

/**
 * POST /video/save
 * body 是完整的 TikTok videoDetail（前端已删掉 zoomCover / bitrateInfo /
 * claInfo / PlayAddrStruct / music 这几个大字段）。
 * 前端不看返回值，分享脚本前调一次把详情落库。
 */
r.post('/save', requireAuth, async (c) => {
  const b = await readJson<Record<string, unknown>>(c);
  const item = extractItemStruct(b);
  if (!item?.id) return ok(true); // 结构不对就静默放过，别打断前端的分享流程

  await c.env.DB.prepare(
    `INSERT INTO tk_videos (video_id, creator_id, region, title, pub_time, payload, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
     ON CONFLICT(video_id) DO UPDATE SET
       creator_id = ?2, region = ?3, title = ?4, pub_time = ?5,
       payload = ?6, updated_at = unixepoch()`,
  )
    .bind(
      String(item.id),
      item.author?.id ? String(item.author.id) : null,
      item.locationCreated ?? null,
      item.desc ?? null,
      item.createTime ? Number(item.createTime) * 1000 : null,
      JSON.stringify(b).slice(0, 900_000),
    )
    .run();

  return ok(true);
});

/**
 * POST /video/analysis  （原 plugin-data 域）
 * body 是明确列举字段的数组，是这组回流接口里最规整的一个。
 * hide:true，前端不看返回值。
 */
r.post('/analysis', async (c) => {
  const rows = await readArray<Record<string, unknown>>(c);
  if (!Array.isArray(rows) || !rows.length) return ok(null);

  await c.env.DB.batch(
    rows.slice(0, 200).map((v) =>
      c.env.DB.prepare(
        `INSERT INTO tk_videos
           (video_id, creator_id, region, title, pub_time, like_cnt, forward_cnt,
            play_cnt, comment_cnt, collect_cnt, tk_category, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11, unixepoch())
         ON CONFLICT(video_id) DO UPDATE SET
           creator_id=?2, region=?3, title=?4, pub_time=?5, like_cnt=?6, forward_cnt=?7,
           play_cnt=?8, comment_cnt=?9, collect_cnt=?10, tk_category=?11, updated_at=unixepoch()`,
      ).bind(
        String(v.videoId ?? ''),
        v.creatorId != null ? String(v.creatorId) : null,
        v.region ?? null,
        v.title ?? null,
        v.pubTime ?? null,
        v.likeCnt ?? null,
        v.forwardCnt ?? null,
        v.playCnt ?? null,
        v.commentCnt ?? null,
        v.collectCnt ?? null,
        v.tkCategory ?? null,
      ),
    ),
  );
  return ok(null);
});

/** POST /video/detail  （原 plugin-data 域）—— 和 /video/save 同构，静默入库 */
r.post('/detail', async (c) => {
  const b = await readJson<Record<string, unknown>>(c);
  const item = extractItemStruct(b);
  if (!item?.id) return ok(null);

  await c.env.DB.prepare(
    `INSERT INTO tk_videos (video_id, creator_id, region, title, payload, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT(video_id) DO UPDATE SET payload = ?5, updated_at = unixepoch()`,
  )
    .bind(
      String(item.id),
      item.author?.id ? String(item.author.id) : null,
      item.locationCreated ?? null,
      item.desc ?? null,
      JSON.stringify(b).slice(0, 900_000),
    )
    .run();
  return ok(null);
});

/** POST /video/label/add[?region=]  （原 plugin-data 域）—— 视频列表批量回流 */
r.post('/label/add', async (c) => {
  const region = c.req.query('region') || null;
  const rows = await c.req.json<Array<Record<string, unknown>>>().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return ok(null);

  await c.env.DB.batch(
    rows.slice(0, 200).map((v) => {
      const stats = (v.statsV2 ?? v.stats ?? {}) as Record<string, unknown>;
      const author = (v.author ?? {}) as Record<string, unknown>;
      return c.env.DB.prepare(
        `INSERT INTO tk_videos
           (video_id, creator_id, region, title, pub_time, play_cnt, like_cnt,
            comment_cnt, collect_cnt, forward_cnt, payload, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11, unixepoch())
         ON CONFLICT(video_id) DO UPDATE SET payload = ?11, updated_at = unixepoch()`,
      ).bind(
        String(v.id ?? ''),
        author.id != null ? String(author.id) : null,
        region,
        v.desc ?? null,
        v.createTime ? Number(v.createTime) * 1000 : null,
        num(stats.playCount),
        num(stats.diggCount),
        num(stats.commentCount),
        num(stats.collectCount),
        num(stats.shareCount),
        JSON.stringify(v).slice(0, 400_000),
      );
    }),
  );
  return ok(null);
});

/**
 * GET /video/diag?n=12&provider=kolsprite   （需要 X-Admin-Key）
 *
 * 解析链的出网体检。要回答两个只有在边缘才能测的问题：
 *   1. Worker 出网到底用什么 IP？同一个 colo 会不会换 IP？
 *      （Cloudflare 是全球分布式，出口按 colo 走，不是一个固定地址）
 *   2. 上游解析源对我们这个出口能撑几次才限流？
 *      本机实测 kolsprite 是第 8 次就 RESOURCE_CREATE_LIMIT，但那是家用宽带 IP，
 *      边缘出口的实际配额只能在这里测。
 *
 * 串行发 n 次同一个视频的解析请求，记录每次的返回码和当时的出口 IP。
 *
 * 为什么不挂在 /admin 下：线上 /admin/* 前面还有一道 Cloudflare Access 墙，
 * 脚本要过墙得带 service token 双头，而那对凭证不在仓库里。这个接口只读、
 * 只打固定的两个上游，用 ADMIN_KEY 保护、无 key 时伪装成全局 404。
 */
r.get('/diag', async (c) => {
  if (!c.env.ADMIN_KEY || c.req.header('X-Admin-Key') !== c.env.ADMIN_KEY) {
    // 和全局 notFound 一字不差，对外这个地址不存在
    return fail('ERR_GLOBAL_404', `接口不存在: ${c.req.method} ${c.req.path}`, 200);
  }

  const n = Math.min(Number(c.req.query('n') || 12), 40);
  const provider = c.req.query('provider') || 'kolsprite';
  const videoUrl =
    c.req.query('url') || 'https://www.tiktok.com/@zachking/video/6768504823336815877';

  // 回显服务必须选**非 Cloudflare** 的主机：Worker 打自家域名可能走内网，
  // 报出来的地址不是第三方看到的那个公网出口。checkip 在 AWS 上。
  const egress = async (): Promise<string> => {
    try {
      const r2 = await fetch('https://checkip.amazonaws.com/', {
        signal: AbortSignal.timeout(8000),
      });
      return (await r2.text()).trim() || '?';
    } catch {
      return 'fetch-failed';
    }
  };

  const target =
    provider === 'tikwm'
      ? (u: string) => `https://www.tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`
      : (u: string) =>
          `https://www.kolsprite.com/api/v2/video/fetch_video_data_by_url?url=${encodeURIComponent(u)}`;

  const attempts: Array<Record<string, unknown>> = [];
  const ips = new Set<string>();

  for (let i = 0; i < n; i++) {
    const ip = await egress();
    ips.add(ip);
    let code: unknown = null;
    let hasData = false;
    try {
      const res = await fetch(target(videoUrl), {
        headers: {
          Accept: 'application/json',
          Referer: provider === 'tikwm' ? 'https://www.tikwm.com/' : 'https://dl.kolsprite.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json<{ code?: unknown; msg?: string; data?: unknown }>();
      code = body.code ?? res.status;
      hasData = !!body.data;
      if (body.msg) code = `${code}:${body.msg}`.slice(0, 60);
    } catch (e) {
      code = `throw:${e instanceof Error ? e.message.slice(0, 40) : 'unknown'}`;
    }
    attempts.push({ i: i + 1, ip, code, hasData });
  }

  return ok({
    colo: (c.req.raw as { cf?: { colo?: string } }).cf?.colo ?? null,
    provider,
    distinctEgressIps: [...ips],
    okCount: attempts.filter((a) => a.hasData).length,
    attempts,
  });
});

// ---------------------------------------------------------------------------

/**
 * 无水印直链解析。两条路，按顺序：
 *   1. 配了 TIKTOK_PROXY_URL 就走自建解析服务（batch 协议，见下面的转发逻辑）
 *   2. 默认中转原站的匿名解析接口 —— 实现和原理见 lib/tiktok-resolver.ts。
 *      开箱即用，但额度寄人篱下，量起来后换 1。
 * 两条都失败返回 null，上层返回空数组让前端自己降级 tiksave.io。
 */
async function resolveVideo(env: Env, awemeIds: string[]): Promise<ResolvedVideo[] | null> {
  if (env.TIKTOK_PROXY_URL) {
    try {
      const res = await fetch(env.TIKTOK_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.TIKTOK_PROXY_KEY ? { Authorization: `Bearer ${env.TIKTOK_PROXY_KEY}` } : {}),
        },
        body: JSON.stringify({ awemeIds }),
      });
      if (res.ok) {
        const data = await res.json<{ data?: ResolvedVideo[] }>();
        if (data.data?.length) {
          // 自建服务的老协议可能没有这三个命名字段，补默认值保证出参形状一致
          return data.data.map((v) => ({
            ...v,
            desc: v.desc ?? null,
            authorId: v.authorId ?? null,
            createTime: v.createTime ?? awemeIdToSec(v.awemeId),
          }));
        }
      }
    } catch (e) {
      console.error('resolveVideo proxy failed', e);
    }
    // 自建服务挂了也别直接死，落回中转
  }

  const list = await resolveByAwemeIds(env, awemeIds);
  return list.length ? list : null;
}

interface ItemStruct {
  id?: string | number;
  desc?: string;
  createTime?: string | number;
  locationCreated?: string;
  author?: { id?: string | number; uniqueId?: string };
}

function extractItemStruct(body: Record<string, unknown>): ItemStruct | null {
  const info = body.itemInfo as { itemStruct?: ItemStruct } | undefined;
  return info?.itemStruct ?? null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MEDIA_KINDS = new Set<MediaKind>(['cover', 'mp4', 'hd', 'mp3']);

function pickMediaUrl(data: Awaited<ReturnType<typeof resolveTikTokUrl>>, kind: MediaKind): string | null {
  if (!data) return null;
  if (kind === 'cover') return data.covers[0] || null;
  if (kind === 'mp3') return data.musicList[0] || null;
  if (kind === 'hd') return data.hdUrls[0] || data.urls[0] || null;
  return data.urls[0] || data.hdUrls[0] || null;
}

/** 每次跳转都重新校验，避免允许的 CDN 用 302 把 Worker 带到内网或任意站点。 */
async function fetchMedia(rawUrl: string, range: string | undefined): Promise<Response | null> {
  let current = rawUrl;
  const headers = new Headers({
    Accept: '*/*',
    Referer: 'https://www.tiktok.com/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  if (range && /^bytes=(?:\d+-\d*|-\d+)$/.test(range)) headers.set('Range', range);

  for (let i = 0; i < 4; i++) {
    if (!isAllowedMediaUrl(current)) return null;
    const response = await fetch(current, { headers, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('Location');
    await response.body?.cancel().catch(() => {});
    if (!location) return null;
    current = new URL(location, current).toString();
  }
  return null;
}

function isAllowedMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'tikwm.com' ||
      host.endsWith('.tikwm.com') ||
      host.endsWith('.tiktokcdn.com') ||
      host.endsWith('.tiktokcdn-us.com') ||
      host.endsWith('.tiktokcdn-eu.com') ||
      host.endsWith('.tiktokv.com') ||
      host.endsWith('.muscdn.com')
    );
  } catch {
    return false;
  }
}

function matchesMediaType(kind: MediaKind, contentType: string): boolean {
  const type = contentType.toLowerCase().split(';')[0].trim();
  if (kind === 'cover') return type.startsWith('image/');
  if (kind === 'mp3') return type.startsWith('audio/') || type === 'application/octet-stream';
  return type.startsWith('video/') || type === 'application/octet-stream';
}

function downloadFilename(raw: string | undefined, kind: MediaKind, contentType: string): string {
  const type = contentType.toLowerCase().split(';')[0].trim();
  const ext =
    kind === 'cover'
      ? type === 'image/webp'
        ? '.webp'
        : type === 'image/png'
          ? '.png'
          : '.jpg'
      : kind === 'mp3'
        ? '.mp3'
        : '.mp4';
  const fallback = `tiktok-${kind}${ext}`;
  if (!raw) return fallback;

  let name = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 160);
  if (!name) return fallback;
  if (!name.toLowerCase().endsWith(ext)) name = name.replace(/\.[a-z0-9]{1,8}$/i, '') + ext;
  return name;
}

export default r;
