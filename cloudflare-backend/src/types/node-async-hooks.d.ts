/**
 * node:async_hooks 的最小类型声明。
 *
 * Workers 在开了 nodejs_compat 之后运行时是有 AsyncLocalStorage 的，
 * 但 @cloudflare/workers-types 不带它的类型。装 @types/node 会为了几行声明
 * 拖进一整套 Node 类型（还会和 workers-types 的 fetch/Request 打架），
 * 所以这里只声明用到的部分。
 */
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
