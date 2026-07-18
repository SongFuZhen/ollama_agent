'use strict';

// 文件日志：写入 data/agent.log（纯 fs，零原生依赖，与 db.js 同目录约定）。
// 同时回显到 stdout，保持与原 console.log 行为一致（终端可直接看，亦可用 `npm start > x.log` 重定向）。
// 文件超过 MAX_BYTES 时轮转：agent.log -> agent.log.1（仅保留一份历史，避免无限增长）。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'agent.log');
const MAX_BYTES = 2 * 1024 * 1024; // 2MB 后轮转

let dirReady = null;
function ensureDir() {
  if (!dirReady) dirReady = fsp.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  return dirReady;
}

function ts() {
  // 本地时间 YYYY-MM-DD HH:MM:SS.mmm，便于离线排查
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

async function rotateIfNeeded() {
  try {
    const st = await fsp.stat(LOG_PATH);
    if (st.size > MAX_BYTES) {
      await fsp.rename(LOG_PATH, LOG_PATH + '.1').catch(() => {});
    }
  } catch (e) { /* 文件不存在则无需轮转 */ }
}

// 落盘一行（仅写文件，不碰 console，避免与 console 包装互相递归）
async function appendLine(line) {
  await ensureDir();
  await rotateIfNeeded();
  await fsp.appendFile(LOG_PATH, line + '\n', 'utf8');
}

// 统一入口：msg 为已格式化的字符串。所有日志经此处落盘 + 回显。
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  origLog(line);                 // 原 stdout 回显
  appendLine(line).catch(() => {});
}

// 保留原始 console 引用，包装后仍能回显到终端且不触发递归写文件
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
const origWarn = console.warn.bind(console);

// 让散落在各处的 console.*（agent 工具调试、错误堆栈、加载失败等）也落盘，
// 否则这些内容只打到终端，刷新页面后运行日志抽屉里看不到任何运行时活动。
function fmtArg(a) {
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (typeof a === 'object') {
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  return String(a);
}
['log', 'error', 'warn'].forEach((lvl) => {
  const orig = lvl === 'error' ? origErr : lvl === 'warn' ? origWarn : origLog;
  console[lvl] = (...args) => {
    orig.apply(null, args);
    const line = `[${ts()}] [${lvl}] ${args.map(fmtArg).join(' ')}`;
    appendLine(line).catch(() => {});
  };
});

module.exports = { log, LOG_PATH };
