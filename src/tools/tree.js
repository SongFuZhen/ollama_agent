'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { safeResolve, PROJECT_ROOT } = require('./utils');

// 以树状结构列出目录（可限深度），排除 node_modules 与隐藏目录
async function walk(dir, root, depth, maxDepth, prefix, lines) {
  if (depth > maxDepth) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
  const items = [...dirs, ...files].sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < items.length; i++) {
    const entry = items[i];
    const isLast = i === items.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    lines.push(prefix + branch + entry.name + (entry.isDirectory() ? '/' : ''));
    if (entry.isDirectory()) {
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      await walk(path.join(dir, entry.name), root, depth + 1, maxDepth, nextPrefix, lines);
    }
  }
}

module.exports = {
  name: 'tree',
  desc: '以树状结构列出目录（可限深度，默认完整展开），直观展示项目结构；排除 node_modules 与隐藏目录',
  params: {
    path: '相对项目根的目标目录，默认根目录',
    depth: '展开深度，默认完整遍历（一次获取全部，无需逐级下钻）',
  },
  needConfirm: false,

  async run({ path: p, depth }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const abs = await safeResolve(p || '.', root);
    // 默认完整遍历：一次调用即返回全部层级，避免模型为下钻而反复调用 tree。
    // 仅当显式传入 depth 时才作为上限截断。
    const maxDepth = depth ? parseInt(depth, 10) : Infinity;
    if (maxDepth !== Infinity && (!Number.isFinite(maxDepth) || maxDepth < 1)) throw new Error('depth 必须是 >=1 的整数');

    const lines = [path.relative(root, abs) || '.'];
    await walk(abs, root, 1, maxDepth, '', lines);
    return lines.join('\n');
  },
};
