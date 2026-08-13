import type { Env } from './types';
import { ChainError, httpProviderOf, resolveChain, type ProviderName } from './providers';

/**
 * 大模型调用。按 AI_CHAIN 的顺序逐个试，第一个成功就返回。
 * 默认 groq -> siliconflow -> workers-ai。
 *
 * 之所以做成链而不是单选：这几家都是免费额度，随时可能限流或抽风，
 * 有降级的话用户侧不会直接看到「AI 处理失败」。
 */

export class AINotConfiguredError extends Error {
  constructor(msg = '没有可用的 AI 供应商，请至少配置 GROQ_API_KEY 或 SILICONFLOW_API_KEY') {
    super(msg);
    this.name = 'AINotConfiguredError';
  }
}

export function aiConfigured(env: Env): boolean {
  return resolveChain(env, 'chat').length > 0;
}

export interface ChatOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** 要求模型返回 JSON。评论分析用得到。 */
  json?: boolean;
}

export async function chat(env: Env, prompt: string, opts: ChatOptions = {}): Promise<string> {
  const chain = resolveChain(env, 'chat');
  if (!chain.length) throw new AINotConfiguredError();

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });

  const attempts: Array<{ provider: string; model?: string; error: string }> = [];

  for (const name of chain) {
    try {
      const text =
        name === 'workers-ai'
          ? await runWorkersAI(env, messages, opts)
          : await runOpenAICompatible(env, name, messages, opts);
      if (text) {
        if (attempts.length) console.warn(`AI 降级到 ${name}（前面失败：${attempts.length} 家）`);
        return text;
      }
      attempts.push({ provider: name, error: '返回内容为空' });
    } catch (e) {
      attempts.push({ provider: name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  throw new ChainError(attempts);
}

async function runWorkersAI(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  opts: ChatOptions,
): Promise<string> {
  const model = env.WORKERS_AI_CHAT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  const input: Record<string, unknown> = {
    messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.maxTokens) input.max_tokens = opts.maxTokens;
  // 不是所有 Workers AI 模型都支持 response_format，不支持的会忽略，传了没风险
  if (opts.json) input.response_format = { type: 'json_object' };

  const res = (await env.AI!.run(model as never, input as never)) as { response?: string } | string;
  const text = typeof res === 'string' ? res : res?.response;
  if (!text) throw new Error('Workers AI 返回内容为空');
  return text;
}

async function runOpenAICompatible(
  env: Env,
  name: ProviderName,
  messages: Array<{ role: string; content: string }>,
  opts: ChatOptions,
): Promise<string> {
  const p = httpProviderOf(env, name);
  if (!p) throw new Error(`${name} 未配置`);

  const body: Record<string, unknown> = {
    model: p.chatModel,
    messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`${p.chatModel} 返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json<{ choices?: Array<{ message?: { content?: string } }> }>();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${p.chatModel} 返回内容为空`);
  return content;
}

/** 模型有时会把 JSON 包在 ```json 代码块里，这里剥掉再解析。 */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  return JSON.parse(raw) as T;
}
