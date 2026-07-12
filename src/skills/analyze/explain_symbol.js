'use strict';

const { execSync } = require('child_process');
const { truncate } = require('../utils');

// 用 grep 查找符号的定义处（含上下文行），帮助理解其用途与签名
function grepDef(symbol, root, path) {
  const pattern = `${symbol}\\s*[=(:]`;
  const target = path ? ` ${path}` : '';
  try {
    return execSync(`grep -rEn -C 3 --include='*' "${pattern}"${target}`, {
      cwd: root,
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }) || '(未找到该符号的定义)';
  } catch (e) {
    const out = e.stdout || '';
    if (out) return out;
    return '(未找到符号 ' + symbol + ' 的定义)';
  }
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
    return truncate(grepDef(symbol.trim(), ctx.root, path));
  },
};
