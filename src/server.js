'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { runAgent } = require('./agent');
const { listModels } = require('./ollama');
const { PROJECT_ROOT, PORT, SCENARIOS, OLLAMA_HOST } = require('./config');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public', 'frontend');
const ROOT_DIR = path.resolve(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB，防内存耗尽（DoS）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// 待确认的写操作请求：key=reqId -> resolve
const pendingConfirm = new Map();
let confirmSeq = 0;

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') {
    // 首页位于 public/ 根，其余静态资源在 public/frontend/
    const indexPath = path.join(ROOT_DIR, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  // 用 path.join 拼接后，再用 path.relative 判断是否逃出 PUBLIC_DIR
  const filePath = path.resolve(PUBLIC_DIR, path.join('.', urlPath));
  const rel = path.relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY) {
        req.destroy(); // 超上限直接断开，避免继续累积占用内存
        reject(new Error('请求体过大（上限 ' + MAX_BODY + ' 字节）'));
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('请求体 JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function handleChat(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // 客户端断开标志：用于中断 Agent 循环、避免向已关闭连接写入
  let aborted = false;
  const onClose = () => {
    aborted = true;
    // 清理本连接等待中的确认项，避免 pendingConfirm 泄漏
    for (const [id, resolve] of pendingConfirm) {
      if (id === currentConfirmId) {
        pendingConfirm.delete(id);
        resolve(false); // 视为拒绝，让 Agent 循环退出
      }
    }
  };
  req.on('close', onClose);

  // 向已关闭连接写入会抛错，统一拦截
  const send = (obj) => {
    if (aborted) return;
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
    catch (e) { aborted = true; }
  };
  send({ type: 'meta', projectRoot: PROJECT_ROOT, ollamaHost: OLLAMA_HOST, scenarios: SCENARIOS });

  let currentConfirmId = null;

  readBody(req).then((body) => {
    const { message, scenario } = body;
    const sc = SCENARIOS[scenario] || SCENARIOS.general;
    if (!message) { send({ type: 'error', msg: '缺少 message' }); res.end(); return; }

    const confirm = (reqInfo) =>
      new Promise((resolve) => {
        if (aborted) return resolve(false);
        const id = ++confirmSeq;
        currentConfirmId = id;
        pendingConfirm.set(id, (ok) => {
          currentConfirmId = null;
          pendingConfirm.delete(id);
          resolve(ok);
        });
        send({ type: 'confirm_request', id, ...reqInfo });
      });

    runAgent(message, { model: sc.model, scenarioKey: sc.key, confirm }, send)
      .catch((e) => { if (!aborted) send({ type: 'error', msg: e.message }); })
      .finally(() => { if (!aborted) res.end(); });
  }).catch((e) => {
    if (!aborted) { send({ type: 'error', msg: e.message }); res.end(); }
  });
}

function handleConfirm(req, res) {
  readBody(req).then((body) => {
    const { id, ok } = body;
    const fn = pendingConfirm.get(Number(id));
    if (fn) { pendingConfirm.delete(Number(id)); fn(Boolean(ok)); sendJSON(res, 200, { ok: true }); }
    else sendJSON(res, 404, { ok: false, msg: '确认请求不存在或已过期' });
  }).catch((e) => sendJSON(res, 400, { ok: false, msg: e.message }));
}

function handlePreflight(res) {
  listModels()
    .then((models) => {
      const names = models.map((m) => m.name);
      // 逐个场景报告模型是否就绪
      const scenarioStatus = {};
      for (const k of Object.keys(SCENARIOS)) {
        scenarioStatus[k] = { model: SCENARIOS[k].model, ready: names.includes(SCENARIOS[k].model) };
      }
      sendJSON(res, 200, {
        node: process.version,
        ollama: 'ok',
        ollamaHost: OLLAMA_HOST,
        models: names,
        scenarios: scenarioStatus,
        projectRoot: PROJECT_ROOT,
      });
    })
    .catch((e) => sendJSON(res, 200, {
      node: process.version,
      ollama: 'unreachable',
      ollamaHost: OLLAMA_HOST,
      error: e.message,
      projectRoot: PROJECT_ROOT,
    }));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/preflight') return handlePreflight(res);
  if (req.method === 'POST' && url === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && url === '/api/confirm') return handleConfirm(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, () => {
  console.log('本地 Agent 客户端已启动: http://localhost:' + PORT);
  console.log('项目根目录(沙箱): ' + PROJECT_ROOT);
  for (const k of Object.keys(SCENARIOS)) {
    console.log('场景[' + SCENARIOS[k].label + '] -> ' + SCENARIOS[k].model);
  }
});
