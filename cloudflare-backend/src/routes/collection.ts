import { Hono } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();
r.use('*', requireAuth);

// 必须和扩展里的值逐字一致 —— 前端靠它判断要不要把名字显示成「默认收藏夹」。
// 改名时两边一起改，改动点在 kolsprite-2.1.3-editable/patch-backend.mjs 的 rebrand()。
const DEFAULT_FOLDER = 'AITikTokDownloader_#Default';

async function ensureDefaultFolder(
  env: Env,
  userId: string,
  type: string,
): Promise<string> {
  const found = await env.DB.prepare(
    `SELECT id FROM collection_folders WHERE user_id = ?1 AND type = ?2 AND name = ?3`,
  )
    .bind(userId, type, DEFAULT_FOLDER)
    .first<{ id: string }>();
  if (found) return found.id;

  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO collection_folders (id, user_id, name, type) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, userId, DEFAULT_FOLDER, type)
    .run();
  return id;
}

/**
 * POST /collection/add
 * body 有四种形态，共同点是 ids + type，可选 folders / region / uniqueId / otherParams。
 * folders 为空或没传时落到默认收藏夹。
 */
r.post('/add', async (c) => {
  const user = currentUser(c);
  const b = await readJson<{
      ids?: string[];
      type?: string;
      region?: string;
      uniqueId?: string;
      folders?: string[];
      otherParams?: Record<string, unknown>;
    }>(c);

  const ids = (b.ids ?? []).map(String).filter(Boolean);
  const type = (b.type || 'VIDEO').toUpperCase();
  if (!ids.length) return fail(ERR.PARAM, '收藏内容不能为空');

  const folders = (b.folders ?? []).filter(Boolean);
  const targets = folders.length ? folders : [await ensureDefaultFolder(c.env, user.id, type)];

  const payload = JSON.stringify({
    uniqueId: b.uniqueId ?? null,
    region: b.region ?? null,
    ...(b.otherParams ?? {}),
  });

  const stmts = [];
  for (const folderId of targets) {
    for (const id of ids) {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO collection_items (folder_id, user_id, item_type, item_id, region, payload)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(folder_id, item_type, item_id) DO UPDATE SET payload = ?6`,
        ).bind(folderId, user.id, type, id, b.region ?? null, payload),
      );
    }
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE collection_folders
       SET item_count = (SELECT COUNT(*) FROM collection_items WHERE folder_id = collection_folders.id),
           updated_at = unixepoch()
       WHERE user_id = ?1`,
    ).bind(user.id),
  );
  await c.env.DB.batch(stmts);

  return ok({ added: ids.length * targets.length });
});

/**
 * POST /collection/remove
 * body: { ids, type, region?, uniqueId? }
 *
 * 提醒：原扩展在 type === "VIDEO" 时**根本没发这个请求**
 * （index.js:119091-119111 三元表达式写漏了），取消收藏视频会一直转圈。
 * 后端这边两种类型都支持，改完前端就能用。
 */
r.post('/remove', async (c) => {
  const user = currentUser(c);
  const b = await readJson<{ ids?: string[]; type?: string; region?: string; folders?: string[] }>(c);

  const ids = (b.ids ?? []).map(String).filter(Boolean);
  const type = (b.type || 'VIDEO').toUpperCase();
  if (!ids.length) return fail(ERR.PARAM, '缺少要移除的 id');

  const placeholders = ids.map((_, i) => `?${i + 3}`).join(',');
  const folderFilter = b.folders?.length
    ? ` AND folder_id IN (${b.folders.map((_, i) => `?${i + 3 + ids.length}`).join(',')})`
    : '';

  await c.env.DB.prepare(
    `DELETE FROM collection_items
     WHERE user_id = ?1 AND item_type = ?2 AND item_id IN (${placeholders})${folderFilter}`,
  )
    .bind(user.id, type, ...ids, ...(b.folders ?? []))
    .run();

  return ok(true);
});

/**
 * GET /collection/folder/{type}   列收藏夹
 * type ∈ CREATOR / VIDEO / PRODUCT / SHOP
 *
 * 注意这条路由和下面的 DELETE 共用 URL 模板但语义不同 ——
 * GET 的路径参数是 type，DELETE 的是 folderId。这是原后台的设计，照搬。
 */
r.get('/folder/:type', async (c) => {
  const user = currentUser(c);
  const type = c.req.param('type').toUpperCase();
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, item_count AS itemCount FROM collection_folders
     WHERE user_id = ?1 AND type = ?2 ORDER BY created_at ASC`,
  )
    .bind(user.id, type)
    .all();

  // 一个收藏夹都没有时先建默认的，免得前端弹窗是空的
  if (!results?.length) {
    const id = await ensureDefaultFolder(c.env, user.id, type);
    return ok([{ id, name: DEFAULT_FOLDER, itemCount: 0 }]);
  }
  return ok(results);
});

/** POST /collection/folder  body {name, type} -> data.id */
r.post('/folder', async (c) => {
  const user = currentUser(c);
  const b = await readJson<{ name?: string; type?: string }>(c);
  const name = (b.name || '').trim();
  if (!name) return fail(ERR.PARAM, '收藏夹名称不能为空');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO collection_folders (id, user_id, name, type) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, user.id, name, (b.type || 'VIDEO').toUpperCase())
    .run();
  return ok({ id, name });
});

/** POST /collection/folder/rename  body {id, newName, type} */
r.post('/folder/rename', async (c) => {
  const user = currentUser(c);
  const b = await readJson<{ id?: string; newName?: string; type?: string }>(c);
  if (!b.id || !b.newName) return fail(ERR.PARAM, '参数不完整');

  await c.env.DB.prepare(
    `UPDATE collection_folders SET name = ?3, updated_at = unixepoch()
     WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(b.id, user.id, b.newName.trim())
    .run();
  return ok(true);
});

/** DELETE /collection/folder/{folderId} */
r.delete('/folder/:folderId', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare(`DELETE FROM collection_folders WHERE id = ?1 AND user_id = ?2`)
    .bind(c.req.param('folderId'), user.id)
    .run();
  return ok(true);
});

/** 列收藏夹里的内容，官网收藏页用。原扩展没调，但迁移后官网需要。 */
r.get('/folder/:folderId/items', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT item_type AS itemType, item_id AS itemId, region, payload, created_at AS createdAt
     FROM collection_items WHERE user_id = ?1 AND folder_id = ?2
     ORDER BY created_at DESC LIMIT 1000`,
  )
    .bind(user.id, c.req.param('folderId'))
    .all<{ payload: string | null; [k: string]: unknown }>();

  return ok(
    (results ?? []).map((row) => ({
      ...row,
      payload: row.payload ? safeParse(row.payload) : null,
    })),
  );
});

/**
 * GET /collection/{uniqueId}/region
 * data 直接是地区码字符串。前端拿不到会兜底成 "US"。
 * 从已收藏数据里反查，查不到就走默认。
 */
r.get('/:uniqueId/region', async (c) => {
  const uniqueId = c.req.param('uniqueId');

  const hit = await c.env.DB.prepare(
    `SELECT region FROM tk_creators WHERE unique_id = ?1 AND region IS NOT NULL LIMIT 1`,
  )
    .bind(uniqueId)
    .first<{ region: string }>();
  if (hit?.region) return ok(hit.region);

  const fromItems = await c.env.DB.prepare(
    `SELECT region FROM collection_items
     WHERE user_id = ?1 AND region IS NOT NULL AND json_extract(payload, '$.uniqueId') = ?2
     LIMIT 1`,
  )
    .bind(currentUser(c).id, uniqueId)
    .first<{ region: string }>()
    .catch(() => null);

  return ok(fromItems?.region || 'US');
});

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default r;
