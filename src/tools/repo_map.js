'use strict';

// repo_map：大型仓库结构速览——按扩展名扫描，输出"重要文件 + 导出符号"摘要。
// 纯 JS，轻量正则提取 import/export（不引 babel/tsc，零依赖、跨平台）。
const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT, safeResolve } = require('./utils');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const CODE_EXT = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.go', '.java', '.rs', '.cpp', '.c', '.rb', '.php']);
const BINARY_EXT = /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz|lock|json)$/i;

function extractSymbols(content) {
  const syms = [];
  // export function/class/const NAME  或  export default function NAME
  const re = /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(content))) syms.push(m[1]);
  // module.exports = { a, b }  /  module.exports = NAME
  const me = content.match(/module\.exports\s*=\s*(?:\{[^}]*\}|([A-Za-z0-9_$]+))/);
  if (me) {
    if (me[1]) syms.push(me[1]);
    else {
      const inner = me[0].match(/\{([^}]*)\}/);
      if (inner) for (const part of inner[1].split(',')) {
        const name = part.trim().split(/\s*:\s*/)[0].trim();
        if (name && /^[A-Za-z0-9_$]+$/.test(name)) syms.push(name);
      }
    }
  }
  // Python: def/class
  const py = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)/gm;
  while ((m = py.exec(content))) syms.push(m[1]);
  return [...new Set(syms)].slice(0, 20);
}

async function walk(dir, root, acc) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await walk(full, root, acc);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!CODE_EXT.has(ext) || BINARY_EXT.test(e.name)) continue;
      const rel = path.relative(root, full);
      try {
        const content = await fsp.readFile(full, 'utf8');
        const syms = extractSymbols(content);
        if (syms.length) acc.push({ file: rel, syms });
      } catch (_) {}
    }
  }
}

module.exports = {
  name: 'repo_map',
  desc: '仓库结构速览：列出含导出符号的重要源文件（大型仓库导航用）',
  params: { path: '根目录，默认项目根', max: '最多列出文件数，默认 40' },
  needConfirm: false,

  async run({ path: p, max }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const searchDir = p ? await safeResolve(p, root) : root;
    const acc = [];
    await walk(searchDir, root, acc);
    if (!acc.length) return '未找到含导出符号的源文件';

    const maxFiles = Number(max) || 40;
    const sorted = acc.sort((a, b) => b.syms.length - a.syms.length).slice(0, maxFiles);
    const lines = [`仓库结构速览（${acc.length} 个含符号文件，列出前 ${sorted.length}）：`];
    for (const f of sorted) {
      lines.push(`\n📄 ${f.file}`);
      lines.push('  ' + f.syms.map((s) => s).join(', '));
    }
    return lines.join('\n');
  },
};

module.exports.extractSymbols = extractSymbols;
