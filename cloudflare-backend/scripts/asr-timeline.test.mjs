/**
 * estimateTimeline 的单元测试。
 *
 * 为什么单独测这个：硅基流动的 SenseVoiceSmall / TeleSpeechASR 只返回纯文本，
 * 时间轴是后端估出来的。这段逻辑要是错了，字幕会全部堆在 0 秒，
 * 而且 AI 文案接口拿到的 subtitle 也会跟着废掉 —— 但线上不会报错，只会"结果怪怪的"。
 *
 * 跑：node scripts/asr-timeline.test.mjs
 */

import assert from 'node:assert/strict';

// Node 25 能直接跑 .ts（自动剥类型）。timeline.ts 没有任何 import，
// 不依赖 Workers 运行时，所以能直接跑。
const { estimateTimeline } = await import('../src/lib/timeline.ts');

let pass = 0;
function it(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    pass++;
  } catch (e) {
    console.log('  ✗', name);
    console.log('    ', e.message);
    process.exitCode = 1;
  }
}

console.log('estimateTimeline');

it('空文本返回空数组', () => {
  assert.deepEqual(estimateTimeline('', 10), []);
  assert.deepEqual(estimateTimeline('   ', 10), []);
});

it('按句号切句', () => {
  const out = estimateTimeline('第一句话。第二句话。第三句话。', 30);
  assert.equal(out.length, 3);
  assert.equal(out[0].text, '第一句话。');
});

it('时间轴单调递增且不重叠', () => {
  const out = estimateTimeline('第一句。第二句更长一些内容。第三句。', 60);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].start_time >= out[i - 1].end_time, `第 ${i} 句的起点早于上一句终点`);
  }
});

it('总时长和给定的音频时长一致', () => {
  const out = estimateTimeline('第一句。第二句。第三句。', 30);
  assert.equal(out[0].start_time, 0);
  // 允许 1 秒的取整误差
  assert.ok(Math.abs(out[out.length - 1].end_time - 30000) < 1000, '结尾时间对不上音频时长');
});

it('长句会被切开，不会出现超长字幕行', () => {
  const long = '这是一个没有任何标点符号的超长句子'.repeat(8);
  const out = estimateTimeline(long, 60);
  assert.ok(out.length > 1, '长句没有被切分');
  assert.ok(
    out.every((w) => w.text.length <= 60),
    '切分后仍有超长行',
  );
});

it('不给时长也能出结果（按中文 5 字/秒估）', () => {
  const out = estimateTimeline('一二三四五六七八九十。', null);
  assert.equal(out.length, 1);
  assert.ok(out[0].end_time > 0, '没有时长线索时结尾时间不应该是 0');
});

it('英文文本也能切', () => {
  const out = estimateTimeline('Hello there. This is a test. Bye.', 12);
  assert.equal(out.length, 3);
  assert.ok(out[2].end_time <= 12000);
});

console.log(`\n${pass} 项通过`);
