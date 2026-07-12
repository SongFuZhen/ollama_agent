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
      showSimpuiToast('提示', '对话内容为空');
      return;
    }

    // 清空当前会话
    if (state.session) state.session.innerHTML = '';

    // 设置对话 ID
    state.conversationId = convId;
    syncUrl();

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

    closeDrawer();
    showEmptyIfEmpty();
    renderSessionState();
    scrollDown(true);
  } catch (e) {
    console.error('加载对话失败:', e);
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

  if (ssModelEl) ssModelEl.textContent = model;
  if (ssCharsEl) ssCharsEl.textContent = `${msgCount} 条 | TTFT: ${avgTtft}ms | 总耗时: ${formatElapsed(totalTime)}`;
  if (ssGitEl) ssGitEl.textContent = 'git:' + (state.gitBranch || '—');
  if (ssDirEl) ssDirEl.textContent = dirName;
  if (ssToolsEl) ssToolsEl.textContent = 'Tools: ' + toolCount;
  if (ssSkillsEl) ssSkillsEl.textContent = 'Skills: ' + skillCount;

  // 渲染上下文用量条
  renderContextBar();
}

function renderContextBar() {
  if (!ssContextFill || !ssContextText) return;
  const used = state.sessionStats.contextTokens || 0;
  const limit = state.sessionStats.contextLimit || 0;

  if (limit > 0) {
    const pct = Math.min(100, Math.round((used / limit) * 100));
    ssContextFill.style.width = pct + '%';
    ssContextFill.classList.remove('warn', 'danger');
    if (pct >= 90) ssContextFill.classList.add('danger');
    else if (pct >= 70) ssContextFill.classList.add('warn');
    ssContextText.textContent = `${formatTokenCount(used)}/${formatTokenCount(limit)} ${pct}%`;
  } else {
    ssContextFill.style.width = '0%';
    ssContextFill.classList.remove('warn', 'danger');
    ssContextText.textContent = used > 0 ? formatTokenCount(used) + '/?' : '—';
  }
}

function formatTokenCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}

// 状态栏点击事件
if (ssToolsEl) ssToolsEl.addEventListener('click', showTools);
if (ssSkillsEl) ssSkillsEl.addEventListener('click', showSkills);

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
      appendToolCall(ev.action, ev.params, null, ev.root || effectiveRoot() || '');
      // 累计工具调用次数到状态栏
      state.sessionStats.toolCounts[ev.action] = (state.sessionStats.toolCounts[ev.action] || 0) + 1;
      renderSessionState();
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
      
    case 'error':
      appendStep('error', '⚠ ' + ev.msg + (ev.content ? '\n' + ev.content : ''));
      break;
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

// ---------- 中止控制器 ----------
let currentAbortController = null;
let requestAborted = false;

// ---------- 发送请求（SSE 流式读取） ----------
async function send() {
  const text = inputEl.value.trim();
  if (state.busy) return;
  if (!text && pendingImages.length === 0) return; // 文+图至少一项

  const convId = state.conversationId;

  const imgs = pendingImages.slice();
  inputEl.value = '';
  autoResizeInput();
  pendingImages.length = 0;
  renderImageThumbs();

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

  // 收集对话历史（最近 20 条，不含当前输入），供模型感知上下文
  const history = [];
  if (state.session) {
    const msgs = state.session.querySelectorAll('.msg');
    for (const m of msgs) {
      if (m.classList.contains('user')) {
        const bubble = m.querySelector('.bubble');
        history.push({ role: 'user', content: bubble ? bubble.textContent.trim() : '' });
      } else if (m.classList.contains('agent') && m.classList.contains('answer-card')) {
        // 只取最终答案，跳过思考/工具步骤
        const bubble = m.querySelector('.bubble');
        if (bubble && bubble.textContent.trim()) {
          history.push({ role: 'assistant', content: bubble.textContent.trim() });
        }
      }
    }
  }

  const body = { message: text, images: imgs.map((i) => i.b64), history };
  if (state.activeModel) body.model = state.activeModel;    // 下拉选中的模型
  const oh = ollamaHost(); if (oh) body.ollamaHost = oh;     // 前端覆盖 Ollama 地址

  // 生效沙箱根：已绑定的绝对路径优先；否则设置页绝对路径；否则本地浏览目录名
  const boundAbs = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  if (!boundAbs) {
    const sAbs = (settingsRoot() && isAbs(settingsRoot())) ? settingsRoot() : null;
    if (sAbs) state.currentProjectRoot = sAbs;
  }
  const effRoot = boundAbs || state.currentProjectRoot || settingsRoot() || browseRoot;
  if (effRoot) body.projectRoot = effRoot;
  if (!state.sessionStats.startTs) state.sessionStats.startTs = Date.now();
  updateProjectRootUI();

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
  requestAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
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
    sendBtn.innerHTML = '<i data-lucide="send" class="send-icon"></i>';
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
// 状态栏：点击模型名称打开模型切换弹框（效果同 /models）
if (ssModelEl) {
  ssModelEl.style.cursor = 'pointer';
  ssModelEl.onclick = () => {
    if (typeof showModels === 'function') showModels();
  };
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
