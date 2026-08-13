-- 品牌迁移：默认收藏夹改名
--
-- 扩展里判断「这是不是默认收藏夹」是靠名字硬比对的，改名后前后端必须一致，
-- 否则已有用户的默认夹会显示成一串标识符而不是「默认收藏夹」。
--
-- 只在从旧版本升级时需要跑一次；全新部署跑了也无害（影响 0 行）。

UPDATE collection_folders
   SET name = 'AITikTokDownloader_#Default'
 WHERE name = 'KolSprite_#Default';
