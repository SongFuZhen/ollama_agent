'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT } = require('../config');

// 路径沙箱：所有工具调用必须落在指定 root 内
const _rootRealCache = new Map();
async function rootReal(root) {
  if (!_rootRealCache.has(root)) _rootRealCache.set(root, await fsp.realpath(root));
  return _rootRealCache.get(root);
}

async function safeResolve(p, root = PROJECT_ROOT) {
  const realRoot = await rootReal(root);

  let abs;
  if (path.isAbsolute(p)) {
    // 绝对路径：如果在沙箱内直接使用，否则拒绝（不再静默 redirect 到不存在路径）
    const rel = path.relative(realRoot, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      abs = p;
    } else {
      throw new Error('绝对路径超出沙箱，已阻止：' + p + '\n请使用相对路径（如 src/server.js），沙箱根为 ' + root);
    }
  } else {
    abs = path.resolve(realRoot, p);
  }

  let realBase;
  try {
    realBase = await fsp.realpath(path.dirname(abs));
  } catch (e) {
    const rel = path.relative(realRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('路径越界，已阻止：' + p);
    }
    return abs;
  }

  const realTarget = path.join(realBase, path.basename(abs));
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界（含符号链接），已阻止：' + p);
  }
  return realTarget;
}

function truncate(text, max = 8000) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[已截断，共 ${text.length} 字符]`;
}

module.exports = { safeResolve, truncate, PROJECT_ROOT };
