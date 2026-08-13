/**
 * 时间轴估算。独立成文件是为了能被单元测试直接 import ——
 * asr.ts 依赖 Workers 运行时，测试环境跑不起来。
 *
 * 什么时候会用到：ASR 供应商只返回纯文本、不给时间戳时（硅基流动的
 * SenseVoiceSmall 就是这样），以及某个 segment 太长需要再切分时。
 */

export interface Word {
  start_time: number; // 毫秒
  end_time: number;
  text: string;
}

/**
 * 把整段文本切句，按字数比例分配时间。
 * 中英文都按字符数算 —— 不精确，但比全部堆在 0 秒强。
 */
export function estimateTimeline(text: string, durationSec: number | null): Word[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[。．.!?！？…；;])\s*/)
    .flatMap((s) => (s.length > 60 ? chunk(s, 40) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sentences.length) return [];

  // 没有任何时长线索时，按中文约 5 字/秒估
  const totalChars = sentences.reduce((n, s) => n + s.length, 0);
  const total = durationSec && durationSec > 0 ? durationSec : totalChars / 5;

  const out: Word[] = [];
  let cursor = 0;
  for (const s of sentences) {
    const span = (s.length / totalChars) * total;
    out.push({
      start_time: Math.round(cursor * 1000),
      end_time: Math.round((cursor + span) * 1000),
      text: s,
    });
    cursor += span;
  }
  return out;
}

function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
