'use strict';

const http = require('http');
const fs = require('fs');
const { execFile, execSync, spawnSync } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const { runAgent } = require('./core/agent');
const { listModels, hostParts } = require('./core/ollama');
const { safeResolve, allSpecs } = require('./tools/index');
const { getProjectRoot, saveProjectRoot, validateRoot, isRootPersisted } = require('./storage/rootstore');
const { PROJECT_ROOT, PORT, DEFAULT_MODEL, OLLAMA_HOST } = require('./config');
const { resolveMode } = require('./core/workflow');
const db = require('./storage/db');
const { getDeviceId, getDevice } = require('./device/device');
const { handleHotreload, startHotwatch } = require('./server/hotreload');
const { log, LOG_PATH } = require('./server/logger');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public', 'frontend');
const ROOT_DIR = path.resolve(__dirname, '..', 'public');
const LIB_DIR = path.resolve(__dirname, '..', 'public', 'lib');
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB，防内存耗尽（DoS）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// 待确认的写操作请求：key=reqId -> resolve
const pendingConfirm = new Map();
// ask_user 问答请求：key=reqId -> resolve(answer)
const pendingAsk = new Map();
let confirmSeq = 0;

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];

  // 特殊处理：根路径返回 index.html
  if (urlPath === '/') {
    const indexPath = path.join(ROOT_DIR, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // 先尝试从 ROOT_DIR (public/) 读取 HTML 文件（支持 simpui.html 等）
  if (urlPath.endsWith('.html')) {
    const rootFilePath = path.resolve(ROOT_DIR, path.join('.', urlPath));
    const rootRel = path.relative(ROOT_DIR, rootFilePath);
    if (!rootRel.startsWith('..') && !path.isAbsolute(rootRel)) {
      try {
        const data = fs.readFileSync(rootFilePath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
        return;
      } catch (e) {
        // 继续尝试其他路径
      }
    }
  }

  // 用 path.join 拼接后，再用 path.relative 判断是否逃出 PUBLIC_DIR
  // 特殊处理：/lib/ 路径从 LIB_DIR 读取
  let filePath;
  let rel;
  if (urlPath.startsWith('/lib/')) {
    // /lib/xxx -> 从 public/lib/xxx 读取
    const libPath = urlPath.slice(5); // 去掉 '/lib/' 前缀
    filePath = path.resolve(LIB_DIR, libPath);
    rel = path.relative(LIB_DIR, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  } else {
    // 按优先级尝试多个目录：PUBLIC_DIR -> ROOT_DIR -> LIB_DIR
    const tryDirs = [PUBLIC_DIR, ROOT_DIR, LIB_DIR];
    for (const dir of tryDirs) {
      filePath = path.resolve(dir, path.join('.', urlPath));
      rel = path.relative(dir, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
        return;
      } catch (e) {
        // 文件不存在，继续尝试下一个目录
      }
    }
    res.writeHead(404); res.end('not found');
    return;
  }
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
  if (res.socket) res.socket.setNoDelay(true);

  // 客户端断开标志：用于中断 Agent 循环、避免向已关闭连接写入
  let aborted = false;
  let currentConfirmId = null;
  // 后端取消控制器：客户端断开（前端中止/关闭页面）时 abort，signal 透传 runAgent，
  // 真正中断 Ollama 生成（此前 runAgent 在 aborted 后仍在跑直到自然结束/90s 超时）。
  const agentAbort = new AbortController();
  const onClose = () => {
    aborted = true;
    agentAbort.abort(); // 通知 runAgent 主循环与 Ollama 连接一并取消
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
    // 自愈事件结构化日志：带上第 N/M 次计数，落盘 data/agent.log 便于离线排查弱模型修复收敛
    if (obj && obj.type === 'verify' && /^heal_/.test(obj.status || '')) {
      const cnt = obj.max ? ` ${obj.attempt || 0}/${obj.max}` : '';
      log(`[自愈] ${obj.status}${cnt} (step ${obj.step || '-'}): ${(obj.output || '').replace(/\n/g, ' ').slice(0, 200)}`);
    }
    if (aborted) return;
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
    catch (e) { aborted = true; }
  };
  readBody(req).then(async (body) => {
    const { message, images, model: bodyModel, ollamaHost, projectRoot, history, conversationId } = body;
    const model = bodyModel || DEFAULT_MODEL; // 前端可覆盖模型名
    send({ type: 'meta', projectRoot: PROJECT_ROOT, ollamaHost: OLLAMA_HOST, tools: allSpecs(), model });
    if (!message && !(images && images.length)) { send({ type: 'error', msg: '缺少 message 或图片' }); res.end(); return; }

    // 规划模式入口：WORKFLOW_MODE='auto' 时复杂任务自动进 plan；'/plan ' 前缀或
    // body.mode 显式值可强制覆盖。plan 只调研不改动，最终返回可确认的执行计划
    // （前端据此二次确认再 execute）。body.mode='execute' 用于二段式跳过自动判定。
    const { mode, planMessage } = resolveMode(message, body.mode);

    // 解析生效的项目根：前端下发的绝对路径优先（校验有效才用），否则用持久化/默认沙箱
    let effectiveRoot = PROJECT_ROOT;
    if (projectRoot && (await validateRoot(projectRoot))) effectiveRoot = await validateRoot(projectRoot);
    else effectiveRoot = await getProjectRoot();

    const confirm = (reqInfo) =>
      new Promise((resolve) => {
        if (aborted) return resolve(false);
        const id = ++confirmSeq;
        currentConfirmId = id;
        pendingConfirm.set(id, (payload) => {
          currentConfirmId = null;
          pendingConfirm.delete(id);
          // payload 可为布尔（写操作确认）或 {ok, answer}（ask_user 问答）
          resolve(payload);
        });
        send({ type: 'confirm_request', id, ...reqInfo });
      });

    // ask_user 问答通道：emit 一个问题事件，等前端以 {id, answer} 回应，返回 answer 文本
    const askUser = (question) =>
      new Promise((resolve) => {
        if (aborted) return resolve('（已中断）');
        const id = ++confirmSeq;
        pendingAsk.set(id, (answer) => {
          pendingAsk.delete(id);
          resolve(typeof answer === 'string' ? answer : '');
        });
        send({ type: 'ask_user_request', id, question });
      });

    runAgent(planMessage, { model, confirm, askUser, images: images || [], ollamaHost, projectRoot: effectiveRoot, history, conversationId, mode, signal: agentAbort.signal }, send)
      .catch((e) => { if (!aborted) send({ type: 'error', msg: e.message }); })
      .finally(() => { if (!aborted) res.end(); });
  }).catch((e) => {
    if (!aborted) { send({ type: 'error', msg: e.message }); res.end(); }
  });
}

function handleConfirm(req, res) {
  readBody(req).then((body) => {
    const { id, ok, answer } = body;
    const fn = pendingConfirm.get(Number(id));
    if (fn) { pendingConfirm.delete(Number(id)); fn({ ok: Boolean(ok), answer: answer != null ? String(answer) : '' }); sendJSON(res, 200, { ok: true }); }
    else sendJSON(res, 404, { ok: false, msg: '确认请求不存在或已过期' });
  }).catch((e) => sendJSON(res, 400, { ok: false, msg: e.message }));
}

// ask_user 回答：前端把用户文本回传，resolve 对应提问
function handleAskUser(req, res) {
  readBody(req).then((body) => {
    const { id, answer } = body;
    const fn = pendingAsk.get(Number(id));
    if (fn) { pendingAsk.delete(Number(id)); fn(answer != null ? String(answer) : ''); sendJSON(res, 200, { ok: true }); }
    else sendJSON(res, 404, { ok: false, msg: '提问请求不存在或已过期' });
  }).catch((e) => sendJSON(res, 400, { ok: false, msg: e.message }));
}

function handlePreflight(res, userHost) {
  const host = userHost || OLLAMA_HOST;
  listModels(host)
    .then((models) => {
      const names = models.map((m) => m.name);
      sendJSON(res, 200, {
        node: process.version,
        ollama: 'ok',
        ollamaHost: host,
        models: names,
        defaultModel: DEFAULT_MODEL,
        projectRoot: PROJECT_ROOT,
      });
    })
    .catch((e) => sendJSON(res, 200, {
      node: process.version,
      ollama: 'unreachable',
      ollamaHost: host,
      error: e.message,
      defaultModel: DEFAULT_MODEL,
      projectRoot: PROJECT_ROOT,
    }));
}

function handleConfig(res) {
  sendJSON(res, 200, {
    ollamaHost: OLLAMA_HOST,
    projectRoot: PROJECT_ROOT,
    tools: allSpecs(),
    defaultModel: DEFAULT_MODEL,   // 状态栏模型名不再依赖 preflight 往返（离线也可显示）
  });
}

// 显式语义召回：/api/recall?query=...&k=5
// 返回命中的历史记忆片段（含 embedding 时语义排序，否则关键词降级）。
async function handleRecall(req, res) {
  const u = new URL(req.url, 'http://x');
  const query = u.searchParams.get('query') || '';
  const k = Math.max(1, Math.min(20, Number(u.searchParams.get('k')) || 5));
  const ollamaHost = u.searchParams.get('ollamaHost') || '';
  try {
    const { buildRecallPrompt, setEmbedAvailable } = require('./memory/recall');
    const text = await buildRecallPrompt(query, ollamaHost ? { ollamaHost } : {});
    // 同时返回结构化片段，便于前端展示
    const db = require('./storage/db');
    let chunks = [];
    if (query) {
      const { embed } = require('./core/ollama');
      try {
        const q = await embed(query, ollamaHost ? { ollamaHost } : {});
        const all = db.getAllMemory();
        chunks = require('./memory/recall').cosineTopK(all, Float32Array.from(q), k).map(c => ({ role: c.role, content: c.content }));
      } catch (e) {
        chunks = db.searchMemoryKeyword(query, k).map(c => ({ role: c.role, content: c.content }));
      }
    } else {
      chunks = db.getAllMemory().slice(-k).map(c => ({ role: c.role, content: c.content }));
    }
    sendJSON(res, 200, { ok: true, query, count: chunks.length, prompt: text, chunks });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
}

// 查询模型的 context window 大小（通过 Ollama /api/show）
function handleModelContext(req, res) {
  const model = new URL(req.url, 'http://x').searchParams.get('model') || '';
  if (!model) return sendJSON(res, 400, { error: '缺少 model 参数' });

  // 复用 ollama.js 的 host 解析（统一格式校验，错误不再静默降级到 localhost）
  let host, port;
  try {
    const oh = new URL(req.url, 'http://x').searchParams.get('ollamaHost') || OLLAMA_HOST;
    ({ host, port } = hostParts(oh));
  } catch (e) {
    return sendJSON(res, 400, { model, contextSize: 0, error: e.message });
  }

  const body = JSON.stringify({ name: model });
  const r = http.request(
    { host, port, path: '/api/show', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (apiRes) => {
      let data = '';
      apiRes.on('data', (c) => (data += c));
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          // 从 model_info 中提取 context_length 相关字段
          const info = json.model_info || {};
          let ctxSize = 0;
          for (const key of Object.keys(info)) {
            if (/context_length|max_position|num_ctx|n_ctx|max_seq_len/i.test(key)) {
              ctxSize = parseInt(info[key], 10) || 0;
              break;
            }
          }
          sendJSON(res, 200, { model, contextSize: ctxSize || 0 });
        } catch (e) {
          sendJSON(res, 200, { model, contextSize: 0, error: '解析失败' });
        }
      });
    }
  );
  r.on('error', () => sendJSON(res, 200, { model, contextSize: 0, error: 'Ollama 不可达' }));
  r.write(body);
  r.end();
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
    const st = await fsp.stat(abs);
    if (!st.isDirectory()) {
      return sendJSON(res, 400, { error: '不是目录: ' + (urlPath || '.') });
    }
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

// 列出某绝对路径下的直接子目录（供前端目录选择器导航服务端真实文件系统）
// 返回：当前绝对路径、父目录（若存在）、子目录列表。兜底从默认沙箱向上探索。
async function handleFsDirs(req, res) {
  const params = new URL(req.url, 'http://x').searchParams;
  let target = params.get('path');
  // 未指定路径：从默认沙箱根开始
  if (!target || !target.trim()) {
    target = (await getProjectRoot());
  }
  try {
    let abs = path.resolve(target.trim());
    // 若指定路径不存在，向上回退到首个存在的祖先目录
    let stat = null;
    try { stat = await fsp.stat(abs); } catch (e) { stat = null; }
    while (!stat || !stat.isDirectory()) {
      const parent = path.dirname(abs);
      if (parent === abs) break; // 已到文件系统根
      abs = parent;
      try { stat = await fsp.stat(abs); } catch (e) { stat = null; }
    }
    const parent = path.dirname(abs);
    const parentPath = parent === abs ? null : parent;
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    sendJSON(res, 200, { path: abs, parent: parentPath, dirs });
  } catch (e) {
    sendJSON(res, 400, { error: e.message });
  }
}

// 读取 git 分支名（用于状态栏展示，非 git 仓库返回空）
// 仅探测用户传入的 root（或默认 PROJECT_ROOT），不回退 process.cwd()——
// 否则当用户绑定的目录不是 git 仓库时，会错误地显示 server 启动目录的分支。
function handleGitBranch(req, res) {
  const params = new URL(req.url, 'http://x').searchParams;
  const root = params.get('root') || PROJECT_ROOT;
  if (!root) return sendJSON(res, 200, { branch: '' });

  const r = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000, encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    const branch = r.stdout.trim();
    if (branch) return sendJSON(res, 200, { branch });
  }
  sendJSON(res, 200, { branch: '' });
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

// 上传图片：保存到 启动目录/photos/<日期>/<对话ID>/<时间戳>_<名>
// 返回相对路径，便于随对话持久化、历史回放直接加载
const UPLOAD_DIR = 'photos';
async function handleUpload(req, res) {
  try {
    const body = await parseBody(req);
    const convId = (body.convId || 'unknown').replace(/[^A-Za-z0-9_\-]/g, '_');
    const name = (body.name || 'image.png').replace(/[^A-Za-z0-9_.\-]/g, '_');
    const data = body.data;
    if (!data || typeof data !== 'string') return sendJSON(res, 400, { error: '缺少图片数据' });

    // base64 前缀处理
    const m = /^data:image\/([a-zA-Z+]+);base64,(.*)$/.exec(data);
    const ext = m ? (m[1].replace('+', '') || 'png') : (path.extname(name) || 'png').replace('.', '');
    const b64 = m ? m[2] : data;
    let buf;
    try { buf = Buffer.from(b64, 'base64'); }
    catch (e) { return sendJSON(res, 400, { error: '图片数据无效' }); }

    const datePart = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const safeName = `${Date.now()}-${name}`;
    const relDir = path.join(UPLOAD_DIR, datePart, convId);
    // 存储在启动目录下（process.cwd()），而非项目目录
    const targetDir = path.resolve(process.cwd(), relDir);
    await fsp.mkdir(targetDir, { recursive: true });
    const targetAbs = path.join(targetDir, safeName);
    await fsp.writeFile(targetAbs, buf);

    const rel = path.join(relDir, safeName).split(path.sep).join('/');
    sendJSON(res, 200, { ok: true, path: rel, name });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

// 读取已保存的图片，按扩展名返回 content-type
// 支持两种路径：photos/ 开头从启动目录读取，其他从项目目录读取
async function handleFile(req, res) {
  const params = new URL(req.url, 'http://x').searchParams;
  const urlPath = params.get('path') || '';
  const root = params.get('root') || (await getProjectRoot());
  try {
    // photos/ 开头的路径从启动目录读取
    const basePath = urlPath.startsWith('photos/') ? process.cwd() : root;
    const abs = await safeResolve(urlPath, basePath);
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) return sendJSON(res, 400, { error: '目标是目录' });
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const data = await fsp.readFile(abs);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
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
  if (req.method === 'GET' && url === '/api/recall') return handleRecall(req, res);
  if (req.method === 'GET' && url.startsWith('/api/log')) return handleLog(req, res);
  if (req.method === 'GET' && url === '/api/notes') return sendJSON(res, 200, db.getNotes());
  if (req.method === 'POST' && url === '/api/notes') return handleNotesPost(req, res);
  if (req.method === 'GET' && url === '/api/todos') return sendJSON(res, 200, db.getTodos());
  if (req.method === 'POST' && url === '/api/todos') return handleTodosPost(req, res);
  if (req.method === 'GET' && url === '/api/model/context') return handleModelContext(req, res);
  if (req.method === 'GET' && url === '/api/root') return handleRootGet(res);
  if (req.method === 'POST' && url === '/api/root') return handleRootSave(req, res);
  if (req.method === 'POST' && url === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && url === '/api/confirm') return handleConfirm(req, res);
  if (req.method === 'POST' && url === '/api/ask-user') return handleAskUser(req, res);
  if (req.method === 'GET' && url === '/api/fs/list') return handleFsList(req, res);
  if (req.method === 'GET' && url === '/api/fs/dirs') return handleFsDirs(req, res);
  if (req.method === 'GET' && url === '/api/fs/read') return handleFsRead(req, res);
  if (req.method === 'GET' && url === '/api/fs/git-branch') return handleGitBranch(req, res);
  if (req.method === 'POST' && url === '/api/upload') return handleUpload(req, res);
  if (req.method === 'GET' && url === '/api/file') return handleFile(req, res);
  // 对话 API
  if (req.method === 'GET' && url === '/api/device') return handleGetDevice(req, res);
  if (req.method === 'GET' && url.startsWith('/api/conversations')) return handleGetConversations(req, res);
  if (req.method === 'GET' && url.startsWith('/api/conversation/') && url.endsWith('/stats')) return handleGetConversationStats(req, res);
  if (req.method === 'GET' && url.startsWith('/api/conversation/')) return handleGetConversation(req, res);
  if (req.method === 'POST' && url === '/api/conversation') return handleSaveConversation(req, res);
  if (req.method === 'PATCH' && url.startsWith('/api/conversation/')) return handleRenameConversation(req, res);
  if (req.method === 'DELETE' && url.startsWith('/api/conversation/')) return handleDeleteConversation(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

// ---------- 日志查看 API ----------
// GET /api/log?lines=N  返回末尾 N 行（默认 200）；?download=1 直接下载完整文件
async function handleLog(req, res) {
  const urlObj = new URL(req.url, 'http://localhost');
  const download = urlObj.searchParams.get('download') === '1';
  const lines = Math.min(Math.max(parseInt(urlObj.searchParams.get('lines') || '200', 10) || 200, 1), 5000);
  let content = '';
  try {
    content = await fsp.readFile(LOG_PATH, 'utf8');
  } catch (e) {
    content = ''; // 日志尚未生成
  }
  if (download) {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="agent.log"',
    });
    res.end(content);
    return;
  }
  // 取末尾 N 行（保留换行），避免大文件一次性全量下发
  const all = content.split('\n');
  const tail = all.slice(Math.max(0, all.length - lines - 1)).join('\n');
  sendJSON(res, 200, { content: tail, totalLines: all.length - 1, path: LOG_PATH });
}

// ---------- 笔记 / 待办 API（本地、离线） ----------
// POST /api/notes { action: add|update|delete, id?, title?, content? }
async function handleNotesPost(req, res) {
  try {
    const { action, id, title, content } = await parseBody(req);
    const act = action || 'add';
    if (act === 'add') {
      if (content == null || !String(content).trim()) return sendJSON(res, 400, { error: 'content required' });
      db.addNote({ title: title == null ? '' : String(title), content: String(content) });
      return sendJSON(res, 200, { ok: true, notes: db.getNotes() });
    }
    if (act === 'update') {
      if (id == null) return sendJSON(res, 400, { error: 'id required' });
      const fields = {};
      if (title !== undefined) fields.title = String(title);
      if (content !== undefined) fields.content = String(content);
      db.updateNote(Number(id), fields);
      return sendJSON(res, 200, { ok: true, notes: db.getNotes() });
    }
    if (act === 'delete') {
      if (id == null) return sendJSON(res, 400, { error: 'id required' });
      db.deleteNote(Number(id));
      return sendJSON(res, 200, { ok: true, notes: db.getNotes() });
    }
    return sendJSON(res, 400, { error: 'action 仅支持 add / update / delete' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
}

// POST /api/todos { action: add|update|toggle|status|delete, id?, title?, body?, priority?, due?, status? }
async function handleTodosPost(req, res) {
  try {
    const { action, id, title, body, priority, due, status } = await parseBody(req);
    const act = action || 'add';
    if (act === 'add') {
      if (title == null || !String(title).trim()) return sendJSON(res, 400, { error: 'title required' });
      db.addTodo({
        title: String(title),
        body: body == null ? '' : String(body),
        priority: priority || 'medium',
        due: due || null,
      });
      return sendJSON(res, 200, { ok: true, todos: db.getTodos() });
    }
    if (act === 'update') {
      if (id == null) return sendJSON(res, 400, { error: 'id required' });
      const fields = {};
      if (title !== undefined) fields.title = String(title);
      if (body !== undefined) fields.body = String(body);
      if (priority !== undefined) fields.priority = String(priority);
      if (due !== undefined) fields.due = due || null;
      if (status !== undefined) fields.status = String(status);
      db.updateTodo(Number(id), fields);
      return sendJSON(res, 200, { ok: true, todos: db.getTodos() });
    }
    if (act === 'toggle' || act === 'status') {
      if (id == null) return sendJSON(res, 400, { error: 'id required' });
      let next;
      if (act === 'status') {
        next = status || 'done';
      } else {
        // toggle: todo/doing -> done, done -> todo（done 取消回 todo）
        const todo = db.getTodos().find((t) => t.id === Number(id));
        if (!todo) return sendJSON(res, 404, { error: 'not found' });
        next = todo.status === 'done' ? 'todo' : 'done';
      }
      db.setTodoStatus(Number(id), next);
      return sendJSON(res, 200, { ok: true, todos: db.getTodos() });
    }
    if (act === 'delete') {
      if (id == null) return sendJSON(res, 400, { error: 'id required' });
      db.deleteTodo(Number(id));
      return sendJSON(res, 200, { ok: true, todos: db.getTodos() });
    }
    return sendJSON(res, 400, { error: 'action 仅支持 add / update / toggle / status / delete' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
}

// ---------- 设备 API ----------
async function handleGetDevice(req, res) {
  const deviceId = getDeviceId();
  const deviceInfo = getDevice();
  const device = db.getDevice(deviceId);
  sendJSON(res, 200, {
    id: deviceId,
    ...deviceInfo,
    first_seen: device?.first_seen,
    last_seen: device?.last_seen,
  });
}

// ---------- 对话 API 处理函数 ----------
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleGetConversations(req, res) {
  const conversations = db.getConversations();
  sendJSON(res, 200, conversations);
}

async function handleGetConversation(req, res) {
  const id = req.url.split('/api/conversation/')[1]?.split('?')[0];
  if (!id) return sendJSON(res, 400, { error: 'id required' });
  const conversation = db.getConversation(id);
  if (!conversation) return sendJSON(res, 404, { error: 'not found' });
  const messages = db.getMessages(id);
  const stats = db.getConversationStats(id);
  sendJSON(res, 200, { ...conversation, messages, stats });
}

async function handleGetConversationStats(req, res) {
  const id = req.url.split('/api/conversation/')[1]?.split('/stats')[0];
  if (!id) return sendJSON(res, 400, { error: 'id required' });
  const stats = db.getConversationStats(id);
  sendJSON(res, 200, stats);
}

async function handleSaveConversation(req, res) {
  try {
    const { id, title, projectRoot, messages, contextClearedAt } = await parseBody(req);
    if (!id) return sendJSON(res, 400, { error: 'id required' });
    
    const existing = db.getConversation(id);
    if (!existing) {
      db.createConversation(id, title || '', projectRoot || '', contextClearedAt || null);
    } else {
      if (title) db.updateConversationTitle(id, title);
      // 更新 project_root（如果提供了新值）
      if (projectRoot !== undefined) {
        db.updateConversationRoot(id, projectRoot);
      }
      // 清除上下文时间戳：仅当本次携带有效值时更新（null 表示本次未清除，保留历史值）
      if (contextClearedAt !== undefined) {
        db.updateConversationContextCleared(id, contextClearedAt || null);
      }
    }
    
    if (messages && Array.isArray(messages)) {
      // 整体覆盖：先删除旧消息，再写入完整列表，避免重复累积
      db.deleteMessages(id);
      for (const msg of messages) {
        db.addMessage(id, msg.role, msg.content, msg.model || null, msg.tools || null, msg.thinks || null, msg.images || null, msg.stats || null);
      }
    }
    
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleRenameConversation(req, res) {
  try {
    const { id, title } = await parseBody(req);
    if (!id) return sendJSON(res, 400, { error: 'id required' });
    db.updateConversationTitle(id, title || '');
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleDeleteConversation(req, res) {
  const id = req.url.split('/api/conversation/')[1]?.split('?')[0];
  if (!id) return sendJSON(res, 400, { error: 'id required' });
  db.deleteConversation(id);
  sendJSON(res, 200, { ok: true });
}

// 初始化数据库并启动服务器
db.initDB().then(() => {
  const deviceId = getDeviceId();
  const deviceInfo = getDevice();

  // 记录设备信息
  db.upsertDevice(deviceId, deviceInfo);

  // 进程退出前同步落盘，避免防抖窗口内的数据丢失
  const shutdown = () => { try { db.closeDB(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('beforeExit', () => { try { db.closeDB(); } catch (e) {} });

  server.listen(PORT, () => {
    log('Ason Agent 已启动: http://localhost:' + PORT);
    log('设备 ID: ' + deviceId);
    log('设备信息: ' + deviceInfo.username + '@' + deviceInfo.hostname);
    log('项目根目录(沙箱): ' + PROJECT_ROOT);
    log('默认模型: ' + DEFAULT_MODEL);
    log('数据库: 已连接');
    log('日志文件: ' + require('./server/logger').LOG_PATH);
    startHotwatch();
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
