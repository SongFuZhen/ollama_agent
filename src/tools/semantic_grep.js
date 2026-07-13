'use strict';

// semantic_grep：比 grep 更"模糊"的工作区检索——按 token 重叠度对命中行排序，
// 适合"记得大概意思但不记得精确词"的场景。纯 JS，无系统命令调用（呼应 P0 跨平台）。
const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT, safeResolve } = require('./utils');

const BINARY_EXT = /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz)$/i;
const SKIP_DIRS = new Set(['node_modules']);

function tokenize(s) {
  return new Set((s.toLowerCase().match(/[a-z0-9_]+|[一-龥]+/g) || [])
    .filter((t) => t.length >= 2));
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

async function walk(dir, root, queryTokens, results, limit) {
  if (results.length >= limit) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const e of entries) {
    if (results.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await walk(full, root, queryTokens, results, limit);
    } else if (e.isFile() && !BINARY_EXT.test(e.name)) {
      await scoreFile(full, root, queryTokens, results, limit);
    }
  }
}

async function scoreFile(file, root, queryTokens, results, limit) {
  const rel = path.relative(root, file);
  let content;
  try { content = await fsp.readFile(file, 'utf8'); }
  catch (e) { return; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const score = overlap(tokenize(lines[i]), queryTokens);
    if (score > 0) {
      results.push({ file: rel, line: i + 1, score, text: lines[i].trim() });
    }
  }
  // 防止单文件命中过多
  if (results.length > limit) results.length = limit;
}

module.exports = {
  name: 'semantic_grep',
  desc: '模糊语义检索：按 token 重叠度对工作区文本排序，适合"记得大概意思"的场景',
  params: {
    query: '查询短语（自然语言或关键词，按语义相近度排序）',
    path: '搜索目录，默认项目根',
    limit: '返回条数上限，默认 20',
  },
  needConfirm: false,

  async run({ query, path: p, limit }, ctx = {}) {
    if (!query || !query.trim()) return '错误：query 不能为空';
    const root = ctx.root || PROJECT_ROOT;
    const searchDir = p ? await safeResolve(p, root) : root;
    const qTokens = tokenize(query);
    if (!qTokens.length) return '错误：查询无可识别的 token';

    const results = [];
    await walk(searchDir, root, qTokens, results, Number(limit) || 20);
    if (!results.length) return '未找到语义相近的内容';

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, Number(limit) || 20);
    const lines = [`找到 ${top.length} 处语义相近（按相关度降序）：`];
    for (const r of top) {
      lines.push(`\n📄 ${r.file}:${r.line}  (相关度 ${(r.score * 100).toFixed(0)}%)\n  ${r.text}`);
    }
    return lines.join('\n');
  },
};

module.exports.tokenize = tokenize;
module.exports.overlap = overlap;
