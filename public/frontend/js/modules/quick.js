'use strict';

/* =========================================================================
 * quick.js — Toolbox 快捷命令（单轮，固定 prompt，不经过 Agent 循环）。
 * 复用 render.js 的渲染原语（appendUser / appendStep / ensureMessageContainer /
 * appendToken / finalizeAnswer）与 chat.js 的中止/忙碌控制。
 * 依赖全局：state、$、el、escapeHtml、renderMarkdown、isAbs、ollamaHost、
 *   settingsRoot、effectiveRoot、appendUser、appendStep、ensureMessageContainer、
 *   appendToken、finalizeAnswer、toggleThinking、setBusy、saveConversation、
 *   pushHistory、currentAbortController、requestAborted、showSimpuiToast、
 *   makeCopyBtn、autoResizeInput。
 * ========================================================================= */

// ---------- 命令列表（缓存，供 slash 菜单与检测使用） ----------
async function loadQuickCommands() {
  if (state.quickCommands) return state.quickCommands;
  try {
    const r = await fetch('/api/quick/commands');
    const d = await r.json();
    state.quickCommands = Array.isArray(d.commands) ? d.commands : [];
  } catch (e) {
    state.quickCommands = [];
  }
  return state.quickCommands;
}

// 当前输入是否命中 Toolbox 命令（以 /name 开头且 name 在命令表中）
async function isQuickCommand(text) {
  if (!text || !text.startsWith('/')) return false;
  const name = text.slice(1).split(/\s+/)[0];
  if (!name) return false;
  const cmds = await loadQuickCommands();
  return cmds.some((c) => c.name === name);
}

// 解析参数：不同命令的取参逻辑不同
function parseQuickArgs(name, rest) {
  const t = (rest || '').trim();
  const m = t.match(/^(\S+)\s*([\s\S]*)$/);
  switch (name) {
    case 'fix':
      return { path: m ? m[1] : '', error: m ? m[2].trim() : '' };
    case 'test':
      return { path: m ? m[1] : '', function: m ? m[2].trim() : '' };
    case 'explain':
    case 'comment':
    case 'review':
      return { path: t };
    case 'error':
    case 'regex':
      return { text: t }; // 整段即内容，无 path
    case 'commit':
    default:
      return {};
  }
}

// 阶段中文标签
const QUICK_STEP_LABEL = {
  prepare: '预处理',
  model: '模型推理',
  postprocess: '后处理',
};
function quickStepText(step, status) {
  const label = QUICK_STEP_LABEL[step] || step;
  if (status === 'running') return '⏳ ' + label + '中…';
  if (status === 'done') return '✓ ' + label + '完成';
  if (status === 'error') return '✗ ' + label + '失败';
  return label;
}

// 把动作按钮附加到最后一个 agent 答案卡片
function appendQuickActions(card, meta) {
  if (!card) return;
  if (card.querySelector('.quick-actions')) return; // 防重复
  const wrap = el('div', 'quick-actions');

  if (meta.command === 'commit') {
    // commit 走独立居中弹框（openCommitMsgModal），此处不内联渲染
  } else if (meta.command === 'push') {
    const pushBtn = el('button', 'simpui-btn primary sm', '推送');
    pushBtn.onclick = () => doQuickPush(pushBtn);
    wrap.appendChild(pushBtn);
  } else if (meta.apply) {
    const apply = el('button', 'simpui-btn primary sm', '应用修改');
    apply.title = '将修改写入 ' + meta.apply.path;
    apply.onclick = () => doQuickApply(meta.apply);
    const copy = el('button', 'simpui-btn secondary sm', '复制代码');
    copy.onclick = () => {
      navigator.clipboard?.writeText(meta.apply.code || '').then(() => {
        showSimpuiToast('已复制', '修改后代码已复制到剪贴板');
      });
    };
    wrap.appendChild(apply);
    wrap.appendChild(copy);
  }
  if (wrap.childNodes.length) card.appendChild(wrap);
}

// 应用 Toolbox 写操作到文件
async function doQuickApply(apply) {
  if (!apply || !apply.path) return;
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = { path: apply.path, content: apply.code };
  if (root) body.projectRoot = root;
  try {
    const r = await fetch('/api/quick/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) showSimpuiToast('已应用', (d.msg || '修改已写入') );
    else showSimpuiToast('应用失败', d.msg || '写入失败');
  } catch (e) {
    showSimpuiToast('应用失败', e.message);
  }
}

// 提交信息确认弹框（居中大输入框，提交/取消/复制，点击任一即结束并总结）
let pendingCommitFiles = [];

// 约定式提交类型（与项目提交规范一致：<type>: <description>）
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

// 将已有提交信息解析为「类型 / 主题 / 正文」，无法识别类型时退回纯文本
function parseCommitMessage(text) {
  const t = (text || '').trim();
  if (!t) return { type: '', subject: '', body: '' };
  const lines = t.split('\n');
  const first = lines[0];
  const m = first.match(/^(\w+):\s*(.*)$/);
  let type = '';
  let subject = first;
  if (m && COMMIT_TYPES.includes(m[1].toLowerCase())) {
    type = m[1].toLowerCase();
    subject = m[2];
  }
  const blank = lines.indexOf('');
  const body = blank !== -1 ? lines.slice(blank + 1).join('\n').trim() : '';
  return { type, subject, body };
}

// 组装为 git 约定式提交信息（主题行 + 空行 + 正文）
function assembleCommitMessage(type, subject, body) {
  const head = (type ? type + ': ' : '') + subject.trim();
  const b = (body || '').trim();
  return b ? head + '\n\n' + b : head;
}

function updateCommitPreview() {
  const typeEl = document.getElementById('commit-msg-type');
  const subjectEl = document.getElementById('commit-msg-subject');
  const bodyEl = document.getElementById('commit-msg-body');
  const preview = document.getElementById('commit-msg-preview');
  const count = document.getElementById('commit-msg-count');
  if (!typeEl || !subjectEl) return;
  const len = subjectEl.value.length;
  if (count) { count.textContent = len + '/50'; count.classList.toggle('over', len > 50); }
  if (preview) preview.textContent = assembleCommitMessage(typeEl.value, subjectEl.value, bodyEl ? bodyEl.value : '') || '（预览为空）';
}

function openCommitMsgModal(message) {
  const modal = $('#commit-msg-modal');
  if (!modal) return;
  const typeSel = document.getElementById('commit-msg-type');
  const subjectInp = document.getElementById('commit-msg-subject');
  const bodyInp = document.getElementById('commit-msg-body');
  const tip = $('#commit-msg-tip');
  if (!typeSel || !subjectInp) return;
  const parsed = parseCommitMessage(message);
  typeSel.value = parsed.type || '';
  subjectInp.value = parsed.subject || '';
  if (bodyInp) bodyInp.value = parsed.body || '';
  if (tip) tip.textContent = '选择类型并填写简述后提交';
  updateCommitPreview();
  modal.classList.remove('hidden');

  const close = () => modal.classList.add('hidden');
  const submit = document.getElementById('commit-msg-submit');
  const cancel = document.getElementById('commit-msg-cancel');
  const copy = document.getElementById('commit-msg-copy');
  const onInput = () => { updateCommitPreview(); if (tip) tip.textContent = '选择类型并填写简述后提交'; };
  typeSel.onchange = onInput;
  subjectInp.oninput = onInput;
  if (bodyInp) bodyInp.oninput = onInput;
  if (submit) submit.onclick = () => {
    const type = typeSel.value;
    const subject = subjectInp.value.trim();
    if (!type) { if (tip) tip.textContent = '请选择提交类型'; return; }
    if (!subject) { if (tip) tip.textContent = '请填写提交简述'; return; }
    close();
    doQuickCommit(assembleCommitMessage(type, subject, bodyInp ? bodyInp.value : ''));
  };
  if (cancel) cancel.onclick = () => { close(); pendingCommitFiles = []; appendAnswer('已取消提交。', nextMid()); };
  if (copy) copy.onclick = () => {
    const msg = assembleCommitMessage(typeSel.value, subjectInp.value, bodyInp ? bodyInp.value : '');
    navigator.clipboard?.writeText(msg || '').then(() => {});
    close();
    appendAnswer('已复制提交信息到剪贴板。', nextMid());
  };
  const x = modal.querySelector('.modal-close-btn');
  if (x) x.onclick = cancel.onclick;
  modal.querySelectorAll('[data-close]').forEach((b) => { b.onclick = cancel.onclick; });
  modal.onclick = (e) => { if (e.target === modal) cancel.onclick(); };
}

// 用生成的 message 直接 git commit（仅提交选定文件）
async function doQuickCommit(message) {
  if (!message || !message.trim()) return;
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = { message, files: Array.from(pendingCommitFiles || []) };
  pendingCommitFiles = [];
  if (root) body.projectRoot = root;
  try {
    const r = await fetch('/api/quick/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) {
      showSimpuiToast('已提交', (d.msg && d.msg.slice(0, 80)) || '提交成功');
      appendAnswer('已提交：\n```\n' + (d.msg || '提交成功') + '\n```', nextMid());
    } else {
      showSimpuiToast('提交失败', d.msg || 'git commit 失败');
      appendAnswer('提交失败：' + (d.msg || 'git commit 失败'), nextMid());
    }
  } catch (e) {
    showSimpuiToast('提交失败', e.message);
    appendAnswer('提交失败：' + e.message, nextMid());
  }
}

// 推送到远程（/push 的「推送」按钮）；btn 用于推送后禁用并标记已完成
async function doQuickPush(btn) {
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = {};
  if (root) body.projectRoot = root;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/quick/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) {
      showSimpuiToast('已推送', (d.msg && d.msg.slice(0, 80)) || '推送成功');
      if (btn) { btn.textContent = '已推送 ✓'; btn.classList.add('pushed'); }
    } else {
      showSimpuiToast('推送失败', d.msg || 'git push 失败');
      if (btn) btn.disabled = false;
    }
  } catch (e) {
    showSimpuiToast('推送失败', e.message);
    if (btn) btn.disabled = false;
  }
}

// 将选定文件加入暂存区（目录多选提交前的 git add 步骤）
async function stageQuickFiles(files) {
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = { files };
  if (root) body.projectRoot = root;
  const r = await fetch('/api/quick/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 当前生效的项目根（与 file-browser 一致）
function quickEffRoot() {
  if (state.currentProjectRoot && isAbs(state.currentProjectRoot)) return state.currentProjectRoot;
  const s = settingsRoot();
  if (s && isAbs(s)) return s;
  return serverRootCache || '';
}

// 探测路径是否为目录（供目录多选拦截使用）
async function probeIsDir(p) {
  const root = quickEffRoot();
  try {
    const params = new URLSearchParams({ path: p });
    if (root) params.set('root', root);
    const r = await fetch('/api/fs/list?' + params.toString());
    const d = await r.json();
    return !d.error && Array.isArray(d.items);
  } catch (e) { return false; }
}

// 递归收集目录下所有文件路径（相对 root）
async function collectDirFiles(relDir) {
  const root = quickEffRoot();
  const out = [];
  async function walk(rel) {
    const params = new URLSearchParams({ path: rel || '.' });
    if (root) params.set('root', root);
    const d = await (await fetch('/api/fs/list?' + params.toString())).json();
    if (d.error || !d.items) return;
    for (const it of d.items) {
      const full = rel ? rel + '/' + it.name : it.name;
      if (it.type === 'dir') await walk(full);
      else out.push(full);
    }
  }
  await walk(relDir);
  return out;
}

// 将 unified diff 文本渲染为左右两列对比行
function renderSplitDiff(container, text) {
  container.innerHTML = '';
  const lines = String(text).split('\n');
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      let oldLine = m ? parseInt(m[1], 10) : 0;
      let newLine = m ? parseInt(m[2], 10) : 0;
      rows.push({ type: 'hunk', text: line });
      i++;
      const rem = [];
      const add = [];
      const flush = () => {
        const n = Math.max(rem.length, add.length);
        for (let k = 0; k < n; k++) {
          const left = rem[k];
          const right = add[k];
          rows.push({
            type: 'pair',
            left: left ? left.text : '', leftNum: left ? left.num : '',
            right: right ? right.text : '', rightNum: right ? right.num : '',
          });
        }
        rem.length = 0; add.length = 0;
      };
      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git')) {
        const l = lines[i];
        if (l.startsWith('-')) { rem.push({ text: l.slice(1), num: oldLine }); oldLine++; }
        else if (l.startsWith('+')) { add.push({ text: l.slice(1), num: newLine }); newLine++; }
        else if (l.startsWith(' ')) { flush(); rows.push({ type: 'ctx', left: l.slice(1), leftNum: oldLine, right: l.slice(1), rightNum: newLine }); oldLine++; newLine++; }
        i++;
      }
      flush();
    } else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('Binary')) {
      i++;
    } else {
      i++;
    }
  }
  for (const row of rows) {
    const r = el('div', 'diff-row' + (row.type === 'hunk' ? ' hunk' : row.type === 'ctx' ? ' ctx' : ' pair'));
    if (row.type === 'hunk') {
      const L = el('div', 'diff-cell left'); L.textContent = row.text;
      const R = el('div', 'diff-cell right'); R.textContent = row.text;
      r.appendChild(L); r.appendChild(R);
    } else {
      const LN = el('div', 'diff-gutter left', row.leftNum != null ? String(row.leftNum) : '');
      const L = el('div', 'diff-cell left'); L.textContent = row.left != null ? row.left : '';
      const RN = el('div', 'diff-gutter right', row.rightNum != null ? String(row.rightNum) : '');
      const R = el('div', 'diff-cell right'); R.textContent = row.right != null ? row.right : '';
      if (row.type === 'pair') { if (row.left) L.classList.add('del'); if (row.right) R.classList.add('add'); }
      r.appendChild(LN); r.appendChild(L); r.appendChild(RN); r.appendChild(R);
    }
    container.appendChild(r);
  }
}

// 单文件 diff 弹框（左右两列对比；untracked 传 true 以展示完整新增内容）
// 在来源弹框内就地展示 diff（不关闭来源弹框，用「返回」切回文件列表）
async function openDiffModal(path, isUntracked) {
  const source = ['#commit-files-modal', '#quick-dir-modal'].map((s) => $(s)).find((m) => m && !m.classList.contains('hidden'));
  if (source && source.querySelector('.picker-diffview')) {
    await showInlineDiff(source, path, isUntracked);
    return;
  }
  // 兼容场景：独立弹框展示（不隐藏来源弹框）
  const modal = $('#diff-modal');
  const contentEl = $('#diff-content');
  const titleEl = $('#diff-modal-title');
  if (!modal || !contentEl) return;
  if (titleEl) titleEl.textContent = (isUntracked ? '新增 · ' : 'diff · ') + path;
  contentEl.textContent = '加载中…';
  const close = () => modal.classList.add('hidden');
  const x = modal.querySelector('.modal-close-btn');
  if (x) x.onclick = close;
  if (!modal._diffBackdropWired) {
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
    modal._diffBackdropWired = true;
  }
  modal.classList.remove('hidden');
  await fetchDiffInto(contentEl, path, isUntracked);
}

async function showInlineDiff(picker, path, isUntracked) {
  const panel = picker.querySelector('.simpui-dialog-panel');
  const view = picker.querySelector('.picker-diffview');
  const titleEl = view.querySelector('.picker-diffview-title');
  const contentEl = view.querySelector('.picker-diff-content');
  const back = view.querySelector('.picker-diff-back');
  if (titleEl) titleEl.textContent = (isUntracked ? '新增 · ' : 'diff · ') + path;
  contentEl.textContent = '加载中…';
  panel.classList.add('showing-diff');
  view.classList.remove('hidden');
  back.onclick = () => { panel.classList.remove('showing-diff'); view.classList.add('hidden'); };
  await fetchDiffInto(contentEl, path, isUntracked);
}

async function fetchDiffInto(contentEl, path, isUntracked) {
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = { path, untracked: !!isUntracked };
  if (root) body.projectRoot = root;
  try {
    const r = await fetch('/api/quick/diff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok && d.diff && d.diff.trim()) renderSplitDiff(contentEl, d.diff);
    else contentEl.textContent = (d.msg && d.msg !== '(命令执行成功，无输出)') ? d.msg : '无改动';
  } catch (e) {
    contentEl.textContent = '加载失败: ' + e.message;
  }
}

// 由路径列表构建目录树（folder/file 节点）
function buildPathTree(paths) {
  const root = { children: {}, files: {} };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      node.children[part] = node.children[part] || { children: {}, files: {} };
      node = node.children[part];
    }
    node.files[parts[parts.length - 1]] = p;
  }
  return root;
}

// 将目录树渲染为可勾选的文件列表（tracked 显示 +add -del，可点开 diff；untracked 可「跟踪」）
function renderPathTree(container, node, metaMap, selected, updateCount, onTrack) {
  const dirNames = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
  const fileNames = Object.keys(node.files).sort((a, b) => a.localeCompare(b));
  for (const dn of dirNames) {
    const child = node.children[dn];
    const folderRow = el('div', 'commit-tree-folder');
    const toggle = el('span', 'commit-tree-toggle', '▸');
    const fcb = el('input', 'commit-file-cb'); fcb.type = 'checkbox';
    const label = el('span', 'commit-tree-label', '📁 ' + dn);
    const childBox = el('div', 'commit-tree-children');
    renderPathTree(childBox, child, metaMap, selected, updateCount, onTrack);
    fcb.addEventListener('change', () => {
      childBox.querySelectorAll('.commit-file-cb').forEach((c) => {
        if (c.checked !== fcb.checked) { c.checked = fcb.checked; c.dispatchEvent(new Event('change')); }
      });
    });
    const toggleFolder = () => {
      const collapsed = childBox.classList.toggle('hidden');
      toggle.textContent = collapsed ? '▸' : '▾';
    };
    label.addEventListener('click', toggleFolder);
    toggle.addEventListener('click', toggleFolder);
    folderRow.appendChild(fcb);
    folderRow.appendChild(toggle);
    folderRow.appendChild(label);
    container.appendChild(folderRow);
    container.appendChild(childBox);
  }
  for (const fn of fileNames) {
    const full = node.files[fn];
    const meta = metaMap.get(full) || {};
    const row = el('div', 'commit-file-row' + (meta.kind === 'untracked' ? ' untracked' : ''));
    const cb = el('input', 'commit-file-cb'); cb.type = 'checkbox';
    cb.checked = selected.has(full);
    cb.addEventListener('change', () => { if (cb.checked) selected.add(full); else selected.delete(full); updateCount(); });
    const name = el('span', 'commit-file-name', fn);
    if (meta.kind === 'tracked') name.addEventListener('click', () => openDiffModal(full));
    else {
      name.classList.add('untracked-name');
      name.title = '预览新增文件内容';
      name.addEventListener('click', () => openDiffModal(full, true));
    }
    const stat = el('span', 'commit-file-stat');
    if (meta.kind === 'tracked') stat.innerHTML = '<span class="diff-add">+' + meta.add + '</span> <span class="diff-del">-' + meta.del + '</span>';
    else if (meta.kind === 'untracked') stat.textContent = '未跟踪';
    const eye = el('button', 'quick-eye-btn');
    eye.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    eye.title = '查看 diff';
    eye.addEventListener('click', (e) => { e.stopPropagation(); openDiffModal(full, meta.kind === 'untracked'); });
    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(stat);
    row.appendChild(eye);
    if (meta.kind === 'untracked' && typeof onTrack === 'function') {
      const trackBtn = el('button', 'quick-track-btn', '跟踪');
      trackBtn.title = 'git add 加入暂存区';
      trackBtn.addEventListener('click', (e) => { e.stopPropagation(); onTrack(full); });
      row.appendChild(trackBtn);
    }
    container.appendChild(row);
  }
}

// 提交文件选择：基于 git status，分 tracked（含 +add -del）/ untracked
async function openCommitFilesPicker() {
  const modal = $('#commit-files-modal');
  if (!modal) return;
  const trackedEl = $('#commit-files-tracked');
  const untrackedEl = $('#commit-files-untracked');
  const countEl = $('#commit-files-count');
  const selected = new Set();
  const updateCount = () => { if (countEl) countEl.textContent = '已选 ' + selected.size + ' 个文件'; };

  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = {};
  if (root) body.projectRoot = root;

  // 暂存单个文件后重新拉取并渲染（保留已勾选状态）
  const onTrack = async (file) => {
    const r = await stageQuickFiles([file]);
    showSimpuiToast(r.ok ? '已暂存' : '暂存失败', (r.msg || '') + ' · ' + file);
    await renderAll();
  };

  async function renderAll() {
    trackedEl.innerHTML = '加载中…';
    untrackedEl.innerHTML = '';
    try {
      const r = await fetch('/api/quick/commit-files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { trackedEl.innerHTML = '<div class="recall-empty">⚠ ' + escapeHtml(d.msg || '加载失败') + '</div>'; return; }
      trackedEl.innerHTML = '';
      untrackedEl.innerHTML = '';
      if (!d.tracked.length && !d.untracked.length) {
        trackedEl.innerHTML = '<div class="recall-empty">没有检测到改动（git status 为空）</div>';
      }
      const metaMap = new Map();
      d.tracked.forEach((f) => metaMap.set(f.path, { kind: 'tracked', add: f.add, del: f.del }));
      d.untracked.forEach((p) => metaMap.set(p, { kind: 'untracked' }));
      if (d.tracked.length) renderPathTree(trackedEl, buildPathTree(d.tracked.map((f) => f.path)), metaMap, selected, updateCount, onTrack);
      if (d.untracked.length) renderPathTree(untrackedEl, buildPathTree(d.untracked), metaMap, selected, updateCount, onTrack);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      trackedEl.innerHTML = '<div class="recall-empty">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
    updateCount();
  }

  await renderAll();
  modal.classList.remove('hidden');

  const submit = () => {
    const files = Array.from(selected);
    modal.classList.add('hidden');
    if (!files.length) return;
    (async () => {
      pendingCommitFiles = files;
      const r = await stageQuickFiles(files);
      showSimpuiToast(r.ok ? '已暂存' : '暂存失败', (r.msg || '') + '（' + files.length + ' 个文件）');
      if (r.ok) await runQuickCommand('/commit', { skipDirProbe: true });
    })();
  };
  const submitBtn = $('#commit-files-submit');
  if (submitBtn) submitBtn.onclick = submit;
  modal.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => modal.classList.add('hidden'); });
  if (!modal._pickerBackdropWired) {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    modal._pickerBackdropWired = true;
  }
}

// 目录多选：文件路径参数指向目录时，基于 git status 弹出树状复选框选择器（已跟踪在上 / 未跟踪在下）
async function openQuickDirPicker(cmd, dirPath, def) {
  const modal = $('#quick-dir-modal');
  if (!modal) return;
  const titleEl = $('#quick-dir-title');
  const hintEl = $('#quick-dir-hint');
  const treeEl = $('#quick-dir-tree');
  const extraEl = $('#quick-dir-extra');
  const countEl = $('#quick-dir-count');
  if (titleEl) titleEl.textContent = '选择文件 · /' + cmd;
  if (hintEl) hintEl.innerHTML = '勾选要处理的文件（按目录树展示，上方已跟踪 / 下方未跟踪）；未跟踪文件可点「跟踪」加入暂存区：';

  // 额外参数（path 之外的必填项，如 fix 的报错描述、test 的函数名）
  const extraKeys = def && def.params ? Object.keys(def.params).filter((k) => k !== 'path') : [];
  extraEl.innerHTML = '';
  if (extraKeys.length === 1) {
    const k = extraKeys[0];
    const wrap = el('div', 'quick-dir-extra-row');
    wrap.appendChild(el('label', 'quick-dir-extra-label', def.params[k] + '：'));
    const inp = el('input', 'simpui-input quick-dir-extra-input');
    inp.id = 'quick-dir-extra-input';
    inp.placeholder = '可选，留空则按默认处理';
    wrap.appendChild(inp);
    extraEl.appendChild(wrap);
  }

  const selected = new Set();
  const updateCount = () => { if (countEl) countEl.textContent = '已选 ' + selected.size + ' 个文件'; };

  // 限定到指定目录范围（如 ./src）
  const prefix = dirPath.replace(/^\.\//, '').replace(/\/+$/, '');
  const inScope = (p) => !prefix || p === prefix || p.startsWith(prefix + '/');

  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = {};
  if (root) body.projectRoot = root;

  const onTrack = async (file) => {
    const r = await stageQuickFiles([file]);
    showSimpuiToast(r.ok ? '已暂存' : '暂存失败', (r.msg || '') + ' · ' + file);
    await renderAll();
  };

  async function renderAll() {
    treeEl.innerHTML = '加载中…';
    try {
      const r = await fetch('/api/quick/commit-files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { treeEl.innerHTML = '<div class="recall-empty">⚠ ' + escapeHtml(d.msg || '加载失败') + '</div>'; return; }
      treeEl.innerHTML = '';
      const metaMap = new Map();
      const tracked = d.tracked.filter((f) => inScope(f.path)).map((f) => {
        metaMap.set(f.path, { kind: 'tracked', add: f.add, del: f.del });
        return f.path;
      });
      const untracked = d.untracked.filter((p) => { metaMap.set(p, { kind: 'untracked' }); return inScope(p); });
      if (!tracked.length && !untracked.length) {
        treeEl.innerHTML = '<div class="recall-empty">该范围内没有改动文件</div>';
      }
      if (tracked.length) {
        treeEl.appendChild(el('div', 'commit-files-section-title', '已跟踪 (Tracked)'));
        const box = el('div', 'commit-files-section');
        renderPathTree(box, buildPathTree(tracked), metaMap, selected, updateCount, onTrack);
        treeEl.appendChild(box);
      }
      if (untracked.length) {
        treeEl.appendChild(el('div', 'commit-files-section-title', '未跟踪 (Untracked)'));
        const box = el('div', 'commit-files-section');
        renderPathTree(box, buildPathTree(untracked), metaMap, selected, updateCount, onTrack);
        treeEl.appendChild(box);
      }
    } catch (e) {
      treeEl.innerHTML = '<div class="recall-empty">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
    updateCount();
  }

  await renderAll();
  modal.classList.remove('hidden');

  const submit = () => {
    const extra = extraKeys.length === 1
      ? (document.getElementById('quick-dir-extra-input')?.value || '').trim()
      : '';
    const files = Array.from(selected);
    modal.classList.add('hidden');
    if (!files.length) return;
    (async () => {
      for (const f of files) {
        const txt = '/' + cmd + ' ' + f + (extra ? ' ' + extra : '');
        await runQuickCommand(txt, { skipDirProbe: true });
      }
    })();
  };
  const submitBtn = $('#quick-dir-submit');
  if (submitBtn) submitBtn.onclick = submit;
  modal.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => modal.classList.add('hidden'); });
  if (!modal._pickerBackdropWired) {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    modal._pickerBackdropWired = true;
  }
}

// ---------- 主入口：执行一个 Toolbox 命令 ----------
async function runQuickCommand(text, opts = {}) {
  if (state.busy) return;
  if (!text || !text.trim()) return;

  const name = text.slice(1).split(/\s+/)[0];
  const args = parseQuickArgs(name, text.slice(1 + name.length));

  // 目录多选：文件路径参数指向目录时，弹出树状复选框选择器（内部递归提交时跳过探测）
  if (!opts.skipDirProbe) {
    // /commit 走专门的「提交文件选择」流程（基于 git status，分 tracked/untracked）
    if (name === 'commit') { openCommitFilesPicker(); return; }
    const def = (await loadQuickCommands()).find((c) => c.name === name);
    if (def && def.params && def.params.path && args.path && args.path.trim()) {
      const isDir = await probeIsDir(args.path.trim());
      if (isDir) {
        openQuickDirPicker(name, args.path.trim(), def);
        return;
      }
    }
  }

  // 清空输入框
  inputEl.value = '';
  autoResizeInput();

  const um = appendUser(text, [], nextMid());
  renderSessionState();
  setBusy(true);
  toggleThinking(true, '指令集 · 准备中');

  // 收集动作所需的上下文
  state.quickLastOutput = '';
  state.quickMeta = { command: name, apply: null };

  // 进入忙碌：复用 chat.js 的中止控制器，使「中止」按钮生效
  requestAborted = false;
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const effRoot = (state.currentProjectRoot && isAbs(state.currentProjectRoot))
    ? state.currentProjectRoot
    : (settingsRoot() && isAbs(settingsRoot()) ? settingsRoot() : '');

  const body = {
    command: name,
    args,
    model: state.activeModel || undefined,
  };
  const oh = ollamaHost(); if (oh) body.ollamaHost = oh;
  if (effRoot) body.projectRoot = effRoot;

  // 首条用户消息：保存对话并写 URL
  const msgCount = state.session ? state.session.querySelectorAll('.msg').length : 0;
  if (msgCount <= 1 && state.conversationId) {
    await saveConversation();
    if (typeof syncUrl === 'function') syncUrl();
  }
  // 当前命令作为一轮 user 提交入栈（不含在发送的 history 内）
  pushHistory('user', text, um ? um.dataset.mid : null);

  // 当前是否已有答案容器（流式 token 用）
  _quickHaveAnswer = false;
  // 本次命令是否已收到 quick_done（用于失败兜底判断）
  _quickDone = false;
  // 最近一次失败步骤的错误信息（失败时回填进气泡）
  _quickLastError = null;
  // 重置步骤进度与耗时统计
  _quickStepEls = {};
  _quickStepStart = {};
  _quickModelStart = 0;
  _quickTtft = null;
  _quickTotal = null;

  try {
    toggleThinking(true, '正在连接');
    const res = await fetch('/api/quick', {
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
        handleQuickEvent(ev);
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      if (!requestAborted) appendStep('error', '⚠ 已中止');
    } else {
      appendStep('error', '读取响应失败: ' + e.message);
    }
  } finally {
    currentAbortController = null;
    setBusy(false);
    toggleThinking(false);
    // 命令在输出中途失败（未走到 quick_done）：若已有模型 token，冲刷已收到的片段；
    // 若连一个 token 都没有（预处理/推理阶段就已失败），把错误回填进气泡，避免遗留空白答案卡片。
    // quick_done 已调用 finalize 时 streamingAnswer 为 null，跳过。
    if (state.streamingAnswer) {
      const text = _quickHaveAnswer
        ? (state.streamingText || '')
        : (_quickLastError ? '⚠ 指令执行失败：' + _quickLastError : '⚠ 指令执行失败');
      finalizeAnswer(text);
    }
  }
}

// 处理单个 quick SSE 事件
function handleQuickEvent(ev) {
  if (requestAborted) return;
  switch (ev.type) {
    case 'meta':
      state.currentStreamModel = ev.model || state.currentStreamModel;
      state.quickMeta.command = ev.command || state.quickMeta.command;
      break;
    case 'quick_step': {
      // 首个步骤先创建答案容器，确保步骤归入消息的 .steps（刷新后可恢复）
      if (!state.streamingSteps) ensureMessageContainer();
      const label = QUICK_STEP_LABEL[ev.step] || ev.step;
      if (ev.status === 'running') {
        _quickStepStart[ev.step] = performance.now();
        let elStep = _quickStepEls[ev.step];
        if (!elStep) {
          elStep = appendStep('step', '');
          _quickStepEls[ev.step] = elStep;
        }
        elStep.textContent = '⏳ ' + label + '中…';
        elStep.dataset.status = 'running';
        if (ev.step === 'model') _quickModelStart = _quickStepStart[ev.step];
        toggleThinking(true, '指令集 · ⏳ ' + label + '中…');
      } else if (ev.status === 'done') {
        const start = _quickStepStart[ev.step];
        const dur = start ? performance.now() - start : null;
        const elStep = _quickStepEls[ev.step];
        const tail = ev.msg ? '：' + ev.msg : '';
        if (elStep) {
          elStep.textContent = '✓ ' + label + '完成' + (dur != null ? ' · ' + fmtDur(dur) : '') + tail;
          if (dur != null) elStep.dataset.time = String(Math.round(dur));
          elStep.dataset.status = 'done';
        }
        if (ev.step === 'model') _quickTotal = dur;
        toggleThinking(true, '指令集 · ✓ ' + label + '完成');
      } else if (ev.status === 'error') {
        const elStep = _quickStepEls[ev.step];
        if (elStep) {
          elStep.textContent = '✗ ' + label + '失败' + (ev.msg ? '：' + ev.msg : '');
          elStep.dataset.status = 'error';
        }
        _quickLastError = ev.msg || (label + '失败');
        toggleThinking(false);
      }
      break;
    }
    case 'quick_token':
      if (!_quickHaveAnswer) {
        ensureMessageContainer();
        _quickHaveAnswer = true;
      }
      // 模型阶段首字到达即记录 TTFT
      if (_quickTtft == null && _quickModelStart) {
        _quickTtft = performance.now() - _quickModelStart;
      }
      appendToken(ev.content);
      break;
    case 'quick_done':
      _quickDone = true;
      state.quickLastOutput = ev.output || '';
      if (ev.apply) state.quickMeta.apply = ev.apply;
      if (!_quickHaveAnswer) {
        ensureMessageContainer();
        _quickHaveAnswer = true;
      }
      // 写入耗时统计到答案底部（持久化，刷新后保留）
      const statsEl = state.streamingHead ? state.streamingHead.querySelector('.stats') : null;
      if (statsEl) {
        statsEl.dataset.ttft = _quickTtft != null ? String(Math.round(_quickTtft)) : '';
        statsEl.dataset.total = _quickTotal != null ? String(Math.round(_quickTotal)) : '';
        statsEl.textContent = 'TTFT: ' + (_quickTtft != null ? Math.round(_quickTtft) : '—') +
          'ms | 总耗时: ' + (_quickTotal != null ? Math.round(_quickTotal) : '—') + 'ms';
      }
      finalizeAnswer(ev.output || '');
      // 附加动作按钮（fix/comment 应用修改；push 推送）
      const card = state.session.querySelectorAll('.msg.agent.answer-card');
      appendQuickActions(card[card.length - 1], state.quickMeta);
      // commit：弹出居中弹框编辑提交信息
      if (state.quickMeta.command === 'commit') openCommitMsgModal(ev.output || '');
      break;
    case 'error':
      appendStep('error', '⚠ ' + ev.msg);
      break;
  }
}

// 标记：本次 quick 命令是否已创建答案容器（避免重复 ensureMessageContainer）
let _quickHaveAnswer = false;
// 标记：本次命令是否已收到 quick_done（用于失败兜底判断，避免空白答案卡片）
let _quickDone = false;
// 最近一次失败步骤的错误信息（失败时回填进气泡）
let _quickLastError = null;

// 步骤进度与耗时：每个阶段一行，原地更新并显示耗时；模型阶段额外统计 TTFT / 总耗时。
let _quickStepEls = {};     // phase -> 步骤 DOM 元素
let _quickStepStart = {};   // phase -> 起始 performance.now()
let _quickModelStart = 0;   // 模型阶段起始时间
let _quickTtft = null;      // 首字延迟（ms）
let _quickTotal = null;     // 模型总耗时（ms）

function fmtDur(ms) {
  if (ms == null) return '';
  return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
}
