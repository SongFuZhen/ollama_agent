'use strict';

const fsp = require('fs/promises');
const { safeResolve, truncate } = require('./utils');

// 按行范围读取文件（适合大文件，避免一次读全文）
module.exports = {
  name: 'read_lines',
  desc: '读取文件的指定行范围（1 起，含首尾）；用于大文件时比 read_file 更省。未指定 end 则读到文件末尾',
  params: {
    path: '相对项目根的文件路径',
    start: '起始行号（从 1 开始）',
    end: '结束行号（可选，默认文件末尾）',
  },
  needConfirm: false,

  async run({ path: p, start, end }, ctx = {}) {
    const s = parseInt(start, 10);
    if (!Number.isFinite(s) || s < 1) throw new Error('start 必须是 >=1 的整数');
    const e = end !== undefined && end !== '' ? parseInt(end, 10) : Infinity;
    if (Number.isFinite(e) && e < s) throw new Error('end 不能小于 start');

    const abs = await safeResolve(p, ctx.root);
    const content = await fsp.readFile(abs, 'utf8');
    const lines = content.split('\n');
    const slice = lines.slice(s - 1, Number.isFinite(e) ? e : undefined);
    const text = slice.join('\n');
    const total = lines.length;
    const head = `（共 ${total} 行，显示第 ${s}–${Number.isFinite(e) ? Math.min(e, total) : total} 行）\n`;
    return head + truncate(text);
  },
};
