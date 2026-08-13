import { currentLang } from '../lib/i18n';
import { SITE_STRINGS } from './i18n-catalog';

/**
 * 官网页面的文案。
 *
 * 和 lib/i18n.ts 的区别：那份是给**接口返回的 message** 用的，以中文原文作 key
 * （业务代码里写 fail('参数不完整')，出口处翻译）。页面文案是整段整段的 HTML，
 * 拿中文原句当 key 太长也太脆，所以这里用短 slug。
 *
 * 语言取自 lib/i18n 的请求上下文：中间件按 `lang` 头或 Accept-Language 定的
 * （见 index.ts）。页面是浏览器直接导航打开的，走的是 Accept-Language；
 * 扩展跳转时还会带 ?lang=xx，由 routes/site.ts 的中间件覆盖掉。
 *
 * 译文在 i18n/<lang>/site.json，由 scripts/build-i18n.mjs 编译进 i18n-catalog.ts。
 */

/** `<html lang="">` 和 toLocaleDateString 用的 BCP-47 代码。 */
const HTML_LANG: Record<string, string> = {
  zh_CN: 'zh-CN',
  zh_TW: 'zh-TW',
  en: 'en',
  ja: 'ja',
  vi: 'vi',
  id: 'id',
  es: 'es',
  pt: 'pt',
  ko: 'ko',
};

/**
 * 取一条页面文案。
 * 缺词条时 build-i18n 已经用英文补齐过了，这里再兜一层，
 * 真的查不到就返回 slug 本身 —— 页面上很显眼，漏了一眼就能看见。
 */
export function st(key: string, vars?: Record<string, string | number>): string {
  const lang = currentLang();
  let s = SITE_STRINGS[lang]?.[key] ?? SITE_STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function htmlLang(): string {
  return HTML_LANG[currentLang()] ?? 'en';
}
