'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT, safeResolve } = require('./utils');

// 递归匹配文件模式
// 支持: *.js, src/*.ts, a.test.js
async function matchGlob(dir, pattern, root, results = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);
    
    // 跳过 node_modules 和 .开头的目录
    if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name.startsWith('.'))) {
      continue;
    }
    
    if (entry.isDirectory()) {
      await matchGlob(fullPath, pattern, root, results);
    } else if (matchPattern(relPath, pattern)) {
      results.push(relPath);
    }
  }
  
  return results;
}

// 简单的 glob 模式匹配
// 支持: *, **, ?
function matchPattern(filePath, pattern) {
  // 将 glob 转换为正则：分隔符用 path.sep 兼容 Windows（\ 需转义为 \\）
  const sep = path.sep;
  const neg = '[^' + (sep === '\\' ? '\\\\' : '/') + ']*';
  const one = '[^' + (sep === '\\' ? '\\\\' : '/') + ']';
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, neg)
    .replace(/\?/g, one)
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}

module.exports = {
  name: 'glob',
  desc: '按 glob 模式查找文件（如 *.js, src/**/*.ts）；已知文件命名/目录规律时比 search_files 更精确',
  params: { pattern: 'glob 模式', path: '搜索目录，默认项目根' },
  needConfirm: false,
  
  async run({ pattern, path: p }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const searchDir = p ? await safeResolve(p, root) : root;
    const results = await matchGlob(searchDir, pattern, root);
    
    if (results.length === 0) {
      return '未找到匹配文件';
    }
    
    return results.sort().join('\n');
  },
};
