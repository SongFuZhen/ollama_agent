'use strict';

/* =========================================================================
 * sidebar.js — 侧栏 tab 切换、待办/笔记 渲染与增删改、日志抽屉、添加弹框。
 * 依赖全局：state、escapeHtml、renderMarkdown、fmtTs、showSimpuiToast。
 * ========================================================================= */

// 笔记 / 待办（沙箱目录侧栏内，三 tab 切换：目录 / 待办 / 笔记 / 日志）
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

// 缓存当前列表数据，供编辑弹框回填
let currentTodos = [];
let currentNotes = [];

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

// 按行内容判定级别（用于着色与筛选）
function classifyLogLine(line) {
  if (/\[error\]/.test(line) || /失败/.test(line) || /->\s*[45]\d\d/.test(line)) return 'error';
  if (/\[warn\]/.test(line)) return 'warn';
  if (/\[api\]/.test(line)) return 'api';
  if (/\[quick\]/.test(line)) return 'quick';
  return 'info';
}
const LOG_BADGE = { error: 'ERR', warn: 'WARN', api: 'API', quick: 'CMD' };

let logFilter = 'all';

async function loadLog() {
  if (!logContent) return;
  try {
    const res = await fetch('/api/log?lines=500');
    const data = await res.json();
    const raw = data.content || '（暂无日志）';
    logContent.innerHTML = raw
      .split('\n')
      .map((line) => {
        const text = escapeHtml(line) || '&nbsp;';
        const level = classifyLogLine(line);
        const badge = LOG_BADGE[level]
          ? `<span class="log-badge">${LOG_BADGE[level]}</span> `
          : '';
        return `<div class="log-line log-lvl-${level}" data-level="${level}">${badge}${text}</div>`;
      })
      .join('');
    applyLogFilter();
    logContent.scrollTop = logContent.scrollHeight;
    if (logMeta) {
      logMeta.textContent = `${data.totalLines} 行` + (logFilter !== 'all' ? ` · 筛选: ${logFilter}` : '');
    }
  } catch (e) {
    logContent.innerHTML = `<div class="log-line log-lvl-error" data-level="error">日志读取失败: ${escapeHtml(e.message)}</div>`;
  }
}
// 按当前筛选条件显隐行
function applyLogFilter() {
  if (!logContent) return;
  logContent.querySelectorAll('.log-line').forEach((el) => {
    el.classList.toggle('hidden', logFilter !== 'all' && el.dataset.level !== logFilter);
  });
}
function setLogFilter(level) {
  logFilter = level;
  document.querySelectorAll('#log-filters .log-filter').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === level);
  });
  applyLogFilter();
  if (logMeta) {
    const total = logContent ? logContent.querySelectorAll('.log-line').length : 0;
    logMeta.textContent = (total ? total + ' 行' : '') + (logFilter !== 'all' ? ` · 筛选: ${logFilter}` : '');
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
const logFiltersEl = $('#log-filters');
if (logFiltersEl) {
  logFiltersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.log-filter');
    if (btn) setLogFilter(btn.dataset.filter);
  });
}

function renderTodos(todos) {
  if (!todoList) return;
  currentTodos = todos;
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
          <div class="todo-line">
            <span class="todo-title">${escapeHtml(t.title || '(无标题)')}</span>
            <span class="pri-badge pri-${pri}">${pri === 'high' ? '高' : pri === 'low' ? '低' : '中'}</span>
            ${t.due ? `<span class="todo-due" title="截止">📅 ${escapeHtml(t.due)}</span>` : ''}
            <span class="todo-actions">
              <button class="todo-edit" data-act="edit" data-id="${t.id}" title="编辑">✎</button>
              <button class="todo-del" data-act="delete" data-id="${t.id}" title="删除">✕</button>
            </span>
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
  currentNotes = notes;
  if (!notes.length) {
    noteList.innerHTML = '<li class="notes-empty">暂无笔记</li>';
  } else {
    noteList.innerHTML = notes
      .map((n) => {
        const text = n.title || (n.content || '').split('\n')[0] || '(无内容)';
        return `
        <li class="note-item" data-id="${n.id}">
          <div class="note-line">
            <span class="note-title">${escapeHtml(text)}</span>
            <button class="note-edit" data-act="edit" data-id="${n.id}" title="编辑">✎</button>
            <button class="note-del" data-act="delete" data-id="${n.id}" title="删除">✕</button>
          </div>
        </li>`;
      })
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

// ---------- 编辑待办 / 笔记 弹框 ----------
const todoEditModal = $('#todo-edit-modal');
const todoEditTitle = $('#todo-edit-title');
const todoEditBody = $('#todo-edit-body');
const todoEditPriority = $('#todo-edit-priority');
const todoEditStatus = $('#todo-edit-status');
const todoEditDue = $('#todo-edit-due');
const noteEditModal = $('#note-edit-modal');
const noteEditTitle = $('#note-edit-title');
const noteEditContent = $('#note-edit-content');
let editingTodoId = null;
let editingNoteId = null;

function openTodoEditModal(id) {
  const t = currentTodos.find((x) => String(x.id) === String(id));
  if (!t || !todoEditModal) return;
  editingTodoId = t.id;
  if (todoEditTitle) todoEditTitle.value = t.title || '';
  if (todoEditBody) todoEditBody.value = t.body || '';
  if (todoEditPriority) todoEditPriority.value = t.priority || 'medium';
  if (todoEditStatus) todoEditStatus.value = t.status || 'todo';
  if (todoEditDue) todoEditDue.value = t.due || '';
  todoEditModal.classList.remove('hidden');
  if (todoEditTitle) todoEditTitle.focus();
}
function closeTodoEditModal() {
  if (todoEditModal) todoEditModal.classList.add('hidden');
  editingTodoId = null;
}
async function saveTodoEdit() {
  if (editingTodoId == null) return;
  await todoAction('update', editingTodoId, {
    title: todoEditTitle ? todoEditTitle.value : '',
    body: todoEditBody ? todoEditBody.value : '',
    priority: todoEditPriority ? todoEditPriority.value : 'medium',
    due: todoEditDue ? (todoEditDue.value || null) : null,
    status: todoEditStatus ? todoEditStatus.value : 'todo',
  });
  closeTodoEditModal();
}
function openNoteEditModal(id) {
  const n = currentNotes.find((x) => String(x.id) === String(id));
  if (!n || !noteEditModal) return;
  editingNoteId = n.id;
  if (noteEditTitle) noteEditTitle.value = n.title || '';
  if (noteEditContent) noteEditContent.value = n.content || '';
  noteEditModal.classList.remove('hidden');
  if (noteEditContent) noteEditContent.focus();
}
function closeNoteEditModal() {
  if (noteEditModal) noteEditModal.classList.add('hidden');
  editingNoteId = null;
}
async function saveNoteEdit() {
  if (editingNoteId == null) return;
  await noteAction('update', editingNoteId, {
    title: noteEditTitle ? noteEditTitle.value : '',
    content: noteEditContent ? noteEditContent.value : '',
  });
  closeNoteEditModal();
}

if ($('#todo-edit-save')) $('#todo-edit-save').onclick = () => saveTodoEdit();
if ($('#todo-edit-cancel')) $('#todo-edit-cancel').onclick = closeTodoEditModal;
if ($('#todo-edit-close')) $('#todo-edit-close').onclick = closeTodoEditModal;
if (todoEditModal) {
  todoEditModal.onclick = (e) => { if (e.target === todoEditModal) closeTodoEditModal(); };
  todoEditModal.onkeydown = (e) => { if (e.key === 'Escape') closeTodoEditModal(); };
}
if ($('#note-edit-save')) $('#note-edit-save').onclick = () => saveNoteEdit();
if ($('#note-edit-cancel')) $('#note-edit-cancel').onclick = closeNoteEditModal;
if ($('#note-edit-close')) $('#note-edit-close').onclick = closeNoteEditModal;
if (noteEditModal) {
  noteEditModal.onclick = (e) => { if (e.target === noteEditModal) closeNoteEditModal(); };
  noteEditModal.onkeydown = (e) => { if (e.key === 'Escape') closeNoteEditModal(); };
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
    if (act === 'toggle') {
      todoAction('toggle', id);
    } else if (act === 'delete') {
      todoAction('delete', id);
    } else if (act === 'edit') {
      openTodoEditModal(id);
    }
  };
}
if (noteList) {
  noteList.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'edit') {
      openNoteEditModal(id);
    } else if (act === 'delete') {
      noteAction('delete', id);
    }
  };
}
