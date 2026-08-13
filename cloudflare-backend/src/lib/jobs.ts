/**
 * 离线任务：队列消费 + 定时调度。
 *
 * 在这之前后端没有任何「离线执行载体」——没有队列也没有 cron，
 * 所以 async_tasks 里 creator_similarity 这类任务建完就永远躺在 pending，
 * 没有任何进程会去跑它。这个文件就是补上那个载体。
 *
 * 目前只有一种任务：把达人嵌成向量写进 Vectorize（相似达人的召回层）。
 * 后续加任务时，往 JobMessage 上加一个 kind，在 runOne() 里加一个分支即可。
 */
import type { Env } from './types';
import { tickCampaigns } from './mail';

/** bge-m3：多语言（东南亚市场必须），输出 1024 维。 */
export const EMBED_MODEL = '@cf/baai/bge-m3';

/**
 * 一批嵌多少个达人。
 *
 * 卡这个数的是 D1 而不是 Workers AI：D1 单条查询的绑定参数上限是 100，
 * 而我们要用 `WHERE creator_id IN (...)` 回查资料，所以留一半余量取 50。
 */
const EMBED_CHUNK = 50;

export type JobMessage =
  | { kind: 'embed_creators'; creatorIds: string[] }
  | { kind: 'derive_creators'; creatorIds: string[] }
  | { kind: 'refresh_tag_stats' }
  | { kind: 'seed_creators'; limit?: number }
  | { kind: 'sweep_similarity_covers' }
  | { kind: 'snapshot_creators' }
  | { kind: 'tick_campaigns' };

type CreatorRow = {
  creator_id: string;
  unique_id: string | null;
  nickname: string | null;
  region: string | null;
  follower_count: number | null;
  payload: string | null;
};

/** 达人主页回流的 payload 形状，取我们要用的那几个字段。 */
type CreatorPayload = {
  user?: { signature?: string; uniqueId?: string; nickname?: string };
  itemList?: Array<{ desc?: string; tkCategory?: string }>;
};

// ---------------------------------------------------------------------------
// 文本构造
// ---------------------------------------------------------------------------

/**
 * 把一个达人拼成用于嵌入的文档。
 *
 * 原料全部取自 tk_creators.payload（主页回流的完整 JSON），刻意不去 join
 * tk_videos / tk_video_tags —— 那两张表的 creator_id 语义和 tk_creators 对不上
 * （一个存数字 id，一个存上报时带的 uid），join 出来大概率是空的。
 * payload 里本来就带 itemList，自给自足更稳。
 */
export function buildCreatorDoc(row: CreatorRow): string {
  let payload: CreatorPayload = {};
  try {
    payload = row.payload ? (JSON.parse(row.payload) as CreatorPayload) : {};
  } catch {
    // 回流数据被截断过（存的时候 slice 到 900KB），解析失败就只用列字段
  }

  const titles = (payload.itemList ?? [])
    .slice(0, 20)
    .map((v) => str(v.desc).trim())
    .filter(Boolean);

  // 话题标签单独抽一遍并去重：标题里同一个 #tag 会重复出现很多次，
  // 不去重的话嵌出来的向量会被高频标签带偏。
  const tags = new Set<string>();
  for (const t of titles) {
    for (const m of t.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
      tags.add(m[1].toLowerCase());
    }
  }

  return [
    str(row.nickname),
    str(payload.user?.signature),
    titles.join(' '),
    [...tags].join(' '),
  ]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

/** 粉丝量级分档（log10 取整）。相似达人必须量级相近，这是硬性产品约束。 */
export function followerBucket(n: number | null | undefined): number {
  if (!n || n <= 0) return 0;
  return Math.floor(Math.log10(n));
}

/** 取出现最多的那个内容分类，作为 metadata 过滤维度。 */
function topCategory(payload: CreatorPayload): string {
  const cnt = new Map<string, number>();
  for (const v of payload.itemList ?? []) {
    const c = str(v.tkCategory).trim();
    if (c) cnt.set(c, (cnt.get(c) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [c, n] of cnt) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** 文本指纹，用来判断内容有没有真的变过，避免重复烧 embedding 的钱。 */
async function hashOf(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// 任务实现
// ---------------------------------------------------------------------------

/**
 * 把一批达人嵌成向量写进 Vectorize。
 *
 * 返回实际写入的条数（跳过的不算）。
 */
async function embedCreators(env: Env, creatorIds: string[]): Promise<number> {
  if (!env.VECTORIZE || !env.AI || creatorIds.length === 0) return 0;

  const ids = creatorIds.slice(0, EMBED_CHUNK);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');

  const { results } = await env.DB.prepare(
    `SELECT creator_id, unique_id, nickname, region, follower_count, payload
       FROM tk_creators WHERE creator_id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<CreatorRow>();

  const rows = results ?? [];
  if (rows.length === 0) return 0;

  // 已有指纹，用来跳过内容没变的
  const known = new Map<string, string>();
  {
    const { results: seen } = await env.DB.prepare(
      `SELECT creator_id, source_hash FROM creator_vectors
        WHERE creator_id IN (${placeholders}) AND model = ?${ids.length + 1}`,
    )
      .bind(...ids, EMBED_MODEL)
      .all<{ creator_id: string; source_hash: string }>();
    for (const r of seen ?? []) known.set(r.creator_id, r.source_hash);
  }

  const pending: Array<{ row: CreatorRow; text: string; hash: string }> = [];
  for (const row of rows) {
    const text = buildCreatorDoc(row);
    // 没有任何可嵌的文本就别浪费额度了，这种达人只能靠 L0 规则匹配兜底
    if (!text) continue;
    const hash = await hashOf(text);
    if (known.get(row.creator_id) === hash) continue;
    pending.push({ row, text, hash });
  }
  if (pending.length === 0) return 0;

  const out = (await env.AI.run(EMBED_MODEL as never, {
    text: pending.map((p) => p.text),
  } as never)) as { data?: number[][] };

  const vectors = out?.data ?? [];
  if (vectors.length !== pending.length) {
    throw new Error(`embedding 数量对不上：期望 ${pending.length}，实际 ${vectors.length}`);
  }

  await env.VECTORIZE.upsert(
    pending.map(({ row }, i) => {
      let payload: CreatorPayload = {};
      try {
        payload = row.payload ? (JSON.parse(row.payload) as CreatorPayload) : {};
      } catch {
        /* 同上，解析失败就当没有 */
      }
      return {
        id: row.creator_id,
        values: vectors[i],
        // 地区走 namespace 而不是 metadata：namespace 在向量搜索之前生效，
        // 精度比搜完再过滤高，而相似达人必须同地区，正好是最强的那道过滤
        namespace: (row.region || 'UNKNOWN').toUpperCase(),
        metadata: {
          unique_id: row.unique_id ?? '',
          follower_bucket: followerBucket(row.follower_count),
          category: topCategory(payload),
        },
      };
    }),
  );

  // 记账。Vectorize 写入是最终一致的（中位 30 秒 / p99 2 分钟），
  // 这里记的是「已提交」而不是「已可搜」，查询侧要能容忍这段延迟。
  await env.DB.batch(
    pending.map(({ row, hash }) =>
      env.DB.prepare(
        `INSERT INTO creator_vectors (creator_id, namespace, source_hash, model, embedded_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch())
         ON CONFLICT(creator_id) DO UPDATE SET
           namespace = ?2, source_hash = ?3, model = ?4, embedded_at = unixepoch()`,
      ).bind(row.creator_id, (row.region || 'UNKNOWN').toUpperCase(), hash, EMBED_MODEL),
    ),
  );

  return pending.length;
}

// ---------------------------------------------------------------------------
// 从视频反推达人 + 派生指标
// ---------------------------------------------------------------------------

/** tk_videos.payload 里我们要用的那部分。TikTok 的数字字段全是字符串。 */
type VideoPayload = {
  author?: {
    id?: string;
    uniqueId?: string;
    nickname?: string;
    signature?: string;
    secUid?: string;
  };
  authorStats?: { followerCount?: string; heartCount?: string; videoCount?: string };
  authorStatsV2?: { followerCount?: string; heartCount?: string; videoCount?: string };
  stats?: {
    playCount?: string;
    diggCount?: string;
    commentCount?: string;
    collectCount?: string;
    shareCount?: string;
  };
  statsV2?: {
    playCount?: string;
    diggCount?: string;
    commentCount?: string;
    collectCount?: string;
    shareCount?: string;
  };
  textLanguage?: string;
  CategoryType?: string;
  desc?: string;
  createTime?: string;
};

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 强制转成字符串再用。
 *
 * SQLite 是动态类型的：TEXT 列照样能存进整数（回流时 tk_category 传的是
 * 数字 104，D1 就原样存成 INTEGER，读出来是 number）。
 * 直接 .trim() / .matchAll() 会抛 "is not a function"，而且只在特定数据上炸，
 * 很难复现。所有从 D1 或 payload 里取出来当字符串用的值都要过这一道。
 */
/** 时间戳归一到秒。大于 1e12 的当毫秒处理。 */
function toSec(v: number | null | undefined): number {
  const n = num(v);
  if (!n) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

/** 从标题里抽话题标签，归一化成小写无 # 的形式。 */
export function extractTags(desc: unknown): string[] {
  const out: string[] = [];
  for (const m of str(desc).matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
    out.push(m[1].toLowerCase());
  }
  return out;
}

/**
 * 从 tk_videos 反推达人资料、派生指标和标签。
 *
 * 为什么值得做：tk_videos.payload 里带完整的 author 对象和 authorStats，
 * 而视频回流的量比主页回流大得多 —— 实测线上 tk_videos 覆盖 78 个达人，
 * tk_creators 只有 4 个。等于 20 倍的达人资料躺在库里没人提取。
 * 这是零成本的冷启动方案，比买第三方数据靠前。
 *
 * 注意 source 字段：视频里的 author 信息比主页少（没有完整 itemList），
 * 所以只在达人不存在、或者已有记录也是 video 来源时才写，
 * 绝不覆盖 /creator/save 抓来的 profile 数据。
 */
async function deriveCreators(env: Env, creatorIds: string[]): Promise<number> {
  const ids = creatorIds.slice(0, EMBED_CHUNK);
  if (ids.length === 0) return 0;
  const ph = ids.map((_, i) => `?${i + 1}`).join(',');

  const { results } = await env.DB.prepare(
    `SELECT creator_id, region, title, pub_time, play_cnt, like_cnt, comment_cnt,
            collect_cnt, forward_cnt, tk_category, payload
       FROM tk_videos WHERE creator_id IN (${ph})`,
  )
    .bind(...ids)
    .all<{
      creator_id: string;
      region: string | null;
      title: string | null;
      pub_time: number | null;
      play_cnt: number | null;
      like_cnt: number | null;
      comment_cnt: number | null;
      collect_cnt: number | null;
      forward_cnt: number | null;
      tk_category: string | null;
      payload: string | null;
    }>();

  // 按达人分组
  const byCreator = new Map<string, typeof results>();
  for (const row of results ?? []) {
    const arr = byCreator.get(row.creator_id) ?? [];
    arr.push(row);
    byCreator.set(row.creator_id, arr);
  }
  if (byCreator.size === 0) return 0;

  const stmts: D1PreparedStatement[] = [];

  for (const [creatorId, vids] of byCreator) {
    let author: NonNullable<VideoPayload['author']> = {};
    let followerCount = 0;
    let heartCount = 0;
    let videoCount = 0;
    let region: string | null = null;

    let playSum = 0;
    let likeSum = 0;
    let commentSum = 0;
    let rateSum = 0;
    let rateN = 0;
    let lastPost = 0;

    const langCnt = new Map<string, number>();
    const catCnt = new Map<string, number>();
    const tagCnt = new Map<string, number>();

    for (const v of vids) {
      let p: VideoPayload = {};
      try {
        p = v.payload ? (JSON.parse(v.payload) as VideoPayload) : {};
      } catch {
        // payload 存的时候截断到 900KB，解析失败就只用列字段
      }

      // 达人基础资料：取最完整的那一条
      if (p.author?.uniqueId && !author.uniqueId) author = p.author;
      const st = p.authorStatsV2 ?? p.authorStats;
      if (st) {
        followerCount = Math.max(followerCount, num(st.followerCount));
        heartCount = Math.max(heartCount, num(st.heartCount));
        videoCount = Math.max(videoCount, num(st.videoCount));
      }
      if (!region && v.region) region = v.region;

      // 互动指标：列字段优先（回流时已经解析过），缺了再回 payload 找
      const s = p.statsV2 ?? p.stats ?? {};
      const play = v.play_cnt ?? num(s.playCount);
      const like = v.like_cnt ?? num(s.diggCount);
      const comment = v.comment_cnt ?? num(s.commentCount);
      const collect = v.collect_cnt ?? num(s.collectCount);
      const forward = v.forward_cnt ?? num(s.shareCount);

      playSum += play;
      likeSum += like;
      commentSum += comment;
      // 播放为 0 的条目不参与互动率平均，否则会把整体拉成 0
      if (play > 0) {
        rateSum += (like + comment + collect + forward) / play;
        rateN += 1;
      }

      // ⚠️ tk_videos.pub_time 存的是**毫秒**（所有写入方都是 createTime * 1000），
      // 而 payload 里的 createTime 是**秒**。混用会让 last_post_at 差三个数量级，
      // 活跃度判断直接失效。统一归一到秒。
      const t = toSec(v.pub_time) || num(p.createTime);
      if (t > lastPost) lastPost = t;

      // 'un' 是 TikTok 自己的「语种识别不出来」标记，不是真语种。
      // 当成真值存进去，lang 过滤会把一堆无关达人算成同语区。
      const lang = str(p.textLanguage).trim().toLowerCase();
      if (lang && lang !== 'un') langCnt.set(lang, (langCnt.get(lang) ?? 0) + 1);

      const cat = str(v.tk_category || p.CategoryType).trim();
      if (cat) catCnt.set(cat, (catCnt.get(cat) ?? 0) + 1);

      for (const tag of extractTags(v.title || p.desc)) {
        tagCnt.set(tag, (tagCnt.get(tag) ?? 0) + 1);
      }
    }

    const top = (m: Map<string, number>): string => {
      let best = '';
      let bestN = 0;
      for (const [k, n] of m) if (n > bestN) [best, bestN] = [k, n];
      return best;
    };

    const n = vids.length;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO creator_metrics
           (creator_id, avg_play_cnt, avg_like_cnt, avg_comment_cnt, interaction_rate,
            sample_size, last_post_at, lang, category, computed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, unixepoch())
         ON CONFLICT(creator_id) DO UPDATE SET
           avg_play_cnt = ?2, avg_like_cnt = ?3, avg_comment_cnt = ?4,
           interaction_rate = ?5, sample_size = ?6, last_post_at = ?7,
           lang = ?8, category = ?9, computed_at = unixepoch()`,
      ).bind(
        creatorId,
        Math.round(playSum / n),
        Math.round(likeSum / n),
        Math.round(commentSum / n),
        rateN > 0 ? rateSum / rateN : 0,
        n,
        lastPost || null,
        top(langCnt) || null,
        top(catCnt) || null,
      ),
    );

    // 达人资料：只补不覆盖 —— profile 来源的记录比这里完整得多
    if (author.uniqueId) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO tk_creators
             (creator_id, unique_id, unique_id_lower, nickname, region, follower_count,
              payload, source, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'video', unixepoch())
           ON CONFLICT(creator_id) DO UPDATE SET
             unique_id = COALESCE(tk_creators.unique_id, ?2),
             unique_id_lower = COALESCE(tk_creators.unique_id_lower, ?3),
             nickname = COALESCE(tk_creators.nickname, ?4),
             region = COALESCE(tk_creators.region, ?5),
             follower_count = MAX(COALESCE(tk_creators.follower_count, 0), ?6),
             payload = CASE WHEN tk_creators.source = 'video' THEN ?7 ELSE tk_creators.payload END,
             updated_at = unixepoch()`,
        ).bind(
          creatorId,
          author.uniqueId,
          author.uniqueId.toLowerCase(),
          author.nickname ?? null,
          region,
          followerCount,
          JSON.stringify({
            user: {
              id: creatorId,
              uniqueId: author.uniqueId,
              nickname: author.nickname,
              signature: author.signature,
              secUid: author.secUid,
            },
            stats: { followerCount, heartCount, videoCount },
            // 给 embedding 用：视频标题就是这个达人的内容画像
            itemList: vids.slice(0, 20).map((v) => ({ desc: str(v.title) })),
          }).slice(0, 900_000),
        ),
      );
    }

    // 标签：带次数写进干净的表
    for (const [tag, hit] of [...tagCnt].slice(0, 100)) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO creator_tags (creator_id, kind, tag, hit_count, updated_at)
           VALUES (?1, 'challenge', ?2, ?3, unixepoch())
           ON CONFLICT(creator_id, kind, tag) DO UPDATE SET
             hit_count = MAX(creator_tags.hit_count, ?3), updated_at = unixepoch()`,
        ).bind(creatorId, tag, hit),
      );
    }
  }

  // D1 单次调用最多 1000 条查询，分批提交
  for (let i = 0; i < stmts.length; i += 200) {
    await env.DB.batch(stmts.slice(i, i + 200));
  }
  return byCreator.size;
}

// ---------------------------------------------------------------------------
// 灌达人库（冷启动）
// ---------------------------------------------------------------------------

/**
 * tikwm 的免费档是 1 请求/秒，这里统一按 1.3 秒一拍走，别去撞限流。
 * sleep 不吃 CPU 时间，卡的是 wall clock（队列消费者 15 分钟），
 * 所以单次任务的达人数要有上限。
 */
const TIKWM_PACE_MS = 1300;
const SEED_MAX_CREATORS = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TikwmAuthor = { id?: string; unique_id?: string; nickname?: string; avatar?: string };
type TikwmSearchVideo = {
  video_id?: string;
  title?: string;
  region?: string;
  create_time?: number;
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  collect_count?: number;
  share_count?: number;
  author?: TikwmAuthor;
};

async function tikwmGet<T>(env: Env, path: string, params: Record<string, string>): Promise<T | null> {
  const base = (env.TIKWM_API_URL || 'https://www.tikwm.com/api/').replace(/\/api\/?$/, '');
  const url = `${base}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tikwm ${path} http ${res.status}`);
  const body = await res.json<{ code?: number; msg?: string; data?: T }>();
  if (body.code !== 0 || !body.data) {
    // 把拒绝原因打出来。免费档最常见的是
    // "Free Api Limit: 10000 request/ 1 day." —— 日额度按出口 IP 算，
    // Cloudflare 边缘是共享 IP，经常在我们用之前就被烧光。
    // 不打日志的话，线上表现就是"灌库跑了但一个人都没进来"，无从排查。
    console.warn(`tikwm ${path} 被拒: code=${body.code} msg=${body.msg ?? ''}`);
    return null;
  }
  return body.data;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 按关键词灌达人库。
 *
 * 为什么需要这个：自有回流的达人全部来自用户自己刷过的页面，冷启动阶段
 * 线上只有 4 个达人（从视频反推后也才 78 个），相似达人搜出来必然是空的。
 * 候选池规模是比算法调优更靠前的瓶颈。
 *
 * 用的是 tikwm —— 已经在给视频解析用的同一个供应商，不引入新依赖、不额外花钱：
 *   1. /api/feed/search 按关键词搜视频，返回里带 author 和 region
 *   2. /api/user/info 按 handle 反查粉丝数（搜索结果里没有粉丝数，
 *      而 L0 是按粉丝量级过滤的，没有这个字段的达人会被直接排除）
 *   3. 写进 tk_creators（source='seed'）+ tk_videos，
 *      剩下的指标和标签由 derive_creators 接着算
 *
 * 已经在库里的达人跳过，不重复请求。
 */
async function seedCreators(env: Env, limit: number): Promise<Record<string, number>> {
  const keywords = (env.SEED_KEYWORDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keywords.length) {
    console.warn('seed_creators: 没配 SEED_KEYWORDS，跳过');
    return { keywords: 0, creators: 0, videos: 0 };
  }
  const regions = new Set(
    (env.SEED_REGIONS || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );

  const cap = Math.min(limit || SEED_MAX_CREATORS, SEED_MAX_CREATORS);
  const byAuthor = new Map<string, { author: TikwmAuthor; region: string; videos: TikwmSearchVideo[] }>();

  for (const kw of keywords) {
    if (byAuthor.size >= cap) break;
    let data: { videos?: TikwmSearchVideo[] } | null = null;
    try {
      data = await tikwmGet(env, '/api/feed/search', { keywords: kw, count: '20' });
    } catch (e) {
      console.warn('seed_creators: 搜索失败', kw, String(e).slice(0, 100));
    }
    await sleep(TIKWM_PACE_MS);
    for (const v of data?.videos ?? []) {
      const a = v.author;
      const uid = str(a?.unique_id).trim();
      const cid = str(a?.id).trim();
      if (!uid || !cid) continue;
      const region = str(v.region).toUpperCase();
      // 只要指定市场的达人。地区不明的也放进来 —— 宁可多收，
      // 反正 L2 重排会把地区不匹配的排后面
      if (regions.size && region && !regions.has(region)) continue;
      const hit = byAuthor.get(cid);
      if (hit) {
        hit.videos.push(v);
      } else if (byAuthor.size < cap) {
        byAuthor.set(cid, { author: a!, region, videos: [v] });
      }
    }
  }
  if (byAuthor.size === 0) return { keywords: keywords.length, creators: 0, videos: 0 };

  // 已经在库里的不用再查粉丝数，省请求
  const ids = [...byAuthor.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const ph = chunk.map((_, j) => `?${j + 1}`).join(',');
    const { results } = await env.DB.prepare(
      `SELECT creator_id FROM tk_creators WHERE creator_id IN (${ph}) AND follower_count > 0`,
    )
      .bind(...chunk)
      .all<{ creator_id: string }>();
    for (const r of results ?? []) existing.add(r.creator_id);
  }

  const stmts: D1PreparedStatement[] = [];
  let added = 0;
  let videoRows = 0;

  for (const [cid, entry] of byAuthor) {
    const uid = str(entry.author.unique_id);

    let followerCount = 0;
    let heartCount = 0;
    let videoCount = 0;
    let signature = '';
    if (!existing.has(cid)) {
      try {
        const info = await tikwmGet<{
          user?: { signature?: string };
          stats?: { followerCount?: number; heartCount?: number; videoCount?: number };
        }>(env, '/api/user/info', { unique_id: uid });
        followerCount = num(info?.stats?.followerCount);
        heartCount = num(info?.stats?.heartCount);
        videoCount = num(info?.stats?.videoCount);
        signature = str(info?.user?.signature);
      } catch (e) {
        console.warn('seed_creators: 查达人失败', uid, String(e).slice(0, 80));
      }
      await sleep(TIKWM_PACE_MS);
      // 查不到粉丝数就别入库了 —— L0 按粉丝量级过滤，
      // follower_count 为 0 的达人永远不会成为候选，入库只是占位
      if (!followerCount) continue;
      added += 1;
    }

    stmts.push(
      env.DB.prepare(
        `INSERT INTO tk_creators
           (creator_id, unique_id, unique_id_lower, nickname, region, follower_count,
            payload, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'seed', unixepoch())
         ON CONFLICT(creator_id) DO UPDATE SET
           unique_id = COALESCE(tk_creators.unique_id, ?2),
           unique_id_lower = COALESCE(tk_creators.unique_id_lower, ?3),
           nickname = COALESCE(tk_creators.nickname, ?4),
           region = COALESCE(tk_creators.region, ?5),
           follower_count = MAX(COALESCE(tk_creators.follower_count, 0), ?6),
           -- 只在原来也是种子/视频派生时才覆盖 payload，
           -- 别把 /creator/save 抓来的完整主页数据冲掉
           payload = CASE WHEN tk_creators.source IN ('seed','video')
                          THEN ?7 ELSE tk_creators.payload END,
           updated_at = unixepoch()`,
      ).bind(
        cid,
        uid,
        uid.toLowerCase(),
        str(entry.author.nickname) || null,
        entry.region || null,
        followerCount,
        JSON.stringify({
          user: { id: cid, uniqueId: uid, nickname: entry.author.nickname, signature },
          stats: { followerCount, heartCount, videoCount },
          itemList: entry.videos.slice(0, 20).map((v) => ({ desc: str(v.title) })),
        }).slice(0, 900_000),
      ),
    );

    // 视频也存一份，derive_creators 会拿它们算均播/互动率/标签
    for (const v of entry.videos.slice(0, 20)) {
      const vid = str(v.video_id);
      if (!vid) continue;
      videoRows += 1;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO tk_videos
             (video_id, creator_id, region, title, pub_time, play_cnt, like_cnt,
              comment_cnt, collect_cnt, forward_cnt, payload, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, unixepoch())
           ON CONFLICT(video_id) DO UPDATE SET
             play_cnt = MAX(COALESCE(?6,0), COALESCE(tk_videos.play_cnt,0)),
             like_cnt = MAX(COALESCE(?7,0), COALESCE(tk_videos.like_cnt,0)),
             updated_at = unixepoch()`,
        ).bind(
          vid,
          cid,
          entry.region || null,
          str(v.title) || null,
          // 和其它写入方保持一致：这张表的 pub_time 存的是毫秒
          v.create_time ? num(v.create_time) * 1000 : null,
          num(v.play_count),
          num(v.digg_count),
          num(v.comment_count),
          num(v.collect_count),
          num(v.share_count),
          JSON.stringify({
            author: { id: cid, uniqueId: uid, nickname: entry.author.nickname },
            stats: {
              playCount: v.play_count,
              diggCount: v.digg_count,
              commentCount: v.comment_count,
              collectCount: v.collect_count,
              shareCount: v.share_count,
            },
            desc: v.title,
            createTime: v.create_time,
          }).slice(0, 400_000),
        ),
      );
    }
  }

  for (let i = 0; i < stmts.length; i += 200) {
    await env.DB.batch(stmts.slice(i, i + 200));
  }
  return { keywords: keywords.length, creators: added, videos: videoRows };
}

/**
 * 达人粉丝数每日快照，喂达人榜的「近30天涨粉」tab。
 *
 * 单条 INSERT...SELECT，量级 = tk_creators 行数，很轻。
 * 同一天重复跑取 MAX（回流数据一天内可能多次更新，涨粉取当天最高值）。
 * 只保留 90 天：榜单窗口是 30 天，留 3 倍余量，别让表无限膨胀。
 */
async function snapshotCreators(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO creator_snapshots (creator_id, day, follower_count, created_at)
     SELECT creator_id, date('now'), follower_count, unixepoch()
       FROM tk_creators WHERE follower_count > 0
     ON CONFLICT(creator_id, day) DO UPDATE SET
       follower_count = MAX(creator_snapshots.follower_count, excluded.follower_count)`,
  ).run();
  await env.DB.prepare(
    `DELETE FROM creator_snapshots WHERE day < date('now','-90 day')`,
  ).run();
  return r.meta?.changes ?? 0;
}

/**
 * 重算标签的文档频率。
 *
 * 不做这一步的话，#fyp / #foryou / #viral 这种全站通用标签会让任意两个达人
 * 都「很相似」—— 这是共现类相似度最典型的翻车方式。
 */
async function refreshTagStats(env: Env): Promise<number> {
  await env.DB.prepare(`DELETE FROM tag_stats`).run();
  const r = await env.DB.prepare(
    `INSERT INTO tag_stats (tag, doc_freq, updated_at)
     SELECT tag, COUNT(DISTINCT creator_id), unixepoch()
       FROM creator_tags GROUP BY tag`,
  ).run();
  return r.meta?.changes ?? 0;
}

/**
 * 清掉相似达人上传的封面图。
 *
 * 封面图相似这条路已经放弃（Workers AI 没有 CLIP / 多模态 embedding 模型），
 * 但前端那段上传逻辑不能停 —— 它在「封面全部上传失败」时会直接报错、
 * 根本不会发起相似达人请求。所以图照收，收完定期删，别让 R2 无限膨胀。
 */
async function sweepSimilarityCovers(env: Env): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  // 一次 cron 最多删这么多，剩下的下次再来，避免把 CPU 时间耗光
  const MAX = 5000;
  while (deleted < MAX) {
    const listed = await env.R2.list({ prefix: 'similarity/', cursor, limit: 500 });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length === 0) break;
    // R2 单次 delete 最多 1000 个 key
    await env.R2.delete(keys);
    deleted += keys.length;
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return deleted;
}

async function runOne(env: Env, msg: JobMessage): Promise<void> {
  switch (msg.kind) {
    case 'embed_creators': {
      const n = await embedCreators(env, msg.creatorIds);
      if (n > 0) console.log('jobs: embedded', n, 'creators');
      return;
    }
    case 'derive_creators': {
      const n = await deriveCreators(env, msg.creatorIds);
      if (n > 0) console.log('jobs: derived', n, 'creators from videos');
      return;
    }
    case 'refresh_tag_stats': {
      const n = await refreshTagStats(env);
      console.log('jobs: tag_stats 重算完成，', n, '个标签');
      return;
    }
    case 'seed_creators': {
      const r = await seedCreators(env, msg.limit ?? SEED_MAX_CREATORS);
      console.log('jobs: 灌达人库', JSON.stringify(r));
      return;
    }
    case 'sweep_similarity_covers': {
      const n = await sweepSimilarityCovers(env);
      if (n > 0) console.log('jobs: 清理封面图', n, '个');
      return;
    }
    case 'snapshot_creators': {
      const n = await snapshotCreators(env);
      console.log('jobs: 粉丝快照', n, '条');
      return;
    }
    case 'tick_campaigns': {
      const r = await tickCampaigns(env);
      if (r.sent > 0) console.log('jobs: 群发推进', JSON.stringify(r));
      return;
    }
    default: {
      // 队列里出现了不认识的消息类型，直接吞掉，别让它反复重投
      console.warn('jobs: 未知任务类型', JSON.stringify(msg).slice(0, 200));
    }
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 同步跑一个任务，供 /admin/jobs/run 手动触发。
 *
 * 和 cron 的区别：cron 只负责「查出待办、投进队列」，真正的活儿在消费者里跑；
 * 这里是当场跑完当场返回，方便改完代码立刻验证、或者一次性回填存量数据。
 */
export async function runJobNow(
  env: Env,
  kind: string,
  limit: number,
): Promise<Record<string, number>> {
  switch (kind) {
    case 'derive_creators': {
      const { results } = await env.DB.prepare(
        `SELECT v.creator_id
           FROM tk_videos v
           LEFT JOIN creator_metrics m ON m.creator_id = v.creator_id
          WHERE v.creator_id IS NOT NULL AND v.creator_id <> ''
            AND (m.creator_id IS NULL OR v.updated_at > m.computed_at)
          GROUP BY v.creator_id
          LIMIT ?1`,
      )
        .bind(limit)
        .all<{ creator_id: string }>();
      const ids = (results ?? []).map((r) => r.creator_id);
      let done = 0;
      for (let i = 0; i < ids.length; i += EMBED_CHUNK) {
        done += await deriveCreators(env, ids.slice(i, i + EMBED_CHUNK));
      }
      return { candidates: ids.length, derived: done };
    }
    case 'embed_creators': {
      if (!env.VECTORIZE) throw new Error('没有 VECTORIZE 绑定');
      const { results } = await env.DB.prepare(
        `SELECT c.creator_id
           FROM tk_creators c
           LEFT JOIN creator_vectors v
             ON v.creator_id = c.creator_id AND v.model = ?1
          WHERE v.creator_id IS NULL OR c.updated_at > v.embedded_at
          ORDER BY c.updated_at DESC LIMIT ?2`,
      )
        .bind(EMBED_MODEL, limit)
        .all<{ creator_id: string }>();
      const ids = (results ?? []).map((r) => r.creator_id);
      let done = 0;
      for (let i = 0; i < ids.length; i += EMBED_CHUNK) {
        done += await embedCreators(env, ids.slice(i, i + EMBED_CHUNK));
      }
      return { candidates: ids.length, embedded: done };
    }
    case 'refresh_tag_stats':
      return { tags: await refreshTagStats(env) };
    case 'seed_creators':
      return await seedCreators(env, limit);
    case 'sweep_similarity_covers':
      return { deleted: await sweepSimilarityCovers(env) };
    case 'snapshot_creators':
      return { snapshots: await snapshotCreators(env) };
    case 'tick_campaigns':
      return await tickCampaigns(env);
    default:
      throw new Error(`未知任务类型: ${kind}`);
  }
}

/**
 * 队列消费。
 *
 * 每条消息单独 ack/retry：一条坏消息不该把同批的好消息一起拖去重试。
 * 重试 3 次后进死信队列 kolsprite-jobs-dlq（配置见 wrangler.jsonc）。
 */
export async function handleQueue(
  batch: MessageBatch<JobMessage>,
  env: Env,
): Promise<void> {
  for (const m of batch.messages) {
    try {
      await runOne(env, m.body);
      m.ack();
    } catch (err) {
      console.error('jobs: 任务失败', JSON.stringify(m.body).slice(0, 200), err);
      m.retry();
    }
  }
}

/**
 * 一次调度最多推多少个达人进队列。
 *
 * cron 的 CPU 时间是按间隔给的：间隔 < 1 小时只给 30 秒，≥ 1 小时才给满 15 分钟
 * （所以 wrangler.jsonc 里的两个 cron 都是整点级别的）。
 * 这里只做「查 + 投递」，真正的嵌入在队列消费者里跑，所以很轻。
 */
const HOURLY_LIMIT = 1000;
const DAILY_LIMIT = 5000;

/**
 * 定时调度：找出还没建向量、或者资料已经更新过的达人，推进队列。
 *
 * 两个 cron 走同一段逻辑，只是批量不同：
 *   0 * * * *  每小时增量，追新回流的达人
 *   0 3 * * *  每天 03:00 UTC 大扫除，把增量漏掉的补上
 */
export async function handleScheduled(
  event: ScheduledController,
  env: Env,
): Promise<void> {
  if (!env.JOBS) {
    console.warn('scheduled: 没有 JOBS 队列绑定，跳过');
    return;
  }

  const daily = event.cron === '0 3 * * *';
  const limit = daily ? DAILY_LIMIT : HOURLY_LIMIT;
  const messages: Array<{ body: JobMessage }> = [];

  // --- 1. 从视频反推达人 --------------------------------------------------
  // 有视频、但达人资料还没派生过（或者视频比派生结果新）的那些。
  // 这一步不依赖 Vectorize，没建索引也要跑 —— 它是冷启动的主力。
  {
    const { results } = await env.DB.prepare(
      `SELECT v.creator_id
         FROM tk_videos v
         LEFT JOIN creator_metrics m ON m.creator_id = v.creator_id
        WHERE v.creator_id IS NOT NULL AND v.creator_id <> ''
          AND (m.creator_id IS NULL OR v.updated_at > m.computed_at)
        GROUP BY v.creator_id
        LIMIT ?1`,
    )
      .bind(limit)
      .all<{ creator_id: string }>();

    const ids = (results ?? []).map((r) => r.creator_id);
    for (let i = 0; i < ids.length; i += EMBED_CHUNK) {
      messages.push({ body: { kind: 'derive_creators', creatorIds: ids.slice(i, i + EMBED_CHUNK) } });
    }
    if (ids.length) console.log('scheduled: 待反推达人', ids.length);
  }

  // --- 1.5 群发任务推进（每小时一小批，限速靠的就是这个节奏）-----------------
  messages.push({ body: { kind: 'tick_campaigns' } });

  // --- 2. 向量回填 --------------------------------------------------------
  // 上一步刚派生出来的达人这一轮还嵌不到（消息是并发消费的，顺序不保证），
  // 下一个小时的 tick 会把它们捞走。不追求同一轮内闭环。
  if (env.VECTORIZE) {
    const { results } = await env.DB.prepare(
      `SELECT c.creator_id
         FROM tk_creators c
         LEFT JOIN creator_vectors v
           ON v.creator_id = c.creator_id AND v.model = ?1
        WHERE v.creator_id IS NULL OR c.updated_at > v.embedded_at
        ORDER BY c.updated_at DESC
        LIMIT ?2`,
    )
      .bind(EMBED_MODEL, limit)
      .all<{ creator_id: string }>();

    const ids = (results ?? []).map((r) => r.creator_id);
    for (let i = 0; i < ids.length; i += EMBED_CHUNK) {
      messages.push({ body: { kind: 'embed_creators', creatorIds: ids.slice(i, i + EMBED_CHUNK) } });
    }
    if (ids.length) console.log('scheduled: 待嵌入达人', ids.length);
  } else {
    console.warn('scheduled: 没有 VECTORIZE 绑定，跳过向量回填');
  }

  // --- 3. 每日的全量活儿 --------------------------------------------------
  if (daily) {
    messages.push({ body: { kind: 'refresh_tag_stats' } });
    messages.push({ body: { kind: 'sweep_similarity_covers' } });
    // 粉丝快照：每天一条，30 天后涨粉榜自然有数据
    messages.push({ body: { kind: 'snapshot_creators' } });
    // 每天灌一批新达人。配了 SEED_KEYWORDS 才会真跑，没配就是空转。
    // 放在每日而不是每小时：它要按 1.3 秒一拍去打 tikwm，很慢，
    // 而且候选池是慢慢长起来的，不需要高频。
    messages.push({ body: { kind: 'seed_creators' } });
  }

  if (messages.length === 0) return;
  // sendBatch 单次最多 100 条消息
  for (let i = 0; i < messages.length; i += 100) {
    await env.JOBS.sendBatch(messages.slice(i, i + 100));
  }
  console.log('scheduled:', event.cron, '已投递', messages.length, '条消息');
}
