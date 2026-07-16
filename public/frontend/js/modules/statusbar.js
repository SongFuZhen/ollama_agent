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
  if (ssCharsEl) ssCharsEl.textContent = `${msgCount} 条 | TTFT: ${avgTtft}ms | 总耗时: ${formatElapsed(totalTime)}`;
  if (ssGitEl) ssGitEl.textContent = 'git:' + (state.gitBranch || '—');
  if (ssDirEl) ssDirEl.textContent = dirName;
  if (ssToolsEl) ssToolsEl.textContent = 'Tools: ' + toolCount;
  if (ssSkillsEl) ssSkillsEl.textContent = 'Skills: ' + skillCount;

  // 渲染上下文用量条
  renderContextBar();

  // 上下文已清除警告（Task 4: 视觉反馈）
  if (ssContextText) {
    ssContextText.textContent = state.conversationCleared
      ? '⚠ 上下文已清除 · 下条消息不带历史'
      : (state.sessionStats.contextLimit > 0
          ? `${formatTokenCount(state.sessionStats.contextTokens || 0)}/${formatTokenCount(state.sessionStats.contextLimit)} ${state.sessionStats.contextLimit > 0 ? Math.round((state.sessionStats.contextTokens || 0) / state.sessionStats.contextLimit * 100) + '%' : ''}`
          : (state.sessionStats.contextTokens || 0) > 0 ? formatTokenCount(state.sessionStats.contextTokens || 0) + '/?' : '—');
    ssContextText.classList.toggle('context-cleared-warning', state.conversationCleared);
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
  const ctxTokens = state.sessionStats.contextTokens || 0;
  const ctxLimit = state.sessionStats.contextLimit || 0;
  const ctxLine = ctxLimit > 0
    ? `上下文用量: ${formatTokenCount(ctxTokens)} / ${formatTokenCount(ctxLimit)} (${Math.round(ctxTokens / ctxLimit * 100)}%)`
    : `上下文用量: ${ctxTokens > 0 ? formatTokenCount(ctxTokens) : '—'}`;

  return `模型: ${model}
目录: ${root || '默认沙箱'}${state.gitBranch ? '\n分支: ' + state.gitBranch : ''}
会话 ID: ${id}
已用时长: ${elapsed}
消息数: ${msgCount}
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

// 查询沙箱目录的 git 分支（用于状态栏），同一根只查一次
async function fetchGitBranch(root) {
  if (!root) { state.gitBranch = ''; lastGitRoot = null; return; }
  if (lastGitRoot === root) return;
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
