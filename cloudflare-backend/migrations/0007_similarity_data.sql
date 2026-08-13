-- ---------------------------------------------------------------------------
-- 相似达人：干净的标签表 + 派生指标表
-- ---------------------------------------------------------------------------
-- 为什么不接着用 tk_video_tags：那张表存的是脏数据 ——
--   1. video_id 恒为空串（写入方 creator.ts 写死了 VALUES ('', ?1, ?2)），
--      idx_tag_video 索引因此完全失效；
--   2. tag 被塞成 'challenge:xxx' / 'label:xxx'，官网 hashtag 生成器原样渲染成
--      #challenge:xxx，用户复制出去根本不能用；
--   3. 写入方只取了 Object.keys()，把每个话题的出现次数整个丢了 ——
--      共现/IDF 加权最需要的权重原料没了；
--   4. 没有唯一约束，同一个达人反复上报会重复插行，把 COUNT(*) 刷虚。
-- 线上那张表当前是 0 行，没有历史包袱，直接换成结构正确的新表。
-- 旧表保留不动（不再写入），避免部署过程中读写打架。

CREATE TABLE IF NOT EXISTS creator_tags (
  creator_id TEXT NOT NULL,
  -- 'challenge' = 视频话题挑战，'label' = 用户自定义标签。分开存，
  -- 别再拼进 tag 里 —— 拼进去就是上面第 2 条那个 bug 的来源
  kind       TEXT NOT NULL,
  -- 归一化后的标签：去 #、小写、去首尾空白
  tag        TEXT NOT NULL,
  -- 该标签在这个达人身上出现了多少次，做 TF 用
  hit_count  INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (creator_id, kind, tag)
);

-- 按标签反查达人（相似达人的共现召回要用）
CREATE INDEX IF NOT EXISTS idx_ct_tag ON creator_tags(tag);

-- 标签的文档频率（多少个达人用过），做 IDF 降权用。
-- 不加这个的话 #fyp / #foryou / #viral 这种全站通用标签会让「人人都相似」。
CREATE TABLE IF NOT EXISTS tag_stats (
  tag        TEXT PRIMARY KEY,
  doc_freq   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- 达人派生指标
-- ---------------------------------------------------------------------------
-- 前端相似达人卡片直接要 avgPlayCnt / avgLikeCnt / avgInteractionRate
-- （最后一个是 0~1 的小数，前端会 ×100 再加 %），这三个字段此前没有任何来源。
-- 全部从 tk_videos 聚合出来，算好了存这里，检索时直接取，不在请求里现算。
CREATE TABLE IF NOT EXISTS creator_metrics (
  creator_id       TEXT PRIMARY KEY,
  avg_play_cnt     INTEGER NOT NULL DEFAULT 0,
  avg_like_cnt     INTEGER NOT NULL DEFAULT 0,
  avg_comment_cnt  INTEGER NOT NULL DEFAULT 0,
  -- (赞 + 评论 + 收藏 + 转发) / 播放，取样本视频的均值
  interaction_rate REAL    NOT NULL DEFAULT 0,
  -- 参与计算的视频条数，太少的指标不可信，检索时可以据此降权
  sample_size      INTEGER NOT NULL DEFAULT 0,
  -- 最近一条视频的发布时间，用来判断达人是否还活跃
  last_post_at     INTEGER,
  -- 主要语种（取自视频的 textLanguage），做 Vectorize 的 lang metadata
  lang             TEXT,
  -- 出现最多的内容分类
  category         TEXT,
  computed_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cm_computed ON creator_metrics(computed_at);

-- ---------------------------------------------------------------------------
-- tk_creators 补两个列
-- ---------------------------------------------------------------------------
-- 达人资料现在有两个来源：主页回流（/creator/save，权威但量少）和
-- 视频回流里的 author 字段（量大 20 倍，但字段少一些）。
-- 用 source 区分，避免视频派生的数据把主页抓来的完整资料覆盖掉。
--   'profile' = 主页回流，'video' = 从 tk_videos.payload.author 反推
-- D1 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报 duplicate column，
-- CI 的迁移重放对这个错误是容忍的（见 .github/workflows/deploy.yml）。
ALTER TABLE tk_creators ADD COLUMN source TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE tk_creators ADD COLUMN unique_id_lower TEXT;

-- 前端相似达人结果里的 creatorId 其实是 handle，
-- 拿 handle 反查达人必须走索引，否则每次检索都是全表扫
CREATE INDEX IF NOT EXISTS idx_tkc_unique_lower ON tk_creators(unique_id_lower);
