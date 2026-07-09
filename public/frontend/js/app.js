'use strict';

/* =========================================================================
 * 本地 Agent 客户端 — 前端
 * 三个场景标签页（代码 / 排查 / 通用），各自独立会话，共享同一沙箱工具箱。
 * 通过 SSE 接收后端的 Agent 执行过程并实时渲染。
 * ========================================================================= */

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const tabsEl = $('#tabs');
const messagesEl = $('#messages');
const inputEl = $('#input');
const sendBtn = $('#send');
const statusEl = $('#status');

// ---------- 全局状态 ----------
const state = {
  scenarios: {},            // 后端下发的场景配置 { key: {label, model} }
  activeScenario: null,     // 当前选中的场景 key
  sessions: {},             // 每个场景独立的消息 DOM 容器 { key: HTMLElement }
  busy: false,              // 是否有请求进行中
};

// ---------- 小工具：创建元素 ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ---------- 消息流渲染 ----------
// 切换场景时，把对应会话的 DOM 挂回主区域
function mountSession(key) {
  messagesEl.innerHTML = '';
  if (!state.sessions[key]) {
    state.sessions[key] = el('div', 'session');
  }
  messagesEl.appendChild(state.sessions[key]);
  scrollDown();
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendToActive(node) {
  const box = state.sessions[state.activeScenario] || messagesEl;
  box.appendChild(node);
  scrollDown();
}

// 用户气泡
function appendUser(text) {
  const m = el('div', 'msg user');
  m.appendChild(el('div', 'bubble', text));
  appendToActive(m);
}

// Agent 最终回答气泡
function appendAnswer(text) {
  const m = el('div', 'msg agent');
  m.appendChild(el('div', 'bubble', text));
  appendToActive(m);
}

// 过程步骤（思考链 / 工具调用 / 错误等）
function appendStep(type, text) {
  const s = el('div', 'step ' + type, text);
  appendToActive(s);
  return s;
}

// R1 推理块：默认折叠，可点击展开
function appendThink(text) {
  const wrap = el('div', 'step thought');
  const toggle = el('div', 'think-toggle', '推理过程（点击展开）');
  const body = el('div', 'think-body', text);
  toggle.onclick = () => {
    toggle.classList.toggle('open');
    body.classList.toggle('open');
  };
  wrap.appendChild(toggle);
  wrap.appendChild(body);
  appendToActive(wrap);
}

// ---------- 写操作确认卡片（每次单独确认） ----------
function showConfirm(card) {
  const { id, action, params } = card;
  const c = el('div', 'confirm-card');
  c.appendChild(el('div', 'step confirm', `写操作确认 [${action}]`));
  const pre = el('pre');
  pre.textContent = JSON.stringify(params, null, 2);
  c.appendChild(pre);

  const btns = el('div', 'btns');
  const yes = el('button', 'yes', '确认写入');
  const no = el('button', 'no', '拒绝');
  yes.onclick = () => {
    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok: true }),
    });
    c.remove();
  };
  no.onclick = () => {
    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok: false }),
    });
    c.remove();
  };
  btns.appendChild(yes);
  btns.appendChild(no);
  c.appendChild(btns);
  appendToActive(c);
}

// ---------- SSE 事件分发 ----------
function handleEvent(ev) {
  switch (ev.type) {
    case 'meta':
      state.scenarios = ev.scenarios || {};
      break;
    case 'thought':
      if (ev.think) appendThink(ev.content);
      else appendStep('thought', `[思考#${ev.step}]\n${ev.content}`);
      break;
    case 'tool':
      appendStep('tool', `→ 调用工具: ${ev.action}(${JSON.stringify(ev.params)})`);
      break;
    case 'tool_result':
      appendStep('tool', `← 结果: ${ev.result}`);
      break;
    case 'confirm_request':
      showConfirm(ev);
      break;
    case 'confirm_result':
      appendStep('confirm', ev.ok ? '✓ 用户已确认写入' : '✗ 用户拒绝写入');
      break;
    case 'error':
      appendStep('error', '⚠ ' + ev.msg + (ev.content ? '\n' + ev.content : ''));
      break;
    case 'answer':
      appendAnswer(ev.content);
      break;
  }
}

// ---------- 图片粘贴 / 拖拽（仅随消息发送，不落工作目录） ----------
const pendingImages = []; // [{ name, dataUrl, b64 }]

function addImage(dataUrl, name) {
  const b64 = dataUrl.split(',')[1];
  if (!b64) return;
  pendingImages.push({ name: name || 'image.png', dataUrl, b64 });
  renderImageThumbs();
}

function renderImageThumbs() {
  let box = document.getElementById('img-thumbs');
  if (!box) {
    box = el('div', 'img-thumbs');
    box.id = 'img-thumbs';
    inputEl.parentNode.insertBefore(box, inputEl);
  }
  box.innerHTML = '';
  pendingImages.forEach((img, i) => {
    const wrap = el('div', 'thumb');
    const im = el('img'); im.src = img.dataUrl;
    const x = el('span', 'x', '×');
    x.onclick = () => { pendingImages.splice(i, 1); renderImageThumbs(); };
    wrap.appendChild(im); wrap.appendChild(x);
    box.appendChild(wrap);
  });
}

// 粘贴图片（剪贴板含图片时拦截）
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      const r = new FileReader();
      r.onload = () => addImage(r.result, f.name);
      r.readAsDataURL(f);
      e.preventDefault();
    }
  }
});

// 拖拽图片到输入框
inputEl.addEventListener('dragover', (e) => e.preventDefault());
inputEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files) return;
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = () => addImage(r.result, f.name);
      r.readAsDataURL(f);
    }
  }
});

// ---------- 设置（存 localStorage，随请求下发，不碰后端常量） ----------
const SETTINGS_KEY = 'local-agent-settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
// 取某场景的模型名（前端覆盖优先，否则用后端默认）
function modelFor(scenarioKey) {
  const s = loadSettings();
  const map = { coder: s.coder, debug: s.debug, general: s.general, vision: s.vision };
  const v = map[scenarioKey];
  return v && v.trim() ? v.trim() : null; // null => 用后端默认
}
const DEFAULT_OLLAMA_HOST = 'http://192.168.0.101:11434';
function ollamaHost() {
  const s = loadSettings();
  return s.ollama && s.ollama.trim() ? s.ollama.trim() : DEFAULT_OLLAMA_HOST;
}

const settingsBtn = $('#settings-btn');
const settingsModal = $('#settings-modal');
const settingsClose = $('#settings-close');
const settingsSave = $('#settings-save');
settingsBtn.onclick = () => {
  const s = loadSettings();
  $('#set-ollama').value = s.ollama || DEFAULT_OLLAMA_HOST;
  $('#set-coder').value = s.coder || '';
  $('#set-debug').value = s.debug || '';
  $('#set-general').value = s.general || '';
  $('#set-vision').value = s.vision || '';
  settingsModal.classList.remove('hidden');
};
settingsClose.onclick = () => settingsModal.classList.add('hidden');
settingsSave.onclick = () => {
  const s = {
    ollama: $('#set-ollama').value,
    coder: $('#set-coder').value,
    debug: $('#set-debug').value,
    general: $('#set-general').value,
    vision: $('#set-vision').value,
  };
  saveSettings(s);
  $('#settings-msg').textContent = '已保存（浏览器本地）';
  setTimeout(() => (settingsModal.classList.add('hidden')), 600);
};

// ---------- 文件浏览器（左栏，沙箱内） ----------
const fileTreeEl = $('#file-tree');
const fsRefresh = $('#fs-refresh');

async function loadFileTree(sub) {
  fileTreeEl.textContent = '加载中…';
  try {
    const q = sub ? ('?path=' + encodeURIComponent(sub)) : '';
    const r = await fetch('/api/fs/list' + q);
    const d = await r.json();
    if (d.error) { fileTreeEl.textContent = '⚠ ' + d.error; return; }
    renderFileTree(d.items, sub || '');
  } catch (e) {
    fileTreeEl.textContent = '⚠ ' + e.message;
  }
}

function renderFileTree(items, base) {
  fileTreeEl.innerHTML = '';
  // 返回上级（非根时）
  if (base) {
    const up = el('div', 'node dir', '..');
    up.onclick = () => loadFileTree(base.split('/').slice(0, -1).join('/'));
    fileTreeEl.appendChild(up);
  }
  for (const it of items) {
    const full = (base ? base + '/' : '') + it.name;
    const node = el('div', 'node ' + (it.type === 'dir' ? 'dir' : 'file'), (it.type === 'dir' ? '📁 ' : '📄 ') + it.name);
    if (it.type === 'dir') {
      node.onclick = () => loadFileTree(full);
    } else {
      node.onclick = () => insertPath(full);
    }
    fileTreeEl.appendChild(node);
  }
}

// 点文件：把相对路径插入输入框（供用户发送时引用，或交给模型读取）
function insertPath(rel) {
  const cur = inputEl.value;
  inputEl.value = (cur ? cur + ' ' : '') + '文件: ' + rel;
  inputEl.focus();
}

fsRefresh.onclick = () => loadFileTree('');

// ---------- 发送请求（SSE 流式读取） ----------
async function send() {
  const text = inputEl.value.trim();
  if (state.busy) return;
  if (!text && pendingImages.length === 0) return; // 文+图至少一项

  const imgs = pendingImages.slice();
  inputEl.value = '';
  pendingImages.length = 0;
  renderImageThumbs();
  appendUser(text || '（图片）');
  setBusy(true);

  const scenario = state.activeScenario;
  const body = { message: text, scenario, images: imgs.map((i) => i.b64) };
  const m = modelFor(scenario); if (m) body.model = m;       // 前端覆盖模型名
  const oh = ollamaHost(); if (oh) body.ollamaHost = oh;     // 前端覆盖 Ollama 地址
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop();
    for (const chunk of chunks) {
      if (!chunk.startsWith('data: ')) continue;
      let ev;
      try { ev = JSON.parse(chunk.slice(6)); } catch (e) { continue; }
      handleEvent(ev);
    }
  }
  setBusy(false);
}

function setBusy(flag) {
  state.busy = flag;
  sendBtn.disabled = flag;
  inputEl.disabled = flag;
}

// ---------- 场景标签栏 ----------
function renderTabs() {
  tabsEl.innerHTML = '';
  for (const key of Object.keys(state.scenarios)) {
    const sc = state.scenarios[key];
    // 模型未就绪的标签置灰并提示，不可点击
    const disabled = sc.ready === false;
    const cls = 'tab' + (key === state.activeScenario ? ' active' : '') + (disabled ? ' disabled' : '');
    const tab = el('div', cls);
    tab.appendChild(el('div', 'label', sc.label));
    tab.appendChild(el('div', 'm', sc.model + (disabled ? ' （未安装）' : '')));
    if (!disabled) tab.onclick = () => selectScenario(key);
    tabsEl.appendChild(tab);
  }
}

function selectScenario(key) {
  if (state.busy) return; // 请求进行中不允许切换
  state.activeScenario = key;
  renderTabs();
  mountSession(key);
}

// ---------- 启动自检 ----------
async function preflight() {
  try {
    const r = await fetch('/api/preflight');
    const d = await r.json();
    if (d.ollama !== 'ok') {
      statusEl.textContent = '⚠ Ollama 不可达 (' + (d.ollamaHost || '') + '): ' + (d.error || '');
      return;
    }
    // 用后端下发的场景配置初始化标签（带就绪状态）
    state.scenarios = {};
    for (const k of Object.keys(d.scenarios || {})) {
      const s = d.scenarios[k];
      state.scenarios[k] = { label: SCENARIO_LABELS[k] || k, model: s.model, ready: s.ready };
    }
    const readyList = Object.entries(state.scenarios)
      .filter(([, v]) => v.ready).map(([, v]) => v.model);
    statusEl.textContent = `就绪 | Node ${d.node} | Ollama: ${d.ollamaHost || '?'} | 已装: ${readyList.join(', ') || '无'} | 根: ${d.projectRoot}`;

    // 默认选中第一个就绪的场景
    const firstReady = Object.keys(state.scenarios).find((k) => state.scenarios[k].ready);
    state.activeScenario = firstReady || Object.keys(state.scenarios)[0];
    renderTabs();
    mountSession(state.activeScenario);
    loadFileTree(''); // 启动即加载项目文件树
  } catch (e) {
    statusEl.textContent = '⚠ 无法连接服务: ' + e.message;
  }
}

// 场景 key -> 中文标签（后端也下发 label，这里作兜底）
const SCENARIO_LABELS = {
  coder: '代码补全 / 解释',
  debug: '逻辑排查 / 找 bug',
  general: '通用对话',
  vision: '图片识别',
};

// ---------- 绑定事件 ----------
sendBtn.onclick = send;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

preflight();
