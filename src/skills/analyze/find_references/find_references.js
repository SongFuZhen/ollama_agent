'use strict';

const { execSync } = require('child_process');
const { truncate } = require('../../utils');

// 用 grep 查找符号的所有引用位置
function grepRefs(symbol, root, path) {
  const target = path ? ` ${path}` : '';
  try {
    return execSync(`grep -rEn --include='*' "${symbol}"${target}`, {
      cwd: root,
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }) || '(无引用)';
  } catch (e) {
    const out = e.stdout || '';
    if (out) return out;
    return '(未找到符号 ' + symbol + ' 的引用)';
  }
}

module.exports = {
  name: 'find_references',
  desc: '查找某个符号的所有使用位置（引用），帮助评估改动影响范围',
  params: {
    symbol: '必填，要查找引用的符号名',
    path: '可选，限定搜索的目录或文件，缩小范围',
  },
  needConfirm: false,

  async run({ symbol, path }, ctx = {}) {
    if (!symbol || !symbol.trim()) return '错误：symbol 不能为空';
    return truncate(grepRefs(symbol.trim(), ctx.root, path));
  },
};
