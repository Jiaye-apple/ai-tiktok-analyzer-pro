import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { ERR, fail, ok } from '../lib/response';
import { readJson } from '../lib/req';
import { uuid } from '../lib/auth';
import { AINotConfiguredError, chat, parseJsonLoose } from '../lib/ai';
import { REVIEW_ANALYSIS_PROMPT } from '../lib/review-prompt';
import { buildXlsx } from '../lib/xlsx';
import { consumeQuota, refundConsumed } from '../lib/quota';
import { currentLang, langName, parseLang } from '../lib/i18n';
import { currentUser, requireAuth } from '../middleware/require-auth';

const r = new Hono<{ Bindings: Env; Variables: { user: UserRow | null } }>();

/** 路由处理函数里的 context 类型，抽出来给下面的辅助函数复用。 */
type Ctx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;

// 这里**不能**写 r.use('*', requireAuth)。
// /result/:file 是给前端直接 fetch 的（index.html3.js:42247 那次 fetch 不带 Token），
// 一刀切加鉴权会让整个「AI 看懂评论区」拿不到结果 —— 而且前端只会一直转圈，
// 不会报错，很难查。所以逐个路由挂 requireAuth，公开的那条明确不挂。

/**
 * AI 看懂评论区。挂在 /v1/plugin/video/review 下。
 *
 * 前端流程（index.html3.js:42200-42320）：
 *   1. 进页面先查 /task/recent，命中就直接用旧结果
 *   2. 没有就 POST /analysis（或 /analysis/refresh 强制重算）拿 taskId
 *   3. 每 4 秒 GET /task/status?taskId=，直到 data.resultUrl 非空
 *   4. 前端**直接 fetch(resultUrl)** 取 JSON —— 所以这个 URL 必须公开可访问且带 CORS
 *   5. 组件卸载/失败时 GET /task/delete?taskId= 并 POST /quota/release
 */

interface ReviewItem {
  reviewId?: string;
  reviewDate?: number;
  likeCnt?: number;
  replyCnt?: number;
  content?: string;
  reviewCreatorId?: string;
  reviewHandleName?: string;
  reviewNickname?: string;
  commentLanguage?: string;
  authorPin?: boolean;
  isAuthorDigged?: boolean;
}

interface AnalysisBody {
  region?: string;
  creatorId?: string;
  handleName?: string;
  videoId?: string;
  productId?: string;
  reviewItemList?: ReviewItem[];
  /** 报告输出语言，形如 en-US / zh-CN。不传就用请求的界面语言，绝不默认中文。 */
  outputLanguage?: string;
}

/** 结果 JSON 存 R2，再拼出公开 URL 给前端直接 fetch。 */
function resultKey(taskId: string) {
  return `review/${taskId}.json`;
}

function resultUrlOf(env: Env, origin: string, taskId: string) {
  // 走 Worker 自己的公开读接口，不用给 R2 配公共域名，CORS 也好控制
  return `${origin}/v1/plugin/video/review/result/${taskId}.json`;
}

async function submit(
  c: Ctx,
  force: boolean,
): Promise<Response> {
  const user = currentUser(c);
  const body = await readJson<AnalysisBody>(c);
  const comments = body.reviewItemList ?? [];

  if (!body.videoId) return fail(ERR.PARAM, '缺少 videoId');
  if (!comments.length) return fail(ERR.PARAM, '没有可分析的评论');

  // 报告语言：前端选啥用啥，没选就跟请求的界面语言（lang 头）走。
  // parseLang 兜底是 en —— 这个产品面向海外用户，缺信息时宁可英文也不能中文。
  const langCode = body.outputLanguage ? parseLang(body.outputLanguage) : currentLang();

  // 非强制刷新时，先看有没有 24 小时内**同语言**的现成结果。
  // 老任务的 input 里没存 outputLanguage，json_extract 得 NULL 不会命中 ——
  // 正好：换了语言就该重跑，而不是把旧语言的报告端出来。
  if (!force) {
    const recent = await c.env.DB.prepare(
      `SELECT task_id FROM async_tasks
       WHERE user_id = ?1 AND type = 'video_review' AND video_id = ?2
         AND status = 'success' AND created_at > unixepoch() - 86400
         AND json_extract(input, '$.outputLanguage') = ?3
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(user.id, body.videoId, langCode)
      .first<{ task_id: string }>();
    if (recent) return ok(recent.task_id);
  }

  // 服务端硬扣：VideoReview 是纯点数驱动（20 点/次）。前端正常流程的预扣
  // 会在这里被核销；直连 API 的调用方在这里被当场扣费或拒绝。
  const consumed = await consumeQuota(c.env, user, 'VideoReview', 1);
  if (!consumed.ok) {
    return fail(
      ERR.QUOTA_EXHAUSTED,
      consumed.dailyExceeded
        ? '今日次数已达上限，请明天再试或升级套餐'
        : '本月额度已用完，请升级套餐或购买加油包',
    );
  }

  const taskId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO async_tasks (task_id, user_id, type, status, input, creator_id, video_id, quota_record_id)
     VALUES (?1, ?2, 'video_review', 'running', ?3, ?4, ?5, ?6)`,
  )
    .bind(
      taskId,
      user.id,
      JSON.stringify({
        region: body.region,
        handleName: body.handleName,
        productId: body.productId,
        outputLanguage: langCode,
      }),
      body.creatorId ?? null,
      body.videoId,
      consumed.recordId,
    )
    .run();

  // 分析放到后台跑，接口立刻返回 taskId，前端自己轮询。
  // 这样不受单次请求时长限制，也符合前端已有的交互。
  c.executionCtx.waitUntil(
    runAnalysis(c.env, taskId, comments, langName(langCode), {
      userId: user.id,
      recordId: consumed.recordId,
    }),
  );

  return ok(taskId);
}

r.post('/analysis', requireAuth, (c) => submit(c, false));
r.post('/analysis/refresh', requireAuth, (c) => submit(c, true));

/** GET /video/review/task/status?taskId= */
r.get('/task/status', requireAuth, async (c) => {
  const user = currentUser(c);
  const taskId = c.req.query('taskId') || '';
  if (!taskId) return fail(ERR.PARAM, '缺少 taskId');

  const task = await c.env.DB.prepare(
    `SELECT status, error, created_at, quota_record_id FROM async_tasks
     WHERE task_id = ?1 AND user_id = ?2 AND type = 'video_review'`,
  )
    .bind(taskId, user.id)
    .first<{ status: string; error: string | null; created_at: number; quota_record_id: string | null }>();

  if (!task) return fail(ERR.NOT_FOUND, '任务不存在');
  if (task.status === 'failed') return fail(ERR.INTERNAL, task.error || '分析失败');

  const origin = new URL(c.req.url).origin;
  return ok({
    // resultUrl 为空表示还没好，前端 4 秒后再来
    resultUrl: task.status === 'success' ? resultUrlOf(c.env, origin, taskId) : '',
    createdTime: task.created_at * 1000,
    userQuotaLogId: task.quota_record_id ?? '',
  });
});

/** GET /video/review/task/recent?creatorId=&videoId= */
r.get('/task/recent', requireAuth, async (c) => {
  const user = currentUser(c);
  const videoId = c.req.query('videoId') || '';
  if (!videoId) return fail(ERR.PARAM, '缺少 videoId');

  const task = await c.env.DB.prepare(
    `SELECT task_id, status, created_at, quota_record_id FROM async_tasks
     WHERE user_id = ?1 AND type = 'video_review' AND video_id = ?2 AND status = 'success'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.id, videoId)
    .first<{ task_id: string; created_at: number; quota_record_id: string | null }>();

  if (!task) return ok({ resultUrl: '', createdTime: 0, userQuotaLogId: '', taskId: '' });

  const origin = new URL(c.req.url).origin;
  return ok({
    resultUrl: resultUrlOf(c.env, origin, task.task_id),
    createdTime: task.created_at * 1000,
    userQuotaLogId: task.quota_record_id ?? '',
    taskId: task.task_id,
  });
});

/**
 * GET /video/review/task/delete?taskId=
 * 是的，删除用的是 GET —— 原后台就这么设计的，前端照这个调。
 */
r.get('/task/delete', requireAuth, async (c) => {
  const user = currentUser(c);
  const taskId = c.req.query('taskId') || '';
  if (taskId) {
    await c.env.DB.prepare(
      `DELETE FROM async_tasks WHERE task_id = ?1 AND user_id = ?2 AND type = 'video_review'`,
    )
      .bind(taskId, user.id)
      .run();
    await c.env.R2.delete(resultKey(taskId)).catch(() => {});
  }
  return ok(true);
});

/**
 * 结果 JSON 的公开读接口。前端拿到 resultUrl 后直接 fetch，
 * **不带 Token**，所以这条路由绝对不能加 requireAuth（taskId 是 uuid，猜不到）。
 * 冒烟测试里有一条专门盯着这个，别再加回去。
 */
r.get('/result/:file', async (c) => {
  const file = c.req.param('file');
  const taskId = file.replace(/\.json$/, '');
  const obj = await c.env.R2.get(resultKey(taskId));
  if (!obj) return fail(ERR.NOT_FOUND, '结果不存在或已过期', 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

/**
 * POST /video/review/excel
 *
 * 前端这条是**绕过统一请求层的裸 fetch**，手动拼 Content-Type / Token / X-Version / lang，
 * 期望拿到二进制 xlsx，文件名从 Content-Disposition 解析。
 * 返回 application/json 会被当成出错。
 */
r.post('/excel', requireAuth, async (c) => {
  const body = await readJson<{
    analysisData?: Record<string, { note?: string; items?: Array<Record<string, unknown>> }> & {
      summary?: string;
    };
    commentList?: ReviewItem[];
    videoInfo?: Record<string, unknown>;
  }>(c);

  const info = body.videoInfo ?? {};
  const analysis = body.analysisData ?? {};
  const comments = body.commentList ?? [];

  const sheets = [
    {
      name: '视频信息',
      rows: [
        ['字段', '值'],
        ...Object.entries(info).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ],
    },
    {
      name: '分析结果',
      rows: [
        ['分区', '说明', '条目', '提及数', '证据'],
        ...SECTIONS.flatMap((key) => {
          const sec = analysis[key];
          if (!sec?.items?.length) return [] as string[][];
          return sec.items.map((it) => [
            SECTION_LABELS[key],
            sec.note ?? '',
            itemTitle(it),
            String(it.mentions ?? ''),
            evidenceText(it),
          ]);
        }),
      ],
    },
    {
      name: '评论原文',
      rows: [
        ['评论ID', '昵称', '内容', '点赞', '回复', '语言', '时间'],
        ...comments
          .slice(0, 2000)
          .map((cm) => [
            cm.reviewId ?? '',
            cm.reviewNickname ?? cm.reviewHandleName ?? '',
            cm.content ?? '',
            String(cm.likeCnt ?? 0),
            String(cm.replyCnt ?? 0),
            cm.commentLanguage ?? '',
            cm.reviewDate ? new Date(Number(cm.reviewDate)).toISOString() : '',
          ]),
      ],
    },
  ];

  if (analysis.summary) {
    sheets.unshift({ name: '总览', rows: [['总结'], [String(analysis.summary)]] });
  }

  const xlsx = buildXlsx(sheets);
  const filename = `review_analysis_${info.videoId ?? Date.now()}.xlsx`;

  return new Response(xlsx, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 前端支持 filename*=utf-8'' 形式，中文名也能正确解析
      'Content-Disposition': `attachment; filename="${filename}"; filename*=utf-8''${encodeURIComponent(filename)}`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ---------------------------------------------------------------------------

const SECTIONS = [
  'discussion_topics',
  'pain_points',
  'scenarios_personas',
  'questions_demands',
  'comparisons',
] as const;

const SECTION_LABELS: Record<string, string> = {
  discussion_topics: '讨论话题',
  pain_points: '痛点',
  scenarios_personas: '场景与人群',
  questions_demands: '疑问与需求',
  comparisons: '对比',
};

function itemTitle(it: Record<string, unknown>): string {
  for (const k of ['name', 'point', 'question', 'demand', 'compared_to', 'angle', 'description', 'context']) {
    if (it[k]) return String(it[k]);
  }
  return '';
}

function evidenceText(it: Record<string, unknown>): string {
  const ev = it.evidence as Array<{ original?: string; translation?: string }> | undefined;
  if (!Array.isArray(ev)) return '';
  return ev
    .slice(0, 5)
    .map((e) => (e.translation ? `${e.original} / ${e.translation}` : e.original))
    .filter(Boolean)
    .join('\n');
}

/** 后台跑分析，结果写 R2，状态回写 D1。失败时把扣掉的配额退回去。 */
async function runAnalysis(
  env: Env,
  taskId: string,
  comments: ReviewItem[],
  outputLanguage: string,
  quota?: { userId: string; recordId: string | null },
): Promise<void> {
  try {
    // 前端已经按点赞数降序取了前 100 条，这里再截一次防止异常输入
    const list = comments.slice(0, 100).map((cm) => ({
      content: cm.content ?? '',
      likes: cm.likeCnt ?? 0,
      replies: cm.replyCnt ?? 0,
      nickname: cm.reviewNickname ?? '',
      language: cm.commentLanguage ?? '',
    }));

    const raw = await chat(env, REVIEW_ANALYSIS_PROMPT(JSON.stringify(list, null, 0), outputLanguage), {
      temperature: 0.4,
      maxTokens: 8192,
      json: true,
    });
    const parsed = parseJsonLoose<Record<string, unknown>>(raw);

    await env.R2.put(resultKey(taskId), JSON.stringify(parsed), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    await env.DB.prepare(
      `UPDATE async_tasks SET status = 'success', updated_at = unixepoch() WHERE task_id = ?1`,
    )
      .bind(taskId)
      .run();
  } catch (e) {
    const msg =
      e instanceof AINotConfiguredError
        ? e.message
        : e instanceof Error
          ? e.message
          : '分析失败';
    console.error('review analysis failed', taskId, e);
    await env.DB.prepare(
      `UPDATE async_tasks SET status = 'failed', error = ?2, updated_at = unixepoch()
       WHERE task_id = ?1`,
    )
      .bind(taskId, msg.slice(0, 500))
      .run();
    // 没出结果不收钱。committed 状态只有这里能退，前端重复 release 是无效的
    if (quota?.recordId) {
      await refundConsumed(env, quota.userId, quota.recordId).catch(() => {});
    }
  }
}

export default r;
