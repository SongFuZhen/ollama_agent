'use strict';

const fsp = require('fs/promises');
const { safeResolve } = require('./utils');

// 精确编辑：在文件中查找 old_string 并替换为 new_string
// 默认只替换第一处；all=true 时替换全部匹配。
module.exports = {
  name: 'edit_file',
  desc: '在文件中查找并替换一段内容（比整文件重写更安全）；做局部小修改时用，整文件新建/替换用 write_file。old_string 必须唯一，否则设 all=true 替换全部',
  params: {
    path: '相对项目根的文件路径',
    old_string: '要被替换的原文（片段）',
    new_string: '替换后的新内容',
    all: '是否替换全部匹配，默认否',
  },
  needConfirm: true,

  async run({ path: p, old_string, new_string, all }, ctx = {}) {
    if (!old_string) throw new Error('old_string 不能为空');
    if (new_string === undefined || new_string === null) new_string = '';

    const abs = await safeResolve(p, ctx.root);
    const content = await fsp.readFile(abs, 'utf8');

    const count = content.split(old_string).length - 1;
    if (count === 0) {
      return '未找到匹配 old_string 的内容，未做修改。';
    }
    if (count > 1 && !all) {
      return `找到 ${count} 处匹配但 all=false，为避免误改请先让片段唯一，或设 all=true（替换全部）。未做修改。`;
    }

    const updated = all ? content.split(old_string).join(new_string) : content.replace(old_string, new_string);
    await fsp.writeFile(abs, updated, 'utf8');
    return `已替换 ${all ? count : 1} 处，文件 ${p} 更新完成。`;
  },
};
