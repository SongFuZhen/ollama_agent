'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { runAgent } = require('./agent');
const { listModels } = require('./ollama');
const { safeResolve } = require('./tools');
const { getProjectRoot, saveProjectRoot, validateRoot, isRootPersisted } = require('./rootstore');
const { PROJECT_ROOT, PORT, SCENARIOS, OLLAMA_HOST } = require('./config');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public', 'frontend');
const ROOT_DIR = path.resolve(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB，防内存耗尽（DoS）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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
  let currentConfirmId = null;
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
  // 注意：必须用 res（响应）的 close，而不是 req（请求体）的 close。
  // req 在请求体读完即触发 close，会误把正常请求判为「客户端断开」，
  // 导致答案已生成却因 aborted=true 而不下发、连接挂起（前端收不到响应）。
  res.on('close', onClose);

  // 向已关闭连接写入会抛错，统一拦截
  const send = (obj) => {
    if (aborted) return;
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
    catch (e) { aborted = true; }
  };
  send({ type: 'meta', projectRoot: PROJECT_ROOT, ollamaHost: OLLAMA_HOST, scenarios: SCENARIOS });

  readBody(req).then(async (body) => {
    const { message, scenario, images, model: bodyModel, ollamaHost, projectRoot } = body;
    const sc = SCENARIOS[scenario] || SCENARIOS.general;
    const model = bodyModel || sc.model; // 前端可覆盖模型名
    if (!message && !(images && images.length)) { send({ type: 'error', msg: '缺少 message 或图片' }); res.end(); return; }

    // 解析生效的项目根：前端下发的绝对路径优先（校验有效才用），否则用持久化/默认沙箱
    let effectiveRoot = PROJECT_ROOT;
    if (projectRoot && (await validateRoot(projectRoot))) effectiveRoot = await validateRoot(projectRoot);
    else effectiveRoot = await getProjectRoot();

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

    runAgent(message, { model, scenarioKey: sc.key, confirm, images: images || [], ollamaHost, projectRoot: effectiveRoot }, send)
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

function handlePreflight(res, userHost) {
  const host = userHost || OLLAMA_HOST;
  // 预先构造场景状态；即使 Ollama 不可达，也要把默认模型名下发给前端
  const scenarioStatus = {};
  for (const k of Object.keys(SCENARIOS)) {
    scenarioStatus[k] = { model: SCENARIOS[k].model, ready: false };
  }
  listModels(host)
    .then((models) => {
      const names = models.map((m) => m.name);
      // 逐个场景报告模型是否就绪
      for (const k of Object.keys(SCENARIOS)) {
        scenarioStatus[k].ready = names.includes(SCENARIOS[k].model);
      }
      sendJSON(res, 200, {
        node: process.version,
        ollama: 'ok',
        ollamaHost: host,
        models: names,
        scenarios: scenarioStatus,
        projectRoot: PROJECT_ROOT,
      });
    })
    .catch((e) => sendJSON(res, 200, {
      node: process.version,
      ollama: 'unreachable',
      ollamaHost: host,
      error: e.message,
      scenarios: scenarioStatus,
      projectRoot: PROJECT_ROOT,
    }));
}

function handleConfig(res) {
  sendJSON(res, 200, { scenarios: SCENARIOS, ollamaHost: OLLAMA_HOST, projectRoot: PROJECT_ROOT });
}

// 项目根目录：GET 返回当前生效的根（含是否持久化有效）；POST 校验并持久化
async function handleRootGet(res) {
  const root = await getProjectRoot();
  sendJSON(res, 200, { root, persisted: await isRootPersisted(root), default: PROJECT_ROOT });
}
async function handleRootSave(req, res) {
  let body = {};
  try { body = await readBody(req); } catch (e) {}
  const r = await saveProjectRoot(body.root || '');
  sendJSON(res, r.ok ? 200 : 400, r);
}

// 列出目录内容（受沙箱限制，仅 root 内；root 优先级：前端参数 > 持久化/默认沙箱）
async function handleFsList(req, res) {
  const params = new URL(req.url, 'http://x').searchParams;
  const urlPath = params.get('path') || '';
  const root = params.get('root') || (await getProjectRoot());
  try {
    const abs = await safeResolve(urlPath || '.', root);
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const list = entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: path.relative(root, path.join(abs, e.name)),
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    sendJSON(res, 200, { path: path.relative(root, abs), items: list, root });
  } catch (e) {
    sendJSON(res, 400, { error: e.message });
  }
}

// 读取文件内容（受沙箱限制，仅 root 内）
async function handleFsRead(req, res) {
  const params = new URL(req.url, 'http://x').searchParams;
  const urlPath = params.get('path') || '';
  const root = params.get('root') || (await getProjectRoot());
  try {
    const abs = await safeResolve(urlPath, root);
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) return sendJSON(res, 400, { error: '目标是目录，不是文件' });
    const content = await fsp.readFile(abs, 'utf8');
    sendJSON(res, 200, { path: path.relative(root, abs), content });
  } catch (e) {
    sendJSON(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/preflight') {
    const ollamaHost = new URL(req.url, 'http://x').searchParams.get('ollamaHost') || '';
    return handlePreflight(res, ollamaHost);
  }
  if (req.method === 'GET' && url === '/api/hotreload') return handleHotreload(req, res);
  if (req.method === 'GET' && url === '/api/config') return handleConfig(res);
  if (req.method === 'GET' && url === '/api/root') return handleRootGet(res);
  if (req.method === 'POST' && url === '/api/root') return handleRootSave(req, res);
  if (req.method === 'POST' && url === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && url === '/api/confirm') return handleConfirm(req, res);
  if (req.method === 'GET' && url === '/api/fs/list') return handleFsList(req, res);
  if (req.method === 'GET' && url === '/api/fs/read') return handleFsRead(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

// ---------- 热重载（前端开发便利） ----------
// 浏览器通过 EventSource 连接 /api/hotreload，public/ 下文件变更时收到 reload 指令
const hotClients = new Set();
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
// 监听 public/ 目录（仅文件内容变更，忽略子目录深层以减少开销）
let hotTimer = null;
function startHotwatch() {
  const watchDir = path.resolve(__dirname, '..', 'public');
  fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    // 跳过持久化数据文件与临时文件
    if (filename.includes('project-root.json')) return;
    clearTimeout(hotTimer);
    hotTimer = setTimeout(broadcastHotreload, 120); // 去抖，避免编辑器多次写触发多次刷新
  });
}

server.listen(PORT, () => {
  console.log('本地 Agent 客户端已启动: http://localhost:' + PORT);
  console.log('项目根目录(沙箱): ' + PROJECT_ROOT);
  for (const k of Object.keys(SCENARIOS)) {
    console.log('场景[' + SCENARIOS[k].label + '] -> ' + SCENARIOS[k].model);
  }
  startHotwatch();
});
