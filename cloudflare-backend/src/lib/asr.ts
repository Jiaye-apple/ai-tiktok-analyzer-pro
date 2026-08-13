import type { Env } from './types';
import { ChainError, httpProviderOf, resolveChain, type ProviderName } from './providers';
import { estimateTimeline, type Word } from './timeline';

/**
 * 语音转字幕。
 *
 * 前端要的是带时间轴的数组：[{ start_time: ms, end_time: ms, text }]
 * 时间轴会被用来渲染字幕列表、拼「00:00:01 --> 00:00:04」格式的复制文本，
 * 以及作为 AI 文案接口的 subtitle 入参。
 *
 * 按 ASR_CHAIN 顺序试，默认 groq -> siliconflow -> workers-ai：
 *
 *   groq         Whisper，返回真实的分句时间戳。首选就是为了这个。
 *   siliconflow  免费兜底。实测结论（2026-08 用 11.5 秒中文音频跑的）：
 *                · SenseVoiceSmall  只返回 { text }，无时间戳，但**转写质量最好**
 *                  （标点齐全、没有错字）-> 时间轴按字数估
 *                · TeleSpeechASR    有 segments，但整段音频只吐 1 条，
 *                  而且错字更多（"今天教"识别成"今天叫"）
 *                所以主用 SenseVoiceSmall，TeleSpeechASR 只在它挂了时兜底。
 *   workers-ai   Cloudflare 的 Whisper，也有时间戳，不用出网。
 *
 * 只要 Groq 正常，时间轴就是准的；降到硅基流动才会变成估算值。
 */

export type { Word };

export class ASRNotConfiguredError extends Error {
  constructor(msg = '没有可用的语音转写供应商') {
    super(msg);
    this.name = 'ASRNotConfiguredError';
  }
}

export function asrConfigured(env: Env): boolean {
  return resolveChain(env, 'asr').length > 0;
}

/** 返回值里带上是哪家转的、时间轴是不是真实的，方便排查和前端提示。 */
export interface TranscribeResult {
  words: Word[];
  provider: string;
  model: string;
  /** false 表示时间轴是估算的 */
  realTimestamps: boolean;
}

export async function transcribe(env: Env, file: File): Promise<TranscribeResult> {
  const chain = resolveChain(env, 'asr');
  if (!chain.length) throw new ASRNotConfiguredError();

  const attempts: Array<{ provider: string; model?: string; error: string }> = [];

  for (const name of chain) {
    try {
      const r = name === 'workers-ai' ? await viaWorkersAI(env, file) : await viaHttp(env, name, file);
      if (r.words.length) {
        if (attempts.length) console.warn(`ASR 降级到 ${r.provider}（前面失败：${attempts.length} 家）`);
        if (!r.realTimestamps) console.warn(`ASR ${r.model} 无时间戳，时间轴按字数估算`);
        return r;
      }
      attempts.push({ provider: name, error: '转写结果为空' });
    } catch (e) {
      attempts.push({ provider: name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  throw new ChainError(attempts);
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI（Whisper，有真实时间戳）
// ---------------------------------------------------------------------------

async function viaWorkersAI(env: Env, file: File): Promise<TranscribeResult> {
  const model = env.WORKERS_AI_ASR_MODEL || '@cf/openai/whisper-large-v3-turbo';
  const bytes = new Uint8Array(await file.arrayBuffer());

  const res = (await env.AI!.run(model as never, { audio: [...bytes] } as never)) as {
    text?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    words?: Array<{ start: number; end: number; word: string }>;
  };

  if (res.segments?.length) {
    return {
      words: fromSegments(res.segments),
      provider: 'workers-ai',
      model,
      realTimestamps: true,
    };
  }
  if (res.words?.length) {
    return { words: groupWords(res.words), provider: 'workers-ai', model, realTimestamps: true };
  }
  return {
    words: estimateTimeline(res.text ?? '', await durationHintOf(file)),
    provider: 'workers-ai',
    model,
    realTimestamps: false,
  };
}

// ---------------------------------------------------------------------------
// OpenAI 兼容 HTTP（Groq / 硅基流动）
// ---------------------------------------------------------------------------

async function viaHttp(env: Env, name: ProviderName, file: File): Promise<TranscribeResult> {
  const p = httpProviderOf(env, name);
  if (!p) throw new Error(`${name} 未配置`);

  const models = [p.asrModel, p.asrModelFallback].filter(Boolean) as string[];
  let lastErr: unknown = null;

  for (const model of models) {
    const form = new FormData();
    form.append('file', file, file.name || 'audio.wav');
    form.append('model', model);
    // Groq / OpenAI 认这两个字段并返回带时间戳的 segments；
    // 硅基流动会忽略，只回 { text }。都带上，换供应商不用改代码。
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

    let res: Response;
    try {
      res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.apiKey}` },
        body: form,
      });
    } catch (e) {
      lastErr = e;
      continue;
    }

    if (!res.ok) {
      lastErr = new Error(`${model} 返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
      continue;
    }

    const data = await res.json<{
      text?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
      // 阿里系模型偶尔用这个字段名，单位是毫秒
      sentence_info?: Array<{ start: number; end: number; text: string }>;
    }>();

    if (data.segments?.length) {
      return { words: fromSegments(data.segments), provider: p.name, model, realTimestamps: true };
    }
    if (data.sentence_info?.length) {
      return {
        words: data.sentence_info.map((s) => ({
          start_time: Math.round(s.start),
          end_time: Math.round(s.end),
          text: s.text.trim(),
        })),
        provider: p.name,
        model,
        realTimestamps: true,
      };
    }

    const text = (data.text ?? '').trim();
    if (!text) {
      lastErr = new Error(`${model} 返回空文本`);
      continue;
    }
    return {
      words: estimateTimeline(text, await durationHintOf(file)),
      provider: p.name,
      model,
      realTimestamps: false,
    };
  }

  throw lastErr instanceof Error ? lastErr : new Error(`${name} 转写失败`);
}

// ---------------------------------------------------------------------------

/**
 * 把供应商返回的 segments 转成前端要的结构。
 *
 * 这里有个必须处理的坑：不是所有"有时间戳"的模型都真的按句切好了。
 * 实测硅基流动的 TeleSpeechASR，11.5 秒的音频只返回 **1 条** segment，
 * 整篇文字挤在一行 —— 直接用的话字幕列表就只有一行，比按句估算还难用。
 *
 * 所以对超长片段再按句拆一次，但**锚定在这个片段自己的真实起止时间内**：
 * 总时长是准的，句子边界是估的，两边的好处都拿到。
 */
function fromSegments(segments: Array<{ start: number; end: number; text: string }>): Word[] {
  const out: Word[] = [];

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;

    const start = Math.round(seg.start * 1000);
    const end = Math.round(seg.end * 1000);

    // 短片段（正常的 Whisper 输出）直接用
    if (text.length <= SEGMENT_SPLIT_THRESHOLD) {
      out.push({ start_time: start, end_time: end, text });
      continue;
    }

    const span = (end - start) / 1000;
    const pieces = estimateTimeline(text, span > 0 ? span : null);
    for (const piece of pieces) {
      out.push({
        start_time: start + piece.start_time,
        end_time: start + piece.end_time,
        text: piece.text,
      });
    }
  }

  return out;
}

/** 超过这个字数的 segment 会被再切一次。一行字幕塞太多字就没法看了。 */
const SEGMENT_SPLIT_THRESHOLD = 45;

/** 把词级时间戳按标点聚合成句，避免字幕碎成一个个词。 */
function groupWords(words: Array<{ start: number; end: number; word: string }>): Word[] {
  const out: Word[] = [];
  let buf = '';
  let start = words[0]?.start ?? 0;

  for (const w of words) {
    buf += w.word;
    if (/[。．.!?！？…\n]$/.test(w.word.trim()) || buf.length > 40) {
      out.push({
        start_time: Math.round(start * 1000),
        end_time: Math.round(w.end * 1000),
        text: buf.trim(),
      });
      buf = '';
      start = w.end;
    }
  }
  if (buf.trim()) {
    out.push({
      start_time: Math.round(start * 1000),
      end_time: Math.round((words[words.length - 1]?.end ?? start) * 1000),
      text: buf.trim(),
    });
  }
  return out;
}

/**
 * 估算音频时长，只在拿不到真实时间戳时才用得上。
 *
 * 扩展上传的文件名固定叫 audio.wav，但内容取决于 TikTok 那个 musicUrl，
 * 实际多是 mp3/m4a。所以先试着按 WAV 头算准确值，读不出来再按 128kbps 粗估。
 */
async function durationHintOf(file: File): Promise<number | null> {
  const size = file.size;
  if (!size) return null;

  try {
    // WAV 头固定 44 字节以内就能拿到采样率和位深
    const head = new DataView(await file.slice(0, 64).arrayBuffer());
    const riff = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
    const wave = String.fromCharCode(head.getUint8(8), head.getUint8(9), head.getUint8(10), head.getUint8(11));
    if (riff === 'RIFF' && wave === 'WAVE') {
      const byteRate = head.getUint32(28, true); // 每秒字节数
      if (byteRate > 0) return (size - 44) / byteRate;
    }
  } catch {
    // 不是 WAV 或者头部残缺，走下面的粗估
  }

  return size / 16000;
}
