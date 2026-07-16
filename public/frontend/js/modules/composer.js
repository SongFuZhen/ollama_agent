'use strict';

/* =========================================================================
 * composer.js — 输入框自适应/字数、发送快捷键绑定、对话名称编辑、URL 会话持久化、新对话。
 * 依赖全局：state、generateConvId、escapeHtml、$、el、showEmptyIfEmpty、showSimpuiToast、
 *   abortCurrentRequest/setBusy/send/autoResizeInput/effectiveRoot/renderSessionState/
 *   updateProjectRootUI/syncUrl/resetSessionStats/mountSession(其它模块)。
 * ========================================================================= */

// ---------- 输入框自适应高度（最多约 4 行，超出滚动） ----------
function autoResizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 104) + 'px';
  updateCharCount();
}
function updateCharCount() {
  if (!charCountEl) return;
  const len = inputEl.value.length;
  const pct = len / INPUT_MAX;
  charCountEl.textContent = len + ' / ' + INPUT_MAX;
  charCountEl.classList.remove('warn', 'danger');
  if (pct >= 0.95) charCountEl.classList.add('danger');
  else if (pct >= 0.8) charCountEl.classList.add('warn');
}
inputEl.addEventListener('input', autoResizeInput);

// ---------- 对话名称（可编辑，保存到历史） ----------
// 更新当前对话名称（仅更新 UI 与状态，落库由 save/blur 触发）
function setConvName(title) {
  state.conversationTitle = title || '';
  if (convNameEl && document.activeElement !== convNameEl) {
    convNameEl.value = title || '';
  }
}
// 持久化对话名称到后端（PATCH /api/conversation/:id）
function renameConversation(id, title) {
  if (!id) return;
  fetch('/api/conversation/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title: title || '' }),
  }).catch((e) => console.error('重命名对话失败:', e));
}
if (convNameEl) {
  const commit = () => {
    const val = convNameEl.value.trim();
    setConvName(val);
    renameConversation(state.conversationId, val);
  };
  // 失焦时保存
  convNameEl.addEventListener('blur', commit);
  // 回车提交并失焦
  convNameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); convNameEl.blur(); }
  });
}

// ---------- URL 会话持久化（刷新/分享不丢失） ----------
// 把当前对话 ID 写进 hash：#/session/<id>
let _urlSyncLock = false;
function syncUrl() {
  const id = state.conversationId;
  if (!id) return;
  const target = '#/session/' + id;
  if (location.hash === target) return;
  _urlSyncLock = true;
  location.hash = target;
}
// 从 hash 解析会话 ID（无则返回 null）
function parseSessionIdFromHash() {
  const m = location.hash.match(/^#\/session\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
// 打开指定 ID 的对话（用于刷新恢复 / hash 导航）
async function openSessionById(id) {
  if (!id) return false;
  try {
    const res = await fetch(`/api/conversation/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data || data.error || !data.id) return false;
    // 复用历史对话渲染逻辑
    await loadHistoryConversation(id);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 新对话 ----------
$('#new-chat').onclick = () => {
  // 中止进行中的请求并复位忙碌态，避免输入框/发送按钮卡死
  abortCurrentRequest();
  setBusy(false);

  if (state.session) state.session.innerHTML = '';
  messagesEl.innerHTML = '';
  if (state.session) messagesEl.appendChild(state.session);
  // 生成新对话 ID，保留已有项目目录
  state.currentProjectRoot = effectiveRoot();
  state.conversationId = generateConvId();
  state.conversationTitle = '';
  state.history = []; // U3：新对话清空结构化历史
  state.conversationCleared = false; // 重置上下文清除标记
  state.contextClearedAt = null; // 重置清除时间戳
  setConvName('');
  updateProjectRootUI();
  // 空状态页预填已有 project root
  const rootInput = document.getElementById('empty-root-input');
  if (rootInput) rootInput.value = state.currentProjectRoot || '';
  syncUrl();
  resetSessionStats();
  renderSessionState();
  showEmptyIfEmpty();
};
