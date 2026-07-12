'use strict';

const { safeResolve, truncate } = require('./utils');

module.exports = {
  name: 'read_file',
  desc: '读取项目内文件内容',
  params: { path: '相对项目根的文件路径' },
  needConfirm: false,
  
  async run({ path: p }, ctx = {}) {
    const abs = await safeResolve(p, ctx.root);
    const content = require('fs').promises.readFile(abs, 'utf8');
    return truncate(await content);
  },
};
