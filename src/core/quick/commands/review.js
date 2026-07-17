'use strict';

// /review <path> — 代码审查（只读，列出潜在问题）

const read_file = require('../../../tools/read_file');

module.exports = {
  name: 'review',
  desc: '代码审查（找潜在问题）',
  category: 'readonly',
  usage: 'review <path>',
  params: { path: '相对项目根的文件路径' },
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：review <path>' };
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
      system: '你是资深代码审查者。找出代码中的潜在问题，按严重度（严重 / 中等 / 轻微）排序。每类问题给出：位置（行/函数）、问题描述、修改建议。关注 bug、安全隐患、性能、可读性与边界情况。不要修改代码，只给审查意见。',
      user: `请审查以下代码：\n\n${context}`,
    };
  },
};
