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

  // 7B 小模型常见错误：把绝对路径当相对路径传，或把沙箱根重复拼进路径
  // （如沙箱根为 /a/b，却传来 /a/b/src/x 或 /a/b/workspace/src/x）。
  // 这里做一层容错归一化：若绝对路径越界但「包含沙箱根为前缀」，
  // 剥掉该前缀当相对路径处理，避免模型因路径格式反复触雷。
  // （/ 这种真正在沙箱外的绝对路径仍会走到下方拒绝逻辑，无法救。）
  let normalized = p;
  if (typeof p === 'string' && p.length > 1) {
    let rp = p;
    // 统一斜杠，便于前缀匹配
    if (process.platform === 'win32') rp = rp.replace(/\//g, '\\');
    const rr = process.platform === 'win32' ? realRoot.replace(/\//g, '\\') : realRoot;
    // 前缀匹配（大小写不敏感，兼容 Windows 盘符）
    if (rp.toLowerCase().startsWith(rr.toLowerCase() + (process.platform === 'win32' ? '\\' : '/'))) {
      const stripped = p.slice(rr.length);
      normalized = stripped.replace(/^[/\\]+/, '');
    }
  }

  let abs;
  if (path.isAbsolute(normalized)) {
    // 绝对路径：如果在沙箱内直接使用，否则拒绝（不再静默 redirect 到不存在路径）
    const rel = path.relative(realRoot, normalized);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      abs = normalized;
    } else {
      throw new Error('绝对路径超出沙箱，已阻止：' + p + '\n请使用相对路径（如 src/server.js），沙箱根为 ' + root);
    }
  } else {
    abs = path.resolve(realRoot, normalized);
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
