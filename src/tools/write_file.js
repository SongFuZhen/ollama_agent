'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { safeResolve, PROJECT_ROOT } = require('./utils');

module.exports = {
  name: 'write_file',
  desc: '写入/覆盖项目内文件（需确认）',
  params: { path: '相对项目根的文件路径', content: '要写入的内容' },
  needConfirm: true,
  
  async run({ path: p, content }, ctx = {}) {
    const abs = await safeResolve(p, ctx.root);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const root = ctx.root || PROJECT_ROOT;
    await fsp.writeFile(abs, content, 'utf8');
    return '已写入：' + path.relative(root, abs);
  },
};
