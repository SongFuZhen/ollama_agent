'use strict';

// 前端热重载（开发便利）：监听 public/ 下文件变更，通过 SSE 通知浏览器刷新。
// 与 HTTP 路由解耦，单独作为一个模块，避免 server.js 体积过大、职责混杂。

const fs = require('fs');
const path = require('path');

const hotClients = new Set();
let hotTimer = null;
const hotWatchDirs = new Set();

// SSE 端点：浏览器连接后，public/ 变更时收到 reload 事件
function handleHotreload(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  hotClients.add(res);
  req.on('close', () => hotClients.delete(res));
}

function broadcastHotreload() {
  for (const res of hotClients) {
    try { res.write('event: reload\ndata: 1\n\n'); } catch (e) { hotClients.delete(res); }
  }
}

function onHotEvent(filename) {
  if (filename && filename.includes('project-root.json')) return;
  clearTimeout(hotTimer);
  hotTimer = setTimeout(broadcastHotreload, 120); // 去抖
}

function watchOneDir(dir) {
  if (hotWatchDirs.has(dir)) return;
  hotWatchDirs.add(dir);
  try {
    fs.watch(dir, (eventType, filename) => onHotEvent(filename));
  } catch (e) { /* 目录可能已删除或平台不支持，忽略 */ }
}

// 监听 public/ 目录变更并触发热重载。
// 跨平台：recursive:true 仅 macOS/Windows 支持，Linux 上被忽略，
// 因此 Linux 走「递归 fs.watch 每个子目录」兜底。
function startHotwatch() {
  const watchDir = path.resolve(__dirname, '..', '..', 'public');
  // 递归收集所有子目录（含根），跳过 node_modules 与隐藏目录（.git/.omo 等），避免监听过多/循环
  const dirs = [watchDir];
  (function collect(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      dirs.push(sub);
      collect(sub);
    }
  })(watchDir);
  // 对每个目录（含根）单独 watch（不带 recursive），个别目录失败不中断整体
  for (const dir of dirs) {
    watchOneDir(dir);
  }
}

module.exports = { handleHotreload, startHotwatch };
