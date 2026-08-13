-- 官网搜索页「保存的搜索条件」（对照原站 /v1/creator/condition/*）。
-- CI 会按文件名顺序全量重放 migrations/*.sql，语句必须幂等。
CREATE TABLE IF NOT EXISTS search_conditions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  params     TEXT NOT NULL,            -- JSON：{mode, keyword, region, fansMin, fansMax, sort}
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sc_user ON search_conditions(user_id);
