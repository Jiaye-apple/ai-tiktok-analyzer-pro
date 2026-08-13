/**
 * Node ESM 解析钩子：把 src 里 `./foo` 形式的相对导入补成 `./foo.ts`。
 *
 * 为什么需要：TS 源码按 bundler 风格写导入（不带扩展名），
 * 而 Node 跑 .ts 时要求显式扩展名。只有单元测试直接 import TS 源码时用得上，
 * 生产构建走 wrangler/esbuild，不经过这里。
 *
 * 用法：node --import ./scripts/ts-resolve-hook.mjs scripts/xxx.test.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs';
      import { fileURLToPath } from 'node:url';
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) {
          try {
            const url = new URL(specifier + '.ts', context.parentURL);
            if (existsSync(fileURLToPath(url))) {
              return { url: url.href, shortCircuit: true };
            }
          } catch {}
        }
        return next(specifier, context);
      }
    `),
  pathToFileURL('./'),
);

export { existsSync };
