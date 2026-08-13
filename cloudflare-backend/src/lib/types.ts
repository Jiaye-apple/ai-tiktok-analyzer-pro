export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  /** Cloudflare Workers AI。AI_PROVIDER=workers-ai 时用它 */
  AI?: Ai;
  /**
   * 相似达人的向量库。索引 kolsprite-creators，1024 维 / cosine（bge-m3 的输出维度）。
   * 可选：本地 dev 的 wrangler.dev.jsonc / wrangler.local.jsonc 没绑它，
   * 所有用到的地方都要先判空再走降级，不能默认它存在。
   *
   * 类型用 Vectorize 而不是 VectorizeIndex —— 后者是 V1 的旧类型，
   * 没有 queryById（用已有向量 ID 直接查相似，正是相似达人要用的那个方法）。
   */
  VECTORIZE?: Vectorize;
  /** 离线任务队列（kolsprite-jobs）。同上，本地没绑，用之前判空。 */
  JOBS?: Queue<unknown>;

  ENVIRONMENT: string;
  TOKEN_TTL_DAYS: string;
  PUBLIC_SITE_URL: string;

  // --- AI / 语音供应商链，逗号分隔，按顺序降级。见 lib/providers.ts ---
  /** 默认 groq,siliconflow,workers-ai */
  AI_CHAIN?: string;
  /** 默认 groq,siliconflow,workers-ai */
  ASR_CHAIN?: string;

  // Groq：首选。Whisper 返回真实时间戳，字幕功能靠它
  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  GROQ_CHAT_MODEL?: string;
  GROQ_ASR_MODEL?: string;

  // 硅基流动：免费兜底。ASR 只返回纯文本，没有时间戳
  SILICONFLOW_API_KEY?: string;
  SILICONFLOW_BASE_URL?: string;
  SILICONFLOW_CHAT_MODEL?: string;
  SILICONFLOW_ASR_MODEL?: string;
  SILICONFLOW_ASR_MODEL_FALLBACK?: string;

  // Workers AI：最后一道保险，不用出网也不用 key
  WORKERS_AI_CHAT_MODEL?: string;
  WORKERS_AI_ASR_MODEL?: string;

  // TikTok 视频无水印直链解析服务（自建，配了就优先走它）
  TIKTOK_PROXY_URL?: string;
  TIKTOK_PROXY_KEY?: string;
  /** 解析供应商链，逗号分隔按序降级。默认 tikwm,kolsprite。见 lib/tiktok-resolver.ts */
  TK_CHAIN?: string;
  /** tikwm 接口地址，换自建镜像时用 */
  TIKWM_API_URL?: string;
  /**
   * tikwm 付费档的 key（`wrangler secret put TIKWM_API_KEY`）。
   *
   * 不配就是免费档：每秒 1 次 + **每天 10000 次**，而且日额度是按出口 IP 算的。
   * Cloudflare Workers 的边缘出口是共享 IP，实测线上经常直接拿到
   * "Free Api Limit: 10000 request/ 1 day."，本机直连却完全正常 ——
   * 额度在我们用之前就被同一批 IP 上的其他人烧光了。
   * 这是目前视频解析在生产上最主要的失败原因。
   */
  TIKWM_API_KEY?: string;

  /**
   * 达人库灌库用的搜索词，逗号分隔。相似达人的候选池全靠它撑起来。
   *
   * 冷启动阶段自有回流只有几十个达人，搜不出东西。这些词会被
   * seed_creators 任务拿去 tikwm 搜视频，再反查作者资料入库。
   * 想主攻哪个市场就换成那个市场的词（印尼语/泰语/越南语效果最好）。
   */
  SEED_KEYWORDS?: string;
  /** 只保留这些地区的达人，逗号分隔（如 ID,TH,VN,MY,PH）。留空则不限。 */
  SEED_REGIONS?: string;
  /** 原站匿名解析接口地址，上游换域名时用它覆盖 */
  TIKTOK_UPSTREAM_URL?: string;

  JWT_SECRET: string;
  ADMIN_KEY?: string;

  /**
   * 邮件建联的收信域名（如 kolmail.poviai.com）。
   * 发信时 Reply-To 指到 reply+{threadId}@<MAIL_DOMAIN>（plus addressing），
   * Cloudflare Email Routing 的一条 `reply@<MAIL_DOMAIN>` 规则把来信投给本 Worker
   * 的 email() handler（src/lib/mail-inbound.ts）归线程入库。不配则回信无法回流。
   */
  MAIL_DOMAIN?: string;

  // --- Creem 支付（https://docs.creem.io）。见 lib/creem.ts ---
  /** dashboard → Developers → API keys。不配则支付入口一律返回「支付服务未配置」 */
  CREEM_API_KEY?: string;
  /** dashboard → Developers → Webhooks 里那个 whsec_ 开头的 secret */
  CREEM_WEBHOOK_SECRET?: string;
  /** '1' 走 test-api.creem.io（测试模式的 key 只能打测试域） */
  CREEM_TEST_MODE?: string;
  /**
   * 商品映射 JSON：{"plus_month":"prod_xxx", "addon_credits":"prod_yyy", ...}
   * key 是 plans.code / billing_addons.code，value 是 Creem 后台建好的 product id。
   * 没映射的商品在 /price 页可见但按钮不可点。
   */
  CREEM_PRODUCTS?: string;

  // --- Waffo Pancake 支付（https://docs.waffo.ai）。见 lib/waffo.ts ---
  /**
   * 支付渠道开关：'waffo' 走 Waffo Pancake，其它值（含不配）走 Creem。
   * 切换只影响新建的结账会话；两边的 webhook 路由都常开，老订单照样能收到回调。
   */
  PAY_PROVIDER?: string;
  /** Settings → General → Store Slug，如 subscribe-rf912bic */
  WAFFO_STORE_SLUG?: string;
  /** API & Development → Merchant ID，形如 MER_xxx。配了它和私钥就走签名认证 */
  WAFFO_MERCHANT_ID?: string;
  /** 创建 API Key 时下载的 RSA 私钥（PKCS#8，PEM 或裸 base64 都行） */
  WAFFO_PRIVATE_KEY?: string;
  /** 'live' | 'test'，决定事件环境，也决定该用哪把公钥。默认 live */
  WAFFO_ENV?: string;
  /** 覆盖 API 域名，默认 https://api.waffo.ai */
  WAFFO_API_BASE?: string;
  /** Settings → Webhooks 里的 Public Key（裸 base64 SPKI），用来验 webhook 签名 */
  WAFFO_WEBHOOK_PUBLIC_KEY?: string;
  /**
   * 商品映射 JSON：{"plus_month":"PROD_xxx", "addon_credits":"PROD_yyy", ...}
   * key 同 CREEM_PRODUCTS，value 换成 Waffo 后台的 PROD_ 开头 id。
   */
  WAFFO_PRODUCTS?: string;
  /**
   * 托管收银台直链映射：{"plus_month":"https://checkout.waffo.ai/<store>/<product>", ...}
   * 没有 API 私钥时用它兜底 —— 直链零认证，缺点是带不了我们的订单号，
   * webhook 回来要靠 buyerEmail + 商品反查 pending 订单。
   */
  WAFFO_PAYMENT_LINKS?: string;

  // --- Google 登录（GCP 项目 poviai-kol）。见 lib/google-oauth.ts ---
  /**
   * OAuth 2.0 Web 客户端 ID，形如 <数字>-<串>.apps.googleusercontent.com。
   * 不配则登录页不显示「用 Google 继续」按钮，/kol/exlogin/google 直接 404 语义的报错页。
   */
  GOOGLE_CLIENT_ID?: string;
  /**
   * 对应的 client secret（GOCSPX- 开头）。只能在 Worker 里用，绝不能出现在页面上。
   * 用 `wrangler secret put GOOGLE_CLIENT_SECRET` 写，别塞进 wrangler.jsonc 的 vars。
   */
  GOOGLE_CLIENT_SECRET?: string;
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  head_url: string | null;
  plan_code: string;
  plan_expire_at: number | null;
  status: string;
  created_at: number;
  updated_at: number;
  // 0003_auth.sql 加的，官网自助登录用
  password_hash?: string | null;
  password_salt?: string | null;
  last_login_at?: number | null;
  // 0014_google_login.sql 加的，谷歌账号的稳定标识（改邮箱也不变）
  google_sub?: string | null;
}

/** GET /v1/plugin/user/detail 的 data 部分。字段名不能改，扩展直接读。 */
export interface UserProfile {
  id: string;
  username: string;
  headUrl: string;
  email: string | null;
  phone: string | null;
  /** 扩展用它算 LV：含 plus -> P，含 pro 或 = standard -> V，其它 -> F */
  planCode: string;
  planName: string;
  planExpireAt: number | null;
  /** 后端也直接给一份，省得前端算错 */
  LV: 'F' | 'P' | 'V';
  status: string;
  createdAt: number;
}

export interface QuotaState {
  total: number;
  used: number;
  available: number;
  points: number;
  period: string;
}

export type QuotaType =
  | 'ExcelExport'
  | 'VideoBatchDownload'
  | 'VideoScript'
  | 'SeaProductVideo'
  | 'FindKol'
  | 'VideoReview'
  | 'Points';

/** 通用积分池。它不是一个功能，是所有功能共享的余额。 */
export const POINTS = 'Points';

export const QUOTA_TYPES: QuotaType[] = [
  'ExcelExport',
  'VideoBatchDownload',
  'VideoScript',
  'SeaProductVideo',
  'FindKol',
  'VideoReview',
  'Points',
];
