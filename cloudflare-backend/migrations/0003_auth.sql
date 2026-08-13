-- 给用户表加上密码字段，支持官网自助注册/登录。
-- 原来只有 /admin/users 能建号，没有用户自己进来的入口。
-- 执行：npm run db:migrate:remote

-- SQLite 的 ALTER TABLE ADD COLUMN 在字段已存在时会报错，
-- 但 D1 的批量执行里一条失败会整批回滚，所以这里用重复执行安全的写法：
-- 先建一张新表判断，实际上 D1 支持 IF NOT EXISTS 的只有 CREATE，
-- 所以这个文件**只在首次升级时跑一次**，跑过就别再跑了。

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 官网自己的会话（和扩展用的 user_tokens 分开）。
-- 扩展那套是长期 token 放 chrome.storage；官网这套是 cookie，短一些。
CREATE TABLE IF NOT EXISTS web_sessions (
  sid        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_websess_user ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_websess_exp  ON web_sessions(expires_at);
