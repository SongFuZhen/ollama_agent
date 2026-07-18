'use strict';

// /fix <path> <报错描述> — 尝试修复（写操作，后处理产出可应用的完整文件）

const read_file = require('../../../tools/read_file');
const { extractCodeBlock } = require('../util');

module.exports = {
  name: 'fix',
  desc: '根据报错尝试修复代码',
  category: 'write',
  usage: 'fix <path> <报错描述>',
  params: {
    path: '相对项目根的文件路径',
    error: '报错描述或症状',
  },
  examples: [
    '/fix src/api/server.js 端口被占用 EADDRINUSE',
    '/fix src/db/pool.js 连接泄漏导致超时',
  ],
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：fix <path> <报错描述>' };
    let content;
    try {
      content = await read_file.run({ path: p }, { root: projectRoot });
    } catch (e) {
      return { ok: false, error: '读取文件失败：' + e.message };
    }
    const err = args.error && args.error.trim() ? args.error.trim() : '（未提供报错，请基于代码自行排查明显问题）';
    return { ok: true, context: `文件：${p}\n\n\`\`\`\n${content}\n\`\`\`\n\n报错/症状：\n${err}` };
  },
  prompt(args, context) {
    return {
      system: '你是修复助手。根据报错描述修复代码：只改必要部分，不动无关逻辑，保持原有风格。输出时用单个代码块包裹修复后的完整文件内容。若无法确定修复，请说明原因而非凭空改写。',
      user: `请修复以下代码：\n\n${context}`,
    };
  },
  async postProcess(output, args) {
    const code = extractCodeBlock(output);
    const apply = code ? { path: args.path, code } : null;
    return { output, apply };
  },
};
