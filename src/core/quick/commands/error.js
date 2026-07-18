'use strict';

// /error <报错文本> — 解读报错（无文件预处理，纯文本）

module.exports = {
  name: 'error',
  desc: '解读报错信息',
  category: 'readonly',
  usage: 'error <报错文本>',
  params: { text: '粘贴的报错文本' },
  examples: [
    '/error TypeError: Cannot read properties of undefined (reading \'x\')',
    '/error Segmentation fault (core dumped)',
  ],
  async prepare(args) {
    const text = args.text;
    if (!text || !text.trim()) return { ok: false, error: '缺少报错文本，用法：error <粘贴的报错>' };
    return { ok: true, context: text };
  },
  prompt(args, context) {
    return {
      system: '你是报错解读助手。针对用户粘贴的报错信息，用中文说明：1) 错误含义；2) 可能的原因；3) 排查/修复步骤。语言通俗，必要时给出示例命令或代码。',
      user: `请解读以下报错：\n\n\`\`\`\n${context}\n\`\`\``,
    };
  },
};
