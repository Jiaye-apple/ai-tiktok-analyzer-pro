import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ok } from '../lib/response';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/**
 * 挂在 /v1/plugin/data 下的回流接口。
 * 其余回流接口按路径归到了各自的模块里：
 *   /creator/save、/creator/video/tag        → routes/creator.ts
 *   /video/analysis、/video/detail、/video/label/add → routes/video.ts
 *   /product/data/via-*                       → routes/product.ts
 */

/**
 * POST /data/effect/upload
 * body 是特效页的视频数组，前端做过字段归一化。
 * 无采样，每次进特效页都会发。
 */
r.post('/effect/upload', async (c) => {
  const rows = await c.req.json<Array<Record<string, unknown>>>().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return ok(null);

  const effects = new Map<string, Record<string, unknown>>();
  for (const v of rows.slice(0, 200)) {
    const eff = (v.effectStickers ?? v.effect ?? null) as
      | Array<{ ID?: string; name?: string }>
      | { ID?: string; name?: string }
      | null;
    const list = Array.isArray(eff) ? eff : eff ? [eff] : [];
    for (const e of list) {
      if (e?.ID) effects.set(String(e.ID), e as Record<string, unknown>);
    }
  }

  const stmts = [];

  if (effects.size) {
    for (const [id, e] of effects) {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO tk_effects (effect_id, name, payload, updated_at)
           VALUES (?1, ?2, ?3, unixepoch())
           ON CONFLICT(effect_id) DO UPDATE SET name = ?2, payload = ?3, updated_at = unixepoch()`,
        ).bind(id, (e.name as string) ?? null, JSON.stringify(e).slice(0, 100_000)),
      );
    }
  }

  /**
   * 顺便把视频本身也存一份，特效页的视频不走 /video/label/add。
   *
   * 以前这里的 UPSERT 只刷 payload，play_cnt / like_cnt 首次插入后永不更新 ——
   * 榜单和达人派生指标会越来越陈旧。现在冲突时也刷计数（取更大值）。
   */
  for (const v of rows.slice(0, 200)) {
    if (!v.id) continue;
    const stats = (v.statsV2 ?? v.stats ?? {}) as Record<string, unknown>;
    const author = (v.author ?? {}) as Record<string, unknown>;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO tk_videos (video_id, creator_id, title, pub_time, play_cnt, like_cnt, payload, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
         ON CONFLICT(video_id) DO UPDATE SET
           creator_id = COALESCE(?2, tk_videos.creator_id),
           title      = COALESCE(?3, tk_videos.title),
           pub_time   = COALESCE(?4, tk_videos.pub_time),
           -- 只认更大的值：同一条视频反复上报，播放/点赞只会涨不会跌，
           -- 偶尔抓到的 0 或 null 不该把已有数据抹掉
           play_cnt   = MAX(COALESCE(?5, 0), COALESCE(tk_videos.play_cnt, 0)),
           like_cnt   = MAX(COALESCE(?6, 0), COALESCE(tk_videos.like_cnt, 0)),
           payload    = ?7,
           updated_at = unixepoch()`,
      ).bind(
        String(v.id),
        author.id != null ? String(author.id) : null,
        (v.desc as string) ?? null,
        v.createTime ? Number(v.createTime) * 1000 : null,
        Number(stats.playCount) || null,
        Number(stats.diggCount) || null,
        JSON.stringify(v).slice(0, 400_000),
      ),
    );
  }

  if (stmts.length) await c.env.DB.batch(stmts);
  return ok(null);
});

export default r;
