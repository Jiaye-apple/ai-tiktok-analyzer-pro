-- 达人粉丝数每日快照。
-- 用途：达人榜「近30天涨粉」tab（fansLst30d）。数据由每日 cron 的
-- snapshot_creators 任务写入（见 src/lib/jobs.ts），保留 90 天。
-- day 用 UTC 日期字符串（date('now')），和 cron 的 UTC 时区一致。

CREATE TABLE IF NOT EXISTS creator_snapshots (
  creator_id     TEXT NOT NULL,
  day            TEXT NOT NULL,
  follower_count INTEGER NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (creator_id, day)
);

CREATE INDEX IF NOT EXISTS idx_creator_snapshots_day ON creator_snapshots (day);
