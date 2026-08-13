/**
 * 读 JSON body，解析失败返回空对象。
 *
 * 直接写 `c.req.json<T>().catch(() => ({}))` 的话，TS 会把类型推成 `T | {}`，
 * 后面读任何字段都报错。包一层把返回类型钉成 Partial<T>。
 *
 * 全部字段都当可选处理是有意的 —— 请求来自浏览器扩展，
 * 版本可能比后端旧，少字段是常态，靠代码里显式校验而不是靠类型。
 *
 * 参数类型故意写得很松，这样任意泛型参数的 Hono Context 都能传进来。
 */
type JsonReadable = { req: { json: <T>() => Promise<T> } };

export async function readJson<T>(c: JsonReadable): Promise<Partial<T>> {
  return c.req.json<Partial<T>>().catch(() => ({}) as Partial<T>);
}

/** 读数组 body（有几个接口的 body 是裸数组，不是对象）。 */
export async function readArray<T>(c: JsonReadable): Promise<T[]> {
  const v = await c.req.json<unknown>().catch(() => null);
  return Array.isArray(v) ? (v as T[]) : [];
}
