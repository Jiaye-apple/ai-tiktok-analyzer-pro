-- ---------------------------------------------------------------------------
-- 相似达人：向量回填的记账表
-- ---------------------------------------------------------------------------
-- 向量本体存在 Vectorize（索引 kolsprite-creators，1024 维 / cosine），
-- 这里只记「谁已经建过向量、建的是哪一版数据」，用来算增量。
--
-- 为什么要 source_hash：tk_creators 的 payload 是插件静默回流的，
-- 同一个达人会被反复上报，updated_at 天天变但内容常常一模一样。
-- 只看 updated_at 会每天把整库重嵌一遍，白烧 Workers AI 的钱。
-- 所以存一份用于生成向量的那段文本的哈希，内容没变就跳过。
CREATE TABLE IF NOT EXISTS creator_vectors (
  creator_id  TEXT PRIMARY KEY,
  -- 写进 Vectorize 时用的 namespace（= 地区码），删/改要用得上
  namespace   TEXT,
  -- 生成向量的那段文本的 SHA-256（十六进制前 32 位够用了）
  source_hash TEXT NOT NULL,
  -- 嵌入用的模型，将来换模型时靠它筛出需要重嵌的存量
  model       TEXT NOT NULL,
  embedded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 增量扫描要按时间倒着找最久没更新的那批
CREATE INDEX IF NOT EXISTS idx_cv_embedded_at ON creator_vectors(embedded_at);
