'use strict';

/* commands.js - 输入框斜杠指令（参考 opencode / claude code） */

// 斜杠命令图标映射
const COMMAND_ICONS = {
  skills: 'sparkles',
  tools: 'wrench',
  models: 'cpu',
  help: 'help-circle',
  clear: 'trash-2',
  recall: 'search',
};

// 指令定义
const SLASH_COMMANDS = [
  {
    name: 'skills',
    desc: '查看可用技能',
    icon: 'sparkles',
    run: showSkills,
  },
  {
    name: 'tools',
    desc: '查看可用工具',
    icon: 'wrench',
    run: showTools,
  },
  {
    name: 'models',
    desc: '切换模型',
    icon: 'cpu',
    run: showModels,
  },
  {
    name: 'help',
    desc: '显示所有命令',
    icon: 'help-circle',
    run: showHelp,
  },
  {
    name: 'clear',
    desc: '清空当前对话',
    icon: 'trash-2',
    run: clearChat,
  },
  {
    name: 'compress',
    desc: '压缩上下文（摘要旧历史以省 token）',
    icon: 'minimize-2',
    run: compressContext,
  },
  {
    name: 'recall',
    desc: '语义召回历史记忆',
    icon: 'search',
    run: () => showRecall(),
  },
  {
    name: 'template',
    desc: '使用任务模板（固化高频任务步骤）',
    icon: 'list-tree',
    run: showTemplates,
  },
  {
    name: 'metrics',
    desc: '查看优化指标（埋点）',
    icon: 'activity',
    run: showMetrics,
  },
];

let cmdPaletteEl = null;
let cmdActiveIndex = 0;
let cmdFiltered = [];

// Toolbox 命令图标映射（按命令名）
const QUICK_ICONS = {
  explain: 'book-open',
  commit: 'git-commit',
  comment: 'message-square-plus',
  review: 'scan-search',
  error: 'triangle-alert',
  test: 'flask-conical',
  regex: 'regex',
  fix: 'wrench',
};

// Toolbox 命令是否已装入 slash 菜单（避免重复）
let toolboxLoaded = false;

// 把后端 Toolbox 命令装入 slash 菜单：选中后把「/name 」填入输入框，用户补参数。
function loadToolboxCommands() {
  if (toolboxLoaded) return;
  if (typeof loadQuickCommands !== 'function') return;
  loadQuickCommands().then((cmds) => {
    if (toolboxLoaded || !cmds || !cmds.length) return;
    cmds.forEach((c) => {
      SLASH_COMMANDS.push({
        name: c.name,
        desc: c.desc,
        icon: QUICK_ICONS[c.name] || 'zap',
        tag: '工具箱',
        toolbox: true,
        usage: c.usage || c.name,
        run: () => fillToolboxCommand(c.name),
      });
    });
    toolboxLoaded = true;
    // 若菜单当前可见（用户在输入中），立即重渲染以显示新项
    if (cmdPaletteEl && !cmdPaletteEl.classList.contains('hidden')) {
      cmdActiveIndex = 0;
      renderPalette();
    }
  }).catch(() => {});
}

// 选中 Toolbox 命令：把「/name 」填入输入框并聚焦，等待用户补参数。
function fillToolboxCommand(name) {
  const input = $('#input');
  if (input) {
    input.value = '/' + name + ' ';
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
    autoResizeInput();
  }
}

// @ 选择面板状态（列出全部 tools + skills，可搜索，选中后填入 @name ）
let atPaletteEl = null;
let atActiveIndex = 0;
let atFiltered = [];

// bash 模式状态（输入以 ! 开头时进入，提示用户整行作为 shell 命令）
let bashModeOn = false;

function initCommands() {
  const input = $('#input');
  if (!input) return;
  buildPalette();
  buildAtPalette();
  loadToolboxCommands();
  input.addEventListener('input', onInputChange);
  // keydown 用 capture 阶段注册，确保早于 app.js 的发送监听，
  // 在面板可见时拦截 Enter/Tab，避免把未完成的 @/! 前缀直接发出去。
  input.addEventListener('keydown', onInputKeydown, true);
  document.addEventListener('click', (e) => {
    if (cmdPaletteEl && !cmdPaletteEl.contains(e.target) && e.target !== input) {
      hidePalette();
    }
    if (atPaletteEl && !atPaletteEl.contains(e.target) && e.target !== input) {
      hideAtPalette();
    }
  });
}

function buildPalette() {
  const wrap = el('div', 'slash-menu hidden');
  wrap.id = 'slash-menu';
  const composer = document.querySelector('.composer');
  composer.appendChild(wrap);
  cmdPaletteEl = wrap;
}

// 构建 @ 选择面板（复用 slash-menu 样式，独立元素避免冲突）
function buildAtPalette() {
  const wrap = el('div', 'slash-menu hidden');
  wrap.id = 'at-menu';
  const composer = document.querySelector('.composer');
  composer.appendChild(wrap);
  atPaletteEl = wrap;
}

// 是否处于 bash 模式：输入框以 ! 开头
function isBashInput(val) {
  return val.startsWith('!');
}

// 切换 bash 模式视觉（输入框左边框高亮 + 显示模式徽章）
function setBashMode(on) {
  if (on === bashModeOn) return;
  bashModeOn = on;
  const input = $('#input');
  const badge = document.getElementById('bash-mode-badge');
  if (on) {
    if (input) input.classList.add('bash-mode');
    if (badge) badge.classList.remove('hidden');
  } else {
    if (input) input.classList.remove('bash-mode');
    if (badge) badge.classList.add('hidden');
  }
}

function onInputChange() {
  const input = $('#input');
  const val = input.value;

  // bash 模式：以 ! 开头，提示用户整行作为 shell 命令，隐藏其他面板
  if (isBashInput(val)) {
    setBashMode(true);
    hidePalette();
    hideAtPalette();
    return;
  }
  setBashMode(false);

  // @ 选择面板：以 @ 开头且尚未输入空格，列出可调用工具/技能
  if (val.startsWith('@') && !val.includes(' ')) {
    const q = val.slice(1).toLowerCase();
    const tools = Array.isArray(state.tools) ? state.tools : [];
    atFiltered = tools.filter((t) => t.name.toLowerCase().includes(q));
    if (atFiltered.length) {
      atActiveIndex = 0;
      renderAtPalette();
      showAtPalette();
    } else {
      hideAtPalette();
    }
    hidePalette();
    return;
  }
  hideAtPalette();

  // 原有 slash 命令面板
  if (val.startsWith('/') && !val.includes(' ')) {
    const q = val.slice(1).toLowerCase();
    cmdFiltered = SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
    if (cmdFiltered.length) {
      cmdActiveIndex = 0;
      renderPalette();
      showPalette();
    } else {
      hidePalette();
    }
  } else {
    hidePalette();
  }
}

function renderPalette() {
  cmdPaletteEl.innerHTML = '';
  cmdFiltered.forEach((c, i) => {
    const item = el('div', 'slash-menu-item' + (i === cmdActiveIndex ? ' active' : ''));

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', c.icon || 'terminal');
    icon.className = 'slash-menu-icon';
    item.appendChild(icon);

    const textWrap = el('div', 'slash-menu-text');
    textWrap.appendChild(el('span', 'slash-menu-name', '/' + c.name));
    textWrap.appendChild(el('span', 'slash-menu-desc', c.desc));
    if (c.tag) textWrap.appendChild(el('span', 'slash-menu-tag', c.tag));
    item.appendChild(textWrap);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      runCommand(c);
    });
    cmdPaletteEl.appendChild(item);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// 渲染 @ 选择面板：列出工具/技能，按 kind 标注，可点击或键盘选择
function renderAtPalette() {
  atPaletteEl.innerHTML = '';
  atFiltered.forEach((t, i) => {
    const item = el('div', 'slash-menu-item' + (i === atActiveIndex ? ' active' : ''));
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', t.kind === 'skill' ? 'sparkles' : 'wrench');
    icon.className = 'slash-menu-icon';
    item.appendChild(icon);

    const textWrap = el('div', 'slash-menu-text');
    textWrap.appendChild(el('span', 'slash-menu-name', '@' + t.name));
    const desc = t.desc || '';
    textWrap.appendChild(el('span', 'slash-menu-desc', (t.kind === 'skill' ? '[技能] ' : '[工具] ') + desc));
    item.appendChild(textWrap);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectAtItem(t);
    });
    atPaletteEl.appendChild(item);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showPalette() {
  cmdPaletteEl.classList.remove('hidden');
}

function hidePalette() {
  if (cmdPaletteEl) cmdPaletteEl.classList.add('hidden');
}

function showAtPalette() {
  atPaletteEl.classList.remove('hidden');
}

function hideAtPalette() {
  if (atPaletteEl) atPaletteEl.classList.add('hidden');
}

// 选中 @ 面板中的某项：把输入框填为 @name + 主参数提示，隐藏面板，光标置于末尾
function selectAtItem(t) {
  const input = $('#input');
  if (input) {
    // 工具类补全主参数名（如 @read_file path=），降低「参数格式怎么写」的认知负担；
    // 技能/无参工具仅补空格。
    const hint = (t && t.kind === 'tool' && t.params) ? Object.keys(t.params)[0] : '';
    input.value = '@' + t.name + (hint ? ' ' + hint + '=' : ' ');
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }
  hideAtPalette();
}

function onInputKeydown(e) {
  // @ 面板可见时，拦截方向键/Enter/Tab/Esc，并阻止冒泡到 app.js 的发送监听
  if (atPaletteEl && !atPaletteEl.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopImmediatePropagation();
      atActiveIndex = (atActiveIndex + 1) % atFiltered.length;
      renderAtPalette();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopImmediatePropagation();
      atActiveIndex = (atActiveIndex - 1 + atFiltered.length) % atFiltered.length;
      renderAtPalette();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); e.stopImmediatePropagation();
      const t = atFiltered[atActiveIndex];
      if (t) selectAtItem(t);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      hideAtPalette();
    }
    return;
  }
  if (!cmdPaletteEl || cmdPaletteEl.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdActiveIndex = (cmdActiveIndex + 1) % cmdFiltered.length;
    renderPalette();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdActiveIndex = (cmdActiveIndex - 1 + cmdFiltered.length) % cmdFiltered.length;
    renderPalette();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const cmd = cmdFiltered[cmdActiveIndex];
    if (cmd) runCommand(cmd);
  } else if (e.key === 'Escape') {
    hidePalette();
  }
}

function runCommand(cmd) {
  const input = $('#input');
  input.value = '';
  autoResizeInput(); // 同步字数统计与高度（input 事件不会因直接赋值触发）
  hidePalette();
  cmd.run();
}

/* ----------------------------- */
/* 列表弹窗（/skills、/tools、/models）   */
/* ----------------------------- */
function openListModal(title, rows, options = {}) {
  let modal = $('#cmd-modal');
  if (!modal) {
    modal = el('div', 'simpui-dialog-backdrop hidden');
    modal.id = 'cmd-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const panelClass = options.compact ? 'simpui-dialog-panel sm' : 'simpui-dialog-panel md';
    modal.innerHTML = `
      <div class="${panelClass}">
        <div class="simpui-dialog-header">
          <h3 class="simpui-dialog-title" id="cmd-modal-title"></h3>
          <button class="simpui-dialog-close modal-close-btn" aria-label="关闭">✕</button>
        </div>
        <div id="cmd-modal-body" class="simpui-dialog-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
    modal.querySelector('.simpui-dialog-close').onclick = () => modal.classList.add('hidden');
  }
  const panel = modal.querySelector('.simpui-dialog-panel');
  panel.className = options.compact ? 'simpui-dialog-panel sm' : 'simpui-dialog-panel md';
  modal.querySelector('#cmd-modal-title').textContent = title;
  const body = modal.querySelector('#cmd-modal-body');
  body.innerHTML = '';

  if (!rows.length) {
    body.appendChild(el('div', 'cmd-empty', '暂无内容'));
  } else {
    rows.forEach((r) => body.appendChild(buildRow(r)));
  }
  modal.classList.remove('hidden');
}

function toolToRow(t) {
  const params = [];
  if (t.params && typeof t.params === 'object') {
    for (const [k, v] of Object.entries(t.params)) {
      params.push(typeof v === 'string' ? `${k} — ${v}` : k);
    }
  }
  return {
    name: t.name,
    desc: t.desc || '',
    params,
    kind: t.kind || 'tool',
    tag: t.needConfirm ? '需确认' : null,
  };
}

function buildRow(r) {
  const row = el('div', 'cmd-row');
  const head = el('div', 'cmd-row-head');
  head.appendChild(el('span', 'cmd-row-name', r.name));
  if (r.tag) head.appendChild(el('span', 'simpui-badge warning sm', r.tag));
  if (r.onClick) {
    row.addEventListener('click', () => r.onClick(r.name));
    row.classList.add('clickable');
  }
  // 前置 radio：用于模型选择等单选场景
  if (r.radio !== undefined) {
    const radioWrap = el('label', 'simpui-radio-label cmd-row-radio');
    const radio = el('input', 'simpui-radio-input');
    radio.type = 'radio';
    radio.name = r.radioGroup || 'cmd-radio-group';
    radio.value = r.name;
    if (r.radio) radio.checked = true;
    if (r.onRadio) radio.addEventListener('change', () => r.onRadio(r.name));
    // 阻止 radio 点击冒泡到整行（避免触发整行 onClick 关闭弹框）
    radioWrap.addEventListener('click', (e) => e.stopPropagation());
    radioWrap.appendChild(radio);
    row.appendChild(radioWrap);
  }
  row.appendChild(head);
  if (r.desc) {
    const desc = el('div', 'cmd-row-desc', r.desc);
    row.appendChild(desc);
  }
  const paramsWrap = el('div', 'cmd-row-params');
  if (r.params && r.params.length) {
    r.params.forEach((pp) => {
      const chip = el('code', 'cmd-param', pp);
      paramsWrap.appendChild(chip);
    });
  }
  row.appendChild(paramsWrap);
  return row;
}

function showSkills() {
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const rows = tools.filter((t) => (t.kind || 'tool') === 'skill').map(toolToRow);
  openListModal('可用技能（' + rows.length + '）', rows, { compact: true });
}

function showTools() {
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const rows = tools.filter((t) => (t.kind || 'tool') === 'tool').map(toolToRow);
  openListModal('可用工具（' + rows.length + '）', rows, { compact: true });
}

function showModels() {
  const models = Array.isArray(state.installedModels) ? state.installedModels : [];
  const current = state.activeModel;
  const rows = models.map((m) => ({
    name: m,
    radio: (m === current),
    radioGroup: 'model-select',
    tag: (m === current) ? '当前' : null,
    // 单选 radio 切换：实时设为目标模型，并更新「当前」标记，不关闭弹框
    onRadio: (name) => {
      if (typeof setActiveModel === 'function') setActiveModel(name);
      body && body.querySelectorAll('.cmd-row').forEach((rowEl) => {
        const nm = rowEl.querySelector('.cmd-row-name')?.textContent;
        const badge = rowEl.querySelector('.simpui-badge');
        if (nm === name) {
          if (!badge) {
            const h = rowEl.querySelector('.cmd-row-head');
            h.appendChild(el('span', 'simpui-badge warning sm', '当前'));
          }
        } else if (badge) {
          badge.remove();
        }
      });
    },
    // 点击整行：选中并关闭弹框（兼容无 radio 的快捷操作）
    onClick: (name) => {
      if (typeof setActiveModel === 'function') {
        setActiveModel(name);
        const modal = $('#cmd-modal');
        if (modal) modal.classList.add('hidden');
      }
    },
  }));
  openListModal('选择模型（' + rows.length + '）', rows);
  const body = $('#cmd-modal-body');
  body.classList.add('model-select-modal');
}

function showHelp() {
  const rows = SLASH_COMMANDS.map((cmd) => ({
    name: '/' + cmd.name,
    desc: cmd.desc,
  }));
  openListModal('可用命令', rows, { compact: true });
}

function clearChat() {
  // /clear：清空结构化历史（之前的对话不再作为上下文），不删除已显示的消息
  state.history = [];
  const session = state.session;
  if (session) {
    const div = el('div', 'context-clear-divider');
    div.textContent = '上下文已清除';
    session.appendChild(div);
    // 记录清除分隔线位置（最后一条消息之后），重开对话时恢复
    state.clearedDivider = session.querySelectorAll('.msg').length - 1;
  }
  if (typeof scrollDown === 'function') scrollDown(true);
  // 立即落库，确保重开对话仍可见清除状态与空历史
  if (state.conversationId) saveConversation();
  showSimpuiToast('已清空上下文', '之前的对话不再作为上下文，后续消息从空白开始');
}

// /compress：把中间旧历史摘要化，降低后续上下文 token 占用。
// 优先走模型摘要；模型不可用（离线）时直接本地硬截断旧历史，保证手动压缩一定生效。
async function compressContext() {
  const history = state.history || [];
  const RECENT_K = 6;
  if (history.length <= RECENT_K) {
    showSimpuiToast('提示', '上下文较短，暂无需压缩');
    return;
  }

  let compacted = null;
  try {
    const r = await fetch('/api/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: history.map((h) => ({ role: h.role, content: h.content })),
        model: state.activeModel || state.defaultModel,
        ollamaHost: typeof ollamaHost === 'function' ? ollamaHost() : undefined,
      }),
    });
    const d = await r.json();
    if (d && d.ok && d.compacted && Array.isArray(d.history)) compacted = d.history;
  } catch (e) {
    // 离线/异常：走本地兜底，直接丢弃中间旧历史
  }

  // 模型摘要不可用：本地硬截断，保留最近 RECENT_K 条，直接压缩上下文
  if (!compacted) {
    compacted = history.slice(-RECENT_K).map((h) => ({ role: h.role, content: h.content }));
  }

  // compactMessages 把中间段合成一条 system 摘要；前端转为 user 消息，
  // 使后续发送仍能被后端 validHistory 保留进上下文
  state.history = compacted.map((h) =>
    h.role === 'system'
      ? { role: 'user', content: h.content, mid: nextMid() }
      : { role: h.role, content: h.content, mid: h.mid || null }
  );
  // 记录压缩分隔线位置（按 DOM 消息序号，避免 state.history 被 HISTORY_LIMIT 截断导致错位）。
  // state.history 是 DOM 消息的尾部，保留最近 6 条，分隔线落在它们之前。
  const totalMsgs = state.session ? state.session.querySelectorAll('.msg').length : 0;
  state.compactDivider = totalMsgs > 6 ? (totalMsgs - 7) : null;
  const session = state.session;
  if (session) {
    const div = el('div', 'context-clear-divider');
    div.textContent = '上下文已压缩';
    session.appendChild(div);
  }
  if (typeof scrollDown === 'function') scrollDown(true);
  // 立即落库，确保重开对话仍可见压缩状态与压缩后的历史
  if (state.conversationId) saveConversation();
  showSimpuiToast('已压缩', '中间历史已压缩，后续消息携带压缩后的上下文');
}

// 导出供状态栏点击使用
window.showTools = showTools;
window.showSkills = showSkills;

/* ----------------------------- */
/* 语义召回（/recall）            */
/* ----------------------------- */
// 打开召回弹框：可传入初始 query（支持 /recall <文本> 内联用法）。
function showRecall(initialQuery) {
  let modal = $('#recall-modal');
  if (!modal) {
    modal = el('div', 'simpui-dialog-backdrop hidden');
    modal.id = 'recall-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="simpui-dialog-panel md">
        <div class="simpui-dialog-header">
          <h3 class="simpui-dialog-title">语义召回</h3>
          <button class="simpui-dialog-close modal-close-btn" aria-label="关闭">✕</button>
        </div>
        <div class="simpui-dialog-body">
          <p class="recall-hint">从跨会话历史记忆中召回最相关片段。embedding 模型就绪时走语义排序，缺失则自动降级关键词。</p>
          <div class="recall-form">
            <input id="recall-query" class="simpui-input" type="text" placeholder="输入查询，如：如何配置 embedding 模型" />
            <button id="recall-search" class="simpui-btn primary sm">召回</button>
          </div>
          <div id="recall-results" class="recall-results"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    modal.querySelector('.simpui-dialog-close').onclick = () => modal.classList.add('hidden');
    const q = modal.querySelector('#recall-query');
    const btn = modal.querySelector('#recall-search');
    const doSearch = () => runRecall(q.value.trim(), modal);
    btn.addEventListener('click', doSearch);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }
  modal.classList.remove('hidden');
  const q = modal.querySelector('#recall-query');
  if (q) {
    q.value = initialQuery || '';
    q.focus();
    if (initialQuery) runRecall(initialQuery, modal);
  }
}

// 调用 /api/recall 并渲染命中片段。
async function runRecall(query, modal) {
  const results = modal.querySelector('#recall-results');
  if (!query) { showSimpuiToast('提示', '请输入查询内容'); return; }
  results.innerHTML = '<div class="recall-loading">检索中…</div>';
  try {
    const params = new URLSearchParams({ query, k: '5' });
    const oh = typeof ollamaHost === 'function' ? ollamaHost() : '';
    if (oh) params.set('ollamaHost', oh);
    const r = await fetch('/api/recall?' + params.toString());
    const d = await r.json();
    if (!d || !d.ok) { results.innerHTML = '<div class="recall-empty">召回失败</div>'; return; }
    const chunks = Array.isArray(d.chunks) ? d.chunks : [];
    if (!chunks.length) { results.innerHTML = '<div class="recall-empty">无匹配记忆</div>'; return; }
    const isSemantic = typeof d.prompt === 'string' && d.prompt.includes('相关历史记忆');
    results.innerHTML = '';
    results.appendChild(el('div', 'recall-meta', `命中 ${d.count} 条 · ${isSemantic ? '语义召回' : '关键词召回'}`));
    chunks.forEach((c) => {
      const card = el('div', 'recall-card');
      const role = (c.role === 'user' || c.role === 'assistant') ? c.role : 'unknown';
      const badge = el('span', 'simpui-badge ' + (role === 'user' ? 'info' : 'secondary') + ' sm', role);
      const head = el('div', 'recall-card-head');
      head.appendChild(badge);
      card.appendChild(head);
      card.appendChild(el('div', 'recall-card-body', c.content));
      results.appendChild(card);
    });
  } catch (e) {
    results.innerHTML = '<div class="recall-empty">检索出错: ' + escapeHtml(e.message || String(e)) + '</div>';
  }
}

window.showRecall = showRecall;

/* ----------------------------- */
/* 任务模板（/template）          */
/* ----------------------------- */
// 打开模板选择弹框：以 Tab 栏列出后端 templates，点击某个 Tab 切换展示其详情；
// 点击「使用」按钮把 `/template <name> ` 填入输入框。命中关键词时也会自动注入。
async function showTemplates() {
  let modal = $('#template-modal');
  if (!modal) {
    modal = el('div', 'simpui-dialog-backdrop hidden');
    modal.id = 'template-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="simpui-dialog-panel lg">
        <div class="simpui-dialog-header">
          <h3 class="simpui-dialog-title">任务模板</h3>
          <button class="simpui-dialog-close modal-close-btn" aria-label="关闭">✕</button>
        </div>
        <div class="simpui-dialog-body">
          <p class="template-hint">选择上方 Tab 查看各模板详情，点击「使用」把命令填入输入框，再补上你的具体任务发送即可。命中关键词时也会自动注入。</p>
          <div class="template-tabs" id="template-tabs"></div>
          <div class="template-detail" id="template-detail">
            <div class="recall-loading">加载中…</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    modal.querySelector('.simpui-dialog-close').onclick = () => modal.classList.add('hidden');
  }
  modal.classList.remove('hidden');
  const tabs = modal.querySelector('#template-tabs');
  const detail = modal.querySelector('#template-detail');
  tabs.innerHTML = '<div class="recall-loading">加载中…</div>';
  detail.innerHTML = '';
  try {
    const r = await fetch('/api/templates');
    const d = await r.json();
    const tpls = Array.isArray(d.templates) ? d.templates : [];
    if (!tpls.length) {
      tabs.innerHTML = '<div class="recall-empty">暂无模板</div>';
      detail.innerHTML = '';
      return;
    }
    // 构建 Tab 栏
    tabs.innerHTML = '';
    const tabEls = [];
    tpls.forEach((t, i) => {
      const tab = el('button', 'template-tab' + (i === 0 ? ' active' : ''), t.title || t.name);
      tab.dataset.idx = String(i);
      tab.addEventListener('click', () => {
        tabEls.forEach((x) => x.classList.remove('active'));
        tab.classList.add('active');
        renderTemplateDetail(detail, t);
      });
      tabs.appendChild(tab);
      tabEls.push(tab);
    });
    // 默认展示第一个
    renderTemplateDetail(detail, tpls[0]);
  } catch (e) {
    tabs.innerHTML = '<div class="recall-empty">加载失败</div>';
    detail.innerHTML = '';
  }
}

// 渲染选中模板的详情面板
function renderTemplateDetail(detail, t) {
  detail.innerHTML = '';
  const head = el('div', 'template-detail-head');
  head.appendChild(el('div', 'template-detail-title', t.title || t.name));
  head.appendChild(el('code', 'template-card-name', t.name));
  detail.appendChild(head);

  const kw = el('div', 'template-card-kw');
  (t.keywords || []).slice(0, 6).forEach((k) => kw.appendChild(el('code', 'cmd-param', k)));
  detail.appendChild(kw);

  if (t.body) {
    const body = el('div', 'template-card-body');
    body.textContent = t.body;
    detail.appendChild(body);
  }

  const useBtn = el('button', 'simpui-btn primary sm template-use-btn', '使用此模板');
  useBtn.addEventListener('click', () => {
    const input = $('#input');
    if (input) {
      input.value = '/template ' + t.name + ' ';
      input.focus();
      if (typeof autoResizeInput === 'function') autoResizeInput();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
    const modal = $('#template-modal');
    if (modal) modal.classList.add('hidden');
  });
  detail.appendChild(useBtn);
}

/* ----------------------------- */
/* 优化指标（/metrics）           */
/* ----------------------------- */
async function showMetrics() {
  let modal = $('#metrics-modal');
  if (!modal) {
    modal = el('div', 'simpui-dialog-backdrop hidden');
    modal.id = 'metrics-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="simpui-dialog-panel md">
        <div class="simpui-dialog-header">
          <h3 class="simpui-dialog-title">优化指标</h3>
          <button class="simpui-dialog-close modal-close-btn" aria-label="关闭">✕</button>
        </div>
        <div class="simpui-dialog-body">
          <p class="metrics-hint">量化 7B 小模型优化效果（详见 docs/optimization-plan.md）。数值为进程级累计。</p>
          <div id="metrics-body" class="metrics-body"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    modal.querySelector('.simpui-dialog-close').onclick = () => modal.classList.add('hidden');
  }
  modal.classList.remove('hidden');
  const body = modal.querySelector('#metrics-body');
  body.innerHTML = '<div class="recall-loading">加载中…</div>';
  try {
    const r = await fetch('/api/metrics');
    const m = await r.json();
    const rows = [
      ['JSON 解析失败率', (m.json_parse_failure_rate * 100).toFixed(1) + '%', '目标 < 5%'],
      ['总工具调用次数', m.total_calls, '—'],
      ['JSON 解析失败次数', m.json_parse_failures, '—'],
      ['重复工具调用次数', m.repeat_tool_calls, '目标占比 < 10%'],
      ['自愈触发次数', m.self_heal_triggered, '目标占比 < 20%'],
      ['上下文压缩触发次数', m.context_compact_triggered, '目标占比 < 30%'],
      ['任务成功率', (m.task_success_rate * 100).toFixed(1) + '%', '目标 > 80%'],
      ['模板命中次数', m.template_hit || 0, '—'],
    ];
    body.innerHTML = '';
    rows.forEach(([label, val, target]) => {
      const row = el('div', 'metrics-row');
      row.appendChild(el('span', 'metrics-label', label));
      row.appendChild(el('span', 'metrics-val', String(val)));
      row.appendChild(el('span', 'metrics-target', target));
      body.appendChild(row);
    });
  } catch (e) {
    body.innerHTML = '<div class="recall-empty">加载失败</div>';
  }
}
