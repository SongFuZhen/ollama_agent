'use strict';

/* =========================================================================
 * Ason Agent — 前端主入口（启动 / 全局 DOM 引用 / 事件接线）。
 * 具体的功能模块已拆分到 js/modules/：
 *   chat.js      消息流渲染 / SSE 分发 / 思考态 / 图片 / 发送·中止
 *   sidebar.js   侧栏 tab / 待办·笔记 / 日志抽屉 / 添加弹框
 *   history.js   历史对话抽屉 / 列表 / 加载回放 / 删除确认
 *   statusbar.js 状态栏 / 上下文用量 / 模型下拉 / git 分支 / 详情弹框
 *   composer.js  输入框自适应 / 发送快捷键 / 对话名 / URL 持久化 / 新对话
 * 本文件只负责：共享 DOM 引用、状态栏与用户菜单的全局点击、启动序列。
 * 所有模块共用全局（无打包器）：state / $ / el / renderMarkdown / escapeHtml 等。
 * ========================================================================= */

// 共享 DOM 引用与状态栏/用户菜单点击接线已移至 modules/refs.js（须最先加载）。
// 本文件只负责：发送/输入框绑定、全局 Esc 处理、启动序列。

// ---------- 绑定事件 ----------
sendBtn.onclick = send;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

// 初始化面板提示和按钮状态
updatePanelHint();
renderSessionState();

// 状态栏：点击弹出详情弹框
if (ssMoreEl) {
  ssMoreEl.onclick = openStateModal;
}
// 状态弹框：关闭（按钮 / 点击遮罩 / Esc）
const stateModalClose = $('#state-modal-close');
if (stateModalClose) stateModalClose.onclick = closeStateModal;
const stateModal = $('#state-modal');
if (stateModal) {
  stateModal.onclick = (e) => { if (e.target === stateModal) closeStateModal(); };
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeStateModal();
    closeDeleteConfirm();
    closeTodoAddModal();
    closeNoteAddModal();
    closeLogDrawer();
  }
});
// 状态栏：定时刷新
setInterval(() => { renderSessionState(); }, 30000);

// ---------- 启动 ----------
loadServerRoot();
loadConfig().then(preflight).then(afterBoot);

// 获取并显示真实电脑名
async function loadUserInfo() {
  try {
    const res = await fetch('/api/device');
    if (res.ok) {
      const data = await res.json();
      if (userNameEl) {
        const name = data.hostname || data.username || '用户';
        userNameEl.textContent = name;
        userNameEl.title = name;
      }
    }
  } catch (e) { /* 忽略 */ }
}

// 启动后：若 URL 带 #/session/<id> 则恢复该对话；完成后允许切场景同步 URL
async function afterBoot() {
  state.bootDone = true;
  loadUserInfo();
  // 确保 context window 大小在启动后一定会查询（兜底）
  if (!state.sessionStats.contextLimit) fetchModelContext();
  if (typeof initCommands === 'function') initCommands();
  const id = parseSessionIdFromHash();
  if (id) {
    const ok = await openSessionById(id);
    if (!ok) {
      // 无效 ID：回到当前场景的空会话，并清掉错误 hash
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  // hash 变化（浏览器前进/后退或手动改）时跳到对应对话
  window.addEventListener('hashchange', async () => {
    if (_urlSyncLock) { _urlSyncLock = false; return; } // 忽略自身写入触发的 hashchange
    const hid = parseSessionIdFromHash();
    if (hid && hid !== state.conversationId) {
      const ok = await openSessionById(hid);
      if (!ok) history.replaceState(null, '', location.pathname + location.search);
    } else if (!hid) {
      // 回到无会话 hash：开启新对话
      $('#new-chat').click();
    }
  });
}

// ---------- 热重载：public/ 文件变更时自动刷新页面 ----------
if (typeof EventSource !== 'undefined') {
  try {
    const es = new EventSource('/api/hotreload');
    es.addEventListener('reload', () => location.reload());
  } catch (e) { /* 忽略 */ }
}
