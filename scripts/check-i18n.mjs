#!/usr/bin/env node
/**
 * 词库自检。build-i18n.mjs 已经查过「key 齐不齐、占位符对不对」，
 * 这里查的是翻译质量层面的硬伤 —— 这些不会让构建失败，
 * 但会让用户在界面上直接看到别的语言。
 *
 * 用法：node scripts/check-i18n.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from './langs.mjs';
import { hasSimplified } from './lib-simplified.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'i18n');
const FILES = ['api-messages', 'site', 'activate'];
const BRAND_NAME = 'AI TikTok Downloader Pro';
const SITE_BRAND_KEYS = ['footer', 'uninstall_h1', 'cl_how3', 'mc_welcome_t'];
const LITERAL_BRAND =
  /AI TikTok(?: Video)? Downloader(?: Pro)?|KOL\s*Sprite|Kolsprite|\bSprite\b|达人精灵|達人精靈|小精灵|小精靈/iu;

const HAN = /[一-鿿]/;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;

/**
 * 品牌名、协议名、技术标识符 —— 这些本来就该是英文/原样，
 * 出现在非英文词条里不算「没翻译」。
 */
const ALLOWED_LATIN =
  /^(?:[\s\d\p{P}\p{S}]|\{brand\}|AI TikTok Downloader Pro|TikTok|Excel|AI|Chrome|CSP|DevTools|Console|WeChat|GPM|SKU|Workers AI|GROQ_API_KEY|SILICONFLOW_API_KEY|chrome:\/\/extensions|multipart\/form-data|taskId|videoId|creatorId|creatorId 或 videoId|awemeIds?|userId|username|planCode|durationDays|quotaType|amount|ticket|key|token|batch|code|id|XXXX|MB|mo|br|strong|a|href|javascript|location|reload)$/iu;

const problems = [];
const stats = [];

for (const [lang] of LANGS) {
  let total = 0;
  let cjkLeak = 0;
  let latinOnly = 0;

  for (const file of FILES) {
    const p = path.join(SRC, lang, `${file}.json`);
    if (!fs.existsSync(p)) {
      problems.push(`❌ ${lang}/${file}.json 不存在`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));

    if (file === 'site') {
      if (d.footer !== '{brand}') {
        problems.push(`❌ ${lang}/site :: footer 必须精确为 {brand}`);
      }
      for (const key of SITE_BRAND_KEYS) {
        const value = String(d[key] ?? '');
        const count = (value.match(/\{brand\}/g) || []).length;
        if (count !== 1) {
          problems.push(`❌ ${lang}/site :: ${key} 必须且只能包含一个 {brand}`);
        }
      }
      for (const [key, value] of Object.entries(d)) {
        if (LITERAL_BRAND.test(String(value))) {
          problems.push(
            `❌ ${lang}/site :: ${key} 含硬编码品牌名，改用 {brand}（当前唯一品牌：${BRAND_NAME}）`,
          );
        }
      }
    }

    for (const [k, v] of Object.entries(d)) {
      total++;
      const s = String(v);

      // ① 中文漏到别的语言里
      //
      // 判据不是「有没有汉字」—— 日语里「朝鮮民主主義人民共和国」「平均再生数」
      // 这种整条全汉字的词组太常见，按汉字报警会淹没真问题。
      // 真正的信号是简体专有字（见 lib-simplified.mjs）：日语新字体、韩语汉字都不用它们。
      // 对拉丁语系语言则严格得多，出现任何汉字都是漏译。
      if (HAN.test(s) && lang !== 'zh_CN' && lang !== 'zh_TW') {
        const leaked = lang === 'ja' || lang === 'ko' ? hasSimplified(s) : true;
        if (leaked) {
          problems.push(`⚠️  ${lang}/${file} :: ${k}\n     ${s.slice(0, 90)}`);
          cjkLeak++;
        }
      }

      // ② 该翻的没翻（整条和英文一模一样，且不是专有名词）
      if (lang !== 'en') {
        const en = JSON.parse(
          fs.readFileSync(path.join(SRC, 'en', `${file}.json`), 'utf8'),
        )[k];
        if (en && s === en && !ALLOWED_LATIN.test(s.trim()) && s.trim().length > 3) {
          latinOnly++;
        }
      }
    }
  }
  stats.push({ lang, total, cjkLeak, latinOnly });
}

console.log('语言    词条   中文残留   与英文完全相同');
for (const s of stats) {
  const flag = s.cjkLeak ? '❌' : '  ';
  console.log(
    `${flag} ${s.lang.padEnd(6)} ${String(s.total).padStart(4)}   ${String(s.cjkLeak).padStart(6)}   ${String(s.latinOnly).padStart(10)}`,
  );
}

if (problems.length) {
  console.log('\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\n✓ 没有语言串味');
}
