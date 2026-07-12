'use strict';

/* commands.js - 输入框斜杠指令（参考 opencode / claude code）
   支持：/skills 列出技能，/tools 列出工具，/models 列出已安装模型 */

// 指令定义
const SLASH_COMMANDS = [
  {
    name: 'skills',
    desc: '列出当前 agent 可用的技能',
    run: showSkills,
  },
  {
    name: 'tools',
    desc: '列出当前 agent 可用的工具',
    run: showTools,
  },
  {
    name: 'models',
    desc: '列出已安装的 Ollama 模型',
    run: showModels,
  },
  {
    name: 'help',
    desc: '显示所有可用命令',
    run: showHelp,
  },
  {
    name: 'clear',
    desc: '清空当前对话',
    run: clearChat,
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
  // 点击别处关闭
  document.addEventListener('click', (e) => {
    if (cmdPaletteEl && !cmdPaletteEl.contains(e.target) && e.target !== input) {
      hidePalette();
    }
  });
}

function buildPalette() {
  const wrap = el('div', 'slash-palette hidden');
  wrap.id = 'slash-palette';
  const composer = document.querySelector('.composer');
  composer.appendChild(wrap);
  cmdPaletteEl = wrap;
}

// 根据当前输入更新候选列表
function onInputChange() {
  const input = $('#input');
  const val = input.value;
  // 仅在行首以 / 开头、且不含空格时显示候选
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
    const item = el('div', 'slash-item' + (i === cmdActiveIndex ? ' active' : ''));
    const name = el('span', 'slash-name', '/' + c.name);
    const desc = el('span', 'slash-desc', c.desc);
    item.appendChild(name);
    item.appendChild(desc);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // 防止 input 失焦
      runCommand(c);
    });
    cmdPaletteEl.appendChild(item);
  });
}

function showPalette() {
  cmdPaletteEl.classList.remove('hidden');
}
function hidePalette() {
  if (cmdPaletteEl) cmdPaletteEl.classList.add('hidden');
}

// 键盘导航：上下选择，Enter 执行，Esc 关闭
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

// 执行指令：清空输入框并打开对应面板
function runCommand(cmd) {
  const input = $('#input');
  input.value = '';
  hidePalette();
  cmd.run();
}

/* ----------------------------- */
/* 列表弹窗（/skills、/tools、/models）   */
/* ----------------------------- */
// rows: [{ name, desc, params, tag, kind, onClick }]
function openListModal(title, rows) {
  let modal = $('#cmd-modal');
  if (!modal) {
    modal = el('div', 'simpui-dialog-backdrop hidden');
    modal.id = 'cmd-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="simpui-dialog-panel md">
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

// 将工具规格转为行数据
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

// 构建单个工具/技能行（默认描述最多两行，展开后显示完整描述与参数）
function buildRow(r) {
  const row = el('div', 'cmd-row');
  const head = el('div', 'cmd-row-head');
  head.appendChild(el('span', 'cmd-row-name', r.name));
  if (r.tag) head.appendChild(el('span', 'simpui-badge warning sm', r.tag));
  if (r.onClick) {
    row.addEventListener('click', () => r.onClick(r.name));
    row.classList.add('clickable');
  }
  row.appendChild(head);
  if (r.desc) {
    const desc = el('div', 'cmd-row-desc', r.desc);
    row.appendChild(desc);
  }
  const paramsWrap = el('div', 'cmd-row-params hidden');
  if (r.params && r.params.length) {
    r.params.forEach((pp) => {
      const chip = el('code', 'cmd-param', pp);
      paramsWrap.appendChild(chip);
    });
  }
  row.appendChild(paramsWrap);
  // 描述过长或有参数时，提供展开/折叠（展开显示完整描述 + 参数）
  if ((r.desc && r.desc.length > 48) || (r.params && r.params.length)) {
    const more = el('button', 'cmd-row-more', '展开');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = row.classList.toggle('expanded');
      if (expanded) {
        desc && desc.classList.add('expanded');
        paramsWrap.classList.remove('hidden');
      } else {
        desc && desc.classList.remove('expanded');
        paramsWrap.classList.add('hidden');
      }
      more.textContent = expanded ? '折叠' : '展开';
    });
    row.appendChild(more);
  }
  return row;
}

function showSkills() {
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const rows = tools.filter((t) => (t.kind || 'tool') === 'skill').map(toolToRow);
  openListModal('可用技能（' + rows.length + '）', rows);
}

function showTools() {
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const rows = tools.filter((t) => (t.kind || 'tool') === 'tool').map(toolToRow);
  openListModal('可用工具（' + rows.length + '）', rows);
}

function showModels() {
  const models = Array.isArray(state.installedModels) ? state.installedModels : [];
  const current = state.activeModel;
  const rows = models.map((m) => ({
    name: m,
    tag: (m === current) ? '当前' : null,
    onClick: (name) => {
      if (typeof setActiveModel === 'function') {
        setActiveModel(name);
        const modal = $('#cmd-modal');
        if (modal) modal.classList.add('hidden');
      }
    },
  }));
  openListModal('已安装模型（' + rows.length + '）', rows);
}

function showHelp() {
  const rows = SLASH_COMMANDS.map((cmd) => ({
    name: '/' + cmd.name,
    desc: cmd.desc,
  }));
  openListModal('可用命令', rows);
}

function clearChat() {
  const newChatBtn = $('#new-chat');
  if (newChatBtn) newChatBtn.click();
  showSimpuiToast('已清空', '当前对话已清空');
}
