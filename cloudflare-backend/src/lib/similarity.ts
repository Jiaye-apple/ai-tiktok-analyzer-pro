/**
 * 相似达人检索。
 *
 * 三层，从粗到细：
 *   L0 硬过滤（D1 SQL）  同地区 + 粉丝量级同档 ±1 + 近期活跃 + 排除忽略名单
 *   L1 向量召回（Vectorize）语义相似，namespace 按地区分
 *   L2 统计重排（D1 SQL）  标签共现 IDF 加权 + 类目 + 量级/互动率接近度
 *
 * 为什么不是单纯上向量：用户心智里的「相似达人」必须同地区、粉丝量级相近 ——
 * 这是产品约束不是语义问题，指望 embedding 学出来只会得到一堆没法合作的达人。
 * 所以量级和地区做硬过滤，语义只负责在合格候选里排序。
 *
 * 没有 Vectorize 绑定（本地 dev）或者种子达人还没建向量时，
 * 自动退化成 L0 + L2，仍然能出结果，只是少了语义那一路。
 */
import type { Env } from './types';
import { followerBucket } from './jobs';

/** 前端卡片直接消费的形状。creatorId 必须是 handle，不是数字 id。 */
export type SimilarCreator = {
  /** TikTok handle。前端拿它去 tiktok.com/@{creatorId} 补昵称头像，也拿它调收藏/推广接口 */
  creatorId: string;
  region: string;
  avgPlayCnt: number;
  avgLikeCnt: number;
  /** 0~1 的小数，前端会 ×100 再加 % */
  avgInteractionRate: number;
};

/** 最多给前端多少条。前端每页渲染 5 条，50 条够翻 10 页了。 */
const MAX_RESULTS = 50;

/**
 * L1 一次要回多少候选。
 *
 * Vectorize 带 metadata 的 topK 上限就是 50；同时 D1 单条查询绑定参数上限是 100，
 * 两个上限正好卡在一起，取 50 两边都不越界。
 */
const VECTOR_TOPK = 50;

/** L0 最多捞多少候选进重排。全表扫的规模由 region + 量级过滤压住。 */
const L0_LIMIT = 300;

type Cand = {
  creator_id: string;
  unique_id: string | null;
  region: string | null;
  follower_count: number | null;
  avg_play_cnt: number;
  avg_like_cnt: number;
  interaction_rate: number;
  sample_size: number;
  category: string | null;
};

export type SeedInfo = {
  creatorId: string;
  uniqueId: string;
  region: string;
  followerCount: number;
  interactionRate: number;
  category: string;
  tags: Map<string, number>;
};

/**
 * 把种子达人的资料查出来。
 *
 * 请求里给的可能是数字 id（userId）也可能是 handle（handleName），
 * 两个都试。查不到就用请求里带的 region 兜底，仍然能跑 L0。
 */
export async function loadSeed(
  env: Env,
  userId: string | undefined,
  handleName: string | undefined,
  regionHint: string | undefined,
): Promise<SeedInfo | null> {
  let row: Cand | null = null;

  if (userId) {
    row = await env.DB.prepare(
      `SELECT c.creator_id, c.unique_id, c.region, c.follower_count,
              COALESCE(m.avg_play_cnt,0) avg_play_cnt, COALESCE(m.avg_like_cnt,0) avg_like_cnt,
              COALESCE(m.interaction_rate,0) interaction_rate, COALESCE(m.sample_size,0) sample_size,
              m.category
         FROM tk_creators c LEFT JOIN creator_metrics m ON m.creator_id = c.creator_id
        WHERE c.creator_id = ?1 LIMIT 1`,
    )
      .bind(String(userId))
      .first<Cand>();
  }
  if (!row && handleName) {
    row = await env.DB.prepare(
      `SELECT c.creator_id, c.unique_id, c.region, c.follower_count,
              COALESCE(m.avg_play_cnt,0) avg_play_cnt, COALESCE(m.avg_like_cnt,0) avg_like_cnt,
              COALESCE(m.interaction_rate,0) interaction_rate, COALESCE(m.sample_size,0) sample_size,
              m.category
         FROM tk_creators c LEFT JOIN creator_metrics m ON m.creator_id = c.creator_id
        WHERE c.unique_id_lower = ?1 LIMIT 1`,
    )
      .bind(String(handleName).toLowerCase())
      .first<Cand>();
  }

  // 库里完全没有这个达人：还是给个最小种子，让 L0 能按 region 兜底出结果
  if (!row) {
    if (!handleName && !userId) return null;
    return {
      creatorId: String(userId ?? ''),
      uniqueId: String(handleName ?? ''),
      region: (regionHint || '').toUpperCase(),
      followerCount: 0,
      interactionRate: 0,
      category: '',
      tags: new Map(),
    };
  }

  const { results } = await env.DB.prepare(
    `SELECT tag, hit_count FROM creator_tags WHERE creator_id = ?1 LIMIT 200`,
  )
    .bind(row.creator_id)
    .all<{ tag: string; hit_count: number }>();

  return {
    creatorId: row.creator_id,
    uniqueId: row.unique_id ?? String(handleName ?? ''),
    region: (row.region || regionHint || '').toUpperCase(),
    followerCount: row.follower_count ?? 0,
    interactionRate: row.interaction_rate,
    category: row.category ?? '',
    tags: new Map((results ?? []).map((r) => [r.tag, r.hit_count])),
  };
}

/**
 * L1：向量召回。种子还没建过向量时返回空数组，让调用方退化到纯 L0。
 */
async function vectorRecall(env: Env, seed: SeedInfo): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!env.VECTORIZE || !seed.creatorId) return out;

  const bucket = followerBucket(seed.followerCount);
  try {
    // 这里**故意不传 namespace**。
    //
    // 向量写入时是按地区分 namespace 存的（jobs.ts），设计上 namespace 过滤
    // 在向量搜索之前生效、精度比搜完再过滤高。但实测回流数据里地区覆盖率只有
    // 约 5%（62 条视频里只有 3 条带 region），绝大多数向量都躺在 'UNKNOWN'。
    // 这时候按 namespace='ID' 查会几乎什么都搜不到 —— 而且是静默返回空，
    // 比没有过滤还糟。
    //
    // 所以现阶段地区降级成 L2 里的一个加分项（regionScore）。
    // 等地区覆盖率上来（比如 >60%），把下面这行注释放开即可，写入侧不用动。
    //   namespace: seed.region || 'UNKNOWN',
    const res = await env.VECTORIZE.queryById(seed.creatorId, {
      topK: VECTOR_TOPK,
      returnMetadata: 'none',
      // 粉丝量级同档 ±1。量级差两个数量级的达人在商务上根本不是替代关系
      filter: bucket
        ? { follower_bucket: { $gte: bucket - 1, $lte: bucket + 1 } }
        : undefined,
    });
    for (const m of res?.matches ?? []) {
      // queryById 会把种子自己以 score=1.0 放在第一条，必须排掉，
      // 否则用户看到的第一个「相似达人」就是他自己
      if (m.id === seed.creatorId) continue;
      out.set(m.id, m.score);
    }
  } catch (err) {
    // 种子没建过向量时 queryById 会报错。这不是故障，是冷启动的常态 ——
    // 记一笔然后退化到 L0，不要让整个任务失败
    console.warn('similarity: 向量召回跳过', seed.creatorId, String(err).slice(0, 120));
  }
  return out;
}

/**
 * L0：硬过滤，捞候选池。
 *
 * ignoreOn 为真时排掉用户在推广计划里标记过 ignored 的达人 ——
 * promotion.ts 一直在写这个状态，但此前服务端从没读过它。
 * 注意 promotion_creators.creator_id 存的是 handle，而 tk_creators.creator_id
 * 是数字 id，关联必须走 unique_id_lower。
 */
async function hardFilter(
  env: Env,
  seed: SeedInfo,
  userId: string,
  ignoreOn: boolean,
  extraIds: string[],
): Promise<Cand[]> {
  const bucket = followerBucket(seed.followerCount);
  const lo = bucket ? Math.pow(10, Math.max(0, bucket - 1)) : 0;
  const hi = bucket ? Math.pow(10, bucket + 2) : Number.MAX_SAFE_INTEGER;

  // 向量召回到的 id 无条件放进候选池（它们已经过了 namespace + 量级过滤），
  // 其余按 region 捞。两边合并去重后再重排。
  const idFilter =
    extraIds.length > 0
      ? `OR c.creator_id IN (${extraIds.map((_, i) => `?${i + 5}`).join(',')})`
      : '';

  const sql = `
    SELECT c.creator_id, c.unique_id, c.region, c.follower_count,
           COALESCE(m.avg_play_cnt,0) avg_play_cnt, COALESCE(m.avg_like_cnt,0) avg_like_cnt,
           COALESCE(m.interaction_rate,0) interaction_rate, COALESCE(m.sample_size,0) sample_size,
           m.category
      FROM tk_creators c
      LEFT JOIN creator_metrics m ON m.creator_id = c.creator_id
     WHERE c.creator_id <> ?1
       AND c.unique_id IS NOT NULL AND c.unique_id <> ''
       AND (
         (
           c.follower_count BETWEEN ?2 AND ?3
           -- 地区不做硬排除：回流数据里 region 覆盖率只有约 5%，
           -- 一旦按 region 严格过滤，候选池会被清空（种子有地区、候选没有）。
           -- 地区不明的一律放进来，在 L2 里按 regionScore 排序时再体现差异。
           AND (?4 = '' OR COALESCE(c.region,'') = '' OR UPPER(c.region) = ?4)
         )
         ${idFilter}
       )
     ORDER BY c.follower_count DESC
     LIMIT ${L0_LIMIT}`;

  const { results } = await env.DB.prepare(sql)
    .bind(seed.creatorId || '-', lo, hi, seed.region || '', ...extraIds)
    .all<Cand>();

  let cands = results ?? [];

  if (ignoreOn && cands.length) {
    const { results: ignored } = await env.DB.prepare(
      `SELECT LOWER(creator_id) h FROM promotion_creators
        WHERE user_id = ?1 AND status = 'ignored'`,
    )
      .bind(userId)
      .all<{ h: string }>();
    const skip = new Set((ignored ?? []).map((r) => r.h));
    if (skip.size) {
      cands = cands.filter((c) => !skip.has((c.unique_id ?? '').toLowerCase()));
    }
  }
  return cands;
}

/** 两个数越接近越接近 1，差一个数量级往下掉。 */
function closeness(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const r = Math.log10(a) - Math.log10(b);
  return 1 / (1 + Math.abs(r));
}

/**
 * L2：重排打分。
 *
 * 四路加权：语义（来自 L1）、标签共现（IDF 加权的 Jaccard）、类目一致、
 * 量级与互动率接近度。权重是经验值，等有了点击回流再调。
 */
async function rerank(
  env: Env,
  seed: SeedInfo,
  cands: Cand[],
  vecScores: Map<string, number>,
): Promise<Cand[]> {
  if (cands.length === 0) return [];

  // 候选的标签，一次查完
  const tagsByCreator = new Map<string, Map<string, number>>();
  if (seed.tags.size > 0) {
    const ids = cands.map((c) => c.creator_id);
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const ph = chunk.map((_, j) => `?${j + 1}`).join(',');
      const { results } = await env.DB.prepare(
        `SELECT creator_id, tag, hit_count FROM creator_tags
          WHERE creator_id IN (${ph})`,
      )
        .bind(...chunk)
        .all<{ creator_id: string; tag: string; hit_count: number }>();
      for (const r of results ?? []) {
        const m = tagsByCreator.get(r.creator_id) ?? new Map();
        m.set(r.tag, r.hit_count);
        tagsByCreator.set(r.creator_id, m);
      }
    }
  }

  // 种子标签的 IDF。没有 tag_stats（还没跑过统计）时退化成全部等权。
  const idf = new Map<string, number>();
  if (seed.tags.size > 0) {
    const total =
      (
        await env.DB.prepare(`SELECT COUNT(*) n FROM creator_metrics`).first<{ n: number }>()
      )?.n ?? 0;
    const tags = [...seed.tags.keys()].slice(0, 90);
    const ph = tags.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await env.DB.prepare(
      `SELECT tag, doc_freq FROM tag_stats WHERE tag IN (${ph})`,
    )
      .bind(...tags)
      .all<{ tag: string; doc_freq: number }>();
    for (const r of results ?? []) {
      // 出现在越多达人身上的标签越不值钱（#fyp 这种全站通用的要压到接近 0）
      idf.set(r.tag, Math.log((total + 1) / (r.doc_freq + 1)));
    }
  }

  const scored = cands.map((c) => {
    const vec = vecScores.get(c.creator_id) ?? 0;

    let tagScore = 0;
    const ct = tagsByCreator.get(c.creator_id);
    if (ct && seed.tags.size) {
      let inter = 0;
      let seedW = 0;
      for (const [t] of seed.tags) {
        const w = idf.get(t) ?? 1;
        seedW += w;
        if (ct.has(t)) inter += w;
      }
      tagScore = seedW > 0 ? inter / seedW : 0;
    }

    const catScore = seed.category && c.category && seed.category === c.category ? 1 : 0;
    const sizeScore = closeness(seed.followerCount, c.follower_count ?? 0);
    const rateScore = closeness(seed.interactionRate, c.interaction_rate);

    // 地区：同地区加满分，地区不明给一半（数据缺失不该被当成「不匹配」惩罚），
    // 明确不同地区给 0
    const cReg = (c.region || '').toUpperCase();
    const regionScore = !seed.region || !cReg ? 0.5 : cReg === seed.region ? 1 : 0;

    // 只有 1 条视频算出来的指标不可信，样本少的整体降权
    const confidence = Math.min(1, (c.sample_size || 0) / 5);

    const score =
      vec * 0.4 +
      tagScore * 0.22 +
      catScore * 0.1 +
      regionScore * 0.1 +
      sizeScore * 0.1 * confidence +
      rateScore * 0.08 * confidence;

    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map((s) => s.c);
}

/**
 * 跑一次完整的相似达人检索。
 */
export async function findSimilarCreators(
  env: Env,
  userId: string,
  input: {
    userId?: string;
    handleName?: string;
    region?: string;
    ignore?: number;
  },
): Promise<SimilarCreator[]> {
  const seed = await loadSeed(env, input.userId, input.handleName, input.region);
  if (!seed) return [];

  const vecScores = await vectorRecall(env, seed);
  // ignore=1 表示「过滤掉已忽略的」（扩展在非筛选模式下传 1）
  const cands = await hardFilter(
    env,
    seed,
    userId,
    input.ignore === 1,
    [...vecScores.keys()],
  );
  const ranked = await rerank(env, seed, cands, vecScores);

  return ranked
    .filter((c) => c.unique_id)
    .map((c) => ({
      creatorId: c.unique_id as string,
      // 地区不明时拿种子的地区顶上 —— 这是个**猜测**，不是事实。
      // 之所以不留空：前端会把这个值原样传给 /promotion/add/creator 和收藏接口，
      // 空字符串会让那边的地区相关逻辑失效。库里地区覆盖率上来之后这行可以去掉。
      region: (c.region || seed.region || '').toUpperCase(),
      avgPlayCnt: c.avg_play_cnt,
      avgLikeCnt: c.avg_like_cnt,
      avgInteractionRate: c.interaction_rate,
    }));
}
