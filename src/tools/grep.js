'use strict';

const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { PROJECT_ROOT, safeResolve } = require('./utils');

const BINARY_EXT = /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz)$/i;
const SKIP_DIRS = new Set(['node_modules']); // .开头的目录也跳过


/**
 * 纯函数：递归搜索目录，返回命中行。
 * @param {string} root   搜索根（绝对路径）
 * @param {string|RegExp} pattern  正则字符串或 RegExp
 * @param {object} opts  { include:'*.js', contextBefore, contextAfter, maxResults, caseSensitive, onlyCount }
 * @returns {Promise<Array<{file:string, line:number, text:string}>>}
 *   file 为相对 root 的路径（用 path.sep，跨平台安全）。
 */
async function grepFiles(root, pattern, opts = {}) {
  const regex = pattern instanceof RegExp
    ? pattern
    : new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');

  const includeRe = opts.include && opts.include !== '*'
    ? new RegExp('^' + opts.include.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
    : null;

  const maxResults = opts.maxResults || 500;
  const hits = [];

  async function walk(dir) {
    if (hits.length >= maxResults) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= maxResults) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (BINARY_EXT.test(entry.name)) continue;
        const rel = path.relative(root, full);
        if (includeRe && !includeRe.test(rel)) continue;
        await grepFileLines(full, rel, regex, opts, hits);
      }
    }
  }

  await walk(root);
  return hits;
}

async function grepFileLines(filePath, relPath, regex, opts, hits) {
  const cb = opts.contextBefore || opts.contextAfter;
  const lines = [];
  try {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lines.push(line);
    }
  } catch (e) {
    return;
  }

  const max = opts.maxResults || 500;
  for (let i = 0; i < lines.length; i++) {
    if (hits.length >= max) break;
    if (regex.test(lines[i])) {
      if (cb) {
        const b = opts.contextBefore || 0, a = opts.contextAfter || 0;
        const from = Math.max(0, i - b), to = Math.min(lines.length - 1, i + a);
        for (let j = from; j <= to; j++) {
          hits.push({ file: relPath, line: j + 1, text: lines[j] });
        }
      } else {
        hits.push({ file: relPath, line: i + 1, text: lines[i] });
      }
    }
  }
}

/**
 * 按文件聚合命中（供工具输出用）
 */
async function grepDirAggregated(root, pattern, opts = {}) {
  const hits = await grepFiles(root, pattern, opts);
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  const results = [];
  for (const [file, lines] of byFile) {
    results.push({
      file,
      count: lines.length,
      lines: lines.slice(0, opts.maxResultsPerFile || 100).map(l => ({ line: l.line, content: l.text })),
    });
  }
  return results;
}

module.exports = {
  grepFiles,
  grepDirAggregated,

  name: 'grep',
  desc: '搜索文件内容（支持正则表达式），返回 文件:行号:内容；已知确切关键字或正则时用，只记得大致意思用 semantic_grep',
  params: {
    pattern: '搜索模式（支持正则表达式）',
    path: '搜索目录，默认项目根',
    include: '文件名过滤，可选（如 *.js）',
  },
  needConfirm: false,

  async run({ pattern, path: p, include }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const searchDir = p ? await safeResolve(p, root) : root;

    let regex;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (e) {
      return `无效的正则表达式: ${e.message}`;
    }

    let results = await grepDirAggregated(searchDir, regex, { include, maxResults: 1000 });

    if (include) {
      const includeRegex = new RegExp(include.replace(/\*/g, '.*'));
      results = results.filter(r => includeRegex.test(r.file));
    }

    if (results.length === 0) {
      return '未找到匹配内容';
    }

    const lines = [];
    let totalMatches = 0;

    for (const file of results.slice(0, 50)) {
      totalMatches += file.count;
      lines.push(`\n📄 ${file.file} (${file.count} 处匹配):`);

       for (const match of file.lines.slice(0, 10)) {
         lines.push(`  ${match.line}: ${match.content}`);
       }

      if (file.count > 10) {
        lines.push(`  ... 还有 ${file.count - 10} 处匹配`);
      }
    }

    if (results.length > 50) {
      lines.push(`\n... 还有 ${results.length - 50} 个文件包含匹配`);
    }

    lines.unshift(`找到 ${totalMatches} 处匹配，涉及 ${results.length} 个文件`);
    return lines.join('\n');
  },
};
