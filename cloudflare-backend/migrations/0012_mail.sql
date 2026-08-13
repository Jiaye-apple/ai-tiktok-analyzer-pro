-- 邮件建联一期：发信账号 / 联系人 / 线程 / 消息 / 模板。
-- 语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
--
-- 架构（2026-08 调研结论，docs 与 memory 有全文）：
--   发信 = 用户自带邮箱 SMTP（worker-mailer），凭据 AES-GCM 加密存 mail_accounts；
--   收信 = Cloudflare Email Routing catch-all -> Email Worker -> postal-mime，
--          原始 .eml 存 R2（mail/raw/{id}.eml），解析后的正文摘要进 mail_messages；
--   归线程 = 发出时 Reply-To 指到 re-{threadId}@<MAIL_DOMAIN>，
--            回信按收件地址里的 threadId 归位，兜底用 In-Reply-To 头。

-- 用户绑定的发信邮箱（Gmail 应用专用密码 / M365 SMTP AUTH / 任意 SMTP 提交口）
CREATE TABLE IF NOT EXISTS mail_accounts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,             -- 发信地址（也是 SMTP 登录名的默认值）
  from_name   TEXT,
  smtp_host   TEXT NOT NULL,
  smtp_port   INTEGER NOT NULL DEFAULT 587,
  smtp_user   TEXT,                      -- 为空则用 email
  smtp_pass   TEXT NOT NULL,             -- AES-GCM 加密（lib/mailcrypt.ts）
  status      TEXT NOT NULL DEFAULT 'active',   -- active / disabled
  last_ok_at  INTEGER,                   -- 最近一次发信成功时间
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_user ON mail_accounts (user_id);

-- 建联联系人（导入达人）。email 可空：先导 handle、后补邮箱是常见流程
CREATE TABLE IF NOT EXISTS mail_contacts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  email       TEXT,
  name        TEXT,
  handle      TEXT,                      -- TikTok @handle
  region      TEXT,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'import',   -- import / manual
  contacted_at INTEGER,                  -- 最近一次给这个联系人发信
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mail_contacts_user ON mail_contacts (user_id, created_at);
-- 去重：有邮箱的按邮箱认人（同一邮箱换个 handle 仍是同一个人），
-- 没邮箱的才退回按 handle 去重。两条局部唯一索引，不能合成一条。
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_contacts_email
  ON mail_contacts (user_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_contacts_handle
  ON mail_contacts (user_id, handle) WHERE email IS NULL AND handle IS NOT NULL;

-- 会话线程：同一收件人的往来归成一条
CREATE TABLE IF NOT EXISTS mail_threads (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  peer_email  TEXT NOT NULL,             -- 对方地址
  subject     TEXT,
  msg_count   INTEGER NOT NULL DEFAULT 0,
  unread      INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mail_threads_user ON mail_threads (user_id, last_at);

-- 单封邮件。正文只存前 32KB 文本，入站完整 .eml 在 R2
CREATE TABLE IF NOT EXISTS mail_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT,                      -- 草稿可以还没有线程
  user_id     TEXT NOT NULL,
  dir         TEXT NOT NULL,             -- out / in
  status      TEXT NOT NULL,             -- draft / sent / failed / received
  from_addr   TEXT,
  to_addr     TEXT,
  subject     TEXT,
  body_text   TEXT,                      -- 纯文本正文（截断到 32KB）
  message_id  TEXT,                      -- RFC 5322 Message-ID（归线程兜底用）
  in_reply_to TEXT,
  raw_key     TEXT,                      -- R2 key（入站原始 .eml）
  error       TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_user ON mail_messages (user_id, dir, status, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_msgid ON mail_messages (message_id);

-- 邮件模板：user_id 为空 = 系统模板（对所有人可见）
CREATE TABLE IF NOT EXISTS mail_templates (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,                      -- NULL = 系统模板
  title       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,             -- 支持 {name} {handle} 插值
  lang        TEXT,                      -- 模板语言（展示用标签）
  stage       TEXT,                      -- 合作阶段（展示用标签）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mail_templates_user ON mail_templates (user_id, updated_at);
