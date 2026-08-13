import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { consumeQuota, refundConsumed } from '../lib/quota';
import { currentUser, requireAuth } from '../middleware/require-auth';
import { findSimilarCreators } from '../lib/similarity';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * POST /creator/sts
 *
 * 原后台返回阿里云 OSS 的 STS 临时凭证，前端用打包进去的 ali-oss SDK 直传封面：
 *   { region, accessKeyId, accessKeySecret, securityToken, bucketName }
 *   → new OSS({...}).put(`similarity/${userId}/${videoId}.jpg`, blob)
 *
 * R2 不兼容阿里云的签名算法，所以没法只换凭证。这里改成下发**一次性直传票据**，
 * 前端把 `oss.put(key, blob)` 换成一次 PUT 就行（改动见 docs/MIGRATION-PLAN.md）。
 *
 * 返回体里同时保留了 bucketName / region 字段，是为了万一你还想接回对象存储
 * 时不用再改协议；ali-oss 那条路已经走不通了，别指望旧代码能直接用。
 */
r.post('/sts', requireAuth, async (c) => {
  const user = currentUser(c);
  const ticket = uuid().replace(/-/g, '');
  const prefix = `similarity/${user.id}/`;
  const ttl = 900; // 15 分钟，够传 20 张封面

  await c.env.KV.put(
    `upload:${ticket}`,
    JSON.stringify({ userId: user.id, prefix, kind: 'similarity' }),
    { expirationTtl: ttl },
  );

  const origin = new URL(c.req.url).origin;
  return ok({
    // 新协议：前端 PUT 到 uploadUrl，路径拼在后面
    uploadUrl: `${origin}/v1/plugin/creator/upload`,
    ticket,
    prefix,
    expiresIn: ttl,
    // 旧字段占位，保证老版本扩展不会因为读不到字段直接抛异常
    region: 'auto',
    bucketName: 'kolsprite-assets',
    accessKeyId: '',
    accessKeySecret: '',
    securityToken: '',
  });
});

/**
 * PUT /creator/upload?ticket=xxx&key=<videoId>.jpg
 * 配合上面的票据用。body 是图片二进制。
 */
r.put('/upload', async (c) => {
  const ticket = c.req.query('ticket') || '';
  const key = c.req.query('key') || '';
  if (!ticket || !key) return fail(ERR.PARAM, '缺少 ticket 或 key');
  if (key.includes('..') || key.startsWith('/')) return fail(ERR.PARAM, 'key 非法');

  const raw = await c.env.KV.get(`upload:${ticket}`);
  if (!raw) return fail(ERR.UNAUTHORIZED, '上传票据无效或已过期');
  const meta = JSON.parse(raw) as { userId: string; prefix: string };

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return fail(ERR.PARAM, '文件为空');
  if (body.byteLength > 5 * 1024 * 1024) return fail(ERR.PARAM, '封面不能超过 5MB');

  const objectKey = meta.prefix + key;
  await c.env.R2.put(objectKey, body, {
    httpMetadata: { contentType: c.req.header('Content-Type') || 'image/jpeg' },
  });

  return ok({ key: objectKey });
});

/**
 * POST /creator/similarity/async
 *
 * body: { userId, handleName, region?, videoList[], promotionPlanId, ignore }
 * data 必须直接是 taskId 字符串 —— 前端 `const r = res.data; if (!r) throw "no taskId"`。
 *
 * 配额由服务端硬扣（consumeQuota）：前端 up("FindKol") 预扣过的会被核销，
 * 直连 API 的当场扣费，扣不动直接拒 —— 不再依赖前端自觉。
 */
r.post('/similarity/async', requireAuth, async (c) => {
  const user = currentUser(c);
  const body = await readJson<{
      userId?: string;
      handleName?: string;
      region?: string;
      videoList?: unknown[];
      promotionPlanId?: string;
      ignore?: number;
    }>(c);

  if (!body.userId && !body.handleName) return fail(ERR.PARAM, '缺少达人标识');

  const consumed = await consumeQuota(c.env, user, 'FindKol', 1);
  if (!consumed.ok) {
    return fail(
      ERR.QUOTA_EXHAUSTED,
      consumed.dailyExceeded
        ? '今日次数已达上限，请明天再试或升级套餐'
        : '本月额度已用完，请升级套餐或购买加油包',
    );
  }

  const taskId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO async_tasks (task_id, user_id, type, status, input, creator_id, quota_record_id)
     VALUES (?1, ?2, 'creator_similarity', 'pending', ?3, ?4, ?5)`,
  )
    .bind(taskId, user.id, JSON.stringify(body), body.userId ?? body.handleName ?? null, consumed.recordId)
    .run();

  /**
   * 真正的检索放到 waitUntil 里跑，接口立刻把 taskId 还给前端。
   *
   * 前端拿到 taskId 后每 5 秒轮询一次 /similarity/task，没有超时也没有次数上限，
   * 所以**任务绝对不能停在 pending**——不管成功失败都必须落一个终态。
   * 出错就写 failed 并退配额（没出结果不收钱）。
   *
   * 封面图那条路已经放弃：Workers AI 没有 CLIP / 多模态 embedding 模型。
   * 前端仍然会先把 20 张封面传到 R2（那段不能停，它全失败时前端会直接报错、
   * 根本不发这个请求），但后端不再用这些图，由每日 cron 清理。
   */
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const list = await findSimilarCreators(c.env, user.id, body);
        await c.env.DB.prepare(
          `UPDATE async_tasks SET status = 'success', result = ?2, updated_at = unixepoch()
            WHERE task_id = ?1`,
        )
          .bind(taskId, JSON.stringify(list))
          .run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('similarity 任务失败', taskId, msg);
        await c.env.DB.prepare(
          `UPDATE async_tasks SET status = 'failed', error = ?2, updated_at = unixepoch()
            WHERE task_id = ?1`,
        )
          .bind(taskId, msg.slice(0, 500))
          .run()
          .catch(() => {});
        await refundConsumed(c.env, user.id, consumed.recordId ?? '').catch(() => {});
      }
    })(),
  );

  return ok(taskId);
});

/**
 * GET /creator/similarity/task?taskId=xxx
 *
 * data === null 表示还没跑完，前端 5 秒后再来一次（无最大次数、无总超时）。
 * 所以**绝对不能让任务永远停在 pending**，否则前端会一直轮询下去。
 * 错误码返回 ERROR_CREATOR_SIMILARITY 或 ERR_GLOBAL_404 前端才会终止轮询。
 */
r.get('/similarity/task', requireAuth, async (c) => {
  const user = currentUser(c);
  const taskId = c.req.query('taskId') || '';
  if (!taskId) return fail('ERR_GLOBAL_404', '缺少 taskId');

  const task = await c.env.DB.prepare(
    `SELECT * FROM async_tasks WHERE task_id = ?1 AND user_id = ?2 AND type = 'creator_similarity'`,
  )
    .bind(taskId, user.id)
    .first<{
      status: string;
      result: string | null;
      error: string | null;
      created_at: number;
      quota_record_id: string | null;
    }>();

  if (!task) return fail('ERR_GLOBAL_404', '任务不存在');

  if (task.status === 'failed') {
    return fail('ERROR_CREATOR_SIMILARITY', task.error || '相似达人分析失败');
  }
  if (task.status === 'success') {
    return ok(task.result ? JSON.parse(task.result) : []);
  }

  /**
   * 兜底：任务不该停在 pending，但 Worker 可能在 waitUntil 跑完之前就被回收
   * （部署、实例重启、超时），那样任务会永远挂着，而前端的轮询没有上限。
   * 超过 5 分钟还是 pending 就判失败并退配额。
   *
   * 正常路径下检索是秒级的，走不到这里。
   */
  const age = Math.floor(Date.now() / 1000) - task.created_at;
  if (age > 300) {
    await c.env.DB.prepare(
      `UPDATE async_tasks SET status = 'failed', error = ?2, updated_at = unixepoch()
       WHERE task_id = ?1`,
    )
      .bind(taskId, '任务超时未完成')
      .run();
    // 没出结果不收钱：把服务端核销的那笔退回去（幂等，重复轮询也只退一次）
    if (task.quota_record_id) {
      await refundConsumed(c.env, user.id, task.quota_record_id).catch(() => {});
    }
    return fail('ERROR_CREATOR_SIMILARITY', '相似达人分析超时，请重试');
  }

  return ok(null);
});

// --- 数据回流（原 plugin-data 域）-------------------------------------------
// 这两个都是 hide:true 的静默上报，前端不看返回值，而且带随机采样，
// 所以量不会很大。不做数据业务的话直接 return ok(null) 丢弃即可。

/**
 * POST /creator/save
 * body 是达人主页的完整对象 { user, stats, statsV2, itemList }。
 * 采样：粉丝 ≥2000 必传；<2000 时 50% 概率传。
 */
r.post('/save', async (c) => {
  const b = await readJson<{
      user?: { id?: string; uniqueId?: string; nickname?: string; region?: string };
      stats?: { followerCount?: number };
    }>(c);

  const u = b.user;
  if (!u?.id) return ok(null);

  await c.env.DB.prepare(
    `INSERT INTO tk_creators (creator_id, unique_id, nickname, region, follower_count, payload, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
     ON CONFLICT(creator_id) DO UPDATE SET
       unique_id = ?2, nickname = ?3, region = COALESCE(?4, region),
       follower_count = ?5, payload = ?6, updated_at = unixepoch()`,
  )
    .bind(
      String(u.id),
      u.uniqueId ?? null,
      u.nickname ?? null,
      u.region ?? null,
      b.stats?.followerCount ?? null,
      JSON.stringify(b).slice(0, 900_000),
    )
    .run();

  return ok(null);
});

/**
 * POST /creator/video/tag
 * body: { nickName, rings: {标签: 次数}, tags: {话题: 次数}, uid }
 * tags 来自视频话题挑战，rings 来自用户自定义标签。
 */
r.post('/video/tag', async (c) => {
  const b = await readJson<{
      uid?: string;
      nickName?: string;
      tags?: Record<string, number>;
      rings?: Record<string, number>;
    }>(c);

  if (!b.uid) return ok(null);

  // uid 到底是数字 id 还是 handle，扩展那边给得不明确（`uid: e.userId`）。
  // 两种都认：纯数字当 creator_id 直接用，否则当 handle 反查。
  // 认错了会让标签挂在一个查不到的 id 上，共现召回直接失效，所以不能猜。
  const raw = String(b.uid).trim();
  let creatorId = raw;
  if (!/^\d+$/.test(raw)) {
    const hit = await c.env.DB.prepare(
      `SELECT creator_id FROM tk_creators WHERE unique_id_lower = ?1 LIMIT 1`,
    )
      .bind(raw.toLowerCase())
      .first<{ creator_id: string }>();
    if (!hit) return ok(null);
    creatorId = hit.creator_id;
  }

  /**
   * 归一化：去掉开头的 #、转小写、去首尾空白。
   *
   * 以前这里把 kind 拼进了 tag（存成 'challenge:xxx'），结果官网的
   * hashtag 生成器原样渲染成 #challenge:xxx，用户复制出去用不了。
   * 现在 kind 单独一列，tag 只存干净的标签本体。
   */
  const norm = (t: string) => t.trim().replace(/^#+/, '').trim().toLowerCase();

  // 保留出现次数 —— 以前只取了 Object.keys()，把次数整个丢了，
  // 而次数正是共现/TF-IDF 加权最需要的原料
  const entries = [
    ...Object.entries(b.tags ?? {}).map(([tag, n]) => ({ tag: norm(tag), kind: 'challenge', n })),
    ...Object.entries(b.rings ?? {}).map(([tag, n]) => ({ tag: norm(tag), kind: 'label', n })),
  ]
    .filter((e) => e.tag.length >= 2 && e.tag.length <= 30)
    .slice(0, 200);

  if (entries.length) {
    await c.env.DB.batch(
      entries.map((e) =>
        c.env.DB.prepare(
          `INSERT INTO creator_tags (creator_id, kind, tag, hit_count, updated_at)
           VALUES (?1, ?2, ?3, ?4, unixepoch())
           ON CONFLICT(creator_id, kind, tag) DO UPDATE SET
             hit_count = MAX(creator_tags.hit_count, ?4), updated_at = unixepoch()`,
        ).bind(creatorId, e.kind, e.tag, Math.max(1, Number(e.n) || 1)),
      ),
    );
  }
  return ok(null);
});

export default r;
