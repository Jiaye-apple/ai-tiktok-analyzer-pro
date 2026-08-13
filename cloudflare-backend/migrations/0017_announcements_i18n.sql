-- 公告多语言化：0016 的 18 条 lang=NULL 英文行按语言拆成 18×9=162 条对照行。
-- lang 存 htmlLang() 的 BCP-47 码（zh-CN/zh-TW，不是 zh_CN）——消息中心按它过滤。
-- 语句必须幂等：CI 按文件名顺序全量重放 migrations/*.sql。
-- INSERT OR IGNORE：重放不重复，之后经 admin 隐藏/修改的行不会被覆盖。
DELETE FROM announcements WHERE lang IS NULL AND id IN ('ann-2020-08-v1-0', 'ann-2020-12-v1-2', 'ann-2021-04-v1-4', 'ann-2021-08-10k', 'ann-2021-12-v1-6', 'ann-2022-05-v2-0', 'ann-2022-09-v2-2', 'ann-2023-01-50k', 'ann-2023-06-v3-0', 'ann-2023-10-v3-2', 'ann-2024-02-v3-5', 'ann-2024-06-100k', 'ann-2024-11-v4-0', 'ann-2025-03-v4-5', 'ann-2025-07-v5-0', 'ann-2025-11-v5-5', 'ann-2026-03-v6-0', 'ann-2026-08-v6-4');
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-en', 'v1.0 — Hello, creators!', 'Our very first update announcement. AI TikTok Downloader Pro v1.0 is live on the Chrome Web Store: open any TikTok video and save a clean, watermark-free copy in original quality with one click. Thank you to the early testers who shaped the beta — this tool exists because of you.', 'en', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-es', 'v1.0 — ¡Hola, creadores!', 'Nuestro primer anuncio de actualización. AI TikTok Downloader Pro v1.0 ya está en la Chrome Web Store: abre cualquier video de TikTok y guarda una copia limpia, sin marca de agua y en calidad original con un clic. Gracias a los primeros testers que dieron forma a la beta: esta herramienta existe gracias a ustedes.', 'es', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-id', 'v1.0 — Halo, kreator!', 'Pengumuman pembaruan pertama kami. AI TikTok Downloader Pro v1.0 sudah tersedia di Chrome Web Store: buka video TikTok mana pun dan simpan salinan bersih tanpa watermark dengan kualitas asli dalam satu klik. Terima kasih kepada para penguji awal yang ikut membentuk versi beta — alat ini ada berkat kalian.', 'id', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-ja', 'v1.0 — クリエイターの皆さん、こんにちは！', '初めてのアップデートのお知らせです。AI TikTok Downloader Pro v1.0 が Chrome ウェブストアに公開されました。TikTok の動画を開いてワンクリックで、ウォーターマークなし・元画質のままダウンロードできます。ベータ版を磨き上げてくれた初期テスターの皆さんに感謝します——このツールは皆さんのおかげで生まれました。', 'ja', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-ko', 'v1.0 — 크리에이터 여러분, 안녕하세요!', '첫 업데이트 공지입니다. AI TikTok Downloader Pro v1.0이 Chrome 웹 스토어에 정식 출시되었습니다. TikTok 동영상을 열고 클릭 한 번으로 워터마크 없는 원본 화질 영상을 저장하세요. 베타를 함께 다듬어 준 초기 테스터 여러분께 감사드립니다. 이 도구는 여러분 덕분에 존재합니다.', 'ko', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-pt', 'v1.0 — Olá, criadores!', 'Nosso primeiro anúncio de atualização. O AI TikTok Downloader Pro v1.0 está no ar na Chrome Web Store: abra qualquer vídeo do TikTok e salve uma cópia limpa, sem marca d''água e em qualidade original com um clique. Obrigado aos primeiros testers que moldaram o beta — esta ferramenta existe graças a vocês.', 'pt', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-vi', 'v1.0 — Xin chào các nhà sáng tạo!', 'Thông báo cập nhật đầu tiên của chúng tôi. AI TikTok Downloader Pro v1.0 đã có mặt trên Chrome Web Store: mở bất kỳ video TikTok nào và lưu bản sạch không watermark, chất lượng gốc chỉ với một cú nhấp. Cảm ơn những người dùng thử đầu tiên đã giúp hoàn thiện bản beta — công cụ này tồn tại là nhờ các bạn.', 'vi', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-zh-CN', 'v1.0 — 你好，创作者！', '第一条更新公告。AI TikTok Downloader Pro v1.0 正式上架 Chrome 应用商店：打开任意 TikTok 视频，一键保存无水印、原画质的干净副本。感谢参与内测、帮我们打磨产品的第一批用户——这个工具因你们而存在。', 'zh-CN', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-08-v1-0-zh-TW', 'v1.0 — 你好，創作者！', '第一則更新公告。AI TikTok Downloader Pro v1.0 正式上架 Chrome 線上應用程式商店：打開任意 TikTok 影片，一鍵儲存無浮水印、原畫質的乾淨副本。感謝參與內測、幫我們打磨產品的第一批用戶——這個工具因你們而存在。', 'zh-TW', 0, 'published', 1597752000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-en', 'v1.2 — Batch downloads arrive', 'Queue an entire creator page and grab every video in one pass. New filename templates keep files organized by author, date and caption, so your archive stays searchable. Also: faster parsing and fewer failed fetches on long videos.', 'en', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-es', 'v1.2 — Llegan las descargas por lotes', 'Pon en cola la página completa de un creador y descarga todos sus videos de una pasada. Las nuevas plantillas de nombre de archivo organizan todo por autor, fecha y descripción, para que tu archivo siempre sea buscable. Además: análisis más rápido y menos fallos en videos largos.', 'es', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-id', 'v1.2 — Unduhan massal hadir', 'Masukkan seluruh halaman kreator ke antrean dan ambil semua videonya sekaligus. Templat nama file baru merapikan arsip berdasarkan penulis, tanggal, dan caption sehingga selalu mudah dicari. Selain itu: parsing lebih cepat dan lebih sedikit kegagalan pada video panjang.', 'id', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-ja', 'v1.2 — 一括ダウンロード登場', 'クリエイターのページをまるごとキューに入れて、全動画を一括保存。新しいファイル名テンプレートが作者・日付・キャプションで自動整理し、アーカイブをいつでも検索できます。解析も高速化し、長い動画の取得失敗も減りました。', 'ja', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-ko', 'v1.2 — 일괄 다운로드 출시', '크리에이터 페이지 전체를 대기열에 넣고 모든 영상을 한 번에 저장하세요. 새 파일명 템플릿이 작성자·날짜·캡션 기준으로 자동 정리해 아카이브를 언제든 검색할 수 있습니다. 파싱 속도가 빨라지고 긴 영상의 실패율도 줄었습니다.', 'ko', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-pt', 'v1.2 — Chegaram os downloads em lote', 'Coloque a página inteira de um criador na fila e baixe todos os vídeos de uma vez. Os novos modelos de nome de arquivo organizam tudo por autor, data e legenda, mantendo seu acervo pesquisável. Além disso: análise mais rápida e menos falhas em vídeos longos.', 'pt', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-vi', 'v1.2 — Ra mắt tải hàng loạt', 'Đưa cả trang của một nhà sáng tạo vào hàng đợi và tải toàn bộ video trong một lượt. Mẫu đặt tên tệp mới tự sắp xếp theo tác giả, ngày và chú thích, giúp kho lưu trữ luôn dễ tìm kiếm. Ngoài ra: phân tích nhanh hơn, ít lỗi hơn với video dài.', 'vi', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-zh-CN', 'v1.2 — 批量下载上线', '把整个达人主页加入队列，一次抓完所有视频。新的文件名模板按作者、日期、标题自动归档，素材库随时可检索。同时解析速度更快，长视频抓取失败更少。', 'zh-CN', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2020-12-v1-2-zh-TW', 'v1.2 — 批量下載上線', '把整個達人主頁加入佇列，一次抓完所有影片。新的檔名模板按作者、日期、標題自動歸檔，素材庫隨時可檢索。同時解析速度更快，長影片抓取失敗更少。', 'zh-TW', 0, 'published', 1607515200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-en', 'v1.4 — Creator profiles at a glance', 'Open any profile and see followers, total likes, posting cadence and engagement rate right inside the extension — no more copying numbers into spreadsheets. Early scouts tell us shortlisting collab candidates now takes minutes instead of an afternoon.', 'en', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-es', 'v1.4 — Perfiles de creadores de un vistazo', 'Abre cualquier perfil y ve seguidores, likes totales, ritmo de publicación y tasa de interacción directamente en la extensión, sin copiar números a hojas de cálculo. Los primeros usuarios nos cuentan que preseleccionar candidatos para colaborar ahora toma minutos, no una tarde.', 'es', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-id', 'v1.4 — Profil kreator dalam sekejap', 'Buka profil mana pun dan lihat pengikut, total suka, ritme posting, dan tingkat interaksi langsung di dalam ekstensi — tak perlu lagi menyalin angka ke spreadsheet. Pengguna awal bercerita: menyaring kandidat kolaborasi kini butuh hitungan menit, bukan setengah hari.', 'id', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-ja', 'v1.4 — クリエイターのデータをひと目で', 'プロフィールを開くだけで、フォロワー数・総いいね・投稿頻度・エンゲージメント率を拡張機能内に直接表示。数字をスプレッドシートに書き写す作業はもう不要です。初期ユーザーからは「コラボ候補の絞り込みが半日から数分になった」との声も。', 'ja', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-ko', 'v1.4 — 한눈에 보는 크리에이터 데이터', '프로필을 열면 팔로워 수, 총 좋아요, 게시 주기, 참여율이 확장 프로그램 안에 바로 표시됩니다. 숫자를 스프레드시트에 옮겨 적을 필요가 없습니다. 초기 사용자들은 협업 후보 선별이 한나절에서 몇 분으로 줄었다고 전합니다.', 'ko', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-pt', 'v1.4 — Perfis de criadores num relance', 'Abra qualquer perfil e veja seguidores, curtidas totais, ritmo de postagem e taxa de engajamento direto na extensão — chega de copiar números para planilhas. Os primeiros usuários contam que montar a shortlist de parceiros agora leva minutos, não uma tarde.', 'pt', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-vi', 'v1.4 — Dữ liệu nhà sáng tạo trong nháy mắt', 'Mở bất kỳ trang cá nhân nào để xem số người theo dõi, tổng lượt thích, nhịp đăng bài và tỷ lệ tương tác ngay trong tiện ích mở rộng — không cần chép số liệu vào bảng tính nữa. Người dùng đầu tiên cho biết: chọn lọc ứng viên hợp tác giờ chỉ mất vài phút thay vì cả buổi chiều.', 'vi', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-zh-CN', 'v1.4 — 达人主页数据一目了然', '打开任意达人主页，粉丝数、总点赞、发布频率、互动率直接显示在扩展里，不用再把数字抄进表格。早期用户反馈：筛选合作人选从一下午缩短到几分钟。', 'zh-CN', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-04-v1-4-zh-TW', 'v1.4 — 達人主頁數據一目了然', '打開任意達人主頁，粉絲數、總按讚、發布頻率、互動率直接顯示在擴充功能裡，不用再把數字抄進表格。早期用戶回饋：篩選合作人選從一下午縮短到幾分鐘。', 'zh-TW', 0, 'published', 1618488000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-en', '10,000 users — thank you', 'This week the community passed 10,000 installs. What started as a simple downloader is becoming a research kit for creators and sourcing teams in 40+ countries. Keep the feature requests coming — the roadmap is built from them.', 'en', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-es', '10.000 usuarios — gracias', 'Esta semana la comunidad superó las 10.000 instalaciones. Lo que empezó como un simple descargador se está convirtiendo en un kit de investigación para creadores y equipos de sourcing en más de 40 países. Sigan enviando ideas: la hoja de ruta se construye con ellas.', 'es', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-id', '10.000 pengguna — terima kasih', 'Minggu ini komunitas melewati 10.000 pemasangan. Yang awalnya sekadar pengunduh kini tumbuh menjadi kit riset bagi kreator dan tim sourcing di 40+ negara. Terus kirimkan permintaan fitur — peta jalan kami dibangun dari masukan kalian.', 'id', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-ja', 'ユーザー1万人突破——ありがとうございます', '今週、コミュニティのインストール数が10,000を超えました。シンプルなダウンローダーとして始まったこのツールは、40か国以上のクリエイターとソーシングチームのリサーチキットへと成長しつつあります。機能リクエストをどんどんお寄せください——ロードマップは皆さんの声から作られています。', 'ja', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-ko', '사용자 1만 명 돌파 — 감사합니다', '이번 주 커뮤니티 설치 수가 10,000을 넘었습니다. 단순한 다운로더로 시작한 이 도구가 40여 개국의 크리에이터와 소싱 팀의 리서치 키트로 성장하고 있습니다. 기능 요청은 계속 보내 주세요. 로드맵은 여러분의 의견으로 만들어집니다.', 'ko', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-pt', '10.000 usuários — obrigado', 'Nesta semana a comunidade passou de 10.000 instalações. O que começou como um simples downloader está virando um kit de pesquisa para criadores e equipes de sourcing em mais de 40 países. Continuem mandando sugestões — o roadmap é construído a partir delas.', 'pt', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-vi', '10.000 người dùng — cảm ơn các bạn', 'Tuần này cộng đồng đã vượt 10.000 lượt cài đặt. Từ một công cụ tải đơn giản, sản phẩm đang trở thành bộ công cụ nghiên cứu cho nhà sáng tạo và đội ngũ tìm nguồn hàng ở hơn 40 quốc gia. Hãy tiếp tục gửi yêu cầu tính năng — lộ trình được xây từ chính phản hồi của các bạn.', 'vi', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-zh-CN', '用户破 1 万，谢谢你们', '本周社区安装量突破 10,000。一个简单的下载器，正在成长为 40 多个国家的创作者和选品团队的研究工具箱。功能建议请继续提——路线图就是从你们的反馈里长出来的。', 'zh-CN', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-08-10k-zh-TW', '用戶破 1 萬，謝謝你們', '本週社群安裝量突破 10,000。一個簡單的下載器，正在成長為 40 多個國家的創作者和選品團隊的研究工具箱。功能建議請繼續提——路線圖就是從你們的回饋裡長出來的。', 'zh-TW', 0, 'published', 1629979200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-en', 'v1.6 — Creator rankings', 'New leaderboard view: sort creators by followers, growth and engagement across categories and regions to spot rising accounts before they blow up. Plus a cleaner dark theme and lots of layout fixes.', 'en', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-es', 'v1.6 — Ranking de creadores', 'Nueva vista de clasificación: ordena creadores por seguidores, crecimiento e interacción, por categoría y región, para detectar cuentas en ascenso antes de que exploten. Además, tema oscuro más limpio y muchos arreglos de diseño.', 'es', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-id', 'v1.6 — Peringkat kreator', 'Tampilan papan peringkat baru: urutkan kreator berdasarkan pengikut, pertumbuhan, dan interaksi lintas kategori dan wilayah untuk menemukan akun yang sedang naik daun sebelum viral. Ditambah tema gelap yang lebih bersih dan banyak perbaikan tata letak.', 'id', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-ja', 'v1.6 — 人気クリエイターランキング', '新しいランキングビュー：カテゴリや地域を横断して、フォロワー数・成長率・エンゲージメントでクリエイターを並べ替え。バズる前の伸びしろアカウントを見つけられます。ダークテーマも刷新し、レイアウトの不具合を多数修正しました。', 'ja', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-ko', 'v1.6 — 인기 크리에이터 랭킹', '새 리더보드 뷰: 카테고리와 지역을 넘나들며 팔로워 수·성장세·참여율로 크리에이터를 정렬해, 뜨기 전의 유망 계정을 먼저 발견하세요. 다크 테마가 깔끔해지고 레이아웃 문제도 대거 수정했습니다.', 'ko', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-pt', 'v1.6 — Ranking de criadores', 'Nova visão de ranking: ordene criadores por seguidores, crescimento e engajamento, por categoria e região, para achar contas em ascensão antes de estourarem. De quebra, tema escuro mais limpo e vários ajustes de layout.', 'pt', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-vi', 'v1.6 — Bảng xếp hạng KOL', 'Chế độ xem bảng xếp hạng mới: sắp xếp nhà sáng tạo theo lượt theo dõi, tốc độ tăng trưởng và tương tác, theo từng ngành hàng và khu vực, để phát hiện tài khoản tiềm năng trước khi bùng nổ. Kèm theo giao diện tối gọn gàng hơn và nhiều chỉnh sửa bố cục.', 'vi', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-zh-CN', 'v1.6 — 热门达人榜上线', '新的榜单视图：按粉丝量、涨粉速度、互动率，跨品类跨地区给达人排序，在爆红之前发现潜力账号。另外深色主题更干净，修了一批排版问题。', 'zh-CN', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2021-12-v1-6-zh-TW', 'v1.6 — 熱門達人榜上線', '全新的榜單檢視：按粉絲量、漲粉速度、互動率，跨品類跨地區給達人排序，在爆紅之前發現潛力帳號。另外深色主題更乾淨，修了一批排版問題。', 'zh-TW', 0, 'published', 1639656000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-en', 'v2.0 — The web workbench (beta)', 'The extension now has a companion: a full web workbench. Research creators, manage download queues and review your library from any browser tab, with everything synced to your account. The extension stays lightweight; the heavy lifting moves to the web.', 'en', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-es', 'v2.0 — Workbench web (beta)', 'La extensión ya tiene compañero: un workbench web completo. Investiga creadores, gestiona colas de descarga y revisa tu biblioteca desde cualquier pestaña, todo sincronizado con tu cuenta. La extensión sigue ligera; el trabajo pesado pasa a la web.', 'es', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-id', 'v2.0 — Workbench web (beta)', 'Ekstensi kini punya pendamping: workbench web lengkap. Riset kreator, kelola antrean unduhan, dan tinjau pustaka dari tab browser mana pun — semuanya tersinkron ke akunmu. Ekstensi tetap ringan; pekerjaan berat pindah ke web.', 'id', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-ja', 'v2.0 — Web ワークベンチ（ベータ）', '拡張機能に相棒ができました：フル機能のWebワークベンチです。どのタブからでもクリエイターをリサーチし、ダウンロードキューを管理し、ライブラリを見返せます。すべてアカウントに同期。拡張機能は軽いまま、重い処理はWebへ。', 'ja', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-ko', 'v2.0 — 웹 워크벤치(베타)', '확장 프로그램에 파트너가 생겼습니다: 완전한 웹 워크벤치입니다. 어느 브라우저 탭에서든 크리에이터를 리서치하고 다운로드 대기열을 관리하고 라이브러리를 살펴보세요. 모든 것이 계정에 동기화됩니다. 확장 프로그램은 가볍게, 무거운 작업은 웹에서.', 'ko', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-pt', 'v2.0 — Workbench web (beta)', 'A extensão ganhou um parceiro: um workbench web completo. Pesquise criadores, gerencie filas de download e revise sua biblioteca de qualquer aba, com tudo sincronizado na sua conta. A extensão continua leve; o trabalho pesado vai para a web.', 'pt', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-vi', 'v2.0 — Bàn làm việc web (beta)', 'Tiện ích mở rộng giờ có thêm người bạn đồng hành: một bàn làm việc web đầy đủ. Nghiên cứu nhà sáng tạo, quản lý hàng đợi tải và xem lại thư viện từ bất kỳ tab trình duyệt nào, tất cả đồng bộ với tài khoản của bạn. Tiện ích vẫn nhẹ; việc nặng chuyển sang web.', 'vi', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-zh-CN', 'v2.0 — Web 工作台（beta）', '扩展有了搭档：完整的网页工作台。在任意浏览器标签页里研究达人、管理下载队列、翻看素材库，一切同步到你的账号。扩展保持轻量，重活儿交给网页端。', 'zh-CN', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-05-v2-0-zh-TW', 'v2.0 — Web 工作台（beta）', '擴充功能有了搭檔：完整的網頁工作台。在任意瀏覽器分頁裡研究達人、管理下載佇列、翻看素材庫，一切同步到你的帳號。擴充功能保持輕量，重活交給網頁端。', 'zh-TW', 0, 'published', 1652356800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-en', 'v2.2 — Transcripts & subtitles', 'Every downloaded video can now produce a transcript and exportable SRT subtitles. Repurpose spoken content into posts, briefs and translations without retyping a word.', 'en', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-es', 'v2.2 — Transcripciones y subtítulos', 'Cada video descargado ahora puede generar una transcripción y subtítulos SRT exportables. Convierte el contenido hablado en publicaciones, briefs y traducciones sin volver a escribir una palabra.', 'es', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-id', 'v2.2 — Transkrip & subtitle', 'Setiap video yang diunduh kini bisa menghasilkan transkrip dan subtitle SRT yang dapat diekspor. Ubah konten lisan menjadi postingan, brief, dan terjemahan tanpa mengetik ulang sepatah kata pun.', 'id', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-ja', 'v2.2 — 文字起こしと字幕', 'ダウンロードした動画から文字起こしを生成し、SRT字幕としてエクスポートできるようになりました。話した内容を、一文字も打ち直さずに投稿・企画書・翻訳素材へ再利用できます。', 'ja', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-ko', 'v2.2 — 전사와 자막', '다운로드한 모든 영상에서 전사본을 만들고 SRT 자막으로 내보낼 수 있습니다. 말로 된 콘텐츠를 한 글자도 다시 입력하지 않고 게시물, 브리프, 번역 자료로 재활용하세요.', 'ko', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-pt', 'v2.2 — Transcrições e legendas', 'Todo vídeo baixado agora pode gerar uma transcrição e legendas SRT exportáveis. Transforme conteúdo falado em posts, briefings e traduções sem redigitar uma palavra.', 'pt', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-vi', 'v2.2 — Bản chép lời & phụ đề', 'Mỗi video tải về giờ có thể tạo bản chép lời và xuất phụ đề SRT. Biến nội dung nói thành bài đăng, bản tóm tắt và bản dịch mà không cần gõ lại một chữ nào.', 'vi', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-zh-CN', 'v2.2 — 转录与字幕', '每个下载的视频都能生成逐字稿，并导出 SRT 字幕。口播内容直接变成帖子、简报和翻译素材，一个字都不用重敲。', 'zh-CN', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2022-09-v2-2-zh-TW', 'v2.2 — 轉錄與字幕', '每個下載的影片都能生成逐字稿，並匯出 SRT 字幕。口播內容直接變成貼文、簡報和翻譯素材，一個字都不用重敲。', 'zh-TW', 0, 'published', 1663848000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-en', '50,000 users — and what you built', 'We crossed 50,000 users this month. In our winter survey, the most common story was sharper targeting: creators told us that studying what already works in their niche brought them noticeably more precise traffic — viewers who actually follow and convert. That is exactly the job we want this tool to do.', 'en', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-es', '50.000 usuarios — y lo que lograron', 'Este mes superamos los 50.000 usuarios. En nuestra encuesta de invierno, la historia más repetida fue la de una segmentación más fina: los creadores nos contaron que estudiar lo que ya funciona en su nicho les trajo un tráfico notablemente más preciso: espectadores que de verdad siguen y convierten. Exactamente el trabajo que queremos que haga esta herramienta.', 'es', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-id', '50.000 pengguna — dan hasil karya kalian', 'Bulan ini kami melewati 50.000 pengguna. Dalam survei musim dingin, cerita yang paling sering muncul adalah penargetan yang lebih tajam: kreator bercerita bahwa mempelajari konten yang sudah terbukti di ceruk mereka mendatangkan trafik yang jauh lebih tepat sasaran — penonton yang benar-benar mengikuti dan berkonversi. Persis itulah tugas yang kami inginkan dari alat ini.', 'id', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-ja', '5万ユーザー突破——皆さんが成し遂げたこと', '今月、ユーザー数が50,000を超えました。冬のアンケートで最も多かった声は「ターゲティングが鋭くなった」。同じジャンルで既に伸びているコンテンツを研究することで、明らかに精度の高い流入——実際にフォローし、購入につながる視聴者——を得られたそうです。まさにこのツールに担ってほしい仕事です。', 'ja', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-ko', '5만 사용자 — 그리고 여러분이 만든 성과', '이번 달 사용자 수가 50,000을 넘었습니다. 겨울 설문에서 가장 많이 들은 이야기는 타겟팅이 정교해졌다는 것이었습니다. 같은 분야에서 이미 통하는 콘텐츠를 연구했더니 눈에 띄게 더 정확한 트래픽 — 실제로 팔로우하고 전환되는 시청자 — 이 들어왔다고 합니다. 바로 이 도구가 해야 할 일입니다.', 'ko', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-pt', '50.000 usuários — e o que vocês construíram', 'Este mês passamos de 50.000 usuários. Na pesquisa de inverno, a história mais comum foi a mira mais fina: criadores contaram que estudar o que já funciona no seu nicho trouxe um tráfego visivelmente mais preciso — espectadores que realmente seguem e convertem. Exatamente o trabalho que queremos que esta ferramenta faça.', 'pt', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-vi', '50.000 người dùng — và những gì các bạn đã làm được', 'Tháng này chúng tôi vượt mốc 50.000 người dùng. Trong khảo sát mùa đông, câu chuyện phổ biến nhất là nhắm mục tiêu chuẩn hơn: các nhà sáng tạo cho biết việc nghiên cứu nội dung đã thành công trong ngách của mình mang lại lượng truy cập chính xác hơn rõ rệt — những người xem thực sự theo dõi và chuyển đổi. Đó chính xác là điều chúng tôi muốn công cụ này làm được.', 'vi', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-zh-CN', '5 万用户，以及你们做成的事', '本月用户突破 50,000。冬季调研里，最常见的故事是定位更准了：创作者说，研究同赛道已经跑通的内容，带来了明显更精准的流量——真正会关注、会转化的观众。这正是我们想让这个工具做到的事。', 'zh-CN', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-01-50k-zh-TW', '5 萬用戶，以及你們做成的事', '本月用戶突破 50,000。冬季調研裡，最常見的故事是定位更準了：創作者說，研究同賽道已經跑通的內容，帶來了明顯更精準的流量——真正會關注、會轉化的觀眾。這正是我們想讓這個工具做到的事。', 'zh-TW', 0, 'published', 1674129600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-en', 'v3.0 — AI joins the workflow', 'Our first AI release: one-click summaries of any video, and audience-ready briefs generated straight from transcripts. Ask for the hook, the structure or the takeaways — in your language, whatever language the video speaks.', 'en', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-es', 'v3.0 — La IA se une al flujo de trabajo', 'Nuestro primer lanzamiento con IA: resúmenes de cualquier video con un clic y briefs listos para usar generados desde la transcripción. Pide el gancho, la estructura o las conclusiones, en tu idioma, hable el idioma que hable el video.', 'es', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-id', 'v3.0 — AI bergabung ke alur kerja', 'Rilis AI pertama kami: ringkasan video sekali klik dan brief siap pakai yang dihasilkan langsung dari transkrip. Minta hook, struktur, atau poin utamanya — dalam bahasamu, apa pun bahasa videonya.', 'id', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-ja', 'v3.0 — AIがワークフローに参加', '初のAIリリースです。どんな動画もワンクリックで要約し、文字起こしからそのまま使える企画ブリーフを生成。フック、構成、要点——欲しいものを指定するだけ。動画が何語でも、出力はあなたの言語で。', 'ja', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-ko', 'v3.0 — AI가 워크플로에 합류', '첫 AI 릴리스입니다. 어떤 영상이든 클릭 한 번으로 요약하고, 전사본에서 바로 쓸 수 있는 브리프를 생성합니다. 후킹, 구성, 핵심 정리 — 원하는 것을 요청하세요. 영상이 어떤 언어든 결과는 여러분의 언어로 나옵니다.', 'ko', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-pt', 'v3.0 — A IA entra no fluxo de trabalho', 'Nosso primeiro lançamento com IA: resumos de qualquer vídeo em um clique e briefings prontos gerados direto da transcrição. Peça o gancho, a estrutura ou os aprendizados — no seu idioma, seja qual for o idioma do vídeo.', 'pt', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-vi', 'v3.0 — AI tham gia quy trình', 'Bản phát hành AI đầu tiên: tóm tắt mọi video chỉ với một cú nhấp, và bản tóm tắt nội dung sẵn sàng sử dụng được tạo thẳng từ bản chép lời. Cần câu mở đầu, cấu trúc hay ý chính — cứ yêu cầu, bằng ngôn ngữ của bạn, bất kể video nói tiếng gì.', 'vi', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-zh-CN', 'v3.0 — AI 加入工作流', '第一个 AI 版本：任意视频一键生成摘要，逐字稿直接产出可用的内容简报。想要开头钩子、结构拆解还是要点提炼，都可以——无论视频说什么语言，输出都用你的语言。', 'zh-CN', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-06-v3-0-zh-TW', 'v3.0 — AI 加入工作流', '第一個 AI 版本：任意影片一鍵生成摘要，逐字稿直接產出可用的內容簡報。想要開頭鉤子、結構拆解還是要點提煉，都可以——無論影片說什麼語言，輸出都用你的語言。', 'zh-TW', 0, 'published', 1686225600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-en', 'v3.2 — AI script studio & bilingual subtitles', 'Turn any reference video into a hook, outline, full script and caption set with hashtags — the whole kit in one run. Subtitles can now render bilingually for cross-border publishing.', 'en', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-es', 'v3.2 — Estudio de guiones IA y subtítulos bilingües', 'Convierte cualquier video de referencia en gancho, esquema, guion completo y set de descripciones con hashtags: el kit entero de una vez. Los subtítulos ahora pueden mostrarse en dos idiomas para publicar sin fronteras.', 'es', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-id', 'v3.2 — Studio skrip AI & subtitle bilingual', 'Ubah video referensi mana pun menjadi hook, kerangka, skrip lengkap, dan set caption dengan tagar — satu paket sekali jalan. Subtitle kini bisa tampil bilingual untuk publikasi lintas negara.', 'id', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-ja', 'v3.2 — AI台本スタジオと二言語字幕', '参考動画ひとつから、フック・アウトライン・完成台本・ハッシュタグ付きキャプションまで一式をまとめて生成。字幕は二言語表示に対応し、越境展開がさらにスムーズに。', 'ja', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-ko', 'v3.2 — AI 스크립트 스튜디오와 이중 자막', '참고 영상 하나로 후킹, 아웃라인, 전체 스크립트, 해시태그 포함 캡션까지 한 번에 생성합니다. 자막은 이제 이중 언어로 렌더링되어 해외 퍼블리싱이 한결 수월합니다.', 'ko', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-pt', 'v3.2 — Estúdio de roteiros IA e legendas bilíngues', 'Transforme qualquer vídeo de referência em gancho, esboço, roteiro completo e conjunto de legendas com hashtags — o kit inteiro de uma vez. As legendas agora podem sair bilíngues para publicação internacional.', 'pt', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-vi', 'v3.2 — Xưởng kịch bản AI & phụ đề song ngữ', 'Biến bất kỳ video tham khảo nào thành câu mở đầu, dàn ý, kịch bản hoàn chỉnh và bộ chú thích kèm hashtag — trọn bộ trong một lần chạy. Phụ đề giờ có thể hiển thị song ngữ để xuất bản xuyên biên giới.', 'vi', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-zh-CN', 'v3.2 — AI 脚本工作室与双语字幕', '任意参考视频，一次生成开头钩子、大纲、完整脚本和带话题标签的文案——整套一步到位。字幕支持双语渲染，跨境发布更顺手。', 'zh-CN', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2023-10-v3-2-zh-TW', 'v3.2 — AI 腳本工作室與雙語字幕', '任意參考影片，一次生成開頭鉤子、大綱、完整腳本和帶話題標籤的文案——整套一步到位。字幕支援雙語渲染，跨境發布更順手。', 'zh-TW', 0, 'published', 1698321600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-en', 'v3.5 — Comment & audience analysis', 'A new analysis tab digs through comments to surface sentiment, recurring questions and content ideas, grouped by language. Know what an audience wants before you script the next video.', 'en', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-es', 'v3.5 — Análisis de comentarios y audiencia', 'Una nueva pestaña de análisis examina los comentarios para revelar sentimiento, preguntas recurrentes e ideas de contenido, agrupado por idioma. Sabe qué quiere la audiencia antes de escribir el próximo guion.', 'es', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-id', 'v3.5 — Analisis komentar & audiens', 'Tab analisis baru menelusuri kolom komentar untuk menampilkan sentimen, pertanyaan yang sering muncul, dan ide konten, dikelompokkan per bahasa. Ketahui apa yang diinginkan penonton sebelum menulis skrip video berikutnya.', 'id', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-ja', 'v3.5 — コメント・オーディエンス分析', '新しい分析タブがコメント欄を掘り下げ、感情の傾向・よくある質問・コンテンツのアイデアを言語別に整理して表示します。次の台本を書く前に、視聴者が求めているものを把握できます。', 'ja', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-ko', 'v3.5 — 댓글·시청자 분석', '새 분석 탭이 댓글을 파고들어 감정 경향, 반복되는 질문, 콘텐츠 아이디어를 언어별로 정리해 보여줍니다. 다음 영상을 기획하기 전에 시청자가 원하는 것을 먼저 파악하세요.', 'ko', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-pt', 'v3.5 — Análise de comentários e audiência', 'Uma nova aba de análise vasculha os comentários para revelar sentimento, perguntas recorrentes e ideias de conteúdo, agrupados por idioma. Saiba o que a audiência quer antes de roteirizar o próximo vídeo.', 'pt', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-vi', 'v3.5 — Phân tích bình luận & khán giả', 'Tab phân tích mới đào sâu phần bình luận để làm nổi bật cảm xúc, câu hỏi lặp lại và ý tưởng nội dung, nhóm theo ngôn ngữ. Biết khán giả muốn gì trước khi viết kịch bản video tiếp theo.', 'vi', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-zh-CN', 'v3.5 — 评论与受众分析', '新的分析页签深挖评论区，按语言归组呈现情绪倾向、高频问题和选题灵感。在写下一条脚本之前，先知道观众想要什么。', 'zh-CN', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-02-v3-5-zh-TW', 'v3.5 — 評論與受眾分析', '新的分析頁籤深挖評論區，按語言歸組呈現情緒傾向、高頻問題和選題靈感。在寫下一條腳本之前，先知道觀眾想要什麼。', 'zh-TW', 0, 'published', 1708603200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-en', '100,000+ users — your results, our favorite metric', 'More than 100,000 creators, agencies and sourcing teams now use AI TikTok Downloader Pro. From this spring’s user stories: teams pairing rankings with comment analysis to pick topics report campaigns earning over 3× their usual revenue, and solo creators describe finally reaching the right audience instead of chasing raw views. Thank you — milestones like this belong to you.', 'en', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-es', 'Más de 100.000 usuarios — sus resultados, nuestra métrica favorita', 'Más de 100.000 creadores, agencias y equipos de sourcing ya usan AI TikTok Downloader Pro. De las historias de esta primavera: equipos que combinan rankings con análisis de comentarios para elegir temas reportan campañas con más de 3 veces sus ingresos habituales, y creadores independientes cuentan que por fin llegan a la audiencia correcta en vez de perseguir vistas. Gracias: hitos como este son de ustedes.', 'es', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-id', '100.000+ pengguna — hasil kalian adalah metrik favorit kami', 'Kini lebih dari 100.000 kreator, agensi, dan tim sourcing memakai AI TikTok Downloader Pro. Dari kisah pengguna musim semi ini: tim yang memadukan peringkat dengan analisis komentar untuk memilih topik melaporkan kampanye dengan pendapatan lebih dari 3 kali lipat biasanya, dan kreator solo bercerita akhirnya menjangkau penonton yang tepat alih-alih mengejar views. Terima kasih — tonggak seperti ini milik kalian.', 'id', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-ja', '10万人突破——皆さんの成果こそ、私たちの一番の指標', '現在、100,000を超えるクリエイター・代理店・ソーシングチームが AI TikTok Downloader Pro を使っています。この春のユーザーストーリーでは、ランキングとコメント分析を組み合わせてテーマを選定したチームが、通常の3倍超の売上をキャンペーンで達成。個人クリエイターからも「再生数を追いかけるのではなく、ようやく正しいオーディエンスに届くようになった」との声が届いています。ありがとうございます——この節目は皆さんのものです。', 'ja', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-ko', '10만+ 사용자 — 여러분의 성과가 우리의 최고 지표입니다', '이제 100,000명이 넘는 크리에이터, 에이전시, 소싱 팀이 AI TikTok Downloader Pro를 사용합니다. 올봄 사용자 사례에서는 랭킹과 댓글 분석을 결합해 주제를 고른 팀이 평소의 3배가 넘는 수익을 캠페인에서 기록했고, 개인 크리에이터들은 조회수만 좇는 대신 마침내 맞는 시청자에게 닿게 되었다고 이야기합니다. 감사합니다 — 이런 이정표는 여러분의 것입니다.', 'ko', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-pt', 'Mais de 100.000 usuários — os resultados de vocês, nossa métrica favorita', 'Mais de 100.000 criadores, agências e equipes de sourcing já usam o AI TikTok Downloader Pro. Das histórias desta primavera: equipes que combinam rankings com análise de comentários para escolher temas relatam campanhas rendendo mais de 3 vezes a receita habitual, e criadores solo contam que finalmente alcançam o público certo em vez de caçar views. Obrigado — marcos assim pertencem a vocês.', 'pt', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-vi', 'Hơn 100.000 người dùng — thành quả của các bạn là chỉ số chúng tôi quý nhất', 'Hiện đã có hơn 100.000 nhà sáng tạo, agency và đội ngũ tìm nguồn hàng dùng AI TikTok Downloader Pro. Từ các câu chuyện người dùng mùa xuân này: những đội kết hợp bảng xếp hạng với phân tích bình luận để chọn chủ đề báo cáo chiến dịch đạt doanh thu hơn 3 lần bình thường; các nhà sáng tạo cá nhân kể rằng cuối cùng đã chạm đúng khán giả thay vì chạy theo lượt xem. Cảm ơn các bạn — cột mốc này thuộc về các bạn.', 'vi', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-zh-CN', '10 万+ 用户——你们的成果，是我们最在意的指标', '如今已有超过 100,000 名创作者、机构和选品团队在使用 AI TikTok Downloader Pro。今春的用户故事里：有团队用榜单+评论分析选题，营销活动的收益做到平时的 3 倍以上；也有个人创作者说，终于触达了对的观众，而不是空刷播放量。谢谢你们——这样的里程碑属于你们。', 'zh-CN', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-06-100k-zh-TW', '10 萬+ 用戶——你們的成果，是我們最在意的指標', '如今已有超過 100,000 名創作者、機構和選品團隊在使用 AI TikTok Downloader Pro。今春的用戶故事裡：有團隊用榜單+評論分析選題，行銷活動的收益做到平時的 3 倍以上；也有個人創作者說，終於觸達了對的觀眾，而不是空刷播放量。謝謝你們——這樣的里程碑屬於你們。', 'zh-TW', 0, 'published', 1718884800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-en', 'v4.0 — Batch task center & exports', 'Long-running work now lives in a task center: queue hundreds of downloads, transcripts or analyses and let them finish in the background. Export any table or report to CSV or Markdown for decks and client reviews.', 'en', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-es', 'v4.0 — Centro de tareas por lotes y exportación', 'El trabajo largo ahora vive en un centro de tareas: pon en cola cientos de descargas, transcripciones o análisis y deja que terminen en segundo plano. Exporta cualquier tabla o informe a CSV o Markdown para presentaciones y revisiones con clientes.', 'es', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-id', 'v4.0 — Pusat tugas batch & ekspor', 'Pekerjaan panjang kini tinggal di pusat tugas: antrekan ratusan unduhan, transkrip, atau analisis dan biarkan selesai di latar belakang. Ekspor tabel atau laporan apa pun ke CSV atau Markdown untuk presentasi dan tinjauan klien.', 'id', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-ja', 'v4.0 — バッチタスクセンターとエクスポート', '時間のかかる処理はタスクセンターへ。数百件のダウンロード・文字起こし・分析をキューに入れれば、バックグラウンドで完了します。表やレポートは CSV / Markdown でエクスポートでき、資料作成やクライアント確認にそのまま使えます。', 'ja', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-ko', 'v4.0 — 배치 작업 센터와 내보내기', '오래 걸리는 작업은 이제 작업 센터에서: 수백 건의 다운로드·전사·분석을 대기열에 넣고 백그라운드에서 끝나게 두세요. 모든 표와 리포트를 CSV나 Markdown으로 내보내 발표 자료와 클라이언트 검토에 바로 쓸 수 있습니다.', 'ko', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-pt', 'v4.0 — Central de tarefas em lote e exportação', 'Trabalhos demorados agora moram numa central de tarefas: enfileire centenas de downloads, transcrições ou análises e deixe terminarem em segundo plano. Exporte qualquer tabela ou relatório em CSV ou Markdown para decks e revisões com clientes.', 'pt', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-vi', 'v4.0 — Trung tâm nhiệm vụ hàng loạt & xuất dữ liệu', 'Các việc chạy lâu giờ nằm trong trung tâm nhiệm vụ: xếp hàng trăm lượt tải, chép lời hay phân tích vào hàng đợi và để chúng tự hoàn thành ở chế độ nền. Xuất mọi bảng và báo cáo ra CSV hoặc Markdown cho thuyết trình và duyệt với khách hàng.', 'vi', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-zh-CN', 'v4.0 — 批量任务中心与导出', '耗时的活儿现在都住进任务中心：几百个下载、转录、分析任务排进队列，后台自己跑完。任何表格和报告都能导出 CSV 或 Markdown，做汇报、给客户过目都方便。', 'zh-CN', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2024-11-v4-0-zh-TW', 'v4.0 — 批量任務中心與匯出', '耗時的活兒現在都住進任務中心：幾百個下載、轉錄、分析任務排進佇列，後台自己跑完。任何表格和報告都能匯出 CSV 或 Markdown，做簡報、給客戶過目都方便。', 'zh-TW', 0, 'published', 1730980800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-en', 'v4.5 — Campaign planner', 'A built-in content calendar turns briefs into scheduled plans: assign scripts to dates, track publishing status and keep a whole campaign visible on one board.', 'en', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-es', 'v4.5 — Calendario de marketing', 'Un calendario de contenido integrado convierte los briefs en planes programados: asigna guiones a fechas, sigue el estado de publicación y mantén toda la campaña visible en un solo tablero.', 'es', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-id', 'v4.5 — Kalender pemasaran', 'Kalender konten bawaan mengubah brief menjadi rencana terjadwal: pasang skrip ke tanggal, pantau status publikasi, dan lihat seluruh kampanye dalam satu papan.', 'id', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-ja', 'v4.5 — マーケティングカレンダー', '内蔵のコンテンツカレンダーが、ブリーフをそのまま配信計画に。台本を日付に割り当て、公開ステータスを追跡し、キャンペーン全体をひとつのボードで見渡せます。', 'ja', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-ko', 'v4.5 — 마케팅 캘린더', '내장 콘텐츠 캘린더가 브리프를 일정으로 바꿉니다. 스크립트를 날짜에 배정하고 게시 상태를 추적하며 캠페인 전체를 한 보드에서 한눈에 보세요.', 'ko', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-pt', 'v4.5 — Calendário de marketing', 'Um calendário de conteúdo integrado transforma briefings em planos agendados: atribua roteiros a datas, acompanhe o status de publicação e mantenha a campanha inteira visível num só quadro.', 'pt', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-vi', 'v4.5 — Lịch marketing', 'Lịch nội dung tích hợp biến bản tóm tắt thành kế hoạch có lịch trình: gán kịch bản vào ngày, theo dõi trạng thái đăng và nhìn toàn bộ chiến dịch trên một bảng.', 'vi', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-zh-CN', 'v4.5 — 营销日历', '内置内容日历，把简报变成排期：脚本挂到日期上，发布状态随时可追，整个营销活动一屏尽览。', 'zh-CN', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-03-v4-5-zh-TW', 'v4.5 — 行銷日曆', '內建內容日曆，把簡報變成排期：腳本掛到日期上，發布狀態隨時可追，整個行銷活動在一個看板上一目瞭然。', 'zh-TW', 0, 'published', 1741867200);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-en', 'v5.0 — Sign in with Google & sync', 'One-tap Google sign-in, with your quota, library and plans synced across devices. Also new: an in-app feedback form and a WhatsApp support line — talk to us anytime.', 'en', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-es', 'v5.0 — Inicio de sesión con Google y sincronización', 'Inicio de sesión con Google de un toque, con tu cuota, biblioteca y planes sincronizados entre dispositivos. También nuevo: formulario de comentarios dentro de la app y línea de soporte por WhatsApp — háblanos cuando quieras.', 'es', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-id', 'v5.0 — Masuk dengan Google & sinkronisasi', 'Masuk dengan Google sekali ketuk, dengan kuota, pustaka, dan rencana tersinkron di semua perangkat. Juga baru: formulir masukan dalam aplikasi dan jalur dukungan WhatsApp — hubungi kami kapan saja.', 'id', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-ja', 'v5.0 — Googleログインとマルチデバイス同期', 'ワンタップのGoogleログインに対応。クォータ・ライブラリ・プランがデバイス間で同期されます。さらに、アプリ内フィードバックフォームとWhatsAppサポート窓口も新設——いつでもご連絡ください。', 'ja', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-ko', 'v5.0 — Google 로그인과 기기 간 동기화', '원탭 Google 로그인을 지원합니다. 사용량, 라이브러리, 플랜이 기기 간에 동기화됩니다. 또한 앱 내 피드백 양식과 WhatsApp 지원 창구가 새로 생겼습니다. 언제든 말을 걸어 주세요.', 'ko', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-pt', 'v5.0 — Login com Google e sincronização', 'Login com Google em um toque, com sua cota, biblioteca e planos sincronizados entre dispositivos. Também novo: formulário de feedback no app e canal de suporte via WhatsApp — fale com a gente quando quiser.', 'pt', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-vi', 'v5.0 — Đăng nhập Google & đồng bộ đa thiết bị', 'Đăng nhập Google một chạm, với hạn mức, thư viện và kế hoạch được đồng bộ giữa các thiết bị. Cũng mới: biểu mẫu góp ý trong ứng dụng và kênh hỗ trợ WhatsApp — liên hệ chúng tôi bất cứ lúc nào.', 'vi', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-zh-CN', 'v5.0 — Google 登录与多端同步', 'Google 一键登录，额度、素材库和计划在多设备间同步。还有两个新入口：应用内反馈表单和 WhatsApp 支持热线——随时找得到我们。', 'zh-CN', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-07-v5-0-zh-TW', 'v5.0 — Google 登入與多端同步', 'Google 一鍵登入，額度、素材庫和計畫在多裝置間同步。還有兩個新入口：應用內回饋表單和 WhatsApp 支援熱線——隨時找得到我們。', 'zh-TW', 0, 'published', 1752148800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-en', 'v5.5 — Smarter creator search', 'Search creators by keyword, niche and region with fresher data behind every card. Shortlists now save to your account and export cleanly.', 'en', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-es', 'v5.5 — Búsqueda de creadores más inteligente', 'Busca creadores por palabra clave, nicho y región, con datos más frescos detrás de cada tarjeta. Las listas de candidatos ahora se guardan en tu cuenta y se exportan sin problemas.', 'es', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-id', 'v5.5 — Pencarian kreator yang lebih pintar', 'Cari kreator berdasarkan kata kunci, ceruk, dan wilayah dengan data yang lebih segar di balik setiap kartu. Daftar kandidat kini tersimpan di akunmu dan bisa diekspor dengan rapi.', 'id', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-ja', 'v5.5 — さらに賢いクリエイター検索', 'キーワード・ジャンル・地域でクリエイターを検索。カードの裏側のデータはより新鮮に。候補リストはアカウントに保存され、きれいにエクスポートできます。', 'ja', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-ko', 'v5.5 — 더 똑똑해진 크리에이터 검색', '키워드, 분야, 지역으로 크리에이터를 검색하세요. 모든 카드 뒤의 데이터가 더 신선해졌습니다. 후보 목록은 계정에 저장되고 깔끔하게 내보낼 수 있습니다.', 'ko', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-pt', 'v5.5 — Busca de criadores mais inteligente', 'Busque criadores por palavra-chave, nicho e região, com dados mais frescos por trás de cada card. As shortlists agora ficam salvas na sua conta e podem ser exportadas facilmente.', 'pt', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-vi', 'v5.5 — Tìm KOL thông minh hơn', 'Tìm nhà sáng tạo theo từ khóa, ngách và khu vực, với dữ liệu mới hơn sau mỗi thẻ. Danh sách rút gọn giờ lưu vào tài khoản và xuất ra gọn gàng.', 'vi', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-zh-CN', 'v5.5 — 更聪明的找达人', '按关键词、赛道、地区搜索达人，每张卡片背后的数据都更新鲜。候选名单可存进账号，导出也更干净。', 'zh-CN', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2025-11-v5-5-zh-TW', 'v5.5 — 更聰明的找達人', '按關鍵字、賽道、地區搜尋達人，每張卡片背後的數據都更新鮮。候選名單可存進帳號，匯出也更乾淨。', 'zh-TW', 0, 'published', 1763640000);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-en', 'v6.0 — A faster workbench', 'Rebuilt workbench UI: quicker navigation, clearer creator pages and AI responses that stream in noticeably faster. Plus dozens of small fixes straight from your feedback reports.', 'en', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-es', 'v6.0 — Un workbench más rápido', 'Interfaz del workbench reconstruida: navegación más ágil, páginas de creador más claras y respuestas de IA que llegan notablemente más rápido. Además, decenas de pequeños arreglos salidos directamente de sus reportes.', 'es', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-id', 'v6.0 — Workbench yang lebih cepat', 'UI workbench dibangun ulang: navigasi lebih gesit, halaman kreator lebih jelas, dan respons AI mengalir terasa lebih cepat. Ditambah puluhan perbaikan kecil langsung dari laporan masukan kalian.', 'id', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-ja', 'v6.0 — さらに速いワークベンチ', 'ワークベンチのUIを再構築。ナビゲーションは素早く、クリエイターページは見やすく、AIの応答は体感できるほど速くストリーミングされます。皆さんのフィードバックに基づく数十件の小さな修正も。', 'ja', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-ko', 'v6.0 — 더 빨라진 워크벤치', '워크벤치 UI를 재구축했습니다. 내비게이션은 더 빠르게, 크리에이터 페이지는 더 명확하게, AI 응답 스트리밍은 눈에 띄게 빨라졌습니다. 여러분의 피드백에서 나온 수십 가지 소소한 수정도 함께입니다.', 'ko', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-pt', 'v6.0 — Um workbench mais rápido', 'Interface do workbench reconstruída: navegação mais ágil, páginas de criador mais claras e respostas de IA que chegam visivelmente mais rápido. E mais dezenas de pequenos ajustes vindos direto dos seus relatos.', 'pt', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-vi', 'v6.0 — Bàn làm việc nhanh hơn', 'Giao diện bàn làm việc được xây lại: điều hướng nhanh hơn, trang nhà sáng tạo rõ ràng hơn, phản hồi AI truyền về nhanh thấy rõ. Kèm hàng chục sửa lỗi nhỏ đến thẳng từ báo cáo góp ý của các bạn.', 'vi', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-zh-CN', 'v6.0 — 更快的工作台', '重构的工作台界面：导航更快，达人页面更清晰，AI 回复的流式输出明显提速。另有几十处小修复，全部来自你们的反馈报告。', 'zh-CN', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-03-v6-0-zh-TW', 'v6.0 — 更快的工作台', '重構的工作台介面：導航更快，達人頁面更清晰，AI 回覆的串流輸出明顯提速。另有幾十處小修復，全部來自你們的回饋報告。', 'zh-TW', 0, 'published', 1773316800);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-en', 'v6.4 — One workflow, every angle', 'Research, download, transcribe, brief, plan and export — one connected workflow, and this release polishes every step of it: a refreshed showcase, steadier batch queues and sharper AI briefs. Six years and 100,000+ users in: thank you for building alongside us.', 'en', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-es', 'v6.4 — Un flujo de trabajo, todos los ángulos', 'Investigar, descargar, transcribir, resumir, planificar y exportar: un flujo de trabajo conectado, y esta versión pule cada paso: galería renovada, colas por lotes más estables y briefs de IA más afinados. Seis años y más de 100.000 usuarios después: gracias por construir con nosotros.', 'es', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-id', 'v6.4 — Satu alur kerja, semua sudut', 'Riset, unduh, transkrip, brief, rencana, dan ekspor — satu alur kerja yang terhubung, dan rilis ini memoles setiap langkahnya: galeri yang diperbarui, antrean batch yang lebih stabil, dan brief AI yang lebih tajam. Enam tahun dan 100.000+ pengguna kemudian: terima kasih telah membangun bersama kami.', 'id', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-ja', 'v6.4 — ひとつのワークフローで、あらゆる角度から', 'リサーチ、ダウンロード、文字起こし、ブリーフ、プランニング、エクスポート——つながったひとつのワークフロー。今回のリリースではその全工程を磨き直しました：ショーケースを刷新し、バッチキューはより安定、AIブリーフはより鋭く。6年間、10万人超のユーザーの皆さん：共に作ってくれてありがとうございます。', 'ja', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-ko', 'v6.4 — 하나의 워크플로, 모든 각도', '리서치, 다운로드, 전사, 브리프, 계획, 내보내기 — 하나로 이어진 워크플로. 이번 릴리스는 그 모든 단계를 다듬었습니다. 쇼케이스를 새 단장하고, 배치 대기열은 더 안정적으로, AI 브리프는 더 날카롭게. 6년, 100,000+ 사용자: 함께 만들어 주셔서 감사합니다.', 'ko', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-pt', 'v6.4 — Um fluxo de trabalho, todos os ângulos', 'Pesquisar, baixar, transcrever, resumir, planejar e exportar — um fluxo de trabalho conectado, e esta versão lapida cada etapa: vitrine renovada, filas em lote mais estáveis e briefings de IA mais afiados. Seis anos e mais de 100.000 usuários depois: obrigado por construir junto com a gente.', 'pt', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-vi', 'v6.4 — Một quy trình, đủ mọi góc nhìn', 'Nghiên cứu, tải về, chép lời, tóm tắt, lên kế hoạch và xuất dữ liệu — một quy trình liền mạch, và bản phát hành này đánh bóng từng bước: gian trưng bày mới, hàng đợi hàng loạt ổn định hơn, bản tóm tắt AI sắc nét hơn. Sáu năm và hơn 100.000 người dùng: cảm ơn các bạn đã đồng hành xây dựng cùng chúng tôi.', 'vi', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-zh-CN', 'v6.4 — 一条工作流，看全每个角度', '研究、下载、转录、简报、排期、导出——一条连贯的工作流，这个版本把每一步都打磨了一遍：展示画廊焕新，批量队列更稳，AI 简报更锐利。六年、10 万+ 用户：谢谢你们一路同行。', 'zh-CN', 1, 'published', 1786017600);
INSERT OR IGNORE INTO announcements (id, title, body, lang, pinned, status, created_at)
  VALUES ('ann-2026-08-v6-4-zh-TW', 'v6.4 — 一條工作流，看全每個角度', '研究、下載、轉錄、簡報、排期、匯出——一條連貫的工作流，這個版本把每一步都打磨了一遍：展示畫廊煥新，批量佇列更穩，AI 簡報更銳利。六年、10 萬+ 用戶：謝謝你們一路同行。', 'zh-TW', 1, 'published', 1786017600);
