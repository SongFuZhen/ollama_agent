'use strict';

const { truncate } = require('../../utils');
const path = require('path');
const { grepFiles } = require('../../../tools/grep');

// 用纯 JS 递归 grep 查找符号的所有引用位置
// path 可为目录或文件：文件时只在该文件内搜索（以文件名作 include 过滤），
// 避免直接把文件路径传给 grepFiles（它只接受目录，传文件会因 readdir 失败返回空）。
async function grepRefs(symbol, root, p) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let searchRoot = root;
  const opts = { include: '*', maxResults: 500 };
  if (p) {
    const resolved = path.resolve(root, p);
    let isFile = false;
    try { isFile = require('fs').statSync(resolved).isFile(); } catch (_) {}
    if (isFile) {
      searchRoot = path.dirname(resolved);
      opts.include = path.basename(resolved);
    } else {
      searchRoot = resolved;
    }
  }
  const hits = await grepFiles(searchRoot, escaped, opts);
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
