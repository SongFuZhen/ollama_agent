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

// 只读兜底解析：沙箱内解析失败时，再尝试「仓库根」(agent 自身源码所在目录)。
// 仅用于解释/读取类场景——开发期用户用 `./src/x.js` 指向 agent 自身代码、而沙箱默认是
// workspace/ 时，避免读不到文件导致"解释代码"返回空内容。写类工具(edit_file/write_file/bash)
// 切勿使用此函数，必须保持沙箱硬隔离，禁止越界。
// 注意：safeResolve 对"目录不存在"的路径会乐观返回（不校验文件存在），故这里用 stat 确认文件
// 真实可读，仅在首个根解析到的文件不存在时才回落到仓库根，避免预读被静默跳过。
const REPO_ROOT = path.resolve(__dirname, '..', '..');
async function safeResolveRead(p, root = PROJECT_ROOT) {
  const roots = [root, REPO_ROOT].filter((r, i, a) => a.indexOf(r) === i); // 去重，沙箱=仓库时只试一次
  let lastErr;
  for (const r of roots) {
    try {
      const abs = await safeResolve(p, r);
      await fsp.stat(abs); // 确认文件真实存在，否则回落下一个根
      return abs;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('文件不存在：' + p);
}

function truncate(text, max = 8000) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[已截断，共 ${text.length} 字符]`;
}

// 工具结果摘要化：7B 在长输出里找关键信息能力弱，且长结果会吞掉上下文。
// 这里把"读大文件 / 长命令输出"压成「头尾 + 关键行 + 一行机器摘要」，
// 既省上下文又帮模型快速定位；保留 read_lines 等逃生口看完整内容。

// 读文件结果：保留前 100 行 + 后 20 行，中间省略，并附行数/函数数摘要。
function summarizeReadFile(text) {
  const lines = text.split('\n');
  const total = lines.length;
  if (total <= 140) return text; // 小文件不摘要，避免误伤短文件
  const head = 100;
  const tail = 20;
  const omitted = total - head - tail;
  const fnCount = (text.match(/\b(function\b|class\b|def\b|=>\s*\(|const\s+\w+\s*=)/g) || []).length;
  const headPart = lines.slice(0, head).join('\n');
  const tailPart = lines.slice(-tail).join('\n');
  const summary =
    `\n\n【摘要】文件共 ${total} 行，约含 ${fnCount} 处函数/类定义；已省略中间 ${omitted} 行。` +
    `\n如需中间内容，用 read_lines(path, start, end) 指定行范围。`;
  return `${headPart}\n... (省略 ${omitted} 行) ...\n${tailPart}${summary}`;
}

// 命令输出：超过 50 行时保留前 10 + 后 10 + 含错误关键词的行，附行数摘要。
function summarizeBash(text) {
  const lines = text.split('\n');
  if (lines.length <= 50) return text;
  const errorLines = lines.filter((l) => /error|Error|失败|异常|Exception|Traceback|✗|FAIL|fatal/i.test(l));
  const headPart = lines.slice(0, 10).join('\n');
  const tailPart = lines.slice(-10).join('\n');
  const errPart = errorLines.length ? '\n--- 关键错误行 ---\n' + errorLines.slice(0, 30).join('\n') : '';
  const summary =
    `\n\n【摘要】命令输出共 ${lines.length} 行${errorLines.length ? `，含 ${errorLines.length} 行疑似错误` : '，未检出明显错误关键词'}。`;
  return `${headPart}\n... (省略 ${lines.length - 20} 行) ...\n${tailPart}${errPart}${summary}`;
}

module.exports = { safeResolve, safeResolveRead, truncate, summarizeReadFile, summarizeBash, PROJECT_ROOT };
