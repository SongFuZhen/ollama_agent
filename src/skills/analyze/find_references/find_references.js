'use strict';

const { truncate } = require('../../utils');
const { grepFiles } = require('../../../tools/grep');

// 用纯 JS 递归 grep 查找符号的所有引用位置
async function grepRefs(symbol, root, path) {
  const searchRoot = path ? require('path').resolve(root, path) : root;
  const hits = await grepFiles(searchRoot, symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), {
    include: '*',
    maxResults: 500,
  });
  if (hits.length === 0) return '(未找到符号 ' + symbol + ' 的引用)';
  return hits.map(h => `${h.file}:${h.line}: ${h.text}`).join('\n');
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
    return truncate(await grepRefs(symbol.trim(), ctx.root, path));
  },
};
