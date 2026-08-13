import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ok } from '../lib/response';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/** 路由处理函数里的 context 类型，抽出来给下面的辅助函数复用。 */
type Ctx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;


/**
 * 商品相关。这里有个路由顺序的坑：
 *   /product/data/via-list      （数据回流）
 *   /product/{region}/list      （商品价格查询）
 * `data` 会被 `:region` 匹配到，所以 data/* 必须先注册。Hono 按注册顺序匹配。
 */

// --- 数据回流（原 plugin-data 域，hide:true，前端不看返回值）-------------------

/** POST /product/data/via-video-product?region= —— 视频挂车商品 */
r.post('/data/via-video-product', (c) => ingestProducts(c, 'via-video-product'));

/** POST /product/data/via-list?region= —— 商品列表页 */
r.post('/data/via-list', (c) => ingestProducts(c, 'via-list'));

/** POST /product/data/via-detail?region= —— 商品详情页 */
r.post('/data/via-detail', (c) => ingestProducts(c, 'via-detail'));

/** POST /product/data/via-detail-relevant?region= —— 详情页关联推荐 */
r.post('/data/via-detail-relevant', (c) => ingestProducts(c, 'via-detail-relevant'));

async function ingestProducts(
  c: Ctx,
  source: string,
): Promise<Response> {
  const region = c.req.query('region') || '';
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body) return ok(null);

  const list = Array.isArray(body) ? body : [body];
  const rows = list
    .map((item) => normalizeProduct(item as Record<string, unknown>))
    .filter((p): p is NormalizedProduct => p !== null)
    .slice(0, 200);

  if (rows.length) {
    await c.env.DB.batch(
      rows.map((p) =>
        c.env.DB.prepare(
          `INSERT INTO tk_products (product_id, region, title, price, sold_count, payload, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
           ON CONFLICT(product_id, region) DO UPDATE SET
             title = COALESCE(?3, title), price = COALESCE(?4, price),
             sold_count = COALESCE(?5, sold_count), payload = ?6, updated_at = unixepoch()`,
        ).bind(p.productId, region || 'UNKNOWN', p.title, p.price, p.soldCount, p.payload),
      ),
    );
  }
  console.log('product ingest', source, region, rows.length);
  return ok(null);
}

interface NormalizedProduct {
  productId: string;
  title: string | null;
  price: string | null;
  soldCount: number | null;
  payload: string;
}

/**
 * TikTok Shop 的商品结构在不同页面差别很大（列表页 / 详情页 / 挂车），
 * 这里只尽力抽出 id、标题、价格三个字段，抽不到就整包存 payload，
 * 后面要用的时候再解析。抽不到 id 的直接丢弃。
 */
function normalizeProduct(item: Record<string, unknown>): NormalizedProduct | null {
  const base = (item.product_base ?? item.product_info ?? item) as Record<string, unknown>;
  const id =
    item.product_id ?? item.productId ?? base.product_id ?? base.id ?? item.id ?? null;
  if (!id) return null;

  const priceObj = (base.price ?? item.price) as Record<string, unknown> | string | undefined;
  const price =
    typeof priceObj === 'string'
      ? priceObj
      : priceObj && typeof priceObj === 'object'
        ? String(
            (priceObj as Record<string, unknown>).real_price ??
              (priceObj as Record<string, unknown>).price_val ??
              (priceObj as Record<string, unknown>).original_price ??
              '',
          ) || null
        : null;

  const soldInfo = (item.sold_info ?? base.sold_info) as Record<string, unknown> | undefined;
  const sold = Number(base.sold_count ?? item.sold_count ?? item.sale_cnt ?? soldInfo?.sold_count);

  return {
    productId: String(id),
    title: (base.title ?? item.title ?? null) as string | null,
    price,
    soldCount: Number.isFinite(sold) ? sold : null,
    payload: JSON.stringify(item).slice(0, 400_000),
  };
}

// --- 业务查询 ---------------------------------------------------------------

/**
 * POST /product/{region}/list
 * body 是**裸的商品 id 数组**，不是对象。
 * data: [{ price: number, currency: string, ... }]
 * 前端会过滤 price > 0，排序后算出 { min, max, avg, unit }，unit 由 currency 查符号表得到。
 */
r.post('/:region/list', async (c) => {
  const region = c.req.param('region');
  const ids = await c.req.json<string[]>().catch(() => [] as string[]);
  if (!Array.isArray(ids) || !ids.length) return ok([]);

  const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT product_id AS productId, price, payload FROM tk_products
     WHERE region = ?1 AND product_id IN (${placeholders})`,
  )
    .bind(region, ...ids.map(String))
    .all<{ productId: string; price: string | null; payload: string | null }>();

  // TODO(补齐商品价格数据源)：
  //   现在只能返回自己库里已经回流过的商品，覆盖率取决于用户量。
  //   如果原后台是接了 TikTok Shop 的官方/第三方数据源，这里需要补上。
  //   查不到的商品不返回即可 —— 前端只按 price > 0 过滤，缺项不会报错。
  return ok(
    (results ?? [])
      .map((row) => ({
        productId: row.productId,
        price: parsePrice(row.price),
        currency: currencyOf(region),
      }))
      .filter((p) => p.price > 0),
  );
});

/**
 * POST /product/{region}/gpm
 * body 是裸数组（实际只传 [creatorId]）
 * data[0] 要有 currency 和 gpm 两个字段。
 */
r.post('/:region/gpm', async (c) => {
  const region = c.req.param('region');
  const ids = await c.req.json<string[]>().catch(() => [] as string[]);
  const creatorId = String(ids?.[0] ?? '');
  if (!creatorId) return ok([]);

  // TODO(接入 GPM 计算)：
  //   GPM = 每千次播放成交额 = 带货 GMV / 播放量 * 1000。
  //   要算准需要成交数据，插件本身抓不到，得有商品侧的数据源。
  //   在补上之前返回 gpm: 0，前端会显示为「-」，不会崩。
  return ok([{ creatorId, currency: currencyOf(region), gpm: 0 }]);
});

function parsePrice(s: string | null): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 地区 -> 币种。前端拿 currency 去查货币符号表显示。 */
function currencyOf(region: string): string {
  const map: Record<string, string> = {
    US: 'USD', GB: 'GBP', ID: 'IDR', TH: 'THB', VN: 'VND', MY: 'MYR',
    PH: 'PHP', SG: 'SGD', JP: 'JPY', KR: 'KRW', DE: 'EUR', FR: 'EUR',
    IT: 'EUR', ES: 'EUR', BR: 'BRL', MX: 'MXN', TW: 'TWD', AU: 'AUD',
    CA: 'CAD', SA: 'SAR',
  };
  return map[region?.toUpperCase()] ?? 'USD';
}

export default r;
