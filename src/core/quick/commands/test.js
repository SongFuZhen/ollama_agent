'use strict';

// /test <path> [function] — 生成单元测试（只读，可定位函数片段）

const read_file = require('../../../tools/read_file');
const grep = require('../../../tools/grep');

module.exports = {
  name: 'test',
  desc: '为代码生成单元测试',
  category: 'readonly',
  usage: 'test <path> [function]',
  params: {
    path: '相对项目根的文件路径',
    function: '可选，指定要测试的函数名',
  },
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：test <path> [function]' };
    let content;
    try {
      content = await read_file.run({ path: p }, { root: projectRoot });
    } catch (e) {
      return { ok: false, error: '读取文件失败：' + e.message };
    }
    // 指定函数名时，用 grep 定位其片段，帮模型聚焦
    let focus = '';
    if (args.function && args.function.trim()) {
      try {
        const hits = await grep.run({ pattern: args.function.trim(), path: p }, { root: projectRoot });
        if (hits && String(hits).trim()) focus = '\n\n目标函数相关片段：\n' + String(hits);
      } catch (e) { /* 定位失败不阻断，用全文 */ }
    }
    return { ok: true, context: `文件：${p}\n\n\`\`\`\n${content}\n\`\`\`${focus}` };
  },
  prompt(args, context) {
    const fn = args.function && args.function.trim() ? `重点为函数 \`${args.function.trim()}\`` : '为文件中的主要函数';
    return {
      system: '你是单元测试助手。' + fn + ' 生成单元测试，覆盖正常 / 边界 / 异常情况。使用项目现有测试框架与断言风格；若未知框架，使用语言主流方案（如 JS 用 node:test 或 jest）。输出用代码块包裹完整测试文件，并简要说明如何运行。',
      user: `请为以下代码生成测试：\n\n${context}`,
    };
  },
};
