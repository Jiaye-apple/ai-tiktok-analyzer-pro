-- 功能许愿：官网 /wish 表单（扩展「功能许愿」入口指过来）的落库。
-- 读端在 /admin/wishes（X-Admin-Key 保护），简易查看页在 /wish/admin。
CREATE TABLE IF NOT EXISTS feature_wishes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  contact    TEXT,                                   -- 选填的联系邮箱
  lang       TEXT,                                   -- 提交时的界面语言（?lang= 带来）
  created_at TEXT NOT NULL DEFAULT (datetime('now')) -- UTC
);
