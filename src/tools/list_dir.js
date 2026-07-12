'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { safeResolve, PROJECT_ROOT } = require('./utils');

module.exports = {
  name: 'list_dir',
  desc: '列出目录下的文件和子目录，返回树状结构',
  params: { path: '相对项目根的路径，默认根目录' },
  needConfirm: false,
  
  async run({ path: p }, ctx = {}) {
    const abs = await safeResolve(p || '.', ctx.root);
    const root = ctx.root || PROJECT_ROOT;
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    
    const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    
    const lines = [];
    const currentPath = path.relative(root, abs) || '.';
    lines.push(`📂 ${currentPath}/`);
    
    dirs.forEach((d, i) => {
      const isLast = i === dirs.length - 1 && files.length === 0;
      const prefix = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}📁 ${d.name}/`);
    });
    
    files.forEach((f, i) => {
      const isLast = i === files.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}📄 ${f.name}`);
    });
    
    if (dirs.length === 0 && files.length === 0) {
      lines.push('(空目录)');
    }
    
    return lines.join('\n');
  },
};
