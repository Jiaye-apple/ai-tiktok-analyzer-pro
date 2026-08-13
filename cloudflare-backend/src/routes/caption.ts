import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { ASRNotConfiguredError, asrConfigured, transcribe } from '../lib/asr';
import { levelOf } from '../lib/auth';
import { consumeQuota, refundConsumed } from '../lib/quota';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * 字幕 / 视频脚本。
 *
 * 完整链路（index.js:186546-186620 + service-worker.ts.js:37-73）：
 *   ① TikTok 自带 WebVTT 字幕 → 前端自己 fetch 解析，然后 POST /caption/upload 存一份
 *   ② 没有字幕 → service worker 先查 CDN
 *        GET https://o.kolsprite.com/caption/{creatorId}/{videoId}[-high].json
 *      未命中再下载音频 POST /caption/file 做语音转写
 *
 * channel: "F" 快速模式 / "M" 专家模式（M 对应 CDN 上的 -high 文件名）
 */

type Word = { start_time: number; end_time: number; text: string; [lang: string]: unknown };

function objectKey(creatorId: string, videoId: string, channel: string) {
  return `caption/${creatorId}/${videoId}${channel === 'M' ? '-high' : ''}.json`;
}

/**
 * POST /caption/upload
 * body: { wordList, creatorId, videoId }
 * 前端解析完 TikTok 的 WebVTT 后调，把成品字幕存下来给下次用。
 */
r.post('/upload', requireAuth, async (c) => {
  const b = await readJson<{ wordList?: Word[]; creatorId?: string; videoId?: string; channel?: string }>(c);

  if (!b.creatorId || !b.videoId) return fail(ERR.PARAM, '缺少 creatorId 或 videoId');
  const words = b.wordList ?? [];
  if (!words.length) return fail(ERR.PARAM, '字幕内容为空');

  const channel = b.channel === 'M' ? 'M' : 'F';
  const key = objectKey(b.creatorId, b.videoId, channel);

  await c.env.R2.put(key, JSON.stringify(words), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await c.env.DB.prepare(
    `INSERT INTO captions (creator_id, video_id, channel, r2_key, word_count, source)
     VALUES (?1, ?2, ?3, ?4, ?5, 'tiktok_vtt')
     ON CONFLICT(creator_id, video_id, channel)
     DO UPDATE SET r2_key = ?4, word_count = ?5`,
  )
    .bind(b.creatorId, b.videoId, channel, key, words.length)
    .run();

  return ok(true);
});

/**
 * POST /caption/file  —— multipart/form-data
 * 字段：file(audio.wav Blob) / creatorId / videoId / channel
 * 响应：{ code, data: wordList }
 *
 * 注意 service worker 那边期望的是**裸的 code + data**，不走 success 判断：
 *   .then(l => l.json()).then(l => e.sendResponse(l))
 * 前端再判 `L.code == "OK"`。所以 ok() 的信封正好合用。
 *
 * 另：音频超 10MB 时 service worker 自己就拦下了，不会打到这里。
 */
r.post('/file', requireAuth, async (c) => {
  const user = currentUser(c);
  // 用 c.req.raw 拿原生 Request 的 formData —— Hono 包装过的那个 get() 只返回 string，
  // 取不到 File 对象
  const form = await c.req.raw.formData().catch(() => null);
  if (!form) return fail(ERR.PARAM, '请求不是 multipart/form-data');

  const entry = form.get('file');
  // Workers 的 FormDataEntryValue 是 File | string，先排除字符串再当文件用
  const file = typeof entry === 'string' || entry === null ? null : entry;
  const creatorId = String(form.get('creatorId') || '');
  const videoId = String(form.get('videoId') || '');
  const channel = String(form.get('channel') || 'F') === 'M' ? 'M' : 'F';

  if (!file) return fail(ERR.PARAM, '缺少音频文件');
  if (!creatorId || !videoId) return fail(ERR.PARAM, '缺少 creatorId 或 videoId');
  if (file.size > 10 * 1024 * 1024) {
    // 和 service worker 的判断对齐。顺带说一句：原扩展这里有个拼写 bug，
    // service worker 返回 "siz_limt" 而前端判的是 "size_limt"，永远匹配不上。
    return fail('size_limt', '音频文件超过 10MB');
  }

  // 专家模式（channel=M）是付费会员功能，服务端硬门槛，改前端绕不过去
  if (channel === 'M' && levelOf(user.plan_code, user.plan_expire_at) === 'F') {
    return fail(ERR.QUOTA_EXHAUSTED, '专家模式是付费会员专属功能，请升级套餐后使用');
  }

  // 服务端硬扣 VideoScript（= 原站的 Script Extraction 额度）。
  // 正常流程前端已 acquire，这里核销；直连 API 的在这里被扣费或拒绝。
  // 命中缓存也收费 —— 和正常流程一致（前端 acquire 后走 CDN 缓存同样不退）。
  const consumed = await consumeQuota(c.env, user, 'VideoScript', 1);
  if (!consumed.ok) {
    return fail(
      ERR.QUOTA_EXHAUSTED,
      consumed.dailyExceeded
        ? '今日次数已达上限，请明天再试或升级套餐'
        : '本月额度已用完，请升级套餐或购买加油包',
    );
  }
  const refund = () =>
    consumed.recordId
      ? refundConsumed(c.env, user.id, consumed.recordId).catch(() => {})
      : Promise.resolve();

  // 命中缓存就不重复转写了
  const key = objectKey(creatorId, videoId, channel);
  const cached = await c.env.R2.get(key);
  if (cached) {
    return ok(await cached.json<Word[]>());
  }

  if (!asrConfigured(c.env)) {
    // ASR_CHAIN 里一家都没配 key 才会到这里。前端收到非 OK 会提示「网络繁忙」。
    await refund();
    return fail(ERR.NOT_IMPLEMENTED, '语音转写服务尚未配置');
  }

  try {
    const { words, provider, model, realTimestamps } = await transcribe(c.env, file);
    await c.env.R2.put(key, JSON.stringify(words), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    await c.env.DB.prepare(
      `INSERT INTO captions (creator_id, video_id, channel, r2_key, word_count, source)
       VALUES (?1, ?2, ?3, ?4, ?5, 'asr')
       ON CONFLICT(creator_id, video_id, channel)
       DO UPDATE SET r2_key = ?4, word_count = ?5, source = 'asr'`,
    )
      .bind(creatorId, videoId, channel, key, words.length)
      .run();

    console.log(
      `asr done user=${user.id} video=${videoId} 句数=${words.length} ` +
        `by=${provider}/${model} 真实时间戳=${realTimestamps}`,
    );
    return ok(words);
  } catch (e) {
    console.error('asr failed', e);
    await refund(); // 转写失败不收钱
    if (e instanceof ASRNotConfiguredError) return fail(ERR.NOT_IMPLEMENTED, e.message);
    return fail(ERR.INTERNAL, e instanceof Error ? e.message : '语音转写失败');
  }
});

/**
 * 分享页读取用，公开访问。
 * 必须注册在 /share/:videoId 之前，否则 "detail" 会被当成 videoId。
 */
r.get('/share/detail/:code', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT creator_id AS creatorId, video_id AS videoId, region, created_at AS createdAt
     FROM caption_shares WHERE share_code = ?1`,
  )
    .bind(c.req.param('code'))
    .first<{ creatorId: string; videoId: string; region: string }>();

  if (!row) return fail(ERR.NOT_FOUND, '分享不存在');

  const obj = await c.env.R2.get(objectKey(row.creatorId, row.videoId, 'F'));
  return ok({ ...row, wordList: obj ? await obj.json<Word[]>() : [] });
});

/**
 * GET /caption/share/{videoId}?region=xx
 * data 直接是 shareCode 字符串。
 * 前端会拼成 <站点>/kol/script-editor/share?region=..&shareCode=..[&translate=..]
 * 复制到剪贴板并开新窗口，所以官网那边要有对应的分享页。
 */
r.get('/share/:videoId', requireAuth, async (c) => {
  const user = currentUser(c);
  const videoId = c.req.param('videoId');
  const region = c.req.query('region') || '';

  const existing = await c.env.DB.prepare(
    `SELECT share_code FROM caption_shares WHERE video_id = ?1 AND user_id = ?2 LIMIT 1`,
  )
    .bind(videoId, user.id)
    .first<{ share_code: string }>();
  if (existing) return ok(existing.share_code);

  // creatorId 前端没传，得自己查。captions 表优先 —— 分享的就是字幕，
  // 那张表一定有记录；tk_videos 只有在 /video/save 跑过之后才有。
  const creator =
    (await c.env.DB.prepare(`SELECT creator_id FROM captions WHERE video_id = ?1 LIMIT 1`)
      .bind(videoId)
      .first<{ creator_id: string | null }>()) ??
    (await c.env.DB.prepare(`SELECT creator_id FROM tk_videos WHERE video_id = ?1`)
      .bind(videoId)
      .first<{ creator_id: string | null }>());

  const shareCode = shortCode();
  await c.env.DB.prepare(
    `INSERT INTO caption_shares (share_code, user_id, creator_id, video_id, region)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(shareCode, user.id, creator?.creator_id ?? '', videoId, region)
    .run();

  return ok(shareCode);
});

// ---------------------------------------------------------------------------

function shortCode(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}


/**
 * GET /caption/cdn/{creatorId}/{videoId}.json
 * 替代原来的 https://o.kolsprite.com/caption/{creatorId}/{videoId}[-high].json。
 * service worker 直接 fetch，**不带 Token**，所以不能要求登录。
 *
 * 路径里多了一层 /cdn 是有意的：写成 /caption/:creatorId/:file 的话，
 * 两个连续的路径参数会让 Hono 的 RegExpRouter 直接抛 UnsupportedPathError，
 * 整个 app 降级到慢速路由，而且 /caption/share/xxx 会被它抢先匹配掉。
 */
r.get('/cdn/:creatorId/:file', async (c) => {
  const creatorId = c.req.param('creatorId');
  const file = c.req.param('file');
  const key = `caption/${creatorId}/${file.replace(/\.json$/, '')}.json`;

  const obj = await c.env.R2.get(key);
  if (!obj) return fail(ERR.NOT_FOUND, '字幕不存在', 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

export default r;
