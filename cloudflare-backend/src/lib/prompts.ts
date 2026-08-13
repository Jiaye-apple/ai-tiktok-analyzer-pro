/**
 * 四个 copy-script 接口的 prompt。
 *
 * 这些不是我编的 —— 原样抄自扩展前端 assets/index.js:184947-185054。
 * 原后台把 prompt 放在前端、只把拼好的字段发给服务端，所以迁移后用同一套 prompt
 * 就能保证 AI 输出风格和原来一致。改这里等于改产品输出，别随手动。
 *
 * 前端传上来的字段：
 *   caption        视频标题（对应下面的 title）
 *   subtitle       带时间轴的全量字幕
 *   outputLanguage 用户选的输出语言
 *   creatorId / videoId / region
 */

export function highlightsPrompt(outputLanguage: string, title: string, subtitle: string) {
  return `Summarize the following Video CONTENT from TikTok into brief sentences of key points, then provide complete highlighted information in a list, choosing an appropriate emoji for each highlight. The following Video Title is from the video creator on Tiktok.
Your output should use the following format:
Summary
{brief summary of this content}
Highlights
- [Emoji] Bullet point with complete explanation
keyword
Suggest up to 3 tags related to video content.
------------
Your output language：
${outputLanguage}
Video Title：
${title}
CONTENT：
${subtitle}`;
}
export function summarizePrompt(outputLanguage: string, title: string, subtitle: string) {
  return `Summarize the following content in 5-10 bullet points with timestamp if it's transcript.
Your output language：
${outputLanguage}
------------
Video Title：
${title}
Video CONTENT：
${subtitle}`;
}
export function analyzeStructurePrompt(outputLanguage: string, title: string, subtitle: string) {
  return `请根据以下带时间戳的字幕数据，按照TikTok短视频脚本结构分析框架进行拆解。
分析要求：
一、分段结构解析
1. 黄金 3 秒分析（0-3s）
  - 钩子类型（悬念 / 冲突 / 利益承诺等）
  - 视听元素（画面动作 / 音效 / 字幕特效）
  - 用户注意力捕获机制
2. 信息传递段（4s - 结尾前 2s）
  - 时间轴分段（按每 2-3 秒信息节点拆分）
  - 内容类型（知识讲解 / 剧情推进 / 产品展示等）
  - 逻辑结构（问题 - 方案 / 现象 - 原理 / 场景 - 结果等）
  - 节奏控制（镜头切换频率 / 信息密度计算）
3. 转化结尾（最后 2s）
  - 行动号召类型（关注 / 点赞 / 收藏 / 点击等）
  - 情感引导策略（共鸣话术 / 场景暗示）
  - 品牌露出方式（显性 / 隐性）
二、关键元素提取
1. 钩子矩阵（标注每个钩子的时间点）
  - 视觉钩子：动态特效 / 画面冲击（如放大、快切）
  - 听觉钩子：音效卡点 / BGM 转折
  - 文案钩子：反常识陈述 / 数据冲击 / 提问互动
2. 互动设计分析
  - 提问话术（如 "你们觉得有用吗？"）
  - 互动节点分布（按时间戳标注）
3. 情感曲线绘制
  - 标注每个时间点的情感倾向（正向 / 负向 / 中性）
  - 识别情感峰值点（如反转 / 高潮 / 共鸣时刻）
4. 标签匹配分析
  - 提取视频核心关键词（建议 3-5 个）
三、结构模型验证
1. 匹配爆款公式：强钩子 +（信息密度 × 情绪浓度）+ 互动引导
2. 验证结构类型（痛点型 / 悬念型 / 故事型等）
3. 计算信息点密度（总信息点数 ÷ 视频时长）
四、数据反推建议
1. 推测高流失时间点（无明显钩子 / 信息断层处）
2. 定位用户兴趣点（重复观看段落 / 高互动节点）
3. 提出优化方向（钩子强化 / 节奏调整 / 转化路径设计）

输出格式要求：
你的输出语言：${outputLanguage}
使用 Markdown 格式，包含：
1. 时间轴分析表（示例）
2. 关键元素清单（分钩子 / 互动 / 情感三类）
3. 结构模型总结（匹配的结构类型 + 优化建议）
4. 数据洞察（基于时间戳分布的 3 个核心发现）
------------
你要分析的TikTok视频的标题：
${title}
你要分析的TikTok视频的字幕：
${subtitle}`;
}
export function rewriteDirectPrompt(outputLanguage: string, title: string, subtitle: string) {
  return `请根据以下TikTok视频的时间轴字幕内容，仿写一份结构相同的视频脚本，生成含分镜细节的视频脚本。要求：
1. 输出语言：${outputLanguage}
2. 每个时间点需包含：✅ 镜头类型（特写 / 全景 / 俯拍等）✅ 画面内容（场景 / 人物动作 / 特效标注）✅ 字幕文案（保留原节奏）✅ 音效 / 音乐（标注出现时机）
3. 脚本应包含场景描述、人物对话（如果字幕中有对话）、旁白（如果字幕中有旁白）以及可能的镜头建议
4. 脚本应具有连贯性和可读性，长度应与原视频时长大致相当，完全保留原分段节奏，保持原字幕的句式特点和口语化风格
5. 如果字幕中包含特定领域的术语，请尝试理解并合理运用
6. 直接输出仿写结果，无需额外解释
------------
你要分析的TikTok视频的标题：
${title}
你要分析的TikTok视频的字幕：
${subtitle}`;
}
export function rewriteTargetFieldPrompt(outputLanguage: string, title: string, subtitle: string, targetField: string) {
  return `请根据以下TikTok视频的时间轴字幕内容，仿写一份结构相同但主题全新的视频脚本，生成含分镜细节的视频脚本。要求：
1. 输出语言：${outputLanguage}
2. 替换所有具体内容为新的行业领域：${targetField}
3. 每个时间点需包含：✅ 镜头类型（特写 / 全景 / 俯拍等）✅ 画面内容（场景 / 人物动作 / 特效标注）✅ 字幕文案（保留原节奏）✅ 音效 / 音乐（标注出现时机）
4. 脚本应包含场景描述、人物对话（如果字幕中有对话）、旁白（如果字幕中有旁白）以及可能的镜头建议
5. 脚本应具有连贯性和可读性，长度应与原视频时长大致相当，完全保留原分段节奏，保持原字幕的句式特点和口语化风格
6. 如果字幕中包含特定领域的术语，请尝试理解并合理运用
7. 直接输出仿写结果，无需额外解释
------------
你要分析的TikTok视频的标题：
${title}
你要分析的TikTok视频的字幕：
${subtitle}`;
}
