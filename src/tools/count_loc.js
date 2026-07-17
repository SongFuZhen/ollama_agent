'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { safeResolve, PROJECT_ROOT } = require('./utils');

// 递归统计代码行数/文件数，排除 node_modules 与隐藏目录
async function scan(dir, root, stats, detail = false) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(full, root, stats, detail);
    } else if (entry.isFile()) {
      stats.files += 1;
      const ext = path.extname(entry.name).toLowerCase();
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      try {
        const content = await fsp.readFile(full, 'utf8');
        const lines = content.split('\n').length;
        let blank = 0, comment = 0;
        for (const ln of content.split('\n')) {
          const t = ln.trim();
          if (t === '') blank += 1;
          else if (t.startsWith('//') || t.startsWith('#')) comment += 1;
        }
        stats.lines += lines;
        stats.blank += blank;
        stats.comment += comment;
        if (detail) {
          const rel = path.relative(root, full);
          stats.fileList.push({ path: rel, lines, blank, comment, ext });
        }
      } catch (e) {
        // 非文本文件读取失败则跳过统计
      }
    }
  }
}

module.exports = {
  name: 'count_loc',
  desc: '递归统计沙箱内代码行数/文件数（按扩展名汇总，区分空行与注释行）；想了解项目规模或各语言占比时用。注意：本工具已内置递归遍历，传入目录即可一次性统计其下所有文件，无需先调用 list_dir / tree 探路。',
  params: {
    path: '相对项目根的目标目录，默认根目录',
    detail: '可选，设为 true 则按每个文件分别列出行数（默认 false，只汇总）',
  },
  needConfirm: false,

  async run({ path: p, detail } = {}, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const abs = await safeResolve(p || '.', root);
    const stats = { files: 0, lines: 0, blank: 0, comment: 0, byExt: {}, fileList: [] };
    const st = await fsp.stat(abs);
    if (st.isFile()) {
      // 单文件统计：直接读文件，不走递归 readdir
      stats.files = 1;
      const ext = path.extname(abs).toLowerCase();
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      try {
        const content = await fsp.readFile(abs, 'utf8');
        const lines = content.split('\n').length;
        let blank = 0, comment = 0;
        for (const ln of content.split('\n')) {
          const t = ln.trim();
          if (t === '') blank += 1;
          else if (t.startsWith('//') || t.startsWith('#')) comment += 1;
        }
        stats.lines += lines;
        stats.blank += blank;
        stats.comment += comment;
        if (detail) {
          stats.fileList.push({ path: path.relative(root, abs) || path.basename(abs), lines, blank, comment, ext });
        }
      } catch (e) { /* 非文本文件读取失败则跳过统计 */ }
    } else {
      await scan(abs, root, stats, !!detail);
    }

    // 汇总信息
    const byExt = Object.entries(stats.byExt)
      .sort((a, b) => b[1] - a[1])
      .map(([ext, n]) => `  ${ext || '(无扩展名)'} : ${n} 个文件`)
      .join('\n');

    const lines = [
      `目录：${path.relative(root, abs) || '.'}`,
      `文件数：${stats.files}`,
      `总行数：${stats.lines}`,
      `空行：${stats.blank}　注释行：${stats.comment}`,
      `按扩展名：`,
      byExt || '  （无文件）',
    ];

    // detail 模式：按每个文件列出
    if (detail && stats.fileList.length > 0) {
      lines.push('', '按文件：');
      stats.fileList
        .sort((a, b) => b.lines - a.lines)
        .forEach(f => {
          lines.push(`  ${f.path}: ${f.lines} 行`);
        });
    }

    return lines.join('\n');
  },
};
