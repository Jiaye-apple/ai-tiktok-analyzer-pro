-- Google 登录：记住谷歌账号的稳定标识 sub。
-- 只按 email 认人是不够的 —— 用户可以在 Google 侧改主邮箱，改完就再也登不回原账号；
-- sub 是这个谷歌账号永不变的 id，绑上之后换邮箱也能认出是同一个人。
--
-- 和 0003_auth.sql 一样：ALTER TABLE ADD COLUMN 重复执行会报错，
-- D1 批量执行里一条失败整批回滚，所以这个文件**只跑一次**。
-- 执行：npm run db:migrate:remote

ALTER TABLE users ADD COLUMN google_sub TEXT;

-- 不用 UNIQUE 索引：D1 的 ALTER 后建唯一索引，历史行全是 NULL 没问题，
-- 但唯一索引会让「同一个 sub 误写两行」直接 500，宁可查得到、由代码兜。
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
