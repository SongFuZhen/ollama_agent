'use strict';

/* commands.js - 输入框斜杠指令（参考 opencode / claude code） */

// 斜杠命令图标映射
const COMMAND_ICONS = {
  skills: 'sparkles',
  tools: 'wrench',
  models: 'cpu',
  help: 'help-circle',
  clear: 'trash-2',
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
  openListModal('可用命令', rows);
}

function clearChat() {
  const newChatBtn = $('#new-chat');
  if (newChatBtn) newChatBtn.click();
  showSimpuiToast('已清空', '当前对话已清空');
}

// 导出供状态栏点击使用
window.showTools = showTools;
window.showSkills = showSkills;
