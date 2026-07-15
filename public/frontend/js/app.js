'use strict';

/* =========================================================================
 * Ason Agent — 前端主入口
 * 通过 SSE 接收后端的 Agent 执行过程并实时渲染。
 * ========================================================================= */

// ---------- DOM 引用 ----------
const messagesEl = $('#messages');
const chatAreaEl = $('#chat-area');
const inputEl = $('#input');
const charCountEl = $('#char-count');
const INPUT_MAX = 20000;
const sendBtn = $('#send');
const ollamaStatusEl = $('#ollama-status');
const debugIconEl = $('#debug-icon');
const emptyEl = $('#empty');
const convNameEl = $('#conv-name');
const userDropdown = $('.user-dropdown');
const userNameEl = $('#user-name');

// 状态栏元素
const ssModelEl = $('#ss-model');
const ssCharsEl = $('#ss-chars');
const ssDirEl = $('#ss-dir');
const ssGitEl = $('#ss-git');
const ssToolsEl = $('#ss-tools');
const ssSkillsEl = $('#ss-skills');
const ssMoreEl = $('#ss-more');
const ssContextFill = $('#ss-context-fill');
const ssContextText = $('#ss-context-text');

// 状态栏点击事件：打开工具/技能列表
if (ssToolsEl) {
  ssToolsEl.addEventListener('click', () => {
    if (typeof showTools === 'function') showTools();
  });
}
if (ssSkillsEl) {
  ssSkillsEl.addEventListener('click', () => {
    if (typeof showSkills === 'function') showSkills();
  });
}
if (ssModelEl) {
  ssModelEl.addEventListener('click', () => {
    if (typeof showModels === 'function') showModels();
  });
}

// 下拉菜单切换
if (userDropdown) {
  const userBtn = userDropdown.querySelector('#user-btn');
  if (userBtn) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });
  }
  document.addEventListener('click', () => {
    userDropdown.classList.remove('open');
  });
}

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
// ---------- 笔记 / 待办（沙箱目录侧栏内，三 tab 切换：目录 / 待办 / 笔记 / 日志） ----------
const sidebarTabs = $('#sidebar-tabs');
const tabTodoBadge = $('#tab-todo-badge');
const todoList = $('#todo-list');
const noteList = $('#note-list');
const todoTitleInput = $('#todo-title-input');
const todoPriorityInput = $('#todo-priority-input');
const todoDueInput = $('#todo-due-input');
const todoAddOpen = $('#todo-add-open');
const noteTitleInput = $('#note-title-input');
const noteInput = $('#note-input');
const noteAddOpen = $('#note-add-open');
const todoCount = $('#todo-count');
const noteCount = $('#note-count');

// 切换侧栏底部 tab：整视图替换（目录 / 待办 / 笔记 各自独立）
function switchSidebarTab(tabName) {
  document.querySelectorAll('#sidebar-tabs .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.sidebar-panes .pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.pane === tabName);
  });
  if (tabName === 'todos' || tabName === 'notes') loadNotes();

}
if (sidebarTabs) {
  sidebarTabs.onclick = (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchSidebarTab(btn.dataset.tab);
  };
}

function fmtTs(ts) {
  try { return new Date(ts).toLocaleString(); } catch (e) { return ''; }
}

async function loadNotes() {
  if (!todoList || !noteList) return;
  try {
    const [todos, notes] = await Promise.all([
      fetch('/api/todos').then((r) => r.json()),
      fetch('/api/notes').then((r) => r.json()),
    ]);
    renderTodos(todos);
    renderNotes(notes);
  } catch (e) {
    if (todoList) todoList.innerHTML = '<li class="notes-err">加载失败: ' + e.message + '</li>';
  }
}

// ---------- 日志（状态栏「日志」按钮 → 右侧抽屉） ----------
const logDrawer = $('#log-drawer');
const logDrawerOverlay = $('#log-drawer-overlay');
const logDrawerClose = $('#log-drawer-close');
const logDownloadBtn = $('#log-download');
const logContent = $('#log-content');
const logMeta = $('#log-meta');
const logAutoEl = $('#log-auto');
const logRefreshBtn = $('#log-refresh');
const logOpenBtn = $('#log-open');
let logTimer = null;

async function loadLog() {
  if (!logContent) return;
  try {
    const res = await fetch('/api/log?lines=500');
    const data = await res.json();
    const raw = data.content || '（暂无日志）';
    logContent.innerHTML = raw
      .split('\n')
      .map((line) => `<div class="log-line">${escapeHtml(line) || '&nbsp;'}</div>`)
      .join('');
    logContent.scrollTop = logContent.scrollHeight;
    if (logMeta) logMeta.textContent = `${data.totalLines} 行`;
  } catch (e) {
    logContent.innerHTML = `<div class="log-line">日志读取失败: ${escapeHtml(e.message)}</div>`;
  }
}
function startLogAuto() {
  stopLogAuto();
  logTimer = setInterval(loadLog, 2000);
}
function stopLogAuto() {
  if (logTimer) { clearInterval(logTimer); logTimer = null; }
}
function openLogDrawer() {
  if (!logDrawer) return;
  logDrawer.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
  loadLog();
  if (logAutoEl && logAutoEl.checked) startLogAuto();
}
function closeLogDrawer() {
  if (logDrawer) logDrawer.classList.add('hidden');
  stopLogAuto();
}
if (logOpenBtn) logOpenBtn.onclick = openLogDrawer;
if (logDrawerClose) logDrawerClose.onclick = closeLogDrawer;
if (logDrawerOverlay) logDrawerOverlay.onclick = closeLogDrawer;
if (logRefreshBtn) logRefreshBtn.onclick = () => loadLog();
if (logDownloadBtn) logDownloadBtn.onclick = () => { window.open('/api/log?download=1', '_blank'); };
if (logAutoEl) logAutoEl.onchange = () => { logAutoEl.checked ? startLogAuto() : stopLogAuto(); };

function renderTodos(todos) {
  if (!todoList) return;
  if (!todos.length) {
    todoList.innerHTML = '<li class="notes-empty">暂无待办</li>';
  } else {
    todoList.innerHTML = todos
      .map((t) => {
        const pri = t.priority || 'medium';
        const checked = t.status === 'done' ? 'checked' : '';
        return `
        <li class="todo-item ${t.status === 'done' ? 'done' : ''} ${t.status === 'doing' ? 'doing' : ''}" data-id="${t.id}">
          <input type="checkbox" class="todo-toggle" data-act="toggle" data-id="${t.id}" ${checked} title="切换完成" />
          <div class="todo-main">
            <div class="todo-line">
              <span class="todo-title">${escapeHtml(t.title || '(无标题)')}</span>
              <span class="pri-badge pri-${pri}">${pri === 'high' ? '高' : pri === 'low' ? '低' : '中'}</span>
              ${t.due ? `<span class="todo-due" title="截止">📅 ${escapeHtml(t.due)}</span>` : ''}
              <button class="todo-edit" data-act="edit" data-id="${t.id}" title="编辑">✎</button>
              <button class="todo-del" data-act="delete" data-id="${t.id}" title="删除">✕</button>
            </div>
            ${t.body ? `<div class="todo-body mdit">${renderMarkdown(t.body)}</div>` : ''}
            <div class="todo-edit-form hidden">
              <input class="ef-title simpui-input" type="text" value="${escapeHtml(t.title || '')}" placeholder="标题" />
              <textarea class="ef-body simpui-input" rows="3" placeholder="备注（Markdown）">${escapeHtml(t.body || '')}</textarea>
              <div class="ef-row">
                <select class="ef-priority simpui-input">
                  <option value="high" ${pri === 'high' ? 'selected' : ''}>高</option>
                  <option value="medium" ${pri === 'medium' ? 'selected' : ''}>中</option>
                  <option value="low" ${pri === 'low' ? 'selected' : ''}>低</option>
                </select>
                <input class="ef-due simpui-input" type="date" value="${t.due ? escapeHtml(t.due) : ''}" />
                <select class="ef-status simpui-input">
                  <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>待办</option>
                  <option value="doing" ${t.status === 'doing' ? 'selected' : ''}>进行中</option>
                  <option value="done" ${t.status === 'done' ? 'selected' : ''}>完成</option>
                </select>
              </div>
              <div class="ef-actions">
                <button class="simpui-btn primary sm ef-save" data-act="update" data-id="${t.id}">保存</button>
                <button class="simpui-btn sm ef-cancel" data-act="cancel" data-id="${t.id}">取消</button>
              </div>
            </div>
          </div>
        </li>`;
      })
      .join('');
  }
  if (todoCount) {
    const left = todos.filter((t) => t.status !== 'done').length;
    todoCount.textContent = todos.length ? `${left}/${todos.length} 待办` : '';
  }
  // 底部 tab 上的待办角标：仅显示未完成的剩余数
  if (tabTodoBadge) {
    const left = todos.filter((t) => t.status !== 'done').length;
    tabTodoBadge.textContent = left > 0 ? String(left) : '';
    tabTodoBadge.classList.toggle('show', left > 0);
  }
}

function renderNotes(notes) {
  if (!noteList) return;
  if (!notes.length) {
    noteList.innerHTML = '<li class="notes-empty">暂无笔记</li>';
  } else {
    noteList.innerHTML = notes
      .map(
        (n) => `
        <li class="note-item" data-id="${n.id}">
          ${n.title ? `<div class="note-title">${escapeHtml(n.title)}</div>` : ''}
          <div class="note-body mdit">${renderMarkdown(n.content)}</div>
          <div class="note-edit-form hidden">
            <input class="ne-title simpui-input" type="text" value="${escapeHtml(n.title || '')}" placeholder="标题（可选）" />
            <textarea class="ne-content simpui-input" rows="5" placeholder="Markdown 正文">${escapeHtml(n.content || '')}</textarea>
            <div class="ne-actions">
              <button class="simpui-btn primary sm ne-save" data-act="update" data-id="${n.id}">保存</button>
              <button class="simpui-btn sm ne-cancel" data-act="cancel" data-id="${n.id}">取消</button>
              <button class="simpui-btn danger sm ne-del" data-act="delete" data-id="${n.id}">删除</button>
            </div>
          </div>
          <div class="note-foot">
            <span class="note-ts">${fmtTs(n.ts)}</span>
            <button class="note-edit" data-act="edit" data-id="${n.id}" title="编辑">✎</button>
          </div>
        </li>`
      )
      .join('');
  }
  if (noteCount) noteCount.textContent = notes.length ? `${notes.length} 条` : '';
}

async function addTodo() {
  const title = todoTitleInput && todoTitleInput.value;
  if (!title || !title.trim()) { showSimpuiToast('提示', '请填写待办标题'); return; }
  await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'add',
      title: title.trim(),
      body: '',
      priority: todoPriorityInput ? todoPriorityInput.value : 'medium',
      due: todoDueInput ? (todoDueInput.value || null) : null,
    }),
  });
  if (todoTitleInput) todoTitleInput.value = '';
  if (todoDueInput) todoDueInput.value = '';
  closeTodoAddModal();
  loadNotes();
}
async function addNote() {
  const content = noteInput && noteInput.value;
  if (!content || !content.trim()) return;
  await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'add',
      title: noteTitleInput ? (noteTitleInput.value || '') : '',
      content: content.trim(),
    }),
  });
  if (noteInput) noteInput.value = '';
  if (noteTitleInput) noteTitleInput.value = '';
  closeNoteAddModal();
  loadNotes();
}
async function todoAction(action, id, extra = {}) {
  await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id: Number(id), ...extra }),
  });
  loadNotes();
}
async function noteAction(action, id, extra = {}) {
  await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id: Number(id), ...extra }),
  });
  loadNotes();
}

// ---------- 添加待办 / 笔记 弹框 ----------
const todoAddModal = $('#todo-add-modal');
const noteAddModal = $('#note-add-modal');

function openTodoAddModal() {
  if (!todoAddModal) return;
  todoAddModal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
  if (todoTitleInput) todoTitleInput.focus();
}
function closeTodoAddModal() {
  if (todoAddModal) todoAddModal.classList.add('hidden');
}
function openNoteAddModal() {
  if (!noteAddModal) return;
  noteAddModal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
  if (noteTitleInput) noteTitleInput.focus();
}
function closeNoteAddModal() {
  if (noteAddModal) noteAddModal.classList.add('hidden');
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

// 笔记 / 待办 侧栏交互（底部 tab 切换，整视图替换）
if (todoAddOpen) todoAddOpen.onclick = openTodoAddModal;
if (noteAddOpen) noteAddOpen.onclick = openNoteAddModal;
// 待办添加弹框
const todoAddSave = $('#todo-add-save');
if (todoAddSave) todoAddSave.onclick = () => addTodo();
const todoAddCancel = $('#todo-add-cancel');
if (todoAddCancel) todoAddCancel.onclick = closeTodoAddModal;
const todoAddClose = $('#todo-add-close');
if (todoAddClose) todoAddClose.onclick = closeTodoAddModal;
if (todoAddModal) {
  todoAddModal.onclick = (e) => { if (e.target === todoAddModal) closeTodoAddModal(); };
  todoAddModal.onkeydown = (e) => {
    if (e.key === 'Escape') closeTodoAddModal();
    if (e.key === 'Enter' && e.target === todoTitleInput) addTodo();
  };
}
// 笔记添加弹框
if (noteAddOpen) noteAddOpen.onclick = openNoteAddModal;
const noteAddSave = $('#note-add-save');
if (noteAddSave) noteAddSave.onclick = () => addNote();
const noteAddCancel = $('#note-add-cancel');
if (noteAddCancel) noteAddCancel.onclick = closeNoteAddModal;
const noteAddClose = $('#note-add-close');
if (noteAddClose) noteAddClose.onclick = closeNoteAddModal;
if (noteAddModal) {
  noteAddModal.onclick = (e) => { if (e.target === noteAddModal) closeNoteAddModal(); };
  noteAddModal.onkeydown = (e) => {
    if (e.key === 'Escape') closeNoteAddModal();
    if (e.key === 'Enter' && (e.target === noteTitleInput || e.target === noteInput)) addNote();
  };
}
// 启动即加载一次待办/笔记（供底部角标显示剩余数）
loadNotes();
// 列表内的切换/删除/编辑/保存用事件委托（按钮动态生成）
if (todoList) {
  todoList.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const li = btn.closest('.todo-item');
    if (act === 'toggle') {
      todoAction('toggle', id);
    } else if (act === 'delete') {
      todoAction('delete', id);
    } else if (act === 'edit') {
      li.querySelector('.todo-edit-form').classList.toggle('hidden');
    } else if (act === 'cancel') {
      li.querySelector('.todo-edit-form').classList.add('hidden');
    } else if (act === 'update') {
      const f = li.querySelector('.todo-edit-form');
      todoAction('update', id, {
        title: f.querySelector('.ef-title').value,
        body: f.querySelector('.ef-body').value,
        priority: f.querySelector('.ef-priority').value,
        due: f.querySelector('.ef-due').value || null,
        status: f.querySelector('.ef-status').value,
      });
    }
  };
}
if (noteList) {
  noteList.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const li = btn.closest('.note-item');
    if (act === 'edit') {
      li.querySelector('.note-edit-form').classList.toggle('hidden');
    } else if (act === 'cancel') {
      li.querySelector('.note-edit-form').classList.add('hidden');
    } else if (act === 'delete') {
      noteAction('delete', id);
    } else if (act === 'update') {
      const f = li.querySelector('.note-edit-form');
      noteAction('update', id, {
        title: f.querySelector('.ne-title').value,
        content: f.querySelector('.ne-content').value,
      });
    }
  };
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
// 新对话：清空当前会话
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

// ---------- 消息流渲染 ----------
function mountSession() {
  messagesEl.innerHTML = '';
  if (!state.session) {
    state.session = el('div', 'session');
  }
  // 确保有对话 ID
  if (!state.conversationId) {
    state.conversationId = generateConvId();
  }
  if (state.bootDone) syncUrl();
  messagesEl.appendChild(state.session);
  // 事件委托：点击「清除上下文」按钮
  state.session.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="clear-context"]');
    if (!btn) return;
    state.conversationCleared = true;
    state.contextClearedAt = Date.now(); // 捕获时间戳，供持久化使用
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">
        <path d="M3 6h18"></path>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
      <span>上下文已清除</span>
    `;
    btn.classList.add('cleared');
    btn.title = '已清除：下一条消息将不携带历史记录发送';
    showSimpuiToast('提示', '已清除上下文，下一条消息将不携带历史记录发送');
  });
  // 同步可编辑的对话名称
  if (convNameEl) {
    convNameEl.value = state.conversationTitle || '';
    convNameEl.placeholder = '新对话';
  }
  // 已有消息的历史会话：以当前时间为起点近似计时
  const hasMsgs = state.session && state.session.querySelectorAll('.msg').length > 0;
  state.sessionStats.startTs = hasMsgs ? Date.now() : null;
  renderSessionState();
  showEmptyIfEmpty();
  scrollDown(true);
}

let autoScroll = true;

function scrollDown(force) {
  if (!force && !autoScroll) return;
  const chatEl = chatAreaEl || messagesEl;
  chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
  updateScrollButton();
}

// 滚动到底部按钮：距底一定距离时显示
const scrollBottomBtn = $('#scroll-bottom');
function updateScrollButton() {
  if (!scrollBottomBtn) return;
  const chatEl = chatAreaEl || messagesEl;
  const distance = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  if (distance > 80) scrollBottomBtn.classList.remove('hidden');
  else scrollBottomBtn.classList.add('hidden');
  // 用户滚回底部时恢复自动滚动
  if (distance <= 40) autoScroll = true;
}
if (scrollBottomBtn) {
  scrollBottomBtn.onclick = () => { autoScroll = true; scrollDown(true); };
  const chatEl = chatAreaEl || messagesEl;
  chatEl.addEventListener('scroll', updateScrollButton);
  // 用户手动向上滚动时暂停自动滚动
  chatEl.addEventListener('wheel', function(e) {
    if (e.deltaY < 0) autoScroll = false;
  });
  window.addEventListener('resize', updateScrollButton);
  window.addEventListener('load', updateScrollButton);
}

function appendToActive(node) {
  const box = state.session || messagesEl;
  box.appendChild(node);
  hideEmpty();
  scrollDown(true);
}

// 当前生效的沙箱根（已绑定的绝对路径优先，其次设置页/服务端默认）
function effectiveRoot() {
  if (state.currentProjectRoot && isAbs(state.currentProjectRoot)) return state.currentProjectRoot;
  const sRoot = settingsRoot();
  if (sRoot && isAbs(sRoot)) return sRoot;
  if (serverRootCache && isAbs(serverRootCache)) return serverRootCache;
  if (state.serverDefaultRoot && isAbs(state.serverDefaultRoot)) return state.serverDefaultRoot;
  return null;
}

// 更新顶栏的项目目录显示 + 沙箱提示
function updateProjectRootUI() {
  const chip = $('#project-root');
  const hint = $('#sandbox-hint');
  if (!chip) return;

  const abs = effectiveRoot();

  if (abs) {
    chip.innerHTML = `<i data-lucide="folder" class="pr-icon"></i><span class="pr-path">${escapeHtml(abs)}</span>`;
    chip.title = '当前会话文件访问限定在此沙箱内：' + abs;
    if (hint) hint.textContent = '当前会话仅可访问此目录下的文件';
  } else if (browseRoot) {
    chip.innerHTML = `<i data-lucide="folder" class="pr-icon"></i><span class="pr-path">${escapeHtml(browseRoot)}</span><span class="pr-tag">本地浏览</span>`;
    chip.title = '本地浏览目录（仅用于插入路径，模型读取仍受沙箱限制）';
    if (hint) hint.textContent = '本会话以「选择目录」浏览本地文件，模型读取受沙箱限制';
  } else {
    const fallback = settingsRoot() || serverRootCache || state.serverDefaultRoot || '默认沙箱';
    chip.innerHTML = `<i data-lucide="folder" class="pr-icon"></i><span class="pr-path">${escapeHtml(fallback)}</span>`;
    chip.title = '当前会话文件访问限定在此沙箱内';
    if (hint) hint.textContent = '当前会话仅可访问此目录下的文件';
  }
  // 重新渲染 Lucide 图标
  if (window.lucide) lucide.createIcons();
  // 同步空状态的绑定提示
  if (typeof refreshEmptyRootStatus === 'function') refreshEmptyRootStatus();
  // 同步文件面板：无根显示提示，有根加载目录树
  if (typeof updateFilePanelState === 'function') updateFilePanelState();
  // 同步会话状态栏（模型 / 目录 / 分支）
  renderSessionState();
  fetchGitBranch(effectiveRoot());
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

// ---------- SSE 事件分发 ----------
// 流程：user -> thinking_start -> thought* -> (tool -> tool_result)* -> token* -> answer
// 每个环节按顺序追加到当前消息容器中
function handleEvent(ev) {
  if (requestAborted) return;
  switch (ev.type) {
    case 'meta':
      state.tools = Array.isArray(ev.tools) ? ev.tools : [];
      if (ev.model) state.currentStreamModel = ev.model;
      // 服务端已收到请求并准备好（位于真正调用模型之前）：标记为「已连接」
      toggleThinking(true, '已连接 · 准备中');
      break;
      
    case 'thinking_start':
      // 模型已开始流式返回（推理/思考阶段）：说明已真正交给模型
      toggleThinking(true, '模型推理中' + phaseStep(ev.step));
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
      // 工具调用，追加到当前消息容器；标签明确显示正在跑哪个工具
      toggleThinking(true, '执行工具：' + ev.action + phaseStep(ev.step));
      ensureMessageContainer();
      appendToolCall(ev.action, ev.params, null, ev.root || effectiveRoot() || '');
      // 累计工具调用次数到状态栏
      state.sessionStats.toolCounts[ev.action] = (state.sessionStats.toolCounts[ev.action] || 0) + 1;
      renderSessionState();
      break;
      
    case 'tool_result':
      // 工具跑完，结果交回模型继续推理
      toggleThinking(true, '工具返回 · 模型整合中' + phaseStep(ev.step));
      updateToolResult(ev.result);
      break;
      
    case 'token':
      // 流式输出 token，开始输出最终答案
      toggleThinking(true, '生成回答中' + phaseStep(ev.step));
      ensureMessageContainer();
      appendToken(ev.content);
      break;
      
    case 'answer':
      // 最终答案（同时结束思考态，兼容仅输出 think 无 token 的模型）
      toggleThinking(false);
      finalizeAnswer(ev.content);
      break;
      
    case 'confirm_request':
      showConfirm(ev);
      break;
      
    case 'confirm_result':
      appendStep('confirm', ev.ok ? '✓ 用户已确认写入' : '✗ 用户拒绝写入');
      break;
      
    case 'stats': {
      // 显示连接统计（直接定位当前答案气泡底部，避免依赖已被清空的 streamingHead）
      const fmt = `TTFT: ${ev.ttft}ms | 总耗时: ${ev.total}ms`;
      const footer = document.querySelector('.msg.agent.answer-card:last-of-type .answer-footer');
      const statsEl = footer && footer.querySelector('.stats');
      if (statsEl) {
        statsEl.textContent = fmt;
        // 记录到 dataset，便于保存时随消息持久化
        statsEl.dataset.ttft = ev.ttft;
        statsEl.dataset.total = ev.total;
        if (typeof ev.promptTokens === 'number') statsEl.dataset.promptTokens = ev.promptTokens;
        if (typeof ev.completionTokens === 'number') statsEl.dataset.completionTokens = ev.completionTokens;
        // 统计到达即落库，确保刷新/历史回放可恢复
        saveConversation();
      }
      // 累计到会话统计
      if (typeof ev.ttft === 'number') {
        state.sessionStats.ttftSum += ev.ttft;
        state.sessionStats.ttftCount += 1;
      }
      if (typeof ev.total === 'number') {
        state.sessionStats.totalTimeSum += ev.total;
      }
      // 更新上下文用量（promptTokens 即为当前上下文 token 数）
      if (typeof ev.promptTokens === 'number' && ev.promptTokens > 0) {
        state.sessionStats.contextTokens = ev.promptTokens;
        // 首次获得模型上下文大小时异步查询
        if (!state.sessionStats.contextLimit) {
          fetchModelContext();
        }
      }
      renderSessionState();
      break;
    }
      
    case 'verify':
      // 验证器闭环：自动跑测试/Lint，及自愈重试进度
      if (ev.status === 'running') {
        toggleThinking(true, '验证中 · 运行测试/Lint' + phaseStep(ev.step));
      } else if (HEAL_STATUSES.has(ev.status)) {
        // 自愈进度：实时反映「验证失败→重试修复→通过/耗尽」
        toggleThinking(true, healLabel(ev) + phaseStep(ev.step));
        showHealBanner(ev);
        // 终态（成功/耗尽/异常）收起横幅，让出消息区空间
        if (ev.status === 'heal_pass' || ev.status === 'heal_exhausted' || ev.status === 'heal_error') {
          setTimeout(hideHealBanner, ev.status === 'heal_pass' ? 2500 : 6000);
        }
      } else {
        toggleThinking(true, (ev.status === 'pass' ? '验证通过' : ev.status === 'fail' ? '验证失败' : '验证异常') + phaseStep(ev.step));
        hideHealBanner(); // 普通验证结束也确保横幅收起
      }
      appendVerify(ev);
      break;

    case 'compact':
      // 上下文压缩（长任务时触发，此前前端未处理）
      toggleThinking(true, '压缩上下文 · 摘要历史' + phaseStep(ev.step));
      appendStep('system', '↧ ' + (ev.msg || '上下文已压缩'));
      break;

    case 'plan':
      // 规划模式最终返回的执行计划：渲染为答案卡片，并追加「确认执行」按钮
      // 形成二段式闭环——用户确认后以 mode:'execute' 重发原始消息（history 自动含本计划）。
      toggleThinking(false);
      finalizeAnswer(ev.content, true);
      appendPlanActions();
      break;

    case 'ask_user_request':
      // 模型通过 ask_user 向用户提问（此前前端未处理）
      toggleThinking(true, '等待你回答…');
      showAskUser(ev);
      break;

    case 'error':
      appendStep('error', '⚠ ' + ev.msg + (ev.content ? '\n' + ev.content : ''));
      break;
  }
}

// 阶段标签里的「第 N 步」后缀（模型每轮工具循环 +1），让长任务进度可见
function phaseStep(step) {
  return typeof step === 'number' && step > 0 ? `（第 ${step} 步）` : '';
}

// 自愈闭环相关状态集合与中文标签（验证失败后自动重试修复进度）
const HEAL_STATUSES = new Set(['heal_start', 'heal_attempt', 'heal_pass', 'heal_exhausted', 'heal_error']);
function healLabel(ev) {
  switch (ev.status) {
    case 'heal_start': return '自愈启动 · 验证失败，准备重试';
    case 'heal_attempt': return '自愈中 · 模型修复代码（退避后重试）';
    case 'heal_pass': return '自愈成功 · 验证通过';
    case 'heal_exhausted': return '自愈耗尽 · 重试次数用尽仍未通过';
    case 'heal_error': return '自愈异常';
    default: return '自愈';
  }
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
  renderSessionState();
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
    x.onclick = () => { pendingImages.splice(i, 1); renderImageThumbs(); renderSessionState(); };
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

// ---------- 中止控制器 ----------
let currentAbortController = null;
let requestAborted = false;

// 最近一次用户消息文本，供 plan 模式「确认执行」二段式复用（此时输入框可能已清空）
let lastUserMessage = '';
// 标记当前中止是否由用户主动触发（用于区分「用户中止」与「连接真正失败」）
let userAborted = false;

// ---------- 发送请求（SSE 流式读取） ----------
// ---------- 结构化历史（U3：解耦 DOM 收集） ----------
// 历史以结构化数组为权威来源：每轮 user/assistant 提交时 push，发送时直接切片上报，
// 不再从 #messages 的 .msg 节点文本 scrape，避免渲染结构变化影响上下文收集。
const HISTORY_LIMIT = 20; // 与后端 validHistory 上限一致，仅保留最近 N 轮
function pushHistory(role, content) {
  if (!content || !content.trim()) return;
  state.history.push({ role, content: content.trim() });
  // 仅保留最近 HISTORY_LIMIT 条，避免无限增长
  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(state.history.length - HISTORY_LIMIT);
  }
}
// 用后端返回的结构化消息（加载历史对话时）重建前端 history
function loadHistoryFromMessages(messages) {
  state.history = (messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

async function send(opts = {}) {
  // 发起全新请求：清除上一次可能遗留的中止标志，避免新请求的初始事件被误丢弃
  requestAborted = false;
  userAborted = false;
  // 二段式闭环：plan 确认执行时传入原始消息文本（此时输入框可能已清空）
  const text = (opts.message != null ? opts.message : inputEl.value).trim();
  if (state.busy) return;
  if (!text && pendingImages.length === 0) return; // 文+图至少一项
  if (text) lastUserMessage = text; // 记录最近一次用户消息，供 plan 确认执行复用

  const convId = state.conversationId;

  const imgs = pendingImages.slice();
  inputEl.value = '';
  autoResizeInput();
  pendingImages.length = 0;
  renderImageThumbs();

  // 发图片时检测当前模型是否支持视觉：不支持则在状态栏模型名上提示
  if (imgs.length > 0) {
    const model = (state.activeModel || state.defaultModel || '').toLowerCase();
    const isVision = /vision|gemma|llava|bakllava|minicpm|moondream|cogvlm/i.test(model);
    if (!isVision) {
      showSimpuiToast('提示', '当前模型可能不支持图片识别，建议切换到 gemma3:4b 等视觉模型');
    }
  }

  // 上传图片到当前项目目录（按 日期/对话 组织），写入磁盘以便持久化与历史回放
  const uploadRoot = settingsRoot() || state.currentProjectRoot || (typeof serverRootCache !== 'undefined' ? serverRootCache : '') || '';
  for (const img of imgs) {
    try {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: uploadRoot, convId, name: img.name, data: img.dataUrl }),
      });
      const d = await r.json();
      if (d.ok && d.path) { img.path = d.path; img.name = d.name || img.name; }
    } catch (e) {
      console.error('图片上传失败:', e);
    }
  }

  appendUser(text || '（图片）', imgs);
  renderSessionState();
  setBusy(true);

  // 首次输入时保存对话
  const msgCount = state.session ? state.session.querySelectorAll('.msg').length : 0;
  if (msgCount <= 1) {
    // 第一条用户消息，保存对话
    await saveConversation();
    // 对话已落库，立即把 session id 写进 URL，刷新即可恢复
    syncUrl();
  }

  // 收集对话历史（结构化，最近 HISTORY_LIMIT 条，不含当前输入）供模型感知上下文。
  // U3：直接读 state.history（权威来源），不再从 DOM .msg 节点 scrape。
  let history;
  if (state.conversationCleared) {
    // 用户点击了「清除上下文」：发送空历史，发送后重置标志（仅影响本次请求）
    history = [];
    state.conversationCleared = false;
    state.contextClearedAt = null; // 重置时间戳（已落库，不再需要）
  } else {
    history = state.history.slice(-HISTORY_LIMIT);
  }
  // 当前用户输入不计入历史（它是本次请求本身），发送后再作为一轮 user 提交入栈。
  const body = { message: text, images: imgs.map((i) => i.b64), history };
  // 二段式闭环：plan 模式下用户点「确认执行」时，显式声明 execute 跳过自动判定，
  // 避免 auto 模式因同一复杂消息再次进 plan 造成死循环。
  if (opts.overrideMode) body.mode = opts.overrideMode;
  if (state.conversationId) body.conversationId = state.conversationId;
  if (state.activeModel) body.model = state.activeModel;    // 下拉选中的模型
  const oh = ollamaHost(); if (oh) body.ollamaHost = oh;     // 前端覆盖 Ollama 地址

  // 生效沙箱根：已绑定的绝对路径优先；否则设置页绝对路径；否则本地浏览目录名
  const boundAbs = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  if (!boundAbs) {
    const sAbs = (settingsRoot() && isAbs(settingsRoot())) ? settingsRoot() : null;
    if (sAbs) state.currentProjectRoot = sAbs;
  }
  const effRoot = boundAbs || state.currentProjectRoot || settingsRoot() || (typeof browseRoot !== 'undefined' ? browseRoot : '');
  if (effRoot) body.projectRoot = effRoot;
  if (!state.sessionStats.startTs) state.sessionStats.startTs = Date.now();
  updateProjectRootUI();

  // U3：当前用户输入作为一轮 user 提交入栈（不含在上方发送的 history 内）。
  // 必须在构造 body 之后调用，确保本次请求不带自己。
  pushHistory('user', text);

  // 创建 AbortController 以支持中止
  requestAborted = false;
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
      // 用户主动中止不视为错误，不追加错误节点（半截卡片已在 abortCurrentRequest 清理）
      if (!userAborted) appendStep('error', '⚠ 已中止');
    } else {
      appendStep('error', '读取响应失败: ' + e.message);
    }
  } finally {
    currentAbortController = null;
    // 无论成功/失败/断开，都必须恢复输入框，避免一直 disabled
    setBusy(false);
  }
}

// plan 模式二段式闭环：在计划答案卡片末尾追加操作按钮。
// - 「确认执行」：以 mode:'execute' 重发原始用户消息，history 自动含本计划，模型按计划实施。
// - 「修改后执行」：把原始消息填回输入框，用户改完自行发送（同样会被 auto 判定，可再确认）。
function appendPlanActions() {
  // 取最后一个 agent 答案卡片：用 querySelectorAll 末尾项，比 :last-of-type 配合类选择器稳健
  // （:last-of-type 只看元素类型位置、不看类，若末尾 .msg 非 answer-card 会匹配失败）
  const cards = document.querySelectorAll('.msg.agent.answer-card');
  const card = cards[cards.length - 1];
  if (!card || card.querySelector('.plan-actions')) return; // 防重复追加
  const wrap = el('div', 'plan-actions');
  const confirm = el('button', 'simpui-btn primary sm', '✅ 确认执行');
  confirm.onclick = () => {
    wrap.remove();
    send({ overrideMode: 'execute', message: lastUserMessage });
  };
  const edit = el('button', 'simpui-btn secondary sm', '✏️ 修改后执行');
  edit.onclick = () => {
    wrap.remove();
    inputEl.value = lastUserMessage;
    autoResizeInput();
    inputEl.focus();
  };
  wrap.appendChild(confirm);
  wrap.appendChild(edit);
  card.appendChild(wrap);
}

// ---------- 中止当前请求 ----------
function abortCurrentRequest() {
  requestAborted = true;
  userAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  // 清理未完成的流式答案卡片：中止发生在 finalize 之前时，state.streamingAnswer
  // 仍指向半截卡片。若不清理，它会被下次发消息的 history 收集当成一条残缺的
  // assistant 回答，并因 ensureMessageContainer 复用旧卡片而把新输出追加进去，
  // 造成上下文错位/顺序混乱。已 finalize 的卡片 streamingAnswer 已置 null，不误删。
  if (state.streamingAnswer) {
    const card = state.streamingAnswer.closest('.msg.agent.answer-card');
    if (card && card.parentNode) card.parentNode.removeChild(card);
    state.streamingAnswer = null;
    state.streamingSteps = null;
    state.streamingText = '';
    state.streamingHead = null;
  }
  setBusy(false);
}

function setBusy(flag) {
  state.busy = flag;
  inputEl.disabled = flag;
  toggleThinking(flag);

  if (flag) {
    // 忙碌时：发送按钮变为中止按钮（方块图标 + 文字，simpui sm danger）
    sendBtn.className = 'send-btn-round simpui-btn danger sm abort';
    sendBtn.innerHTML = '<i data-lucide="square" class="send-icon"></i><span>中止</span>';
    sendBtn.title = '中止';
    sendBtn.onclick = abortCurrentRequest;
  } else {
    // 空闲时：恢复发送按钮（纸飞机图标）
    sendBtn.className = 'send-btn-round simpui-btn primary sm';
    sendBtn.innerHTML = '<i data-lucide="send" class="send-icon"></i><span>发送</span>';
    sendBtn.title = '发送';
    sendBtn.onclick = send;
    currentAbortController = null;
  }
  if (window.lucide) lucide.createIcons();
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
    // 区分连接/思考状态
    thinkingEl.classList.toggle('connecting', msg === '正在连接');
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
// 状态弹框：日志按钮
const stateModalLogBtn = $('#state-modal-log-btn');
if (stateModalLogBtn) stateModalLogBtn.onclick = () => { closeStateModal(); openLogDrawer(); };
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
