'use strict';

/* =========================================================================
 * history.js — 历史对话抽屉、列表、加载对话（含消息回放）、删除二次确认。
 * 依赖全局：state、escapeHtml、renderMarkdown、generateConvId、
 *   appendUser/appendThinkBlock/updateThinkContent/appendToolCall/ensureMessageContainer
 *   (render.js)、loadHistoryFromMessages/syncUrl/updateProjectRootUI/showEmptyIfEmpty/
 *   renderSessionState/scrollDown/effectiveRoot(local chat.js、statusbar.js)、
 *   resetSessionStats、openDeleteConfirm、closeLogDrawer、localDirCache、browseRoot、
 *   localFiles、buildLocalTree、createFileNode、el、renderLocalTree、fileTreeEl、
 *   updatePanelHint、loadFileTreeForRoot(file-browser.js)。
 * ========================================================================= */

// ---------- 历史对话 Drawer ----------
const historyDrawer = $('#history-drawer');
const historyList = $('#history-list');
const drawerClose = $('#drawer-close');
const drawerOverlay = $('#drawer-overlay');

function openDrawer() {
  historyDrawer.classList.remove('hidden');
  loadHistoryList();
}

function closeDrawer() {
  historyDrawer.classList.add('hidden');
}

async function loadHistoryList() {
  historyList.innerHTML = '<div class="history-loading"><span class="spin"></span>加载中…</div>';
  try {
    const res = await fetch('/api/conversations');
    const conversations = await res.json();

    if (conversations.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <i data-lucide="message-square-dashed"></i>
          <div class="history-empty-title">暂无历史对话</div>
          <div class="history-empty-sub">开始新对话后会显示在这里</div>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    historyList.innerHTML = conversations.map(conv => {
      const time = new Date(conv.updated_at).toLocaleString('zh-CN');
      const title = conv.title || '新对话';
      return `
        <div class="history-item" data-id="${conv.id}">
          <div class="history-item-main" data-id="${conv.id}">
            <div class="history-item-title">${escapeHtml(title)}</div>
            <div class="history-item-time">${time}</div>
          </div>
          <button class="history-del" type="button" data-id="${conv.id}" data-title="${escapeHtml(title)}" title="删除对话" aria-label="删除对话">🗑</button>
        </div>
      `;
    }).join('');

    // 绑定点击事件：点击主体加载对话，点击删除按钮弹确认
    historyList.querySelectorAll('.history-item-main').forEach(item => {
      item.onclick = () => loadHistoryConversation(item.dataset.id);
    });
    historyList.querySelectorAll('.history-del').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openDeleteConfirm(btn.dataset.id, btn.dataset.title);
      };
    });
  } catch (e) {
    historyList.innerHTML = '<div class="history-err">⚠ 加载失败: ' + escapeHtml(e.message) + '</div>';
    console.error('加载历史对话失败:', e);
  }
}

async function loadHistoryConversation(convId) {
  // 加载中：在会话区显示占位，避免空白或旧内容闪烁
  emptyEl.style.display = 'none';
  if (state.session) state.session.innerHTML = '<div class="history-conv-loading"><span class="spin"></span>加载对话中…</div>';
  closeDrawer();
  try {
    const res = await fetch(`/api/conversation/${convId}`);
    const data = await res.json();

    if (!data.messages || data.messages.length === 0) {
      if (state.session) state.session.innerHTML = '';
      showEmptyIfEmpty();
      showSimpuiToast('提示', '对话内容为空');
      return;
    }

    // 清空当前会话
    if (state.session) state.session.innerHTML = '';

    // 设置对话 ID
    state.conversationId = convId;
    syncUrl();

    // U3：用后端返回的结构化消息重建前端 history（权威来源），不再依赖 DOM 收集
    loadHistoryFromMessages(data.messages);

    // 恢复对话名称（历史中保存的标题）
    const savedTitle = data.title || '';
    state.conversationTitle = savedTitle;
    if (convNameEl) {
      convNameEl.value = savedTitle;
    }

    // 恢复项目目录（只接受绝对路径）
    const root = data.project_root || '';
    const validRoot = (root && (root.startsWith('/') || /^[A-Z]:\\/i.test(root))) ? root : null;
    state.currentProjectRoot = validRoot;
    updateProjectRootUI();

    // 加载会话统计（TTFT、总耗时等）
    try {
      const statsRes = await fetch(`/api/conversation/${convId}/stats`);
      const statsData = await statsRes.json();
      if (statsData && !statsData.error) {
        state.sessionStats.ttftSum = statsData.ttftSum || 0;
        state.sessionStats.ttftCount = statsData.ttftCount || 0;
        state.sessionStats.totalTimeSum = statsData.totalTimeSum || 0;
        state.sessionStats.toolCounts = statsData.toolCounts || {};
      }
    } catch (e) {
      console.warn('加载会话统计失败:', e);
    }

    // 如果对话有有效的 project_root，加载对应的文件树
    if (validRoot) {
      // 先检查本地缓存
      const cachedFiles = localDirCache.get(validRoot);
      if (cachedFiles) {
        // 从缓存恢复
        localFiles = cachedFiles;
        browseRoot = validRoot;
        const tree = buildLocalTree(cachedFiles);
        fileTreeEl.innerHTML = '';
        const rootNode = createFileNode('dir', browseRoot, 'dir');
        const rootBox = el('div', 'local-children');
        renderLocalTree(tree, rootBox, '');
        rootNode.onclick = () => {
          if (rootBox.childElementCount === 0) renderLocalTree(tree, rootBox, '');
          else rootBox.innerHTML = '';
        };
        fileTreeEl.appendChild(rootNode);
        fileTreeEl.appendChild(rootBox);
        updatePanelHint();
      } else {
        // 尝试从后端加载
        loadFileTreeForRoot(validRoot);
      }
    }

     // 渲染消息
    for (const msg of data.messages) {
      if (msg.role === 'user') {
        appendUser(msg.content, msg.images || []);
      } else {
        if (msg.model) state.currentStreamModel = msg.model;
        ensureMessageContainer();
        // 先按保存顺序恢复思考链与工具调用（thinks/tools 按索引交错还原）
        const thinks = msg.thinks || [];
        const tools = msg.tools || [];
        const maxLen = Math.max(thinks.length, tools.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < thinks.length) {
            appendThinkBlock();
            if (state.streamingThink) state.streamingThink.textContent = thinks[i];
            state.streamingThink = null;
            state.streamingThinkText = '';
          }
          if (i < tools.length) {
            const tool = tools[i];
            appendToolCall(tool.name, tool.params || {}, tool.result || '', state.currentProjectRoot || effectiveRoot() || '');
          }
        }
        // 渲染 Markdown 内容
        if (msg.content) {
          state.streamingAnswer.innerHTML = renderMarkdown(msg.content);
        }
        // 恢复耗时统计（TTFT / 总耗时）
        if (msg.stats && state.streamingHead) {
          const statsEl = state.streamingHead.querySelector('.stats');
          if (statsEl) {
            statsEl.dataset.ttft = msg.stats.ttft;
            statsEl.dataset.total = msg.stats.total;
            statsEl.textContent = `TTFT: ${msg.stats.ttft}ms | 总耗时: ${msg.stats.total}ms`;
          }
        }
        state.streamingAnswer = null;
        state.streamingSteps = null;
      }
    }

    // 恢复上下文用量：promptTokens 是 Ollama 每次返回的累计值（含 system + 所有历史 + 当前用户），
    // 遍历所有消息，最后一条有值的 promptTokens 即为当前上下文总量
    for (const m of data.messages) {
      if (m.stats && m.stats.promptTokens > 0) {
        state.sessionStats.contextTokens = m.stats.promptTokens;
      }
    }

    // Task 5: Show hint if context was previously cleared
    if (data.context_cleared_at) {
      const ago = Math.round((Date.now() - data.context_cleared_at) / 60000);
      showSimpuiToast('提示', `该对话曾在 ${ago} 分钟前清除上下文，历史记录完整保留`);
    }

    closeDrawer();
    showEmptyIfEmpty();
    renderSessionState();
    scrollDown(true);
  } catch (e) {
    console.error('加载对话失败:', e);
    if (state.session) state.session.innerHTML = '';
    showEmptyIfEmpty();
    showSimpuiToast('错误', '加载对话失败: ' + (e.message || e));
  }
}

if (drawerClose) drawerClose.onclick = closeDrawer;
if (drawerOverlay) drawerOverlay.onclick = closeDrawer;

const historyBtnToolbar = $('#history-btn-toolbar');
if (historyBtnToolbar) {
  historyBtnToolbar.onclick = openDrawer;
}

const historyBtn = $('#history-btn');
if (historyBtn) {
  historyBtn.onclick = openDrawer;
}

// ---------- 删除历史对话（需二次确认） ----------
const deleteConfirmModal = $('#delete-confirm');
const deleteConfirmName = $('#delete-confirm-name');
const deleteConfirmBtn = $('#delete-confirm-btn');
const deleteCancelBtn = $('#delete-cancel');
const deleteCancelX = $('#delete-cancel-x');
let pendingDeleteId = null;

function openDeleteConfirm(id, title) {
  pendingDeleteId = id;
  if (deleteConfirmName) deleteConfirmName.textContent = title || '未命名对话';
  if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
}
function closeDeleteConfirm() {
  pendingDeleteId = null;
  if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
}
if (deleteCancelBtn) deleteCancelBtn.onclick = closeDeleteConfirm;
if (deleteCancelX) deleteCancelX.onclick = closeDeleteConfirm;
if (deleteConfirmModal) {
  deleteConfirmModal.onclick = (e) => { if (e.target === deleteConfirmModal) closeDeleteConfirm(); };
}
if (deleteConfirmBtn) {
  deleteConfirmBtn.onclick = async () => {
    const id = pendingDeleteId;
    closeDeleteConfirm();
    if (!id) return;
    // 若正在查看该对话，先清空当前会话
    if (state.conversationId === id) {
      if (state.session) state.session.innerHTML = '';
      state.conversationId = generateConvId();
      showEmptyIfEmpty();
    }
    try {
      const r = await fetch('/api/conversation/' + id, { method: 'DELETE' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '删除失败');
      // 重新拉取列表（保持在抽屉内）
      loadHistoryList();
    } catch (e) {
      showSimpuiToast('错误', '删除失败: ' + e.message);
    }
  };
}
