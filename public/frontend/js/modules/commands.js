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
];

let cmdPaletteEl = null;
let cmdActiveIndex = 0;
let cmdFiltered = [];

function initCommands() {
  const input = $('#input');
  if (!input) return;
  buildPalette();
  input.addEventListener('input', onInputChange);
  input.addEventListener('keydown', onInputKeydown);
  document.addEventListener('click', (e) => {
    if (cmdPaletteEl && !cmdPaletteEl.contains(e.target) && e.target !== input) {
      hidePalette();
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

function onInputChange() {
  const input = $('#input');
  const val = input.value;
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
    item.appendChild(textWrap);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      runCommand(c);
    });
    cmdPaletteEl.appendChild(item);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showPalette() {
  cmdPaletteEl.classList.remove('hidden');
}

function hidePalette() {
  if (cmdPaletteEl) cmdPaletteEl.classList.add('hidden');
}

function onInputKeydown(e) {
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

// /compress：把中间旧历史摘要化，降低后续上下文 token 占用
async function compressContext() {
  const history = state.history || [];
  if (history.length <= 6) {
    showSimpuiToast('提示', '上下文较短，暂无需压缩');
    return;
  }
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
    if (d && d.ok && d.compacted && Array.isArray(d.history)) {
      // compactMessages 把中间段合成一条 system 摘要；前端转为 user 消息，
      // 使后续发送仍能被后端 validHistory 保留进上下文
      state.history = d.history.map((h) =>
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
      showSimpuiToast('已压缩', '中间历史已摘要化，后续消息携带压缩后的上下文');
    } else {
      showSimpuiToast('提示', '上下文较短或压缩失败，未做处理');
    }
  } catch (e) {
    showSimpuiToast('错误', '压缩失败: ' + (e.message || e));
  }
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
