'use strict';

const { safeResolve, truncate } = require('./utils');

module.exports = {
  name: 'read_file',
  desc: '读取项目内文件内容；需要查看某个文件的完整内容时使用，大文件建议改用 read_lines 只读部分以省上下文',
  params: { path: '相对项目根的文件路径' },
  needConfirm: false,
  
  async run({ path: p }, ctx = {}) {
    const abs = await safeResolve(p, ctx.root);
    const content = require('fs').promises.readFile(abs, 'utf8');
    return truncate(await content);
  },
};
