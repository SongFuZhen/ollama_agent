'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT } = require('./utils');

module.exports = {
  name: 'search_files',
  desc: '按文件名模式递归搜索',
  params: { pattern: '文件名包含的关键字' },
  needConfirm: false,
  
  async run({ pattern }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const hits = [];
    
    async function walk(dir) {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        if (e.isDirectory()) await walk(full);
        else if (e.name.includes(pattern)) hits.push(path.relative(root, full));
      }
    }
    
    await walk(root);
    return hits.length ? hits.join('\n') : '未找到匹配文件';
  },
};
