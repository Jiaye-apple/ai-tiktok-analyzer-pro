-- 站内公告（官网消息中心从硬编码换成读表）。
-- 语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  lang       TEXT,                       -- NULL = 所有语言可见；否则 zh_CN / en / ja …
  pinned     INTEGER NOT NULL DEFAULT 0, -- 置顶
  status     TEXT NOT NULL DEFAULT 'published',  -- published / hidden
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_created ON announcements(status, created_at);
