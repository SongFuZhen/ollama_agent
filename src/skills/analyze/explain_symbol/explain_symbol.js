'use strict';

const { truncate } = require('../../utils');
const { grepFiles } = require('../../../tools/grep');

// 用纯 JS 递归 grep 查找符号的定义处（含上下文行），帮助理解其用途与签名
async function grepDef(symbol, root, path) {
  const pattern = `${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[=(:]`;
  const searchRoot = path ? require('path').resolve(root, path) : root;
  const hits = await grepFiles(searchRoot, pattern, {
    include: '*',
    contextBefore: 3,
    contextAfter: 3,
    maxResults: 200,
  });
  if (hits.length === 0) return '(未找到符号 ' + symbol + ' 的定义)';
  return hits.map(h => `${h.file}:${h.line}: ${h.text}`).join('\n');
}

module.exports = {
  name: 'explain_symbol',
  desc: '解释某个函数/类/变量：在项目中查找其定义位置并附带上下文，帮助理解签名与用途',
  params: {
    symbol: '必填，要解释的符号名（函数名、类名、变量名）',
    path: '可选，限定搜索的目录或文件，缩小范围',
  },
  needConfirm: false,

  async run({ symbol, path }, ctx = {}) {
    if (!symbol || !symbol.trim()) return '错误：symbol 不能为空';
    return truncate(await grepDef(symbol.trim(), ctx.root, path));
  },
};
