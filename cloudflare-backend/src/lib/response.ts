/**
 * 统一响应信封。
 *
 * 扩展侧的判定逻辑写死在 hosts.js 的 H5o() 里：
 *   (res && res.code == "OK") || res.status == "ok"   -> resolve
 *   否则                                              -> reject(res)
 *
 * 业务代码又普遍用 res.success / res.data / res.message，
 * 所以四个字段都得给全，少一个就有页面白屏。
 */

import { translate } from './i18n';

export type Envelope<T> = {
  code: string;
  success: boolean;
  message: string;
  data: T;
};

export const ERR = {
  /** 扩展收到这个 code 会清空本地 token 并退出登录，别的错误码不会。 */
  SESSION_EXPIRED: 'ERR_GLOBAL_SESSION_EXPIRED',
  UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  PARAM: 'ERR_PARAM',
  QUOTA_EXHAUSTED: 'ERR_QUOTA_EXHAUSTED',
  NOT_FOUND: 'ERR_NOT_FOUND',
  RATE_LIMITED: 'ERR_RATE_LIMITED',
  INTERNAL: 'ERR_INTERNAL',
  NOT_IMPLEMENTED: 'ERR_NOT_IMPLEMENTED',
} as const;

export function ok<T>(data: T, message = 'success'): Response {
  return json({ code: 'OK', success: true, message: translate(message), data });
}

export function fail(code: string, message: string, status = 200, data: unknown = null): Response {
  // 在出口统一翻译：63 个调用点一个都不用动，以后新写的 fail('中文') 也自动覆盖。
  // 语言来自请求的 lang 头，见 lib/i18n.ts。
  message = translate(message);
  // 注意 status 默认 200：扩展只看 body.code，不看 HTTP 状态码。
  // 返回 4xx 会让 service-worker 里的 fetch().then(r => r.json()) 照样解析，
  // 但某些浏览器扩展环境下 401 会被拦，所以业务错误一律走 200 + code。
  return json({ code, success: false, message, data }, status);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** 还没接的接口用它占位，前端不会崩，日志里能看到是谁在调。 */
export function notImplemented(name: string, hint = ''): Response {
  return fail(
    ERR.NOT_IMPLEMENTED,
    `接口 ${name} 尚未实现${hint ? '：' + hint : ''}`,
    200,
    null,
  );
}
