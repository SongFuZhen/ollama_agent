'use strict';

/* file-browser.js - 文件浏览器 */

// browseRoot: null => 后端默认沙箱目录；非 null => 用户用「选择目录」挑的本地目录名
let browseRoot = null;
let localFiles = null;        // 最近一次选定的 FileList
const fileTreeEl = $('#file-tree');
const fsRefresh = $('#fs-refresh');

// 本地目录缓存：目录名称 -> FileList
const localDirCache = new Map();

// 根据 project_root 加载文件树
async function loadFileTreeForRoot(root) {
  fileTreeEl.textContent = '加载中…';
  try {
    const params = new URLSearchParams();
    params.set('root', root);
    const r = await fetch('/api/fs/list?' + params.toString());
    const d = await r.json();
    if (d.error) {
      // 加载失败，清除项目目录绑定，让用户重新绑定
      state.currentProjectRoot = null;
      updateFilePanelState();
      return;
    }
    const rootLabel = lastSeg(d.root) || '项目文件';
    renderFsTree(d.items, '', rootLabel);
  } catch (e) {
    // 加载失败，清除项目目录绑定，让用户重新绑定
    state.currentProjectRoot = null;
    updateFilePanelState();
  }
}

// 当前生效的沙箱根：优先用已绑定的绝对路径，回退设置页/服务端默认
function activeRoot() {
  if (state.currentProjectRoot && isAbs(state.currentProjectRoot)) return state.currentProjectRoot;
  const s = settingsRoot();
  if (s && isAbs(s)) return s;
  return serverRootCache || '';
}

async function loadFileTree(sub) {
  if (browseRoot !== null) return; // 本地浏览模式，不请求后端
  const root = activeRoot();
  fileTreeEl.textContent = '加载中…';
  try {
    const params = new URLSearchParams();
    if (sub) params.set('path', sub);
    if (root) params.set('root', root);
    const q = params.toString() ? ('?' + params.toString()) : '';
    const r = await fetch('/api/fs/list' + q);
    const d = await r.json();
    if (d.error) { fileTreeEl.textContent = '⚠ ' + d.error; return; }
    // 渲染为可展开的树：根目录名（取绝对路径最后一段）+ 子节点
    const rootLabel = lastSeg(d.root) || '项目文件';
    renderFsTree(d.items, '', rootLabel);
  } catch (e) {
    fileTreeEl.textContent = '⚠ ' + e.message;
  }
}

// 创建文件树节点（带Lucide图标）
function createFileNode(type, name, className) {
  const node = el('div', 'node ' + (className || ''));
  const pascalName = type === 'dir' ? 'Folder' : 'File';
  const icon = createIcon(pascalName);
  if (icon) {
    icon.classList.add('tree-icon');
    node.appendChild(icon);
  }
  node.appendChild(document.createTextNode(' ' + name));
  return node;
}

async function loadFsChildren(fullPath, container) {
  const root = activeRoot();
  const loading = el('div', 'node loading', '加载中…');
  container.appendChild(loading);
  try {
    const params = new URLSearchParams();
    params.set('path', fullPath);
    if (root) params.set('root', root);
    const r = await fetch('/api/fs/list?' + params.toString());
    const d = await r.json();
    container.removeChild(loading);
    if (d.error) { container.appendChild(el('div', 'node', '⚠ ' + d.error)); return; }
    renderFsChildren(d.items, fullPath, container);
  } catch (e) {
    if (loading.parentNode) container.removeChild(loading);
    container.appendChild(el('div', 'node', '⚠ ' + e.message));
  }
}

// 渲染树的一层（用于根层）：直接把根下内容渲染进 rootBox，避免重复请求
function renderFsTree(items, base, rootLabel) {
  fileTreeEl.innerHTML = '';
  const rootNode = createFileNode('dir', rootLabel || '项目文件', 'dir');
  const rootBox = el('div', 'local-children');
  rootNode.onclick = () => {
    // 再次点击根：折叠/展开切换
    if (rootBox.childElementCount === 0) renderFsChildren(items, base, rootBox);
    else rootBox.innerHTML = '';
  };
  fileTreeEl.appendChild(rootNode);
  fileTreeEl.appendChild(rootBox);
  // 初始即展开根目录，直接展示第一层
  renderFsChildren(items, base, rootBox);
}

// 渲染子层到指定容器（带展开/折叠）
function renderFsChildren(items, base, container) {
  container.innerHTML = '';
  const dirs = items.filter((i) => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((i) => i.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
  for (const it of dirs) {
    const full = base ? base + '/' + it.name : it.name;
    const dirNode = createFileNode('dir', it.name, 'dir');
    const childBox = el('div', 'local-children');
    dirNode.onclick = () => {
      if (childBox.childElementCount === 0) loadFsChildren(full, childBox);
      else childBox.innerHTML = ''; // 再次点击折叠
    };
    container.appendChild(dirNode);
    container.appendChild(childBox);
  }
  for (const it of files) {
    const full = base ? base + '/' + it.name : it.name;
    const fNode = createFileNode('file', it.name, 'file');
    fNode.onclick = () => insertPath(full);
    container.appendChild(fNode);
  }
}

// ---------- 本地目录浏览（纯前端，不经后端沙箱） ----------
// 把 FileList 按 webkitRelativePath 构建成可展开的虚拟树
function buildLocalTree(fileList) {
  const root = { name: '', dirs: new Map(), files: [] };
  for (const f of fileList) {
    const parts = f.webkitRelativePath.split('/');
    const rootName = parts[0];
    root.name = rootName;
    let cur = root;
    // 跳过根目录名，逐层建立子目录
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.files.push(part);
      } else {
        if (!cur.dirs.has(part)) cur.dirs.set(part, { name: part, dirs: new Map(), files: [] });
        cur = cur.dirs.get(part);
      }
    }
  }
  return root;
}

function renderLocalTree(node, container, basePath) {
  // 子目录
  const dirNames = [...node.dirs.keys()].sort();
  for (const name of dirNames) {
    const child = node.dirs.get(name);
    const full = basePath ? basePath + '/' + name : name;
    const dirNode = createFileNode('dir', name, 'dir');
    const childBox = el('div', 'local-children');
    let expanded = false;
    dirNode.onclick = () => {
      if (!expanded) {
        childBox.innerHTML = '';
        renderLocalTree(child, childBox, full);
        expanded = true;
      } else {
        childBox.innerHTML = '';
        expanded = false;
      }
    };
    container.appendChild(dirNode);
    container.appendChild(childBox);
  }
  // 文件
  const fileNames = node.files.slice().sort();
  for (const name of fileNames) {
    const full = basePath ? basePath + '/' + name : name;
    const fNode = createFileNode('file', name, 'file');
    fNode.onclick = () => insertPath(full);
    container.appendChild(fNode);
  }
}

function loadLocalTree(fileList) {
  if (!fileList || !fileList.length) return;
  localFiles = fileList;
  browseRoot = fileList[0].webkitRelativePath.split('/')[0];
  
  // 缓存 FileList
  localDirCache.set(browseRoot, fileList);

  // 本地浏览仅用于插入路径；浏览器无法获取本地目录绝对路径，
  // 故不覆盖 state.currentProjectRoot（那是模型沙箱的绝对根）。
  // 若已有绝对沙箱根，同步刷新对话绑定的 project_root
  const convId = state.conversationId;
  if (convId && state.currentProjectRoot && isAbs(state.currentProjectRoot)) {
    fetch('/api/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: convId,
        projectRoot: state.currentProjectRoot,
      }),
    }).catch(e => console.error('更新对话目录失败:', e));
  } else if (!convId) {
    // 新对话，生成新 ID
    state.conversationId = generateConvId();
  }
  
  const tree = buildLocalTree(fileList);
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
  // 本地浏览仅用于插入路径，不覆盖绝对沙箱根（浏览器无法获取本地目录绝对路径）
  if (typeof updateProjectRootUI === 'function') updateProjectRootUI();
}

function updatePanelHint() {
  const hint = document.querySelector('.panel-hint');
  if (hint) {
    if (browseRoot) {
      hint.textContent = '当前浏览：' + browseRoot + '（点文件插入路径）';
    } else {
      hint.textContent = '绑定沙箱目录后，可在此浏览目录内的文件';
    }
  }
}

// 点文件：把相对路径插入输入框（供用户发送时引用，或交给模型读取）
// 本地模式下，路径前缀所选根目录名，便于模型理解
function insertPath(rel) {
  const prefixed = browseRoot ? (browseRoot + '/' + rel) : rel;
  const cur = inputEl.value;
  inputEl.value = (cur ? cur + ' ' : '') + '文件: ' + prefixed;
  inputEl.focus();
}

fsRefresh.onclick = () => {
  if (browseRoot !== null && localFiles) loadLocalTree(localFiles);
  else loadFileTree('');
};

// 文件面板状态：无沙箱根时显示提示，有根时加载目录树
function updateFilePanelState() {
  if (browseRoot !== null) { fileTreeEl.dataset.empty = ''; return; } // 本地浏览模式由 loadLocalTree 控制
  const root = effectiveRoot();
  if (!root) {
    fileTreeEl.dataset.empty = '1';
    fileTreeEl.innerHTML = `<div class="file-hint">⚠ 请先选择并绑定沙箱目录<br><br>绑定后模型才能读取该目录下的文件，<br>并在此查看项目文件。</div>`;
    return;
  }
  if (fileTreeEl.dataset.empty === '1') {
    fileTreeEl.dataset.empty = '';
    loadFileTree('');
  }
}

// ---------- 绑定绝对目录为当前会话沙箱根 ----------
// 浏览器「选择目录」只能拿到相对名，无法获取绝对路径；此处让用户直接粘贴
// 绝对路径，由后端校验可访问后绑定为 project_root（可持久化、历史回放直接加载）。
async function bindAbsoluteRoot(raw) {
  const path = (raw || '').trim();
  if (!path) return;
  if (!isAbs(path)) {
    fileTreeEl.innerHTML = `<div class="node" style="color: var(--red);">⚠ 请输入绝对路径（如 /Users/you/project）</div>`;
    return;
  }
  fileTreeEl.textContent = '校验中…';
  try {
    const params = new URLSearchParams();
    params.set('root', path);
    const r = await fetch('/api/fs/list?' + params.toString());
    const d = await r.json();
    if (d.error) {
      fileTreeEl.innerHTML = `<div class="node" style="color: var(--red);">⚠ 无法访问目录: ${escapeHtml(path)}</div>`;
      return;
    }
    // 绑定成功：作为当前会话沙箱根（绝对路径，可持久化）
    state.currentProjectRoot = path;
    browseRoot = null; // 退出本地浏览模式
    const convId = state.conversationId;
    if (convId) {
      fetch('/api/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: convId, projectRoot: path }),
      }).catch(e => console.error('绑定目录保存失败:', e));
    }
    fileTreeEl.dataset.empty = '';
    updateProjectRootUI();
    if (typeof refreshStatusRoot === 'function') refreshStatusRoot(); // 绑定后刷新状态栏「根」
    loadFileTreeForRoot(path);
  } catch (e) {
    fileTreeEl.innerHTML = `<div class="node" style="color: var(--red);">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 空状态：选择沙箱目录（新任务第一步） ----------
const emptyRootInput = $('#empty-root-input');
const emptyRootPick = $('#empty-root-pick');
const emptyRootDirInput = $('#empty-root-dirinput');
const emptyRootStatus = $('#empty-root-status');

// 刷新空状态里的绑定提示；顶栏显示由 updateProjectRootUI 负责
function refreshEmptyRootStatus() {
  if (!emptyRootStatus) return;
  const abs = effectiveRoot();
  if (abs) {
    emptyRootStatus.textContent = '✓ 已绑定沙箱目录：' + abs;
    emptyRootStatus.className = 'empty-root-status ok';
  } else {
    emptyRootStatus.textContent = '';
    emptyRootStatus.className = 'empty-root-status';
  }
}

// 选择目录：打开「目录选择器」抽屉，从服务端真实文件系统导航并选取，
// 选中后得到完整绝对路径，填入输入框并按回车绑定（左侧同步列出项目文件）。
const dirPicker = document.getElementById('dir-picker');
const dirPickerList = document.getElementById('dir-picker-list');
const dirPickerCurrent = document.getElementById('dir-picker-current');
const dirPickerUp = document.getElementById('dir-picker-up');
const dirPickerHere = document.getElementById('dir-picker-here');
let pickerPath = '';      // 当前导航到的绝对路径
let pickerSelected = '';  // 当前选中的目录（高亮）

async function openDirPicker(initial) {
  pickerSelected = '';
  dirPicker.classList.remove('hidden');
  await loadDirPicker(initial || effectiveRoot() || '');
}

async function loadDirPicker(p) {
  pickerPath = p || '';
  dirPickerList.innerHTML = '<div class="dir-picker-loading">加载中…</div>';
  try {
    const params = new URLSearchParams();
    if (p) params.set('path', p);
    const r = await fetch('/api/fs/dirs?' + params.toString());
    const d = await r.json();
    if (d.error) { dirPickerList.innerHTML = '<div class="dir-picker-err">⚠ ' + escapeHtml(d.error) + '</div>'; return; }
    pickerPath = d.path;
    pickerSelected = ''; // 切换目录后清空选中
    dirPickerCurrent.textContent = d.path;
    dirPickerList.innerHTML = '';
    if (d.parent) {
      const up = el('div', 'dir-picker-item up', '↑  ..');
      up.onclick = () => loadDirPicker(d.parent);
      dirPickerList.appendChild(up);
    }
    if (!d.dirs.length) {
      dirPickerList.appendChild(el('div', 'dir-picker-empty', '（无子目录）'));
    }
    for (const dir of d.dirs) {
      const item = el('div', 'dir-picker-item', '📁 ' + dir.name);
      item.title = dir.path;
      item.onclick = () => {
        pickerSelected = dir.path;
        for (const n of dirPickerList.querySelectorAll('.dir-picker-item')) n.classList.remove('selected');
        item.classList.add('selected');
      };
      item.ondblclick = () => loadDirPicker(dir.path);
      dirPickerList.appendChild(item);
    }
    if (dirPickerUp) {
      dirPickerUp.dataset.parent = d.parent || '';
      dirPickerUp.disabled = !d.parent;
    }
  } catch (e) {
    dirPickerList.innerHTML = '<div class="dir-picker-err">⚠ ' + escapeHtml(e.message) + '</div>';
  }
}

if (emptyRootPick) {
  emptyRootPick.onclick = () => openDirPicker();
}
if (dirPickerUp) dirPickerUp.onclick = () => loadDirPicker(dirPickerUp.dataset.parent || (pickerPath ? pathDirname(pickerPath) : ''));

if (dirPickerHere) {
  dirPickerHere.onclick = () => {
    const chosen = pickerSelected || pickerPath; // 未点选则选当前目录
    emptyRootInput.value = chosen;
    emptyRootInput.placeholder = '已选择目录，按回车绑定';
    dirPicker.classList.add('hidden');
    bindAbsoluteRoot(chosen);
    refreshEmptyRootStatus();
  };
}
// 点击遮罩 / 关闭 / 取消
if (dirPicker) {
  dirPicker.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => dirPicker.classList.add('hidden');
  });
}

function pathDirname(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

emptyRootInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    bindAbsoluteRoot(emptyRootInput.value);
    refreshEmptyRootStatus();
  }
});
