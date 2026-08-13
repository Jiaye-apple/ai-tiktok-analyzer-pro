-- 计费与真实拦截：对照 kolsprite.com/price（2026-08-05 抓取）一比一定价，
-- 外加 Creem 支付的订单表。全部幂等（IF NOT EXISTS / INSERT OR REPLACE），
-- 部署脚本重放所有 migration 也不会炸 —— 所以**不能用 ALTER TABLE**，
-- 需要新列的地方一律开附表。
-- 执行：npm run db:billing:remote

-- ---------------------------------------------------------------------------
-- 套餐改版：Trial / Plus / Pro，美元计价（单位：美分）
-- ---------------------------------------------------------------------------
-- price_cents 存的是**现价**（周年促销价），原价在 price 页模板里展示。
-- 名字用品牌词 Trial/Plus/Pro，九种语言都不翻译 —— 和原站一致。
-- level 映射规则不变：planCode 含 plus -> P，含 pro -> V，其它 -> F。
INSERT OR REPLACE INTO plans (code, name, level, price_cents, duration_days, sort_order) VALUES
  ('free',       'Trial', 'F',     0,   0, 0),
  ('plus_month', 'Plus',  'P',  1990,  31, 1),
  ('plus_year',  'Plus',  'P', 19990, 366, 2),
  ('pro_month',  'Pro',   'V',  4900,  31, 3),
  ('pro_year',   'Pro',   'V', 49900, 366, 4);

-- ---------------------------------------------------------------------------
-- 配额规则：数字全部来自原站 price 页（含完整对比表），不再是猜的
-- ---------------------------------------------------------------------------
--   Trial: 导出 0 / 批量下载 10 / 脚本提取 50 / 东南亚 20 / 相似达人 1 次每天 / 点数 0
--   Plus : 500 / 200 / 600 / 500 / 50 每月 / 点数 1000
--   Pro  : 1000 / 1000 / 3000 / 2500 / 200 每月 / 点数 3000
-- VideoReview 仍是纯点数驱动（0 次 + 20 点/次）：
--   Plus 1000 点 / 20 = 50 次/月，Pro 3000 / 20 = 150 次/月 ——
--   和原站「AI Comment Insights Max 50 / 150 每月」分毫不差，闭环成立。
INSERT OR REPLACE INTO quota_rules (plan_code, quota_type, total, period, points) VALUES
  ('free',       'ExcelExport',          0, 'month', 1),
  ('free',       'VideoBatchDownload',  10, 'month', 1),
  ('free',       'VideoScript',         50, 'month', 10),
  ('free',       'SeaProductVideo',     20, 'month', 5),
  ('free',       'FindKol',              1, 'day',   10),
  ('free',       'VideoReview',          0, 'month', 20),
  ('free',       'Points',               0, 'month', 1),

  ('plus_month', 'ExcelExport',        500, 'month', 1),
  ('plus_month', 'VideoBatchDownload', 200, 'month', 1),
  ('plus_month', 'VideoScript',        600, 'month', 10),
  ('plus_month', 'SeaProductVideo',    500, 'month', 5),
  ('plus_month', 'FindKol',             50, 'month', 10),
  ('plus_month', 'VideoReview',          0, 'month', 20),
  ('plus_month', 'Points',            1000, 'month', 1),
  ('plus_year',  'ExcelExport',        500, 'month', 1),
  ('plus_year',  'VideoBatchDownload', 200, 'month', 1),
  ('plus_year',  'VideoScript',        600, 'month', 10),
  ('plus_year',  'SeaProductVideo',    500, 'month', 5),
  ('plus_year',  'FindKol',             50, 'month', 10),
  ('plus_year',  'VideoReview',          0, 'month', 20),
  ('plus_year',  'Points',            1000, 'month', 1),

  ('pro_month',  'ExcelExport',       1000, 'month', 1),
  ('pro_month',  'VideoBatchDownload',1000, 'month', 1),
  ('pro_month',  'VideoScript',       3000, 'month', 10),
  ('pro_month',  'SeaProductVideo',   2500, 'month', 5),
  ('pro_month',  'FindKol',            200, 'month', 10),
  ('pro_month',  'VideoReview',          0, 'month', 20),
  ('pro_month',  'Points',            3000, 'month', 1),
  ('pro_year',   'ExcelExport',       1000, 'month', 1),
  ('pro_year',   'VideoBatchDownload',1000, 'month', 1),
  ('pro_year',   'VideoScript',       3000, 'month', 10),
  ('pro_year',   'SeaProductVideo',   2500, 'month', 5),
  ('pro_year',   'FindKol',            200, 'month', 10),
  ('pro_year',   'VideoReview',          0, 'month', 20),
  ('pro_year',   'Points',            3000, 'month', 1);

-- ---------------------------------------------------------------------------
-- 日上限（quota_rules 不能加列，单独一张表）
-- ---------------------------------------------------------------------------
-- 类型三种：
--   VideoScript          原站「AI Video Script Max 10/50/200 每天」——
--                        叠在月度额度之上，防止一晚上把整月额度脚本刷光
--   SingleVideoDownload  原站「No-Watermark Download 登录 20/天，付费无限」。
--                        没配行 = 不限（Plus/Pro 不配）
--   AiCopy               AI 文案四件套（总结/亮点/结构/仿写）。原站不单独扣费
--                        （字幕那步已扣过），但直连 API 白嫖 LLM 必须拦 ——
--                        给到日上限的 4 倍（每条脚本约 4 次 AI 操作），正常用户
--                        永远碰不到，脚本党一天就顶死
CREATE TABLE IF NOT EXISTS quota_daily_limits (
  plan_code   TEXT NOT NULL,
  quota_type  TEXT NOT NULL,
  daily_limit INTEGER NOT NULL,
  PRIMARY KEY (plan_code, quota_type)
);

INSERT OR REPLACE INTO quota_daily_limits (plan_code, quota_type, daily_limit) VALUES
  ('free',       'VideoScript',          10),
  ('free',       'SingleVideoDownload',  20),
  ('free',       'AiCopy',               40),
  ('plus_month', 'VideoScript',          50),
  ('plus_month', 'AiCopy',              200),
  ('plus_year',  'VideoScript',          50),
  ('plus_year',  'AiCopy',              200),
  ('pro_month',  'VideoScript',         200),
  ('pro_month',  'AiCopy',              800),
  ('pro_year',   'VideoScript',         200),
  ('pro_year',   'AiCopy',              800);

-- ---------------------------------------------------------------------------
-- 预扣记录扩展（quota_records 不能加列，附表按 id 一对一）
-- ---------------------------------------------------------------------------
-- 两池引擎需要记清每笔从哪儿扣的，release 才能原路退回：
--   own_spent          月度（或日度）套餐次数扣了几次
--   addon_spent        加油包池（period_key='all'）扣了几次
--   points_month_spent 月度点数扣了多少
--   points_addon_spent 加油包点数扣了多少
--   day_key            当天的日上限计数键（退还时要把当日计数一并退）
CREATE TABLE IF NOT EXISTS quota_record_ext (
  id                 TEXT PRIMARY KEY,
  own_spent          INTEGER NOT NULL DEFAULT 0,
  addon_spent        INTEGER NOT NULL DEFAULT 0,
  points_month_spent INTEGER NOT NULL DEFAULT 0,
  points_addon_spent INTEGER NOT NULL DEFAULT 0,
  day_key            TEXT
);

-- ---------------------------------------------------------------------------
-- 加油包 SKU（原站 More Add-ons 六件，价格照抄）
-- ---------------------------------------------------------------------------
-- enabled=0 的照常展示但不可购买（Bulk Outreach 的邮件功能还没上线，
-- 收钱不给货是差评之源）。amount 记进 quota_usage 的 period_key='all' 行，
-- 随会员期长期有效 —— 对应原站积分规则第 2 条。
CREATE TABLE IF NOT EXISTS billing_addons (
  code        TEXT PRIMARY KEY,
  quota_type  TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT OR REPLACE INTO billing_addons (code, quota_type, amount, price_cents, enabled, sort_order) VALUES
  ('addon_transcript',    'VideoScript',        200, 1500, 1, 1),
  ('addon_similar',       'FindKol',             50, 2900, 1, 2),
  ('addon_sea',           'SeaProductVideo',    500, 1500, 1, 3),
  ('addon_outreach',      'BulkOutreach',      5000, 2900, 0, 4),
  ('addon_bulk_download', 'VideoBatchDownload',1250, 1500, 1, 5),
  ('addon_credits',       'Points',            5000, 2900, 1, 6);

-- ---------------------------------------------------------------------------
-- Creem 订单
-- ---------------------------------------------------------------------------
-- id 同时用作 Creem checkout 的 request_id，webhook 回来按它对账。
-- 履约**只**发生在 webhook 验签通过之后 —— 回跳页面只做展示，不碰状态。
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,              -- plan / addon
  item_code        TEXT NOT NULL,              -- plus_month / addon_credits ...
  amount_cents     INTEGER NOT NULL DEFAULT 0, -- 下单时的预期价，对账用
  currency         TEXT NOT NULL DEFAULT 'USD',
  status           TEXT NOT NULL DEFAULT 'pending', -- pending / paid / refunded / canceled
  creem_checkout_id     TEXT,
  creem_order_id        TEXT,
  creem_customer_id     TEXT,
  creem_subscription_id TEXT,
  meta             TEXT,                       -- 履约细节 JSON（到期时间、续费轨迹）
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  paid_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_sub ON orders(creem_subscription_id);

-- webhook 幂等去重 + 审计。同一个事件 id 只处理一次。
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,               -- Creem 的 evt_xxx
  event_type  TEXT NOT NULL,
  order_id    TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
