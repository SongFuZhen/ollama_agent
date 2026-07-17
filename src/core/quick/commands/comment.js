'use strict';

// /comment <path> — 为代码添加中文注释（写操作，后处理产出可应用的完整文件）

const read_file = require('../../../tools/read_file');
const { extractCodeBlock } = require('../util');

module.exports = {
  name: 'comment',
  desc: '为代码添加中文注释',
  category: 'write',
  usage: 'comment <path>',
  params: { path: '相对项目根的文件路径' },
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：comment <path>' };
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
      system: '你是代码注释助手。为代码中的每个函数/类/关键逻辑块添加简洁的中文注释，解释其用途与关键逻辑。保留原代码结构与内容，只在必要处加注释，不改动逻辑、不重命名。输出时用单个代码块包裹完整文件内容。',
      user: `请为以下代码添加中文注释，输出完整文件：\n\n${context}`,
    };
  },
  async postProcess(output, args) {
    const code = extractCodeBlock(output);
    const apply = code ? { path: args.path, code } : null;
    return { output, apply };
  },
};
