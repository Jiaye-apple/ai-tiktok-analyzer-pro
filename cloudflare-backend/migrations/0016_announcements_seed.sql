-- 公告历史种子：删除测试公告，种入 2020→2026 英文更新公告（lang=NULL 全语言可见）。
-- 语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
-- INSERT OR IGNORE：重放不重复，之后经 admin 隐藏/修改的行不会被覆盖。
DELETE FROM announcements WHERE title = '测试公告' OR body LIKE '%公告表读写闭环%';
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0', 'v1.0 — Hello, creators!', 'Our very first update announcement. AI TikTok Downloader Pro v1.0 is live on the Chrome Web Store: open any TikTok video and save a clean, watermark-free copy in original quality with one click. Thank you to the early testers who shaped the beta — this tool exists because of you.', NULL, 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2', 'v1.2 — Batch downloads arrive', 'Queue an entire creator page and grab every video in one pass. New filename templates keep files organized by author, date and caption, so your archive stays searchable. Also: faster parsing and fewer failed fetches on long videos.', NULL, 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4', 'v1.4 — Creator profiles at a glance', 'Open any profile and see followers, total likes, posting cadence and engagement rate right inside the extension — no more copying numbers into spreadsheets. Early scouts tell us shortlisting collab candidates now takes minutes instead of an afternoon.', NULL, 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k', '10,000 users — thank you', 'This week the community passed 10,000 installs. What started as a simple downloader is becoming a research kit for creators and sourcing teams in 40+ countries. Keep the feature requests coming — the roadmap is built from them.', NULL, 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6', 'v1.6 — Creator rankings', 'New leaderboard view: sort creators by followers, growth and engagement across categories and regions to spot rising accounts before they blow up. Plus a cleaner dark theme and lots of layout fixes.', NULL, 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0', 'v2.0 — The web workbench (beta)', 'The extension now has a companion: a full web workbench. Research creators, manage download queues and review your library from any browser tab, with everything synced to your account. The extension stays lightweight; the heavy lifting moves to the web.', NULL, 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2', 'v2.2 — Transcripts & subtitles', 'Every downloaded video can now produce a transcript and exportable SRT subtitles. Repurpose spoken content into posts, briefs and translations without retyping a word.', NULL, 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k', '50,000 users — and what you built', 'We crossed 50,000 users this month. In our winter survey, the most common story was sharper targeting: creators told us that studying what already works in their niche brought them noticeably more precise traffic — viewers who actually follow and convert. That is exactly the job we want this tool to do.', NULL, 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0', 'v3.0 — AI joins the workflow', 'Our first AI release: one-click summaries of any video, and audience-ready briefs generated straight from transcripts. Ask for the hook, the structure or the takeaways — in your language, whatever language the video speaks.', NULL, 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2', 'v3.2 — AI script studio & bilingual subtitles', 'Turn any reference video into a hook, outline, full script and caption set with hashtags — the whole kit in one run. Subtitles can now render bilingually for cross-border publishing.', NULL, 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5', 'v3.5 — Comment & audience analysis', 'A new analysis tab digs through comments to surface sentiment, recurring questions and content ideas, grouped by language. Know what an audience wants before you script the next video.', NULL, 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k', '100,000+ users — your results, our favorite metric', 'More than 100,000 creators, agencies and sourcing teams now use AI TikTok Downloader Pro. From this spring’s user stories: teams pairing rankings with comment analysis to pick topics report campaigns earning over 3× their usual revenue, and solo creators describe finally reaching the right audience instead of chasing raw views. Thank you — milestones like this belong to you.', NULL, 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0', 'v4.0 — Batch task center & exports', 'Long-running work now lives in a task center: queue hundreds of downloads, transcripts or analyses and let them finish in the background. Export any table or report to CSV or Markdown for decks and client reviews.', NULL, 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5', 'v4.5 — Campaign planner', 'A built-in content calendar turns briefs into scheduled plans: assign scripts to dates, track publishing status and keep a whole campaign visible on one board.', NULL, 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0', 'v5.0 — Sign in with Google & sync', 'One-tap Google sign-in, with your quota, library and plans synced across devices. Also new: an in-app feedback form and a WhatsApp support line — talk to us anytime.', NULL, 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5', 'v5.5 — Smarter creator search', 'Search creators by keyword, niche and region with fresher data behind every card. Shortlists now save to your account and export cleanly.', NULL, 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0', 'v6.0 — A faster workbench', 'Rebuilt workbench UI: quicker navigation, clearer creator pages and AI responses that stream in noticeably faster. Plus dozens of small fixes straight from your feedback reports.', NULL, 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4', 'v6.4 — One workflow, every angle', 'Research, download, transcribe, brief, plan and export — one connected workflow, and this release polishes every step of it: a refreshed showcase, steadier batch queues and sharper AI briefs. Six years and 100,000+ users in: thank you for building alongside us.', NULL, 1, 'published', 1786017600);
