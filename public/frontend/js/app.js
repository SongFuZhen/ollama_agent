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
const statusTextEl = statusEl.querySelector('.status-text');
const emptyEl = $('#empty');
const sceneNameEl = $('#scene-name');



// ---------- 状态胶囊 ----------
function setStatus(kind, text) {
  statusEl.className = 'status ' + kind;
  statusTextEl.textContent = text;
}

// ---------- 空状态 ----------
function hideEmpty() { emptyEl.style.display = 'none'; }
function showEmptyIfEmpty() {
  const session = state.sessions[state.activeScenario];
  const has = session && session.childElementCount > 0;
  emptyEl.style.display = has ? 'none' : 'flex';
}
// 示例卡点击即填入输入框
document.querySelectorAll('.eg-card').forEach((c) => {
  c.onclick = () => { inputEl.value = c.dataset.prompt; inputEl.focus(); };
});
// 新对话：清空当前场景会话
$('#new-chat').onclick = () => {
  const s = state.sessions[state.activeScenario];
  if (s) s.innerHTML = '';
  messagesEl.innerHTML = '';
  if (s) messagesEl.appendChild(s);
  showEmptyIfEmpty();
};

// ---------- 主题切换（跟随系统 / 浅色 / 深色 三态循环） ----------
const THEME_KEY = 'local-agent-theme';
const themeBtn = $('#theme-btn');

// 返回系统偏好：'light' | 'dark'
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
// 当前存储的模式：'system' | 'light' | 'dark'（缺省视为 dark）
function storedMode() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}
// 实际生效主题
function effectiveTheme() {
  const m = storedMode();
  return m === 'system' ? systemTheme() : m;
}
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeBtn.textContent = '☀️';
    themeBtn.title = '当前：浅色（点击切换）';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeBtn.textContent = '🌙';
    themeBtn.title = '当前：深色（点击切换）';
  }
}
function applyMode(mode) {
  if (mode === 'system') {
    themeBtn.textContent = '🖥️';
    themeBtn.title = '当前：跟随系统（点击切换）';
    applyTheme(systemTheme());
  } else {
    applyTheme(mode);
  }
}
applyMode(storedMode());

// 跟随系统模式下，实时跟随系统主题变化
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (storedMode() === 'system') applyTheme(systemTheme());
  });
}
// 循环：深色 ↔ 浅色
themeBtn.onclick = () => {
  const next = storedMode() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyMode(next);
};

// ---------- 全局状态 ----------
const state = {
  scenarios: {},            // 后端下发的场景配置 { key: {label, model} }
  activeScenario: null,     // 当前选中的场景 key
  sessions: {},             // 每个场景独立的消息 DOM 容器 { key: HTMLElement }
  busy: false,              // 是否有请求进行中
  streamingAnswer: null,    // 当前流式输出的答案元素
  streamingText: '',        // 当前流式输出的完整文本
  streamingThink: null,     // 当前流式输出的思考元素
  streamingThinkText: '',   // 当前流式输出的思考文本
  streamingHead: null,      // 当前流式输出的答案头部元素
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
  if (sceneNameEl) sceneNameEl.textContent = state.scenarios[key]?.label || '对话';
  showEmptyIfEmpty();
  scrollDown();
}

function scrollDown() {
  const chatEl = messagesEl.closest('.chat') || messagesEl;
  chatEl.scrollTop = chatEl.scrollHeight;
}

function appendToActive(node) {
  const box = state.sessions[state.activeScenario] || messagesEl;
  box.appendChild(node);
  hideEmpty();
  scrollDown();
}

// 用户气泡
function appendUser(text) {
  const m = el('div', 'msg user');
  m.appendChild(el('div', 'bubble', text));
  appendToActive(m);
}

// Agent 最终回答卡片（角色标签 + 复制）
function appendAnswer(text) {
  const m = el('div', 'msg agent answer-card');
  const head = el('div', 'answer-head');
  head.appendChild(el('span', 'role', 'Agent'));
  const copy = el('button', 'copy', '复制');
  copy.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => {
      copy.textContent = '已复制';
      setTimeout(() => (copy.textContent = '复制'), 1200);
    });
  };
  head.appendChild(copy);
  const bubble = el('div', 'bubble');
  bubble.innerHTML = renderMarkdown(text);
  m.appendChild(head);
  m.appendChild(bubble);
  appendToActive(m);
}

// 简单的 Markdown 渲染器（仅处理代码块）
function renderMarkdown(text) {
  if (!text) return '';
  
  // 使用 marked 库渲染 markdown
  if (typeof marked !== 'undefined') {
    // 配置 marked
    marked.setOptions({
      breaks: false,  // 不转换换行符，保持 markdown 格式
      gfm: true,      // 启用 GitHub 风格 markdown
    });
    return marked.parse(text);
  }
  
  // 降级处理：简单换行
  return text.replace(/\n/g, '<br>');
}

// 过程步骤（思考链 / 工具调用 / 错误等）
function appendStep(type, text) {
  const s = el('div', 'step ' + type, text);
  appendToActive(s);
  return s;
}

// R1 推理块：默认折叠，可点击展开
function appendThinkBlock() {
  const thinkWrap = el('div', 'think-block');
  thinkWrap.setAttribute('data-collapsed', 'true');
  
  const header = el('div', 'think-header');
  const arrow = el('span', 'think-arrow', '▶');
  const label = el('span', 'think-label', '思考过程');
  header.appendChild(arrow);
  header.appendChild(label);
  
  const body = el('div', 'think-body');
  
  header.onclick = () => {
    const isCollapsed = thinkWrap.getAttribute('data-collapsed') === 'true';
    thinkWrap.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
    arrow.textContent = isCollapsed ? '▼' : '▶';
  };
  
  thinkWrap.appendChild(header);
  thinkWrap.appendChild(body);
  state.streamingAnswer.appendChild(thinkWrap);
  state.streamingThink = body;
  state.streamingThinkText = '';
}

// 更新思考内容
function updateThinkContent(text) {
  if (state.streamingThink) {
    state.streamingThinkText += text;
    state.streamingThink.textContent = state.streamingThinkText;
  }
}

// 工具调用块：直接显示结果
function appendToolCall(action, params, result) {
  const toolWrap = el('div', 'tool-block');
  
  // 工具调用标题
  const header = el('div', 'tool-toggle');
  const icon = el('span', 'tool-icon', '→');
  const title = el('span', 'tool-title', `${action}(${JSON.stringify(params)})`);
  header.appendChild(icon);
  header.appendChild(title);
  
  // 工具结果
  const body = el('div', 'tool-body');
  if (result !== null) {
    body.textContent = result;
  }
  
  toolWrap.appendChild(header);
  toolWrap.appendChild(body);
  state.streamingAnswer.appendChild(toolWrap);
  scrollDown();
}

// 更新最后一个工具调用块的结果
function updateToolResult(result) {
  const toolBlocks = state.streamingAnswer?.querySelectorAll('.tool-block');
  if (toolBlocks && toolBlocks.length > 0) {
    const lastBlock = toolBlocks[toolBlocks.length - 1];
    const body = lastBlock.querySelector('.tool-body');
    if (body) {
      body.textContent = result;
    }
  }
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
// 流程：user -> thinking_start -> thought* -> (tool -> tool_result)* -> token* -> answer
// 每个环节按顺序追加到当前消息容器中
function handleEvent(ev) {
  switch (ev.type) {
    case 'meta':
      state.scenarios = ev.scenarios || {};
      break;
      
    case 'thinking_start':
      // 开始新的思考块，创建消息容器
      toggleThinking(true, '模型思考中');
      ensureMessageContainer();
      appendThinkBlock();
      break;
      
    case 'thought':
      // 更新思考内容
      if (ev.think) {
        // 流式思考完成
        state.streamingThink = null;
        state.streamingThinkText = '';
      } else {
        updateThinkContent(ev.content);
      }
      break;
      
    case 'tool':
      // 工具调用，追加到当前消息容器
      toggleThinking(true, '执行工具');
      ensureMessageContainer();
      appendToolCall(ev.action, ev.params, null);
      break;
      
    case 'tool_result':
      // 更新最后一个工具调用的结果
      updateToolResult(ev.result);
      break;
      
    case 'token':
      // 流式输出 token，开始输出最终答案
      toggleThinking(false);
      ensureMessageContainer();
      appendToken(ev.content);
      break;
      
    case 'answer':
      // 最终答案
      finalizeAnswer(ev.content);
      break;
      
    case 'confirm_request':
      showConfirm(ev);
      break;
      
    case 'confirm_result':
      appendStep('confirm', ev.ok ? '✓ 用户已确认写入' : '✗ 用户拒绝写入');
      break;
      
    case 'stats':
      // 显示连接统计
      if (state.streamingHead) {
        const statsEl = state.streamingHead.querySelector('.stats');
        if (statsEl) {
          statsEl.textContent = `TTFT: ${ev.ttft}ms | 总耗时: ${ev.total}ms`;
        }
      }
      break;
      
    case 'error':
      appendStep('error', '⚠ ' + ev.msg + (ev.content ? '\n' + ev.content : ''));
      break;
  }
}

// 确保当前消息容器存在
function ensureMessageContainer() {
  if (state.streamingAnswer) return;
  
  const m = el('div', 'msg agent answer-card');
  const head = el('div', 'answer-head');
  head.appendChild(el('span', 'role', 'Agent'));
  const stats = el('span', 'stats');
  head.appendChild(stats);
  const copy = el('button', 'copy', '复制');
  head.appendChild(copy);
  const bubble = el('div', 'bubble');
  m.appendChild(head);
  m.appendChild(bubble);
  appendToActive(m);
  
  state.streamingAnswer = bubble;
  state.streamingText = '';
  state.streamingHead = head;
  
  copy.onclick = () => {
    navigator.clipboard?.writeText(state.streamingText).then(() => {
      copy.textContent = '已复制';
      setTimeout(() => (copy.textContent = '复制'), 1200);
    });
  };
}

// 追加 token 到当前答案
function appendToken(token) {
  state.streamingText += token;
  state.streamingAnswer.innerHTML = renderMarkdown(state.streamingText);
  scrollDown();
}

// 最终确定答案
function finalizeAnswer(content) {
  if (state.streamingAnswer) {
    // 已有流式输出，更新为最终内容
    state.streamingAnswer.innerHTML = renderMarkdown(content);
  } else {
    // 没有流式输出，创建新的答案元素
    ensureMessageContainer();
    state.streamingAnswer.innerHTML = renderMarkdown(content);
  }
  
  // 清理状态
  state.streamingAnswer = null;
  state.streamingText = '';
  state.streamingHead = null;
}

// ---------- 图片粘贴 / 拖拽（仅随消息发送，不落工作目录） ----------
const pendingImages = []; // [{ name, dataUrl, b64 }]

// 点击「＋ 图片」直接选择图片
const imgInput = $('#img-input');
$('#img-btn').onclick = () => imgInput.click();
imgInput.onchange = () => {
  for (const f of imgInput.files) {
    if (!f.type.startsWith('image/')) continue;
    const r = new FileReader();
    r.onload = () => addImage(r.result, f.name);
    r.readAsDataURL(f);
  }
  imgInput.value = ''; // 允许重复选择同一文件
};

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
function scenarioDefault(key) {
  return state.scenarios[key]?.model || '';
}

settingsBtn.onclick = () => {
  const s = loadSettings();
  $('#set-ollama').value = s.ollama || DEFAULT_OLLAMA_HOST;
  $('#set-root').value = s.root || serverRootCache || '';
  $('#set-coder').value = s.coder || scenarioDefault('coder');
  $('#set-debug').value = s.debug || scenarioDefault('debug');
  $('#set-general').value = s.general || scenarioDefault('general');
  $('#set-vision').value = s.vision || scenarioDefault('vision');
  settingsModal.classList.remove('hidden');
};
settingsClose.onclick = () => settingsModal.classList.add('hidden');
settingsSave.onclick = async () => {
  const rootVal = $('#set-root').value.trim();
  const s = {
    ollama: $('#set-ollama').value,
    root: rootVal,
    coder: $('#set-coder').value,
    debug: $('#set-debug').value,
    general: $('#set-general').value,
    vision: $('#set-vision').value,
  };
  saveSettings(s);
  // 立即把已保存的模型覆盖到当前标签上并刷新，避免等待服务端自检才看到变化
  if (state.scenarios && Object.keys(state.scenarios).length) {
    for (const k of Object.keys(state.scenarios)) {
      const v = modelFor(k);
      if (v) state.scenarios[k].model = v;
    }
    renderTabs();
    mountSession(state.activeScenario);
  }
  // 服务端持久化 + 校验项目根目录
  let serverMsg = '';
  try {
    const r = await fetch('/api/root', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: rootVal }) });
    const d = await r.json();
    if (!d.ok) serverMsg = ' · ' + (d.error || '项目目录无效');
  } catch (e) { serverMsg = ' · 服务端保存失败'; }
  $('#settings-msg').textContent = '已保存（浏览器本地）' + serverMsg;
  setTimeout(() => {
    settingsModal.classList.add('hidden');
    $('#settings-msg').textContent = '';
    preflight(); // 地址/模型变更后刷新状态栏（以服务端就绪状态为准）
  }, 600);
};

// 项目目录绝对路径：设置页填写优先，否则回退服务端持久化根，否则默认沙箱
let serverRootCache = null; // 服务端持久化的有效根（启动拉取）
async function loadServerRoot() {
  try {
    const r = await fetch('/api/root');
    const d = await r.json();
    if (d && d.persisted && d.root) serverRootCache = d.root;
  } catch (e) { /* 忽略 */ }
}
function settingsRoot() {
  const s = loadSettings();
  const local = s.root && s.root.trim() ? s.root.trim() : null;
  return local || serverRootCache || null;
}

// ---------- 文件浏览器（左栏） ----------
// browseRoot: null => 后端默认沙箱目录；非 null => 用户用「选择目录」挑的本地目录名
let browseRoot = null;
let localFiles = null;        // 最近一次选定的 FileList
const fileTreeEl = $('#file-tree');
const fsRefresh = $('#fs-refresh');
const fsPick = $('#fs-pick');
const dirInput = $('#dir-input');

async function loadFileTree(sub) {
  if (browseRoot !== null) return; // 本地浏览模式，不请求后端
  const root = settingsRoot();
  fileTreeEl.textContent = '加载中…';
  try {
    const params = new URLSearchParams();
    if (sub) params.set('path', sub);
    if (root) params.set('root', root);
    const q = params.toString() ? ('?' + params.toString()) : '';
    const r = await fetch('/api/fs/list' + q);
    const d = await r.json();
    if (d.error) { fileTreeEl.textContent = '⚠ ' + d.error; return; }
    // 渲染为可展开的树：根目录名（取绝对路径最后一段）+ 子节点
    const rootLabel = lastSeg(d.root) || '项目文件';
    renderFsTree(d.items, '', rootLabel);
  } catch (e) {
    fileTreeEl.textContent = '⚠ ' + e.message;
  }
}

// 取路径最后一段作为根名显示
function lastSeg(p) { return p ? p.replace(/[/\\]$/, '').split(/[/\\]/).pop() : ''; }

// 创建文件树节点（带SVG图标）
function createFileNode(type, name, className) {
  const node = el('div', 'node ' + (className || ''));
  const icon = el('img', 'tree-icon');
  icon.src = type === 'dir' ? '/icons/folder.svg' : '/icons/file.svg';
  icon.alt = '';
  node.appendChild(icon);
  node.appendChild(document.createTextNode(' ' + name));
  return node;
}

async function loadFsChildren(fullPath, container) {
  const root = settingsRoot();
  const loading = el('div', 'node loading', '加载中…');
  container.appendChild(loading);
  try {
    const params = new URLSearchParams();
    params.set('path', fullPath);
    if (root) params.set('root', root);
    const r = await fetch('/api/fs/list?' + params.toString());
    const d = await r.json();
    container.removeChild(loading);
    if (d.error) { container.appendChild(el('div', 'node', '⚠ ' + d.error)); return; }
    renderFsChildren(d.items, fullPath, container);
  } catch (e) {
    if (loading.parentNode) container.removeChild(loading);
    container.appendChild(el('div', 'node', '⚠ ' + e.message));
  }
}

// 渲染树的一层（用于根层）：直接把根下内容渲染进 rootBox，避免重复请求
function renderFsTree(items, base, rootLabel) {
  fileTreeEl.innerHTML = '';
  const rootNode = createFileNode('dir', rootLabel || '项目文件', 'dir');
  const rootBox = el('div', 'local-children');
  rootNode.onclick = () => {
    // 再次点击根：折叠/展开切换
    if (rootBox.childElementCount === 0) renderFsChildren(items, base, rootBox);
    else rootBox.innerHTML = '';
  };
  fileTreeEl.appendChild(rootNode);
  fileTreeEl.appendChild(rootBox);
  // 初始即展开根目录，直接展示第一层
  renderFsChildren(items, base, rootBox);
}

// 渲染子层到指定容器（带展开/折叠）
function renderFsChildren(items, base, container) {
  container.innerHTML = '';
  const dirs = items.filter((i) => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((i) => i.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
  for (const it of dirs) {
    const full = base ? base + '/' + it.name : it.name;
    const dirNode = createFileNode('dir', it.name, 'dir');
    const childBox = el('div', 'local-children');
    dirNode.onclick = () => {
      if (childBox.childElementCount === 0) loadFsChildren(full, childBox);
      else childBox.innerHTML = ''; // 再次点击折叠
    };
    container.appendChild(dirNode);
    container.appendChild(childBox);
  }
  for (const it of files) {
    const full = base ? base + '/' + it.name : it.name;
    const fNode = createFileNode('file', it.name, 'file');
    fNode.onclick = () => insertPath(full);
    container.appendChild(fNode);
  }
}

// ---------- 本地目录浏览（纯前端，不经后端沙箱） ----------
// 把 FileList 按 webkitRelativePath 构建成可展开的虚拟树
function buildLocalTree(fileList) {
  const root = { name: '', dirs: new Map(), files: [] };
  for (const f of fileList) {
    const parts = f.webkitRelativePath.split('/');
    const rootName = parts[0];
    root.name = rootName;
    let cur = root;
    // 跳过根目录名，逐层建立子目录
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.files.push(part);
      } else {
        if (!cur.dirs.has(part)) cur.dirs.set(part, { name: part, dirs: new Map(), files: [] });
        cur = cur.dirs.get(part);
      }
    }
  }
  return root;
}

function renderLocalTree(node, container, basePath) {
  // 子目录
  const dirNames = [...node.dirs.keys()].sort();
  for (const name of dirNames) {
    const child = node.dirs.get(name);
    const full = basePath ? basePath + '/' + name : name;
    const dirNode = createFileNode('dir', name, 'dir');
    const childBox = el('div', 'local-children');
    let expanded = false;
    dirNode.onclick = () => {
      if (!expanded) {
        childBox.innerHTML = '';
        renderLocalTree(child, childBox, full);
        expanded = true;
      } else {
        childBox.innerHTML = '';
        expanded = false;
      }
    };
    container.appendChild(dirNode);
    container.appendChild(childBox);
  }
  // 文件
  const fileNames = node.files.slice().sort();
  for (const name of fileNames) {
    const full = basePath ? basePath + '/' + name : name;
    const fNode = createFileNode('file', name, 'file');
    fNode.onclick = () => insertPath(full);
    container.appendChild(fNode);
  }
}

function loadLocalTree(fileList) {
  if (!fileList || !fileList.length) return;
  localFiles = fileList;
  browseRoot = fileList[0].webkitRelativePath.split('/')[0];
  const tree = buildLocalTree(fileList);
  fileTreeEl.innerHTML = '';
  const rootNode = el('div', 'node dir', '📂 ' + browseRoot);
  const rootBox = el('div', 'local-children');
  renderLocalTree(tree, rootBox, '');
  rootNode.onclick = () => {
    rootBox.innerHTML = '';
    renderLocalTree(tree, rootBox, '');
  };
  fileTreeEl.appendChild(rootNode);
  fileTreeEl.appendChild(rootBox);
  updatePanelHint();
}

function updatePanelHint() {
  const hint = document.querySelector('.panel-hint');
  if (hint) {
    hint.textContent = browseRoot
      ? '当前浏览：' + browseRoot + '（点文件插入路径）'
      : '点文件：插入路径 · 点「选择目录」可浏览任意本地文件夹';
  }
}

// 点文件：把相对路径插入输入框（供用户发送时引用，或交给模型读取）
// 本地模式下，路径前缀所选根目录名，便于模型理解
function insertPath(rel) {
  const prefixed = browseRoot ? (browseRoot + '/' + rel) : rel;
  const cur = inputEl.value;
  inputEl.value = (cur ? cur + ' ' : '') + '文件: ' + prefixed;
  inputEl.focus();
}

fsRefresh.onclick = () => {
  if (browseRoot !== null && localFiles) loadLocalTree(localFiles);
  else loadFileTree('');
};
fsPick.onclick = () => dirInput.click();
dirInput.onchange = () => loadLocalTree(dirInput.files);

// ---------- 中止控制器 ----------
let currentAbortController = null;

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
  // 项目目录：设置页填写的绝对路径优先；否则若用户用「选择目录」挑了本地文件夹，用其目录名作为沙箱根
  const root = settingsRoot() || browseRoot;
  if (root) body.projectRoot = root;

  // 创建 AbortController 以支持中止
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    toggleThinking(true, '正在连接');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
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
  } catch (e) {
    if (e.name === 'AbortError') {
      appendStep('error', '⚠ 已中止');
    } else {
      appendStep('error', '读取响应失败: ' + e.message);
    }
  } finally {
    currentAbortController = null;
    // 无论成功/失败/断开，都必须恢复输入框，避免一直 disabled
    setBusy(false);
  }
}

// ---------- 中止当前请求 ----------
function abortCurrentRequest() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

function setBusy(flag) {
  state.busy = flag;
  inputEl.disabled = flag;
  toggleThinking(flag);

  if (flag) {
    // 忙碌时：发送按钮变为中止按钮
    sendBtn.textContent = '中止';
    sendBtn.classList.add('abort');
    sendBtn.onclick = abortCurrentRequest;
  } else {
    // 空闲时：恢复发送按钮
    sendBtn.textContent = '发送';
    sendBtn.classList.remove('abort');
    sendBtn.onclick = send;
    currentAbortController = null;
  }
}

// ---------- 思考中… + 秒数 ----------
const thinkingEl = $('#thinking');
const thinkSecsEl = $('#think-secs');
let thinkTimer = null;
let thinkStart = 0;
function toggleThinking(on, msg) {
  if (on) {
    thinkStart = Date.now();
    thinkingEl.classList.remove('hidden');
    thinkSecsEl.textContent = '0';
    // 更新提示文字
    const label = thinkingEl.querySelector('.thinking-label');
    if (label) label.textContent = msg || '思考中';
    scrollDown();
    thinkTimer = setInterval(() => {
      thinkSecsEl.textContent = String(Math.floor((Date.now() - thinkStart) / 1000));
    }, 1000);
  } else {
    clearInterval(thinkTimer);
    thinkTimer = null;
    thinkingEl.classList.add('hidden');
  }
}

// ---------- 场景标签栏（分段控件） ----------
function renderTabs() {
  tabsEl.innerHTML = '';
  for (const key of Object.keys(state.scenarios)) {
    const sc = state.scenarios[key];
    // 模型未就绪的标签置灰并提示，不可点击
    const disabled = sc.ready === false;
    const cls = 'tab' + (key === state.activeScenario ? ' active' : '') + (disabled ? ' disabled' : '');
    const tab = el('div', cls);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(key === state.activeScenario));
    const dot = el('span', 'dot');
    dot.style.background = disabled ? 'var(--text-mute)' : 'var(--accent)';
    tab.appendChild(dot);
    tab.appendChild(el('div', 'label', sc.label));
    tab.appendChild(el('div', 'm', sc.model));
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

// ---------- 加载后端默认配置（模型名等） ----------
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    state.scenarios = {};
    for (const k of Object.keys(d.scenarios || {})) {
      const sc = d.scenarios[k];
      const saved = modelFor(k);
      state.scenarios[k] = {
        label: SCENARIO_LABELS[k] || sc.label || k,
        model: saved || sc.model,
        ready: null,
      };
    }
    // 设置模型输入框的占位提示
    $('#set-coder').placeholder = scenarioDefault('coder');
    $('#set-debug').placeholder = scenarioDefault('debug');
    $('#set-general').placeholder = scenarioDefault('general');
    $('#set-vision').placeholder = scenarioDefault('vision');
  } catch (e) { console.error('loadConfig failed', e); }
}

// ---------- 启动自检 ----------
async function preflight() {
  try {
    const oh = ollamaHost();
    const r = await fetch('/api/preflight' + (oh ? '?ollamaHost=' + encodeURIComponent(oh) : ''));
    const d = await r.json();
    // 用后端下发的场景配置初始化标签（带就绪状态），即使 Ollama 不可达也要渲染标签
    // 模型名优先用用户在设置里保存的值（modelFor），否则用后端默认；就绪状态以后端为准
    state.scenarios = {};
    const installed = Array.isArray(d.models) ? d.models : [];
    const isInstalled = (m) => installed.some((n) => n === m || n === m + ':latest' || n === 'latest');
    for (const k of Object.keys(d.scenarios || {})) {
      const s = d.scenarios[k];
      const saved = modelFor(k);
      const model = saved || s.model;
      // 就绪状态以「已安装列表」为准：后端默认或用户自定义模型都行
      const ready = installed.length ? isInstalled(model) : s.ready;
      state.scenarios[k] = {
        label: SCENARIO_LABELS[k] || k,
        model,
        ready,
      };
    }
    if (!state.activeScenario) {
      const firstReady = Object.keys(state.scenarios).find((k) => state.scenarios[k].ready);
      state.activeScenario = firstReady || Object.keys(state.scenarios)[0];
    }
    renderTabs();
    mountSession(state.activeScenario);

    loadFileTree(''); // 启动即加载项目文件树

    if (d.ollama !== 'ok') {
      setStatus('warn', '⚠ Ollama 不可达 (' + (d.ollamaHost || '') + '): ' + (d.error || ''));
      return;
    }
    const readyList = Object.entries(state.scenarios)
      .filter(([, v]) => v.ready).map(([, v]) => v.model);
    setStatus('ok', `就绪 | Node ${d.node} | Ollama: ${d.ollamaHost || '?'} | 已装: ${readyList.join(', ') || '无'} | 根: ${d.projectRoot}`);
  } catch (e) {
    setStatus('err', '⚠ 无法连接服务: ' + e.message);
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

loadServerRoot();
loadConfig().then(preflight);

// ---------- 热重载：public/ 文件变更时自动刷新页面 ----------
if (typeof EventSource !== 'undefined') {
  try {
    const es = new EventSource('/api/hotreload');
    es.addEventListener('reload', () => location.reload());
  } catch (e) { /* 忽略 */ }
}
