'use strict';

// /explain <path> — 解释代码（只读，单轮，7B 强项）

const read_file = require('../../../tools/read_file');

module.exports = {
  name: 'explain',
  desc: '解释指定文件的代码',
  category: 'readonly',
  usage: 'explain <path>',
  params: { path: '相对项目根的文件路径' },
  examples: [
    '/explain src/core/agent.js',
    '/explain src/tools/read_file.js',
  ],
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：explain <path>' };
    let content;
    try {
      content = await read_file.run({ path: p }, { root: projectRoot });
    } catch (e) {
      return { ok: false, error: '读取文件失败：' + e.message };
    }
    return { ok: true, context: `文件：${p}\n\n\`\`\`\n${content}\n\`\`\`` };
  },
  prompt(args, context) {
    return {
      system: '你是代码解释助手。用清晰的中文解释代码的功能、关键逻辑与设计意图。不要逐行重复源码，只解释「做了什么、为什么这么做、关键点在哪里」。涉及关键函数时指出其位置。',
      user: `请解释以下代码：\n\n${context}`,
    };
  },
};
