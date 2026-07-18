'use strict';

const fs = require('fs').promises;
const path = require('path');
const { safeResolveRead, summarizeReadFile } = require('./utils');

module.exports = {
  name: 'read_file',
  desc: '读取项目内文件内容；需要查看某个文件的完整内容时使用，大文件建议改用 read_lines 只读部分以省上下文',
  params: { path: '相对项目根的文件路径' },
  needConfirm: false,

  async run({ path: p }, ctx = {}) {
    const abs = await safeResolveRead(p, ctx.root);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (e) {
      throw new Error('文件不存在：' + p);
    }
    // 目录：read_file 只支持单文件，给出友好提示并列出目录内可选文件
    if (stat.isDirectory()) {
      const root = ctx.root || path.dirname(abs);
      let listing = '';
      let first = '<文件名>';
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile() && !e.name.startsWith('.'))
          .map((e) => path.relative(root, path.join(abs, e.name)))
          .sort()
          .slice(0, 15);
        if (files.length) {
          first = files[0];
          listing = '\n该目录下的文件如：' + files.join('、');
        }
      } catch (e) { /* 列出失败不影响主错误 */ }
      throw new Error(`「${p}」是目录，read_file 只能读取单个文件，请改用具体文件路径（如 ${first}）${listing}`);
    }
    const content = await fs.readFile(abs, 'utf8');
    return summarizeReadFile(content);
  },
};
