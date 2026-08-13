#!/usr/bin/env node
/**
 * 把 i18n/<lang>/*.json 编译成三处运行时用的词典。
 *
 *   i18n/<lang>/api-messages.json  ->  cloudflare-backend/src/lib/i18n-catalog.ts
 *   i18n/<lang>/site.json          ->  cloudflare-backend/src/site/i18n-catalog.ts
 *   i18n/<lang>/activate.json      ->  kolsprite-2.1.3-editable/assets/activate-i18n.js
 *
 * 为什么要编译而不是直接 import JSON：
 *   - Worker 那两处生成 .ts，是为了让 tsc 能检查 key 拼写，也不用给
 *     wrangler 配 JSON import；
 *   - 激活页那处是浏览器里的 ES module，必须是 .js。
 * 三份产物都别手改，改 i18n/ 下的 JSON 再重跑本脚本。
 *
 * 用法：node scripts/build-i18n.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'i18n');

import { LANGS } from './langs.mjs';

const BASE = 'en'; // 缺词条时回落到英文

function read(lang, file) {
  const p = path.join(SRC, lang, `${file}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 校验：每种语言的 key 集合必须和 en 完全一致，值不能为空。 */
function collect(file) {
  const base = read(BASE, file);
  if (!base) throw new Error(`基准词库缺失：i18n/${BASE}/${file}.json`);
  const baseKeys = Object.keys(base);
  const out = {};
  const problems = [];

  for (const [lang] of LANGS) {
    const d = read(lang, file);
    if (!d) {
      problems.push(`  ${lang}/${file}.json 不存在，回落到 ${BASE}`);
      out[lang] = base;
      continue;
    }
    const missing = baseKeys.filter((k) => !(k in d) || d[k] === '' || d[k] == null);
    const extra = Object.keys(d).filter((k) => !(k in base));
    if (missing.length) problems.push(`  ${lang}/${file}: 缺 ${missing.length} 条 -> ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
    if (extra.length) problems.push(`  ${lang}/${file}: 多出 ${extra.length} 条 -> ${extra.slice(0, 5).join(', ')}`);
    // 缺的用英文补上，宁可露英文也不能露 key 名或空白
    out[lang] = Object.fromEntries(baseKeys.map((k) => [k, d[k] || base[k]]));
  }
  return { dict: out, keys: baseKeys, problems };
}

/**
 * 占位符 / HTML 标签必须原样保留，翻译时最容易在这两处出错，
 * 而且错了不会报错、只会静默渲染出 `{n}` 或者破掉的标签。
 */
function checkPlaceholders(file, dict, keys) {
  const bad = [];
  const base = dict[BASE];
  const marks = (s) => (s.match(/\{[a-z]+\}|<\/?[a-z]+[^>]*>|[①②③④]/gi) || []).sort().join('|');
  for (const [lang] of LANGS) {
    if (lang === BASE) continue;
    for (const k of keys) {
      if (marks(base[k]) !== marks(dict[lang][k])) {
        bad.push(`  ${lang}/${file} :: ${k}\n      en: ${marks(base[k]) || '(无)'}\n      ${lang}: ${marks(dict[lang][k]) || '(无)'}`);
      }
    }
  }
  return bad;
}

const problems = [];
const placeholderIssues = [];

const api = collect('api-messages');
const site = collect('site');
const act = collect('activate');
problems.push(...api.problems, ...site.problems, ...act.problems);
placeholderIssues.push(
  ...checkPlaceholders('api-messages', api.dict, api.keys),
  ...checkPlaceholders('site', site.dict, site.keys),
  ...checkPlaceholders('activate', act.dict, act.keys),
);

const HEAD = (from) => `// 本文件由 scripts/build-i18n.mjs 生成，别手改。
// 改 ${from} 之后重跑：node scripts/build-i18n.mjs
`;

// ── 1. 后端接口 message ──────────────────────────────────────────────────────
fs.writeFileSync(
  path.join(ROOT, 'cloudflare-backend/src/lib/i18n-catalog.ts'),
  HEAD('i18n/<lang>/api-messages.json') +
    `import type { Lang } from './i18n';\n\n` +
    `/** 中文原文 -> 各语言。key 就是业务代码里 fail('…') 写的那句中文。 */\n` +
    `export const MESSAGES: Record<Lang, Record<string, string>> = ${JSON.stringify(api.dict, null, 2)};\n`,
);

// ── 2. 官网页面 ──────────────────────────────────────────────────────────────
fs.writeFileSync(
  path.join(ROOT, 'cloudflare-backend/src/site/i18n-catalog.ts'),
  HEAD('i18n/<lang>/site.json') +
    `import type { Lang } from '../lib/i18n';\n\n` +
    `export const SITE_STRINGS: Record<Lang, Record<string, string>> = ${JSON.stringify(site.dict, null, 2)};\n`,
);

// ── 3. 激活页（浏览器 ES module）─────────────────────────────────────────────
const langMap = Object.fromEntries(LANGS.map(([dir, code]) => [code, dir]));
fs.writeFileSync(
  path.join(ROOT, 'kolsprite-2.1.3-editable/assets/activate-i18n.js'),
  `${HEAD('i18n/<lang>/activate.json')}/**
 * 激活页的文案表。
 *
 * 为什么不复用扩展主体的 i18n：那套词典是构建时编译进 hosts.js 的，
 * 而 hosts.js 是个几万行的大 chunk（含 React、zustand、全部业务逻辑）。
 * 激活页是个独立的小页面，为了二十来条文案把整个 chunk 拉进来不划算。
 *
 * 语言取自扩展自己的设置（chrome.storage.local 的 chromeLocalStorage
 * -> state.language，形如 zh-CN / en-US），和插件面板保持一致。
 */

const STRINGS = ${JSON.stringify(act.dict, null, 2)};

/** 界面语言代码 -> 词典目录名。和 hosts.js 的 EEo 映射一致。 */
const LANG_MAP = ${JSON.stringify(langMap, null, 2)};

/** 认不出来的语言一律落到英文。 */
export function pickLang(language) {
  const v = String(language || '');
  if (LANG_MAP[v]) return LANG_MAP[v];
  // 只给了 'zh' / 'pt' 这种主语言码时，取第一个前缀相同的
  const base = v.split(/[-_]/)[0].toLowerCase();
  for (const [code, dir] of Object.entries(LANG_MAP)) {
    if (code.toLowerCase().startsWith(base + '-')) return dir;
  }
  return 'en';
}

export function makeT(language) {
  const dict = STRINGS[pickLang(language)] || STRINGS.en;
  return (key, vars) => {
    let s = dict[key] ?? STRINGS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v);
    return s;
  };
}

/** 读扩展当前的界面语言。和 hosts.js 用的是同一份存储。 */
export async function readLanguage(api) {
  try {
    const store = await api.storage.local.get('chromeLocalStorage');
    return JSON.parse(store.chromeLocalStorage || '{}').state?.language || '';
  } catch {
    return '';
  }
}
`,
);

// ── 报告 ─────────────────────────────────────────────────────────────────────
const langCount = LANGS.length;
console.log(`语言: ${langCount} 种 (${LANGS.map(([l]) => l).join(' ')})`);
console.log(`词条: api-messages ${api.keys.length} · site ${site.keys.length} · activate ${act.keys.length}`);
console.log(`总计 ${langCount * (api.keys.length + site.keys.length + act.keys.length)} 条`);

if (problems.length) {
  console.log('\n⚠️  词库缺口（已用英文兜底）：');
  for (const p of problems) console.log(p);
}
if (placeholderIssues.length) {
  console.log('\n❌ 占位符 / 标签对不上（渲染会出错，必须修）：');
  for (const p of placeholderIssues) console.log(p);
  process.exitCode = 1;
} else {
  console.log('\n✓ 占位符与 HTML 标签全部对得上');
}
