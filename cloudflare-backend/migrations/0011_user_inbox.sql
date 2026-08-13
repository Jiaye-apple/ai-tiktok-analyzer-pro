-- 用户维度站内消息（消息中心的「消息」tab，公告在 announcements 表）。
-- 语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
--
-- 文案存 i18n key（tkey + params），渲染时按用户当前语言取词，
-- 这样一条消息在 9 种界面语言下都对；admin 手发的自由文本走 title/body 列。
CREATE TABLE IF NOT EXISTS user_messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'system',  -- system / task / billing
  tkey       TEXT,                            -- site.json 里的词条 key（与 title 二选一）
  params     TEXT,                            -- tkey 的插值参数，JSON
  title      TEXT,                            -- 自由文本标题（admin 手发用）
  body       TEXT,
  link       TEXT,                            -- 可选的站内跳转路径
  read_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_user_messages_user ON user_messages(user_id, created_at);
