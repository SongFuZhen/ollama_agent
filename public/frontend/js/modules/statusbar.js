'use strict';

/* =========================================================================
 * statusbar.js — 状态更新、空状态、会话状态栏、模型下拉、上下文用量、git 分支、详情弹框。
 * 依赖全局：state、escapeHtml、isAbs、settingsRoot、ollamaHost、
 *   effectiveRoot、updateProjectRootUI、renderMarkdown（render.js 等）。
 * ========================================================================= */

// ---------- 状态更新 ----------
function setStatus(kind, text) {
  if (ollamaStatusEl) {
    ollamaStatusEl.textContent = text;
  }
  if (debugIconEl) {
    debugIconEl.setAttribute('class', 'debug-icon');
    if (kind === 'ok') {
      debugIconEl.classList.add('ready');
    } else if (kind === 'error') {
      debugIconEl.classList.add('error');
    }
  }
}

// ---------- 空状态 ----------
function hideEmpty() { emptyEl.style.display = 'none'; }
function showEmptyIfEmpty() {
  const has = state.session && state.session.childElementCount > 0;
  emptyEl.style.display = has ? 'none' : 'flex';
}

// ---------- 离线诊断 ----------
// 当 Ollama 连接失败时，点「诊断」走**后端代理**探测配置地址（/api/preflight），
// 而非浏览器直连 Ollama。原因：浏览器直连 Ollama 的 /api/tags 会被 CORS 拦截
// （Ollama 默认不返回 CORS 头），即便后端 Node 侧能连通，也会误报「无法建立连接」。
// 经后端探测可准确区分「主机不可达 / 端口未监听 / 服务异常 / 正常」。
let _diagnosing = false;
async function diagnoseOllama() {
  if (_diagnosing) return;
  _diagnosing = true;
  const host = ollamaHost();
  setStatus('error', '诊断中…');
  showSimpuiToast('Ollama 诊断', '正在探测 ' + (host || OLLAMA_HOST));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8s 超时
  let detail;
  try {
    // 经后端代理探测，避免浏览器 CORS 误判（与 preflight 同一通道）。
    const qs = host ? '?ollamaHost=' + encodeURIComponent(host) : '';
    const res = await fetch('/api/preflight' + qs, { signal: ctrl.signal });
    if (!res.ok) {
      detail = '⚠ 诊断接口异常：HTTP ' + res.status;
    } else {
      const d = await res.json();
      if (d.ollama === 'ok') {
        const models = Array.isArray(d.models) ? d.models : [];
        detail = '✅ 连接正常：' + (d.ollamaHost || host) + ' 已就绪，已安装 ' + models.length + ' 个模型' +
          (models.length ? '（' + models.slice(0, 5).join('、') + (models.length > 5 ? '…' : '') + '）' : '');
      } else {
        // 后端已给出真实错误（DNS / 连接被拒 / 超时等），原样回显给用户。
        const err = (d.error || '未知错误').toString();
        detail = '❌ 连接失败：' + (d.ollamaHost || host) + '\n' + err +
          '\n常见原因：① Ollama 未启动；② 仅监听 127.0.0.1（远程需 OLLAMA_HOST=0.0.0.0:11434）；③ 防火墙/跨网段';
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      detail = '⏱ 诊断超时（>8s）：后端未响应，可能 Node 进程卡死或本应用服务异常';
    } else {
      detail = '❌ 诊断异常：' + (e && e.message ? e.message : String(e));
    }
  } finally {
    clearTimeout(timer);
    _diagnosing = false;
  }
  // 先移除「正在探测」等旧的诊断 toast，再显示结果，避免两个并存。
  clearDiagToasts();
  showSimpuiToast('Ollama 诊断', detail);
  // 诊断后重新跑 preflight，刷新状态栏（走同一后端通道，避免 CORS）。
  if (typeof preflight === 'function') preflight();
}

// 移除状态栏「Ollama 诊断」相关的旧 toast，确保一次诊断只显示一个结果 toast。
function clearDiagToasts() {
  const container = document.getElementById('simpui-toast-container');
  if (!container) return;
  container.querySelectorAll('.simpui-toast').forEach((t) => {
    const title = t.querySelector('.simpui-toast-title');
    if (title && title.textContent === 'Ollama 诊断') t.remove();
  });
}

// ---------- 会话状态栏 ----------
let lastGitRoot = null; // 已查询过分支的沙箱根，避免重复请求

function resetSessionStats() {
  state.sessionStats = { startTs: null, toolCounts: {}, msgCount: 0, ttftSum: 0, ttftCount: 0, totalTimeSum: 0, contextTokens: 0, contextLimit: state.sessionStats.contextLimit || 0 };
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

// 查询当前模型的 context window 大小
async function fetchModelContext() {
  const model = state.activeModel || state.defaultModel;
  if (!model) return;
  try {
    const params = new URLSearchParams({ model });
    const oh = ollamaHost(); if (oh) params.set('ollamaHost', oh);
    const r = await fetch('/api/model/context?' + params.toString());
    if (!r.ok) return;
    const d = await r.json();
    if (d.contextSize > 0) {
      state.sessionStats.contextLimit = d.contextSize;
      renderSessionState();
    }
  } catch (e) { /* 忽略 */ }
}

// 渲染状态栏
function renderSessionState() {
  const model = state.activeModel || state.defaultModel || '—';
  const boundAbs = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const dirName = boundAbs ? lastSeg(boundAbs)
    : (typeof browseRoot !== 'undefined' && browseRoot) ? browseRoot
    : effectiveRoot() ? lastSeg(effectiveRoot())
    : '默认沙箱';
  const toolCount = (state.tools || []).filter(t => (t.kind || 'tool') === 'tool').length;
  const skillCount = (state.tools || []).filter(t => t.kind === 'skill').length;
  const msgCount = state.session ? state.session.querySelectorAll('.msg').length : 0;
  const removedCount = state.excludedMids ? state.excludedMids.size : 0;
  const avgTtft = state.sessionStats.ttftCount > 0 ? Math.round(state.sessionStats.ttftSum / state.sessionStats.ttftCount) : 0;
  const totalTime = state.sessionStats.totalTimeSum;

  if (ssModelEl) {
    ssModelEl.textContent = model;
    // 有待发送图片且当前模型非视觉模型：高亮提示
    const hasImages = typeof pendingImages !== 'undefined' && pendingImages.length > 0;
    const isVision = hasImages && /vision|gemma|llava|bakllava|minicpm|moondream|cogvlm/i.test(model);
    if (hasImages && !isVision) {
      ssModelEl.classList.add('vision-warn');
      ssModelEl.title = '当前模型可能不支持图片识别，点击切换';
    } else {
      ssModelEl.classList.remove('vision-warn');
      ssModelEl.title = '点击打开设置';
    }
  }
  if (ssCharsEl) {
    const removedPart = removedCount > 0
      ? ` <span class="ss-removed">（${removedCount}）</span>`
      : '';
    ssCharsEl.innerHTML = `${msgCount}${removedPart} 条 | TTFT: ${avgTtft}ms | 总耗时: ${formatElapsed(totalTime)}`;
    ssCharsEl.title = removedCount > 0 ? `共 ${msgCount} 条，其中 ${removedCount} 条已移出上下文` : `${msgCount} 条消息`;
  }
  if (ssGitEl) ssGitEl.textContent = 'git:' + (state.gitBranch || '—');
  if (ssDirEl) ssDirEl.textContent = dirName;
  if (ssToolsEl) ssToolsEl.textContent = 'Tools: ' + toolCount;
  if (ssSkillsEl) ssSkillsEl.textContent = 'Skills: ' + skillCount;

  // 渲染上下文用量条
  renderContextBar();

  // 上下文用量文本：始终显示 token 用量（如 0/131k 0%），清除状态不在此处覆盖
  if (ssContextText) {
    ssContextText.textContent = state.sessionStats.contextLimit > 0
      ? `${formatTokenCount(state.sessionStats.contextTokens || 0)}/${formatTokenCount(state.sessionStats.contextLimit)} ${Math.round((state.sessionStats.contextTokens || 0) / state.sessionStats.contextLimit * 100)}%`
      : (state.sessionStats.contextTokens || 0) > 0 ? formatTokenCount(state.sessionStats.contextTokens || 0) + '/?' : '—';
  }
}

function renderContextBar() {
  if (!ssContextFill) return;
  const used = state.sessionStats.contextTokens || 0;
  const limit = state.sessionStats.contextLimit || 0;

  if (limit > 0) {
    const pct = Math.min(100, Math.round((used / limit) * 100));
    ssContextFill.style.width = pct + '%';
    ssContextFill.classList.remove('warn', 'danger');
    if (pct >= 90) ssContextFill.classList.add('danger');
    else if (pct >= 70) ssContextFill.classList.add('warn');
  } else {
    ssContextFill.style.width = '0%';
    ssContextFill.classList.remove('warn', 'danger');
  }
}

function formatTokenCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}

// 组装状态详情文本（用于弹框展示）
function buildStateDetail() {
  const model = state.activeModel || state.defaultModel || '—';
  const boundAbs = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const root = boundAbs || (typeof browseRoot !== 'undefined' && browseRoot) || effectiveRoot();
  const id = state.conversationId || '—';
  const elapsed = state.sessionStats.startTs ? formatElapsed(Date.now() - state.sessionStats.startTs) : '0m';
  const counts = state.sessionStats.toolCounts || {};
  const toolLines = Object.keys(counts).length
    ? Object.entries(counts).map(([k, v]) => `  ${k} ×${v}`).join('\n')
    : '  无';
  const msgCount = state.session ? state.session.querySelectorAll('.msg').length : 0;
  const removedCount = state.excludedMids ? state.excludedMids.size : 0;
  const ctxTokens = state.sessionStats.contextTokens || 0;
  const ctxLimit = state.sessionStats.contextLimit || 0;
  const ctxLine = ctxLimit > 0
    ? `上下文用量: ${formatTokenCount(ctxTokens)} / ${formatTokenCount(ctxLimit)} (${Math.round(ctxTokens / ctxLimit * 100)}%)`
    : `上下文用量: ${ctxTokens > 0 ? formatTokenCount(ctxTokens) : '—'}`;

  return `模型: ${model}
目录: ${root || '默认沙箱'}${state.gitBranch ? '\n分支: ' + state.gitBranch : ''}
会话 ID: ${id}
已用时长: ${elapsed}
消息数: ${msgCount}${removedCount > 0 ? `（已移除 ${removedCount}）` : ''}
${ctxLine}
工具调用:
${toolLines}`;
}

// 点击状态栏弹出详情
function openStateModal() {
  const body = $('#state-modal-body');
  if (body) body.textContent = buildStateDetail();
  const modal = $('#state-modal');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}
function closeStateModal() {
  const modal = $('#state-modal');
  if (modal) modal.classList.add('hidden');
}

// 查询沙箱目录的 git 分支（用于状态栏），同一根只查一次。
// force=true 时忽略缓存，绑定/切换目录后强制重新查询。
async function fetchGitBranch(root, force) {
  if (!root) { state.gitBranch = ''; lastGitRoot = null; return; }
  if (!force && lastGitRoot === root) return;
  lastGitRoot = root;
  state.gitBranch = '';
  try {
    const params = new URLSearchParams();
    params.set('root', root);
    const r = await fetch('/api/fs/git-branch?' + params.toString());
    const d = await r.json();
    state.gitBranch = d.branch || '';
  } catch (e) {
    state.gitBranch = '';
  }
  renderSessionState();
}

// ---------- 模型选择（持久化到 localStorage，通过 /models 弹窗切换） ----------
const MODEL_KEY = 'local-agent-model'; // 持久化当前选中的模型

function loadSelectedModel() {
  try { return localStorage.getItem(MODEL_KEY) || null; }
  catch (e) { return null; }
}
function saveSelectedModel(m) {
  try { if (m) localStorage.setItem(MODEL_KEY, m); } catch (e) {}
}

function renderModelDropdown() {
  const models = Array.isArray(state.installedModels) ? state.installedModels.slice() : [];
  if (!models.length) {
    state.activeModel = null;
    return;
  }
  // 优先用上次持久化的选择；否则默认第一个
  const saved = loadSelectedModel();
  const selected = (saved && models.includes(saved)) ? saved : models[0];
  state.activeModel = selected;
  fetchModelContext();
  renderSessionState();
}

function setActiveModel(model) {
  if (state.busy) return;
  if (!model || !state.installedModels.includes(model)) return;
  state.activeModel = model;
  saveSelectedModel(model);
  // 切换模型时重置上下文统计并查询新模型的 context window
  state.sessionStats.contextTokens = 0;
  state.sessionStats.contextLimit = 0;
  fetchModelContext();
  renderSessionState();
}

// ---------- 离线诊断按钮接线 ----------
// 状态栏「诊断」按钮：直接探测配置的 Ollama 地址并回显真实错误。
const ollamaDiagnoseBtn = $('#ollama-diagnose');
if (ollamaDiagnoseBtn) ollamaDiagnoseBtn.onclick = diagnoseOllama;
// 顶栏离线状态文字也可点击诊断（仅在离线时显示为可点击）。
if (ollamaStatusEl) {
  ollamaStatusEl.style.cursor = 'pointer';
  ollamaStatusEl.title = '点击诊断 Ollama 连接';
  ollamaStatusEl.onclick = () => {
    if (typeof diagnoseOllama === 'function') diagnoseOllama();
  };
}

