import { AsyncLocalStorage } from 'node:async_hooks';
import { MESSAGES } from './i18n-catalog';

/**
 * 后端返回的 message 会被扩展直接弹给用户（hosts.js 的 `gi.error(k.message)`），
 * 所以它必须跟着界面语言走 —— 否则日语用户点任何一个失败的操作，
 * 弹出来的都是中文。
 *
 * 扩展每个请求都带 `lang` 头（hosts.js:55648，值形如 en-US / zh-CN / ja-JP），
 * 这里就用它。
 *
 * 实现上用 AsyncLocalStorage 把语言挂在请求上下文里，让 response.ts 的
 * fail()/ok() 自己去翻译 —— 这样 60 多个调用点一个都不用动，
 * 以后新增的 fail('中文') 也会自动被翻译，不会漏。
 *
 * 词条以中文原文作 key。看着有点土，但好处很实在：
 * 业务代码读起来还是中文、没翻译的词条会原样透出（不会变成 undefined 或 key 名），
 * 而且漏翻的一眼就能在返回里看出来。
 *
 * 具体的译文在 i18n/<lang>/api-messages.json，由 scripts/build-i18n.mjs
 * 编译进 i18n-catalog.ts。别改 catalog，改 JSON 再重跑脚本。
 */

/** 扩展语言下拉里的 9 种语言。和 hosts.js 的 EEo 映射一一对应。 */
export type Lang = 'zh_CN' | 'zh_TW' | 'en' | 'ja' | 'vi' | 'id' | 'es' | 'pt' | 'ko';

/**
 * 给 AI prompt 用的语言名。产品面向海外用户，AI 输出语言必须跟着
 * 用户的选择/界面语言走，不能写死中文 —— prompt 里注入这里的英文名
 * （附本族名帮模型消歧），比注入 "en-US" 这类代码更稳。
 */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  zh_CN: 'Simplified Chinese (简体中文)',
  zh_TW: 'Traditional Chinese (繁體中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  vi: 'Vietnamese (Tiếng Việt)',
  id: 'Indonesian (Bahasa Indonesia)',
};

export function langName(code: Lang): string {
  return LANG_NAMES[code] ?? LANG_NAMES.en;
}

const store = new AsyncLocalStorage<Lang>();

/** 每个请求进来时设一次，整个处理链里都能读到。 */
export function withLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

export function currentLang(): Lang {
  return store.getStore() ?? 'en';
}

/**
 * BCP-47 -> 词典代码。
 *
 * 中文必须先按地区分流：zh-TW / zh-Hant / zh-HK 都是繁体，
 * 只看 `zh` 前缀会把台港用户送进简体词典。
 * 其余语言只认主语言码就够了（pt-BR 和 pt-PT 共用一份，
 * 差异不至于让用户看不懂，比退回英文强）。
 */
export function parseLang(header: string | undefined | null): Lang {
  const v = (header || '').trim().toLowerCase();
  if (!v) return 'en';
  // Accept-Language 可能是 "ja,en-US;q=0.9,en;q=0.8"，取第一个
  const first = v.split(',')[0].split(';')[0].trim();
  const base = first.split(/[-_]/)[0];

  if (base === 'zh') {
    return /hant|tw|hk|mo/.test(first) ? 'zh_TW' : 'zh_CN';
  }
  const map: Record<string, Lang> = {
    en: 'en', ja: 'ja', vi: 'vi', id: 'id', es: 'es', pt: 'pt', ko: 'ko',
    // Chrome 里印尼语的老代码是 in
    in: 'id',
  };
  return map[base] ?? 'en';
}

// ---------------------------------------------------------------------------

/**
 * 带变量的 message 没法整句查表，用模板规则处理。
 * 顺序有意义：先匹配到的先用。
 *
 * 这些是拼出来的运行时信息（接口路径、批次号、供应商返回的原文），
 * 面向的是排查问题的人而不是普通用户，所以只做中文 -> 英文，
 * 其余语言统一走英文 —— 给「第 3/7 批」翻九种语言，收益远不抵维护成本。
 */
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^接口不存在: (.+)$/, (m) => `No such endpoint: ${m[1]}`],
  [/^套餐 (.+) 不存在$/, (m) => `Plan "${m[1]}" does not exist`],
  // 捕获组本身也可能是中文（notImplemented 的 hint 就是），要再翻一次
  [/^接口 (.+) 尚未实现：(.+)$/, (m) => `Endpoint ${m[1]} is not implemented yet: ${translate(m[2], 'en')}`],
  [/^接口 (.+) 尚未实现$/, (m) => `Endpoint ${m[1]} is not implemented yet`],
  [/^执行 (.+) 第 (\d+)\/(\d+) 批/, (m) => `Failed running ${m[1]} batch ${m[2]}/${m[3]}`],
  [/^所有供应商都失败了 —— (.+)$/, (m) => `All providers failed — ${m[1]}`],
  [/^(.+) 返回 (\d+): (.+)$/, (m) => `${m[1]} returned ${m[2]}: ${m[3]}`],
  [/^(.+) 返回空文本$/, (m) => `${m[1]} returned empty text`],
  [/^(.+) 未配置$/, (m) => `${m[1]} is not configured`],
];

/** 没有对应词条时原样返回 —— 宁可露一条中文，也不要返回空串或 key 名。 */
export function translate(zh: string, lang: Lang = currentLang()): string {
  if (lang === 'zh_CN') return zh;
  const hit = MESSAGES[lang]?.[zh];
  if (hit) return hit;
  for (const [re, fn] of PATTERNS) {
    const m = zh.match(re);
    if (m) return fn(m);
  }
  return zh;
}

/** 给测试和自检用：哪些中文还没翻译。 */
export function untranslated(list: string[], lang: Lang = 'en'): string[] {
  return list.filter((z) => translate(z, lang) === z && /[一-鿿]/.test(z));
}
