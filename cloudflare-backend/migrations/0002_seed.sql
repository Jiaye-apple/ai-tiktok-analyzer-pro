-- 基础字典数据。改套餐/额度只需要改这个文件再跑一次。
-- 执行：npm run db:seed:remote

-- ---------------------------------------------------------------------------
-- 套餐
-- ---------------------------------------------------------------------------
-- level 必须和 planCode 里的关键字对得上，否则扩展算出来的 LV 和后台不一致：
--   planCode 含 plus              -> P（个人版）
--   planCode 含 pro 或 = standard -> V（专业版）
--   其它                          -> F（免费版）
-- 三个中文名取自扩展 i18n：sidepanel_free_version / _personal_version / _professional_version
INSERT OR REPLACE INTO plans (code, name, level, price_cents, duration_days, sort_order) VALUES
  ('free',          '免费版',       'F',      0,    0, 0),
  ('plus_month',    '个人版·月付',  'P',   3900,   31, 1),
  ('plus_year',     '个人版·年付',  'P',  39900,  366, 2),
  ('pro_month',     '专业版·月付',  'V',   9900,   31, 3),
  ('pro_year',      '专业版·年付',  'V',  99900,  366, 4);

-- ---------------------------------------------------------------------------
-- 配额规则
-- ---------------------------------------------------------------------------
-- 数字的来源分三类，上线前请逐条核对：
--
-- 【有实据】从扩展代码/文案里直接读出来的
--   专业版 Points = 2000        _locales/*/comment-analysis.json:
--                               "专业版每月可获得通用精灵点数 2,000"
--   个人版 FindKol = 50         sidepanel_upgrade_personal_monthly_search
--   专业版 FindKol = 200        sidepanel_upgrade_professional_monthly_search
--   个人版各项 total            index.html2.js:83-124 里的占位默认值
--                               （ExcelExport 500 / VideoBatchDownload 200 /
--                                 VideoScript 20 / SeaProductVideo 200 / FindKol 50，
--                                 其中 FindKol 50 和上面的文案对得上，
--                                 所以这组数字大概率就是个人版的真实值）
--
-- 【推断】按上面的比例外推的
--   专业版除 FindKol 外的各项（按 FindKol 的 4 倍关系推）
--   个人版 Points = 500
--
-- 【纯猜】原后台没留任何痕迹，我按功能成本编的
--   免费版全部数字
--   points 那一列（每个功能单次消耗多少点）
--
-- 【为什么 VideoReview 的 total 是 0】
--   它不像别的功能有独立月度次数，是**纯点数驱动**的。三条证据：
--   1. popup 的权益列表（index.html2.js:83-124）列了 5 个功能 + Points，
--      唯独没有 VideoReview
--   2. 侧边栏把「当前剩余精灵点数」渲染成 available * points
--      （index.html3.js:42104）—— 只有 available 完全来自点数池时这个等式才成立
--   3. 专业版 Points = 2000、单次 20 点 -> 100 次，
--      100 * 20 = 2000 正好等于点数余额，闭环
--   免费版 Points = 0，所以 VideoReview available = 0，
--   和前端「免费版直接禁用这个功能」的判断（index.html3.js:42167）也对得上。
--
-- 单次查找达人数（免费 10 / 付费 30）不在这张表里 ——
-- 那是写死在前端的常量（index.js:186286、index.html3.js:676），后端管不着。
INSERT OR REPLACE INTO quota_rules (plan_code, quota_type, total, period, points) VALUES
  -- 免费版（纯猜，按「注册即享试用版永久免费额度」的定位给了小额度）
  ('free',       'ExcelExport',        10,  'month', 1),
  ('free',       'VideoBatchDownload', 10,  'month', 1),
  ('free',       'VideoScript',         3,  'month', 10),
  ('free',       'SeaProductVideo',     5,  'month', 5),
  ('free',       'FindKol',             3,  'month', 10),
  ('free',       'VideoReview',         0,  'month', 20),
  ('free',       'Points',              0,  'month', 1),

  -- 个人版（total 有实据，points 是猜的）
  ('plus_month', 'ExcelExport',       500,  'month', 1),
  ('plus_month', 'VideoBatchDownload',200,  'month', 1),
  ('plus_month', 'VideoScript',        20,  'month', 10),
  ('plus_month', 'SeaProductVideo',   200,  'month', 5),
  ('plus_month', 'FindKol',            50,  'month', 10),
  ('plus_month', 'VideoReview',         0,  'month', 20),
  ('plus_month', 'Points',            500,  'month', 1),
  ('plus_year',  'ExcelExport',       500,  'month', 1),
  ('plus_year',  'VideoBatchDownload',200,  'month', 1),
  ('plus_year',  'VideoScript',        20,  'month', 10),
  ('plus_year',  'SeaProductVideo',   200,  'month', 5),
  ('plus_year',  'FindKol',            50,  'month', 10),
  ('plus_year',  'VideoReview',         0,  'month', 20),
  ('plus_year',  'Points',            500,  'month', 1),

  -- 专业版（Points 和 FindKol 有实据，其余按 4 倍外推）
  ('pro_month',  'ExcelExport',      2000,  'month', 1),
  ('pro_month',  'VideoBatchDownload',800,  'month', 1),
  ('pro_month',  'VideoScript',        80,  'month', 10),
  ('pro_month',  'SeaProductVideo',   800,  'month', 5),
  ('pro_month',  'FindKol',           200,  'month', 10),
  ('pro_month',  'VideoReview',         0,  'month', 20),
  ('pro_month',  'Points',           2000,  'month', 1),
  ('pro_year',   'ExcelExport',      2000,  'month', 1),
  ('pro_year',   'VideoBatchDownload',800,  'month', 1),
  ('pro_year',   'VideoScript',        80,  'month', 10),
  ('pro_year',   'SeaProductVideo',   800,  'month', 5),
  ('pro_year',   'FindKol',           200,  'month', 10),
  ('pro_year',   'VideoReview',         0,  'month', 20),
  ('pro_year',   'Points',           2000,  'month', 1);

-- ---------------------------------------------------------------------------
-- 地区字典（/public/regions）
-- ---------------------------------------------------------------------------
-- 取的是插件 _locales 里 nation_code_noun_* 覆盖到的主要市场。
-- 前端按 continent 分组渲染，所以大洲名必须填。
INSERT OR REPLACE INTO regions (code, name_en, name_zh, continent_en, continent_zh, biz_type, enabled, sort_order) VALUES
  ('US', 'United States',  '美国',     'North America', '北美洲', 'creator', 1, 1),
  ('CA', 'Canada',         '加拿大',   'North America', '北美洲', 'creator', 1, 2),
  ('MX', 'Mexico',         '墨西哥',   'North America', '北美洲', 'creator', 1, 3),
  ('GB', 'United Kingdom', '英国',     'Europe',        '欧洲',   'creator', 1, 10),
  ('DE', 'Germany',        '德国',     'Europe',        '欧洲',   'creator', 1, 11),
  ('FR', 'France',         '法国',     'Europe',        '欧洲',   'creator', 1, 12),
  ('IT', 'Italy',          '意大利',   'Europe',        '欧洲',   'creator', 1, 13),
  ('ES', 'Spain',          '西班牙',   'Europe',        '欧洲',   'creator', 1, 14),
  ('ID', 'Indonesia',      '印尼',     'Asia',          '亚洲',   'creator', 1, 20),
  ('TH', 'Thailand',       '泰国',     'Asia',          '亚洲',   'creator', 1, 21),
  ('VN', 'Vietnam',        '越南',     'Asia',          '亚洲',   'creator', 1, 22),
  ('MY', 'Malaysia',       '马来西亚', 'Asia',          '亚洲',   'creator', 1, 23),
  ('PH', 'Philippines',    '菲律宾',   'Asia',          '亚洲',   'creator', 1, 24),
  ('SG', 'Singapore',      '新加坡',   'Asia',          '亚洲',   'creator', 1, 25),
  ('JP', 'Japan',          '日本',     'Asia',          '亚洲',   'creator', 1, 26),
  ('KR', 'South Korea',    '韩国',     'Asia',          '亚洲',   'creator', 1, 27),
  ('TW', 'Taiwan',         '台湾',     'Asia',          '亚洲',   'creator', 1, 28),
  ('SA', 'Saudi Arabia',   '沙特',     'Asia',          '亚洲',   'creator', 1, 29),
  ('BR', 'Brazil',         '巴西',     'South America', '南美洲', 'creator', 1, 40),
  ('AU', 'Australia',      '澳大利亚', 'Oceania',       '大洋洲', 'creator', 1, 50);
