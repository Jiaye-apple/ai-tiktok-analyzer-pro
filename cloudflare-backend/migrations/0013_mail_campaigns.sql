-- 批量建联任务（群发）。语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
--
-- 发送引擎抄 listmonk 的形状（2026-08 调研）：
--   ① 绝不一次性载入全量收件人，用 last_id 游标分片推进
--      （Workers 有 CPU 时间上限，只能「取一批、发、记住位置、下次继续」）；
--   ② 限速在「发信邮箱」这一层而不是任务层 —— 信誉是按邮箱算的，
--      同一个人开 3 个任务不该变成 3 倍发信量。
-- 收件人条件实时判断、不做快照（heya 的设计）：达人一旦回信或被拉黑，
-- 后续投递自动跳过，不需要额外的清理任务。

CREATE TABLE IF NOT EXISTS mail_campaigns (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,              -- 支持 {name} {handle} 插值
  status       TEXT NOT NULL DEFAULT 'running',  -- running / paused / done
  sent_count   INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0, -- 建任务时锁定的目标条数（仅用于展示进度）
  cursor_id    TEXT,                       -- 上次推进到的 mail_contacts.id
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mail_campaigns_user ON mail_campaigns (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_campaigns_status ON mail_campaigns (status);

-- 退订/压制表：只要在这里，任何任务都不再投递。
-- 冷邮件合规要求（CAN-SPAM）必须有可用的退订出口，且退订后不得再发。
CREATE TABLE IF NOT EXISTS mail_suppression (
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'unsubscribe',  -- unsubscribe / bounce / manual
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, email)
);
