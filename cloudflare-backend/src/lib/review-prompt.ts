/**
 * 「AI 看懂评论区」的 prompt。
 *
 * 这个 prompt 原后台没暴露（分析在服务端跑），是我按前端渲染逻辑反推的。
 * 输出结构必须严格匹配 index.html3.js:41374-42156 的读法，否则侧边栏会白屏：
 *
 *   顶层：summary + 5 个固定分区
 *   分区：{ note, items[] }，items 会被前端按 mentions 降序重排
 *   item：mentions + 一个文本字段 + evidence[{original, translation}]
 *
 * 各分区用的文本字段名不一样（前端按分区取不同的 key），下面 prompt 里已经指定死了。
 */

export function REVIEW_ANALYSIS_PROMPT(commentsJson: string, outputLanguage: string): string {
  return `你是一个 TikTok 评论区分析专家。下面是某条视频下点赞数最高的一批评论（JSON 数组，
每条含 content 正文、likes 点赞数、replies 回复数、language 语言）。

请通读这些评论，输出一份结构化的洞察报告。

输出要求：
0. 报告的输出语言：${outputLanguage}。summary、note、name、context、point、description、
   question、demand、compared_to、angle 等所有面向读者的文字都必须用这个语言写，
   下面结构示例里的中文说明只是示意，不代表输出语言。
1. 只输出 JSON，不要任何解释文字，不要 Markdown 代码块。
2. 严格使用下面的结构，字段名一个都不能改：

{
  "summary": "两三句话概括这个评论区整体在聊什么、情绪如何",
  "discussion_topics": {
    "note": "这一部分的一句话说明",
    "items": [
      { "name": "话题名", "context": "这个话题下大家具体在说什么",
        "mentions": 12,
        "evidence": [ { "original": "评论原文", "translation": "输出语言的翻译" } ] }
    ]
  },
  "pain_points": {
    "note": "...",
    "items": [
      { "point": "痛点概括", "description": "展开说明", "mentions": 8,
        "evidence": [ { "original": "", "translation": "" } ] }
    ]
  },
  "scenarios_personas": {
    "note": "...",
    "items": [
      { "name": "使用场景或人群标签", "description": "展开说明", "mentions": 5,
        "evidence": [ { "original": "", "translation": "" } ] }
    ]
  },
  "questions_demands": {
    "note": "...",
    "items": [
      { "question": "用户反复问的问题", "demand": "背后的真实需求", "mentions": 4,
        "evidence": [ { "original": "", "translation": "" } ] }
    ]
  },
  "comparisons": {
    "note": "...",
    "items": [
      { "compared_to": "被拿来对比的东西", "angle": "从哪个角度对比的", "mentions": 3,
        "evidence": [ { "original": "", "translation": "" } ] }
    ]
  }
}

3. mentions 是该条目在评论里被提到的次数，必须是整数，用于排序。
4. evidence 每条最多给 3 条最有代表性的原文。original 保留评论原始语言的原文，
   translation 给「${outputLanguage}」的翻译；如果原文本来就是这个语言，translation 填相同内容。
5. 每个分区最多 8 个条目。某个分区确实没有内容时，items 给空数组，note 说明为什么没有。
6. 不要编造评论里没有的内容。

评论数据：
${commentsJson}`;
}
