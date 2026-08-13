import type { Env } from './types';

/**
 * 供应商链。按顺序试，第一个成功的返回，全挂了才抛错。
 *
 * 默认顺序：groq -> siliconflow -> workers-ai
 *   groq         最快，而且 Whisper 返回**真实时间戳**，字幕功能靠它
 *   siliconflow  免费兜底
 *   workers-ai   同一朵云，不用出网，最后一道保险
 *
 * 改顺序：wrangler.jsonc 里的 AI_CHAIN / ASR_CHAIN，逗号分隔。
 * 某一家没配 key 会被自动跳过，不用手动从链里删。
 */

export type ProviderName = 'groq' | 'siliconflow' | 'workers-ai';

export interface HttpProvider {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  asrModel: string;
  /** ASR 主模型失败后还能再试一个（硅基流动有两个免费模型） */
  asrModelFallback?: string;
}

const DEFAULTS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // ⚠️ 这两个模型 ID 是按 Groq 的公开命名填的默认值，我没法从开发环境
    // 连上 api.groq.com 去核对。部署后跑 `POST /admin/ai/selftest`
    // 会把每家每个模型实际能不能用打出来，不对的话改 vars 即可。
    chatModel: 'llama-3.3-70b-versatile',
    asrModel: 'whisper-large-v3-turbo',
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    // 实测选的：Qwen/Qwen2.5-7B-Instruct 跑我们这套长 prompt 会退化成
    // 重复乱码，Qwen/Qwen3-8B 是思考模型、120 秒都没返回。
    // GLM-4-9B 输出稳定、格式听话。想要更好可以换 zai-org/GLM-4.5-Air（更大）。
    chatModel: 'THUDM/GLM-4-9B-0414',
    // SenseVoiceSmall 转写质量最好但没时间戳；TeleSpeechASR 有时间戳
    // 但整段只给 1 条而且错字多。所以主用前者，后者只兜底。
    asrModel: 'FunAudioLLM/SenseVoiceSmall',
    asrModelFallback: 'TeleAI/TeleSpeechASR',
  },
} as const;

/** 解析链配置，跳过没配 key 的。 */
export function resolveChain(env: Env, kind: 'chat' | 'asr'): Array<ProviderName> {
  const raw = (kind === 'chat' ? env.AI_CHAIN : env.ASR_CHAIN) || 'groq,siliconflow,workers-ai';
  const wanted = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as ProviderName[];

  return wanted.filter((name) => {
    if (name === 'workers-ai') return Boolean(env.AI);
    if (name === 'groq') return Boolean(env.GROQ_API_KEY);
    if (name === 'siliconflow') return Boolean(env.SILICONFLOW_API_KEY);
    return false;
  });
}

export function httpProviderOf(env: Env, name: ProviderName): HttpProvider | null {
  if (name === 'groq') {
    if (!env.GROQ_API_KEY) return null;
    return {
      name,
      baseUrl: env.GROQ_BASE_URL || DEFAULTS.groq.baseUrl,
      apiKey: env.GROQ_API_KEY,
      chatModel: env.GROQ_CHAT_MODEL || DEFAULTS.groq.chatModel,
      asrModel: env.GROQ_ASR_MODEL || DEFAULTS.groq.asrModel,
    };
  }
  if (name === 'siliconflow') {
    if (!env.SILICONFLOW_API_KEY) return null;
    return {
      name,
      baseUrl: env.SILICONFLOW_BASE_URL || DEFAULTS.siliconflow.baseUrl,
      apiKey: env.SILICONFLOW_API_KEY,
      chatModel: env.SILICONFLOW_CHAT_MODEL || DEFAULTS.siliconflow.chatModel,
      asrModel: env.SILICONFLOW_ASR_MODEL || DEFAULTS.siliconflow.asrModel,
      asrModelFallback: env.SILICONFLOW_ASR_MODEL_FALLBACK || DEFAULTS.siliconflow.asrModelFallback,
    };
  }
  return null;
}

/** 把每次失败都记下来，全链失败时一次性报出去，方便定位是哪家挂了。 */
export class ChainError extends Error {
  constructor(
    public readonly attempts: Array<{ provider: string; model?: string; error: string }>,
  ) {
    const detail = attempts.map((a) => `${a.provider}${a.model ? `/${a.model}` : ''}: ${a.error}`);
    super(detail.length ? `所有供应商都失败了 —— ${detail.join(' | ')}` : '没有可用的 AI 供应商');
    this.name = 'ChainError';
  }
}
