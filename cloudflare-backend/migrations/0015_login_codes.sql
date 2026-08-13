-- 登录一次性码从 KV 搬进 D1（2026-08-07）。
--
-- 为什么搬：KV 是最终一致的 —— 码在 A colo 写入，扩展的兑换请求打到 B colo
-- 可能还读不到（最长 60s），慢网络/代理换出口的环境下就是
-- 「正在同步网页登录信息…」永远转圈的根因之一。D1 单主强一致，写完必读得到。
--
-- token 列：首次兑换后把发出的长期 token 缓存在这里，重复兑换返回同一个。
-- 登录页会把同一个码每 400ms 兜底重发（site.ts handoff），严格一次性删码
-- 会让并发重复兑换互相踩（先到删码，后到全失败），这是卡死的另一半根因。
CREATE TABLE IF NOT EXISTS login_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token      TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
