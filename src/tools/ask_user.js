'use strict';

// ask_user：执行中向用户澄清（对标 Claudette 的 advanced 组）。
// 复用 server 注入的 ctx.askUser（返回一个 Promise<string>，等前端文字回答）。
// 若运行环境未提供 ctx.askUser（如纯脚本/测试），则降级为提示文本。
module.exports = {
  name: 'ask_user',
  desc: '向用户提一个澄清问题并等待回答（执行中需要用户决策/补充信息时调用）；回答会作为结果返回给模型继续推理',
  params: {
    question: '要问用户的问题（清晰、具体）',
    options: '可选，提供的选项列表（如 ["A","B"]），帮助用户快速回答',
  },
  needConfirm: false, // 交互走 ctx.askUser 专用通道，不是写操作确认

  async run({ question, options }, ctx = {}) {
    if (!question || !question.trim()) return '错误：question 不能为空';
    const optsHint = Array.isArray(options) && options.length
      ? `\n（可选回答：${options.join(' / ')}）`
      : '';
    if (typeof ctx.askUser !== 'function') {
      // 无交互环境：仅记录问题，不阻塞
      return `（当前环境不支持交互提问，已记录问题）\n问题：${question}${optsHint}`;
    }
    const answer = await ctx.askUser(question + optsHint);
    return `用户回答：${answer || '（未回答）'}`;
  },
};
