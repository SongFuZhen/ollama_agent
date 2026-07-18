'use strict';

// /regex <需求> — 写正则表达式（无文件预处理，纯文本）

module.exports = {
  name: 'regex',
  desc: '根据需求写正则表达式',
  category: 'readonly',
  usage: 'regex <需求描述>',
  params: { text: '对正则的需求描述' },
  examples: [
    '/regex 匹配中国大陆手机号',
    '/regex 提取 markdown 中的链接',
  ],
  async prepare(args) {
    const text = args.text;
    if (!text || !text.trim()) return { ok: false, error: '缺少需求描述，用法：regex <你要匹配什么>' };
    return { ok: true, context: text };
  },
  prompt(args, context) {
    return {
      system: '你是正则助手。根据用户需求给出正则表达式。输出包含：1) 正则本身（用代码块）；2) 匹配示例；3) 不匹配示例；4) 关键语法解释。除非用户指定，默认使用 JavaScript 正则语法。',
      user: `请根据需求写正则：\n\n${context}`,
    };
  },
};
