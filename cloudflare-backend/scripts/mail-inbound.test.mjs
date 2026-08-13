/**
 * handleInboundEmail 的单元测试。
 *
 * 为什么单独测这个：达人回信的回流全靠它。这段逻辑要是错了，用户看到的是
 * 「对方一直不回」—— 线上不会报任何错，因为入站邮件根本没有调用方在等结果。
 * 归线程有两条路（收件别名 reply+{threadId}@ 优先，In-Reply-To 兜底），
 * 两条都得测，还要测归不到线程时必须丢弃（收信域会收到大量垃圾邮件）。
 *
 * 跑：node --import ./scripts/ts-resolve-hook.mjs scripts/mail-inbound.test.mjs
 */

import assert from 'node:assert/strict';

const { handleInboundEmail } = await import('../src/lib/mail-inbound.ts');

let pass = 0;
async function it(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
    pass++;
  } catch (e) {
    console.log('  ✗', name);
    console.log('    ', e.message);
    process.exitCode = 1;
  }
}

/** 极简 D1 桩：按 SQL 前缀返回预设结果，并记录所有写入。 */
function fakeEnv({ threadById = null, threadByMsgId = null } = {}) {
  const writes = [];
  const r2 = [];
  const prepare = (sql) => {
    const stmt = {
      sql,
      args: [],
      bind(...args) {
        stmt.args = args;
        return stmt;
      },
      async first() {
        if (sql.includes('FROM mail_threads WHERE id')) return threadById;
        if (sql.includes('FROM mail_messages m')) return threadByMsgId;
        return null;
      },
      async run() {
        writes.push({ sql, args: stmt.args });
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  return {
    env: {
      DB: {
        prepare,
        async batch(stmts) {
          for (const s of stmts) writes.push({ sql: s.sql, args: s.args });
          return stmts.map(() => ({ meta: { changes: 1 } }));
        },
      },
      R2: {
        async put(key, body) {
          r2.push({ key, body });
        },
      },
    },
    writes,
    r2,
  };
}

// ⚠️ 头和正文之间那一行空行是 RFC 5322 的结构分隔，不能被过滤掉，
// 否则正文会被当成邮件头继续解析（parsed.text 变空，测试会误报）。
const RAW = (extra = '') =>
  new TextEncoder().encode(
    [
      'From: Jane Creator <jane@example.com>',
      'To: reply+thread-abc@kolmail.poviai.com',
      'Subject: Re: Collab?',
      'Message-ID: <reply-1@example.com>',
      ...(extra ? [extra] : []),
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Sure, send me the brief.',
      '',
    ].join('\r\n'),
  );

const msgOf = (to, raw) => ({ to, raw });

console.log('handleInboundEmail');

await it('收件别名 reply+{threadId}@ 能归到线程并入库', async () => {
  const { env, writes, r2 } = fakeEnv({
    threadById: { id: 'thread-abc', user_id: 'u1', unread: 0 },
  });
  await handleInboundEmail(msgOf('reply+thread-abc@kolmail.poviai.com', RAW()), env);

  const insert = writes.find((w) => w.sql.includes('INSERT INTO mail_messages'));
  assert.ok(insert, '应该插入一条消息');
  assert.equal(insert.args[1], 'thread-abc', '归到正确线程');
  assert.equal(insert.args[2], 'u1', '归到线程的所有者');
  assert.equal(insert.args[3], 'jane@example.com', '解析出发件人');
  assert.ok(insert.args[6].includes('send me the brief'), '解析出正文');
  assert.equal(r2.length, 1, '原始 .eml 存进 R2');
  assert.ok(r2[0].key.startsWith('mail/raw/u1/'), 'R2 key 按用户分目录');
  assert.ok(
    writes.some((w) => w.sql.includes('unread = unread + 1')),
    '线程未读数 +1',
  );
});

await it('别名对不上时用 In-Reply-To 兜底', async () => {
  const { env, writes } = fakeEnv({
    threadById: null,
    threadByMsgId: { id: 'thread-xyz', user_id: 'u2', unread: 0 },
  });
  await handleInboundEmail(
    msgOf('someone@kolmail.poviai.com', RAW('In-Reply-To: <outbound-1@kolmail.poviai.com>')),
    env,
  );
  const insert = writes.find((w) => w.sql.includes('INSERT INTO mail_messages'));
  assert.ok(insert, '应该插入一条消息');
  assert.equal(insert.args[1], 'thread-xyz', '按 In-Reply-To 归线程');
});

await it('两条路都归不到线程就丢弃，不入库', async () => {
  const { env, writes, r2 } = fakeEnv({ threadById: null, threadByMsgId: null });
  await handleInboundEmail(msgOf('random@kolmail.poviai.com', RAW()), env);
  assert.equal(writes.length, 0, '不应有任何写入');
  assert.equal(r2.length, 0, '不应写 R2');
});

await it('线程 id 不合法的别名不会误当成 threadId 去查', async () => {
  const { env, writes } = fakeEnv({ threadById: null, threadByMsgId: null });
  // reply+ 后面太短，正则不匹配，应该直接进 In-Reply-To 分支（这里也查不到）
  await handleInboundEmail(msgOf('reply+x@kolmail.poviai.com', RAW()), env);
  assert.equal(writes.length, 0, '不应有任何写入');
});

console.log(`\n${pass} 项通过`);
