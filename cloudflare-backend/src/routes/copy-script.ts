import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { AINotConfiguredError, chat } from '../lib/ai';
import { mdToHtml } from '../lib/md';
import {
  analyzeStructurePrompt,
  highlightsPrompt,
  rewriteDirectPrompt,
  rewriteTargetFieldPrompt,
  summarizePrompt,
} from '../lib/prompts';
import { bumpDailyOnly } from '../lib/quota';
import { currentLang, langName } from '../lib/i18n';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/** 路由处理函数里的 context 类型，抽出来给下面的辅助函数复用。 */
type Ctx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;

r.use('*', requireAuth);

/**
 * AI 文案四件套。四个接口的 body 完全一致：
 *   { caption, creatorId, outputLanguage, region, subtitle, videoId }
 * rewrite 多两个字段：rewriteMode ("direct" | "target_field")、targetField
 *
 * 响应 data 是渲染好的 HTML（模型输出 Markdown，这里过 mdToHtml 转换）——
 * 前端拿到后直接 dangerouslySetInnerHTML，给裸 Markdown 会显示成满屏星号。
 *
 * 注意：这几个接口前端**没有走配额**（VideoScript 配额是在拉字幕那一步扣的），
 * 所以这里不要再扣一次，否则用户会觉得次数掉得莫名其妙。
 *
 * 但「不扣配额」≠「不设防」：这是裸的 LLM 出口，直连 API 能白嫖。
 * 按套餐给日上限（quota_daily_limits 的 AiCopy 行：免费 40 / Plus 200 / Pro 800，
 * 是脚本日上限的 4 倍 —— 每条脚本约 4 次 AI 操作，正常用完全碰不到）。
 */

interface ScriptBody {
  caption?: string;
  creatorId?: string;
  outputLanguage?: string;
  region?: string;
  subtitle?: string;
  videoId?: string;
  rewriteMode?: 'direct' | 'target_field';
  targetField?: string;
}

async function readBody(c: { req: { json: <T>() => Promise<T> } }): Promise<ScriptBody> {
  return c.req.json<ScriptBody>().catch(() => ({}) as ScriptBody);
}

function validate(b: ScriptBody): string | null {
  if (!b.subtitle || !b.subtitle.trim()) return '缺少字幕内容';
  return null;
}

async function run(
  c: Ctx,
  build: (lang: string, title: string, subtitle: string, b: ScriptBody) => string,
) {
  const b = await readBody(c);
  const err = validate(b);
  if (err) return fail(ERR.PARAM, err);

  const gate = await bumpDailyOnly(c.env, currentUser(c), 'AiCopy');
  if (gate.exceeded) {
    return fail(ERR.QUOTA_EXHAUSTED, '今日 AI 生成次数已达上限，请明天再试或升级套餐');
  }

  // 不传输出语言就跟请求的界面语言走（lang 头），缺省是英文。
  // 以前这里写死 'zh-CN'，美国用户直连 API 会拿到一份中文分析 —— 不能默认中文。
  const lang = b.outputLanguage || langName(currentLang());
  const title = b.caption || '';
  const prompt = build(lang, title, b.subtitle!, b);

  try {
    // 字幕可能很长，给足输出长度；温度略低一点，脚本分析要稳定
    const text = await chat(c.env, prompt, { temperature: 0.6, maxTokens: 4096 });

    // 留一条使用记录，方便统计和排查。失败不影响返回。
    c.env.DB.prepare(
      `INSERT INTO async_tasks (task_id, user_id, type, status, creator_id, video_id, input, result)
       VALUES (?1, ?2, 'copy_script', 'success', ?3, ?4, ?5, ?6)`,
    )
      .bind(
        crypto.randomUUID(),
        currentUser(c).id,
        b.creatorId ?? null,
        b.videoId ?? null,
        JSON.stringify({ mode: c.req.path.split('/').pop(), lang, region: b.region }),
        text.slice(0, 20000),
      )
      .run()
      .catch(() => {});

    return ok(mdToHtml(text));
  } catch (e) {
    if (e instanceof AINotConfiguredError) {
      return fail(ERR.NOT_IMPLEMENTED, e.message);
    }
    console.error('copy-script failed', e);
    return fail(ERR.INTERNAL, e instanceof Error ? e.message : 'AI 处理失败');
  }
}

/** 提炼亮点 —— 对应前端菜单「总结内容和亮点」 */
r.post('/highlights', (c) => run(c, (l, t, s) => highlightsPrompt(l, t, s)));

/** 分章节总结 —— 对应「按章节总结」 */
r.post('/summarize', (c) => run(c, (l, t, s) => summarizePrompt(l, t, s)));

/** 拆解脚本结构 —— 对应「分析视频脚本结构」 */
r.post('/analyze-structure', (c) => run(c, (l, t, s) => analyzeStructurePrompt(l, t, s)));

/**
 * 仿写 —— 对应「AI 仿写脚本」。
 * rewriteMode 决定用哪个 prompt：
 *   direct        原样仿写
 *   target_field  换成 targetField 指定的行业
 */
r.post('/rewrite', (c) =>
  run(c, (l, t, s, b) =>
    b.rewriteMode === 'target_field' && b.targetField
      ? rewriteTargetFieldPrompt(l, t, s, b.targetField)
      : rewriteDirectPrompt(l, t, s),
  ),
);

export default r;
