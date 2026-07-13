'use strict';

// apply_diff：原子化应用 unified diff（支持多文件）。
// 纯 JS 解析，沙箱写（复用 safeResolve）；任一文件落盘失败则整体回滚。
const fsp = require('fs/promises');
const { safeResolve } = require('./utils');

// 解析 unified diff 文本为 {file, hunks:[{oldStart,oldLines,newStart,newLines,body}]}
// 兼容 git diff / diff -u 格式；@@ -a,b +c,d @@，无 b/d 时按 +/- 行数推断。
function parseDiff(diffText) {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let cur = null;
  let curHunk = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git')) {
      // 新文件块开始
      cur = { file: null, hunks: [] };
      files.push(cur);
      curHunk = null;
    } else if (line.startsWith('+++ ')) {
      if (!cur) { cur = { file: null, hunks: [] }; files.push(cur); }
      let p = line.slice(4).replace(/^[ab]\//, '').replace(/\t.*$/, '');
      if (p === '/dev/null') p = null;
      cur.file = p;
      curHunk = null;
    } else if (line.startsWith('--- ')) {
      // 取相对路径名（可选，优先 +++ 的）
      if (!cur) { cur = { file: null, hunks: [] }; files.push(cur); }
    } else if (line.startsWith('@@')) {
      if (!cur) continue;
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      curHunk = {
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] != null ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newLines: m[4] != null ? parseInt(m[4], 10) : 1,
        old: [],
        neu: [],
      };
      cur.hunks.push(curHunk);
    } else if (curHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        curHunk.neu.push(line.slice(1));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        curHunk.old.push(line.slice(1));
      } else if (line.startsWith(' ')) {
        curHunk.old.push(line.slice(1));
        curHunk.neu.push(line.slice(1));
      } else if (line === '') {
        // 空行在 diff 里可能是上下文（git 会省略前导空格）；保守当上下文
        curHunk.old.push('');
        curHunk.neu.push('');
      }
      // 其它（如 \ No newline）忽略
    }
  }

  // 过滤掉没拿到文件路径的块
  return files.filter((f) => f.file);
}

// 把 hunks 应用到原始行数组，返回新行数组
function applyHunks(originalLines, hunks) {
  const result = [];
  let oldIdx = 0; // 当前在原文件中的 0-based 行号
  for (const h of hunks) {
    // 先把 hunk 之前的原内容补上（oldStart 是 1-based）
    while (oldIdx < h.oldStart - 1) {
      result.push(originalLines[oldIdx]);
      oldIdx++;
    }
    // 校验上下文匹配
    for (let k = 0; k < h.old.length; k++) {
      const expected = h.old[k];
      const actual = originalLines[oldIdx + k] != null ? originalLines[oldIdx + k] : null;
      if (actual !== expected) {
        throw new Error(`上下文不匹配（行 ~${h.oldStart + k}）：期望 "${expected}"，实际 "${actual == null ? '<EOF>' : actual}"`);
      }
    }
    // 写入新内容
    for (const nl of h.neu) result.push(nl);
    oldIdx += h.old.length;
  }
  // 末尾剩余
  while (oldIdx < originalLines.length) {
    result.push(originalLines[oldIdx]);
    oldIdx++;
  }
  return result;
}

module.exports = {
  name: 'apply_diff',
  desc: '应用 unified diff 补丁（支持多文件，原子化：任一文件失败则整体回滚）',
  params: {
    diff: 'unified diff 文本（可含多个文件，@@ 区块）',
    root: '可选，覆盖沙箱根',
  },
  needConfirm: true,

  async run({ diff }, ctx = {}) {
    if (!diff || !diff.trim()) return '错误：diff 不能为空';
    const files = parseDiff(diff);
    if (!files.length) return '错误：未解析出任何文件的 diff（请使用 unified diff 格式，含 +++ / --- 与 @@）';

    const root = ctx.root || require('./utils').PROJECT_ROOT;
    const changes = []; // {abs, newContent}

    try {
      // 预读所有目标文件内容（新建文件允许不存在），并解析 hunk 应用
      for (const f of files) {
        const abs = await safeResolve(f.file, root);
        let original = '';
        try {
          original = await fsp.readFile(abs, 'utf8');
        } catch (e) {
          if (f.hunks.length && f.hunks[0].oldStart > 0) {
            return `错误：文件不存在却含修改：${f.file}`;
          }
          // 全新文件
        }
        const originalLines = original.split('\n');
        // 若原文件以 \n 结尾，split 会多一个空串尾巴，去掉
        if (originalLines.length && originalLines[originalLines.length - 1] === '') originalLines.pop();
        const newLines = applyHunks(originalLines, f.hunks);
        const newContent = newLines.join('\n') + (original.endsWith('\n') || newLines.length === 0 ? '' : '\n');
        changes.push({ abs, newContent });
      }
    } catch (e) {
      return '错误：应用 diff 失败：' + e.message;
    }

    // 原子写入：先全部写临时，再统一 rename；任一失败整体回滚
    const tmpFiles = [];
    try {
      for (const c of changes) {
        const tmp = c.abs + '.diff.tmp';
        await fsp.writeFile(tmp, c.newContent, 'utf8');
        tmpFiles.push(tmp);
      }
      for (let i = 0; i < changes.length; i++) {
        await fsp.rename(tmpFiles[i], changes[i].abs);
      }
    } catch (e) {
      // 回滚：删除已写临时文件
      for (const t of tmpFiles) { try { await fsp.unlink(t); } catch (_) {} }
      return '错误：应用 diff 失败，已回滚：' + e.message;
    }

    const names = files.map((f) => f.file).join(', ');
    return `已应用 diff 到 ${files.length} 个文件：${names}`;
  },
};

// 导出内部函数供测试
module.exports.parseDiff = parseDiff;
module.exports.applyHunks = applyHunks;
