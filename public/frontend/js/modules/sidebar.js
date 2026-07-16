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
