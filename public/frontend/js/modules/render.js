'use strict';

/* render.js - 消息渲染、Markdown 处理 */

// 时间标签：显示 HH:mm，悬浮显示完整日期时间
function timeSpan() {
  const t = el('span', 'time', formatTime());
  t.title = formatTimeFull();
  return t;
}

// 消息唯一 ID：用于「单条消息移出上下文」的精确排除
let msgSeq = 0;
function nextMid() {
  return 'm' + (++msgSeq);
}

const COPY_ICON = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2-2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const COPY_DONE_ICON = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// 复制按钮：复用 simpui .lightbtn，点击后短暂显示「已复制」勾选图标
const COPY_LABEL = '<span class="copy-text">复制</span>';
const COPY_DONE_LABEL = '<span class="copy-text">已复制</span>';

// grep 命中高亮：用已知的搜索 pattern 在结果文本中就地包裹 <mark>。
// 直接在客户端根据 pattern 高亮，避免把控制字符写进工具结果（否则会污染模型上下文 / 历史显示乱码）。
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function highlightGrep(text, pattern) {
  if (!text) return '（无输出）';
  let html = escapeHtml(text);
  if (pattern) {
    let re = null;
    try { re = new RegExp(pattern, 'gi'); } catch (e) { re = null; }
    if (re) html = html.replace(re, (m) => '<mark class="grep-hit">' + m + '</mark>');
  }
  return html;
}

function makeCopyBtn(text) {
  const copy = el('button', 'copy lightbtn sm');
  copy.title = '复制';
  copy.setAttribute('aria-label', '复制');
  copy.innerHTML = COPY_ICON + COPY_LABEL;
  copy.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => {
      copy.innerHTML = COPY_DONE_ICON + COPY_DONE_LABEL;
      copy.title = '已复制';
      setTimeout(() => { copy.innerHTML = COPY_ICON + COPY_LABEL; copy.title = '复制'; }, 1200);
    });
  };
  return copy;
}

// 代码块专用复制按钮：点击只复制该段代码（getText 取 code 文本）
function makeCodeCopyBtn(getText) {
  const copy = el('button', 'copy lightbtn sm code-copy-btn');
  copy.type = 'button';
  copy.title = '复制代码';
  copy.setAttribute('aria-label', '复制代码');
  copy.innerHTML = COPY_ICON + COPY_LABEL;
  copy.onclick = () => {
    const text = typeof getText === 'function' ? getText() : '';
    navigator.clipboard?.writeText(text).then(() => {
      copy.innerHTML = COPY_DONE_ICON + COPY_DONE_LABEL;
      copy.title = '已复制';
      setTimeout(() => { copy.innerHTML = COPY_ICON + COPY_LABEL; copy.title = '复制代码'; }, 1200);
    });
  };
  return copy;
}

// 为气泡内每个代码块（pre.hljs）包裹 .code-block 并挂独立复制按钮，仅复制该段代码。
// 已在 .code-block 内的 pre 跳过，避免流式重渲染时重复包裹。
function addCodeCopyButtons(root) {
  if (!root) return;
  root.querySelectorAll('pre.hljs').forEach((pre) => {
    if (pre.parentElement && pre.parentElement.classList.contains('code-block')) return;
    const code = pre.querySelector('code');
    const wrap = el('div', 'code-block');
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    wrap.appendChild(makeCodeCopyBtn(() => (code ? code.textContent : pre.textContent)));
  });
}

// 检查气泡高度，超过阈值时添加 wide 类使其变宽
const BUBBLE_WIDE_THRESHOLD = 300; // 高度超过此值时变宽
function checkBubbleWide(bubble) {
  if (!bubble) return;
  // 延迟检查，确保内容已渲染
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (bubble.scrollHeight > BUBBLE_WIDE_THRESHOLD) {
        bubble.classList.add('wide');
      }
    });
  });
}

// 清除上下文按钮（单条移出上下文的开关）：按钮变红表示该消息已从上下文排除
function makeContextClearBtn() {
  const btn = el('button', 'copy lightbtn sm context-clear');
  btn.type = 'button';
  btn.dataset.action = 'clear-context';
  btn.innerHTML = `<svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path><path d="M22 21H7"></path><path d="m5 11 9 9"></path></svg><span class="context-clear-label">清除上下文</span>`;
  // 若该消息已被排除（重开对话恢复），直接标红
  const msg = btn.closest('.msg');
  const excluded = !!(msg && msg.dataset.mid && state.excludedMids && state.excludedMids.has(msg.dataset.mid));
  applyContextClearState(btn, excluded);
  return btn;
}

// 应用单个「清除上下文」按钮的状态：removed=true 时按钮变红并提示已移除
function applyContextClearState(btn, removed) {
  btn.classList.toggle('red', removed);
  const label = btn.querySelector('.context-clear-label');
  if (label) label.textContent = removed ? '已移除' : '清除';
  const tip = removed ? '该消息已移出上下文（不再携带给模型）：点击恢复' : '清除：后续对话不再携带该消息';
  btn.title = tip;
  btn.setAttribute('aria-label', tip);
}

// 同步所有「清除上下文」按钮的红色状态（与 state.excludedMids 一致）
function refreshClearButtons() {
  document.querySelectorAll('[data-action="clear-context"]').forEach((btn) => {
    const msg = btn.closest('.msg');
    const excluded = !!(msg && msg.dataset.mid && state.excludedMids && state.excludedMids.has(msg.dataset.mid));
    applyContextClearState(btn, excluded);
    applyMsgCollapsed(msg, excluded);
  });
}

// 气泡内容是否超过约 3 行（超过才需要折叠）
function isBubbleTall(bubble) {
  if (!bubble) return false;
  // 临时解除可能的 clamp，确保测量的是完整内容高度
  const prevMax = bubble.style.maxHeight;
  const prevOverflow = bubble.style.overflow;
  bubble.style.maxHeight = 'none';
  bubble.style.overflow = 'visible';
  const cs = getComputedStyle(bubble);
  const lineH = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.7);
  const threeLines = lineH * 3 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const tall = bubble.scrollHeight > threeLines + 4;
  bubble.style.maxHeight = prevMax;
  bubble.style.overflow = prevOverflow;
  return tall;
}

// 已移出上下文的消息：仅当内容超过 3 行才折叠为单行（点击可展开/收起）
function applyMsgCollapsed(msg, collapsed) {
  if (!msg) return;
  msg.classList.toggle('collapsed', !!collapsed);
  const bubble = msg.querySelector(':scope > .bubble');
  if (bubble) {
    bubble.classList.remove('expanded-flag');
    // 内容较短时不折叠，仅保留红色排除状态
    msg.classList.toggle('collapsible', !!(collapsed && isBubbleTall(bubble)));
  }
}

// 点击已折叠消息的气泡 → 临时展开，再次点击收起（保持 .collapsed，仅切换 expanded-flag）
function bindMsgCollapseToggle() {
  if (boundMsgCollapseToggle) return;
  boundMsgCollapseToggle = true;
  state.session.addEventListener('click', (e) => {
    const msg = e.target.closest('.msg.collapsed.collapsible');
    if (!msg) return;
    // 点按钮不触发折叠切换
    if (e.target.closest('button')) return;
    const bubble = msg.querySelector(':scope > .bubble');
    if (!bubble) return;
    bubble.classList.toggle('expanded-flag');
  });
}
let boundMsgCollapseToggle = false;

// ---------- 工具图标映射（Lucide PascalCase 名） ----------
const TOOL_ICONS = {
  read_file: 'FileText',
  list_dir: 'Folder',
  search_files: 'FileSearch',
  glob: 'Search',
  grep: 'SearchCode',
  write_file: 'FileEdit',
  bash: 'Terminal',
  edit_file: 'FilePen',
  read_lines: 'Rows3',
  tree: 'FolderTree',
  count_loc: 'ListChecks',
  apply_diff: 'FileDiff',
  semantic_grep: 'Brain',
  repo_map: 'Network',
  ask_user: 'MessageCircleQuestion',
  notes: 'StickyNote',
  todos: 'ListTodo',
  delegate: 'Split',
  run_tests: 'Play',
  run_lint: 'ShieldCheck',
  // skills
  git_status: 'GitBranch',
  git_diff: 'GitCompare',
  git_log: 'GitCommit',
  git_show: 'Eye',
  explain_symbol: 'FileCode',
  find_references: 'Link',
};

// 创建 Lucide SVG 图标
function createIcon(pascalName) {
  const icon = lucide.icons[pascalName];
  if (!icon) return null;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  icon.forEach(([tag, attrs]) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    svg.appendChild(el);
  });

  return svg;
}

// 临时开关：true 时跳过 markdown 渲染，原样显示 AI 文本（便于核对原始输出）
const RAW_MARKDOWN_DISABLED = false;

// Markdown 渲染器（按设置的引擎路由）
function renderMarkdown(text) {
  if (!text) return '';

  // 临时：直接返回纯文本，交由 innerHTML 转义显示（不解析 markdown）
  if (RAW_MARKDOWN_DISABLED) {
    return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  const engine = (typeof mdEngine === 'function') ? mdEngine() : 'marked';
  if (engine === 'markdownit') {
    return renderMarkdownIt(text);
  }

  return renderWithMarked(text);
}

// 用 marked 渲染（DOMPurify 净化，阻断 XSS）
function renderWithMarked(text) {
  if (typeof marked === 'undefined') {
    return text.replace(/\n/g, '<br>');
  }
  marked.setOptions({ breaks: false, gfm: true });
  const html = marked.parse(text);
  return (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : html;
}

// 渲染引擎二：markdown-it + highlight.js（气泡风格、代码高亮、默认 XSS 安全）
let _mdit = null;

// 修复模型生成表格时分隔行漏列的问题（如 3 列表头只写了 2 列分隔符）
function normalizeTables(text) {
  if (!text) return text;
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 检查是否可能为表格行：包含 | 分隔
    const isTableRow = (l) => l && l.includes('|');
    if (!isTableRow(line)) {
      out.push(line);
      i++;
      continue;
    }
    // 收集连续的表格行
    const block = [];
    while (i < lines.length && isTableRow(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    if (block.length < 2) {
      out.push(...block);
      continue;
    }
    // 计算每行的列数，取最大值
    const cols = block.map((l) => {
      const t = l.replace(/^\|/, '').replace(/\|$/, '');
      return t.split('|').length;
    });
    const maxCols = Math.max(...cols);
    // 补齐每行到 maxCols 列
    for (let j = 0; j < block.length; j++) {
      const isDelim = /^\|?[\s:-]+\|/.test(block[j]);
      let row = block[j];
      const need = maxCols - cols[j];
      if (need > 0) {
        const suffix = isDelim
          ? '|' + Array(need).fill('---').join('|')
          : '|' + Array(need).fill(' ').join('|');
        row = row.replace(/\|$/, suffix + '|');
      }
      out.push(row);
    }
  }
  return out.join('\n');
}

function getMarkdownIt() {
  if (_mdit) return _mdit;
  if (typeof window.markdownit === 'undefined') return null;
  _mdit = window.markdownit({
    html: true,           // 允许原始 HTML（随后由 DOMPurify 净化，仍安全）
    linkify: true,        // 自动识别链接
    breaks: true,         // 单换行视为 <br>，更贴聊天
    typographer: true,
    highlight(code, lang) {
      const langCls = lang ? ' class="language-' + lang + '"' : '';
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code' + langCls + '>' +
            hljs.highlight(code, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>';
        } catch (e) { /* fall through */ }
      }
      // 无语言或高亮失败：转义后原样输出
      const esc = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      return '<pre class="hljs"><code' + langCls + '>' + esc + '</code></pre>';
    },
  });
  return _mdit;
}

function renderMarkdownIt(text) {
  const md = getMarkdownIt();
  if (!md) {
    // markdown-it 未加载：降级到 marked（仍渲染，不转义）
    return renderWithMarked(text);
  }
  let normalized;
  try { normalized = normalizeTables(text); } catch (e) { normalized = text; }
  const html = md.render(normalized);
  // markdown-it 输出已由 DOMPurify 兜底净化，阻断 XSS
  return (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : html;
}

// ---------- Mermaid 图表渲染 ----------
let _mermaidReady = false;
function initMermaid() {
  if (_mermaidReady) return;
  if (typeof mermaid === 'undefined') return;
  mermaid.initialize({ startOnLoad: false, theme: 'base' });
  _mermaidReady = true;
}

async function renderMermaidBlocks(container) {
  if (!container) return;
  initMermaid();
  if (typeof mermaid === 'undefined') return;

  const codes = container.querySelectorAll('code.language-mermaid');
  if (!codes.length) return;

  let idx = 0;
  for (const code of codes) {
    const pre = code.parentElement;
    if (!pre || pre.tagName !== 'PRE') continue;
    const text = code.textContent.trim();
    if (!text) continue;
    try {
      const id = 'mermaid-' + Date.now() + '-' + (idx++);
      const { svg } = await mermaid.render(id, text);
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-rendered';
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
    } catch (e) {
      console.error('mermaid render error:', e);
    }
  }
}

// 创建承载 markdown 的气泡：按引擎套用不同排版类（保留原版 marked 用 .mdx，markdown-it 用 .mdit）
function elMarkdownBubble() {
  const b = el('div', 'bubble');
  const engine = (typeof mdEngine === 'function') ? mdEngine() : 'marked';
  if (engine === 'markdownit') {
    b.classList.add('mdit');
  } else {
    b.classList.add('mdx', 'mdx-bubble');
  }
  return b;
}

// ---------- 图片放大预览（lightbox） ----------
let lightboxEl = null;

function showLightbox(src) {
  if (lightboxEl) lightboxEl.remove();
  const overlay = el('div', 'lightbox-overlay');
  overlay.onclick = () => overlay.remove();
  const img = document.createElement('img');
  img.src = src;
  img.className = 'lightbox-img';
  img.onclick = (e) => e.stopPropagation(); // 防止点图片关闭
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  lightboxEl = overlay;
}

// 给用户消息中的图片绑定点击预览（在 appendUser 中调用）
function bindImagePreview(container) {
  container.querySelectorAll('.msg-image img, .bubble img').forEach((img) => {
    if (!img.dataset.lightbox) {
      img.dataset.lightbox = '1';
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => {
        if (img.src) showLightbox(img.src);
      });
      // 图片异步加载会改变布局高度，加载完成后再次滚到底部
      if (!img.complete) {
        img.addEventListener('load', () => scrollDown(), { once: true });
      }
    }
  });
}

// 计算图片展示地址：有持久化路径则从后端按 root 加载，否则用内存中的 dataUrl
function imageSrc(img) {
  if (img && img.path) {
    const root = state.currentProjectRoot || settingsRoot() || (typeof serverRootCache !== 'undefined' ? serverRootCache : '') || '';
    if (root) {
      return '/api/file?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(img.path);
    }
  }
  return (img && img.dataUrl) || '';
}

// 用户气泡
function appendUser(text, images, mid) {
  const m = el('div', 'msg user');
  const bubble = el('div', 'bubble');
  bubble.textContent = text || '';
  // 发送的图片：放在气泡内部
  if (images && images.length) {
    const grid = el('div', 'msg-images');
    images.forEach((img) => {
      const fig = el('div', 'msg-image');
      const im = el('img');
      im.src = imageSrc(img);
      if (img.path) im.dataset.path = img.path;
      im.alt = img.name || 'image';
      im.loading = 'lazy';
      fig.appendChild(im);
      grid.appendChild(fig);
    });
    bubble.appendChild(grid);
    bindImagePreview(grid);
  }

  m.appendChild(bubble);
  
  // 底部：复制 + 清除上下文 + 时间（复制在清除左侧）
  const footer = el('div', 'user-footer');
  footer.appendChild(makeCopyBtn(text));
  footer.appendChild(el('span', 'divider'));
  footer.appendChild(makeContextClearBtn());
  footer.appendChild(timeSpan());
  
  m.dataset.mid = mid || nextMid();
  m.appendChild(footer);
  appendToActive(m);
  return m;
}

// Agent 最终回答卡片（气泡 + 底部信息）
function appendAnswer(text, mid) {
  const m = el('div', 'msg agent answer-card');
  m.dataset.mid = mid || nextMid();
  const bubble = elMarkdownBubble();
  bubble.innerHTML = renderMarkdown(text);
  bindImagePreview(bubble); // markdown 内图片点击预览
  renderMermaidBlocks(bubble);
  addCodeCopyButtons(bubble);
  checkBubbleWide(bubble);

  // 底部：模型名 + 时间 + 复制 + 清除上下文
  // 模型名优先使用下拉选中的模型，否则用后端默认
  const footer = el('div', 'answer-footer');
  const modelName = state.currentStreamModel || state.activeModel || state.defaultModel || 'Agent';
  footer.appendChild(el('span', 'role', modelName));
  footer.appendChild(timeSpan());
  footer.appendChild(el('span', 'divider'));
  footer.appendChild(makeCopyBtn(text));
  footer.appendChild(el('span', 'divider'));
  footer.appendChild(makeContextClearBtn());

  m.appendChild(bubble);
  m.appendChild(footer);
  appendToActive(m);
  return m;
}

// 过程步骤（思考链 / 工具调用 / 错误等）
function appendStep(type, text) {
  const s = el('div', 'step ' + type, text);
  // 优先挂到当前消息的步骤容器内，与答案归为一组；无容器时挂到会话末尾
  if (state.streamingSteps) state.streamingSteps.appendChild(s);
  else appendToActive(s);
  return s;
}

// R1 推理块：默认折叠，可点击展开
function appendThinkBlock() {
  const thinkWrap = el('div', 'think-block');
  thinkWrap.setAttribute('data-collapsed', 'true');
  
  const header = el('div', 'think-header');
  const arrow = el('span', 'think-arrow', '▶');
  const label = el('span', 'think-label', '思考过程');
  header.appendChild(arrow);
  header.appendChild(label);
  
  const body = el('div', 'think-body');
  
  header.onclick = () => {
    const isCollapsed = thinkWrap.getAttribute('data-collapsed') === 'true';
    thinkWrap.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
    arrow.textContent = isCollapsed ? '▼' : '▶';
  };
  
  thinkWrap.appendChild(header);
  thinkWrap.appendChild(body);
  state.streamingSteps.appendChild(thinkWrap);
  state.streamingThink = body;
  state.streamingThinkText = '';
}

// 更新思考内容
function updateThinkContent(text) {
  if (state.streamingThink) {
    state.streamingThinkText += text;
    state.streamingThink.textContent = state.streamingThinkText;
  }
}

// 工具调用块：可折叠，直接显示结果
function appendToolCall(action, params, result, root, skipParams) {
  const toolWrap = el('div', 'tool-block');
  toolWrap.dataset.action = action; // 供结果渲染时判断是否为 grep（需高亮命中）
  if (action === 'grep' && params && params.pattern) {
    toolWrap.dataset.grepPattern = params.pattern; // 供 grep 结果高亮用
  }
  // 默认折叠；结果仍在加载（执行中）时保持展开，便于观察
  toolWrap.setAttribute('data-collapsed', result === null || result === undefined ? 'false' : 'true');

  // 工具调用标题（点击折叠/展开）
  const header = el('div', 'tool-toggle');
  header.title = '点击折叠/展开';
  const arrow = el('span', 'tool-arrow', '▶');
  header.appendChild(arrow);
  const iconName = TOOL_ICONS[action];
  const icon = iconName ? createIcon(iconName) : null;
  if (icon) {
    icon.classList.add('tool-icon');
    header.appendChild(icon);
  }
  const title = el('span', 'tool-name', action);
  header.appendChild(title);

  // 参数显示：展示模型传入的参数与生效的沙箱根。
  // @ 直接调用（skipParams=true）跳过参数 JSON 卡片，避免冗余展示。
  let paramsEl = null;
  if (!skipParams) {
    const displayParams = Object.assign({}, params);
    if (root) displayParams.root = root;
    const paramsStr = JSON.stringify(displayParams, null, 2);
    paramsEl = el('div', 'tool-params', paramsStr);
  }

  // 工具结果：结果未返回前显示加载占位，避免空白块
  const body = el('div', 'tool-result');
  if (action === 'grep' && result !== null && result !== undefined && String(result).length > 0) {
    // 已加载的 grep 结果（含历史恢复）同样高亮命中，不污染数据
    body.innerHTML = highlightGrep(String(result), params && params.pattern);
  } else if (result !== null && result !== undefined && String(result).length > 0) {
    body.textContent = result;
  } else {
    body.classList.add('loading');
    body.innerHTML = '<span class="tool-result-loading"></span>执行中…';
  }

  // 折叠交互：默认展开；有结果后再点击可折叠
  header.onclick = () => {
    const collapsed = toolWrap.getAttribute('data-collapsed') === 'true';
    toolWrap.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  };

  // 渲染顺序固定为：工具头 -> 参数 -> 结果
  toolWrap.appendChild(header);
  if (paramsEl) toolWrap.appendChild(paramsEl);
  toolWrap.appendChild(body);
  state.streamingSteps.appendChild(toolWrap);
  scrollDown(true);
}

// 更新最后一个工具调用块的结果
function updateToolResult(result) {
  const toolBlocks = state.streamingSteps?.querySelectorAll('.tool-block');
  if (toolBlocks && toolBlocks.length > 0) {
    const lastBlock = toolBlocks[toolBlocks.length - 1];
    const resultEl = lastBlock.querySelector('.tool-result');
    if (resultEl) {
      setToolResult(resultEl, result, lastBlock.dataset.action, lastBlock.dataset.grepPattern);
    }
  }
}

// 写入工具结果：空结果也去掉「执行中…」占位，避免结束后仍显示加载态。
// grep 结果走高亮渲染（按 pattern 把命中串换成 <mark>），其余工具原样文本。
function setToolResult(resultEl, result, action, pattern) {
  resultEl.classList.remove('loading');
  resultEl.innerHTML = '';
  const text = result === null || result === undefined ? '' : String(result);
  if (action === 'grep') {
    resultEl.innerHTML = highlightGrep(text, pattern);
  } else if (text.length === 0) {
    resultEl.textContent = '（无输出）';
  } else {
    resultEl.textContent = text;
  }
}

// 执行结束时清理所有残留的「执行中…」占位
function clearToolLoading() {
  document.querySelectorAll('.tool-result.loading').forEach((el) => {
    setToolResult(el, el.textContent.replace('执行中…', '').trim());
  });
}

// 确保当前消息容器存在
function ensureMessageContainer(mid) {
  if (state.streamingAnswer) return;

  const m = el('div', 'msg agent answer-card');
  m.dataset.mid = mid || nextMid();
  const steps = el('div', 'steps');  // 思考/工具/步骤容器（独立于气泡）
  const bubble = elMarkdownBubble();
  
  // 底部：模型名 + 时间 + 统计 + 清除上下文 + 复制
  // 模型名优先使用下拉选中的模型，否则用后端默认
  const footer = el('div', 'answer-footer');
  const modelName = state.currentStreamModel || state.activeModel || state.defaultModel || 'Agent';
  footer.appendChild(el('span', 'role', modelName));
  footer.appendChild(timeSpan());
  const stats = el('span', 'stats');
  footer.appendChild(stats);
  footer.appendChild(el('span', 'divider'));
  footer.appendChild(makeContextClearBtn());
  footer.appendChild(el('span', 'divider'));
  const copy = makeCopyBtn('');
  footer.appendChild(copy);

  m.appendChild(steps);
  m.appendChild(bubble);
  m.appendChild(footer);
  appendToActive(m);

  state.streamingAnswer = bubble;
  state.streamingSteps = steps;
  state.streamingText = '';
  state.streamingHead = footer;
  return m;

  copy.onclick = () => {
    navigator.clipboard?.writeText(state.streamingText).then(() => {
      copy.innerHTML = COPY_DONE_ICON + COPY_DONE_LABEL;
      setTimeout(() => { copy.innerHTML = COPY_ICON + COPY_LABEL; }, 1200);
    });
  };
}

// 追加 token 到当前答案
function appendToken(token) {
  state.streamingText += token;
  state.streamingAnswer.innerHTML = renderMarkdown(state.streamingText);
  bindImagePreview(state.streamingAnswer); // 流式过程中新出现的 img 也绑定
  addCodeCopyButtons(state.streamingAnswer);
  checkBubbleWide(state.streamingAnswer);
  scrollDown();
}

// 最终确定答案
 function finalizeAnswer(content, plan) {
  if (state.streamingAnswer) {
    // 已有流式输出，更新为最终内容
    state.streamingAnswer.innerHTML = renderMarkdown(content);
    bindImagePreview(state.streamingAnswer);
    renderMermaidBlocks(state.streamingAnswer);
    addCodeCopyButtons(state.streamingAnswer);
    checkBubbleWide(state.streamingAnswer);
  } else {
    // 没有流式输出，创建新的答案元素
    ensureMessageContainer();
    state.streamingAnswer.innerHTML = renderMarkdown(content);
    bindImagePreview(state.streamingAnswer);
    renderMermaidBlocks(state.streamingAnswer);
    addCodeCopyButtons(state.streamingAnswer);
    checkBubbleWide(state.streamingAnswer);
  }

  // 结构化计划（plan 模式）：若后端解析出 {goal, steps, risks}，在其上渲染可勾选步骤卡片
  if (plan && state.streamingAnswer) {
    const card = renderStructuredPlan(plan);
    state.streamingAnswer.insertBefore(card, state.streamingAnswer.firstChild);
  }
  
  // 清理状态
  state.streamingAnswer = null;
  state.streamingSteps = null;
  state.streamingText = '';
  state.streamingHead = null;

  // 执行结束：清理可能残留的「执行中…」占位
  clearToolLoading();

  // U3：最终答案作为一轮 assistant 提交入栈，成为后续请求的结构化历史来源。
  // 带 mid 以支持单条移出上下文（mid 取自当前答案卡片）。
  if (typeof pushHistory === 'function' && content && content.trim()) {
    const card = state.streamingAnswer ? state.streamingAnswer.closest('.msg.agent.answer-card') : null;
    pushHistory('assistant', content, card ? card.dataset.mid : null);
  }

  // 更新状态栏
  if (typeof renderSessionState === 'function') renderSessionState();
  
  // 保存对话到数据库
  saveConversation();
}

// 渲染结构化计划卡片：goal + 步骤列表（含 action/target/reason）+ 风险。
// 供 plan 模式后端返回的 {goal, steps, risks} 渲染，使计划从"自由文本"变"可执行清单"。
function renderStructuredPlan(plan) {
  const card = el('div', 'plan-card');
  if (plan.goal) card.appendChild(el('div', 'plan-goal', '🎯 ' + plan.goal));
  if (Array.isArray(plan.steps) && plan.steps.length) {
    const ol = el('div', 'plan-steps');
    plan.steps.forEach((s, i) => {
      const row = el('div', 'plan-step');
      row.appendChild(el('span', 'plan-step-idx', String(i + 1)));
      const text = el('div');
      const action = (s && s.action) ? el('span', 'plan-step-action', s.action) : null;
      const target = (s && s.target) ? el('span', 'plan-step-target', ' ' + s.target) : null;
      const reason = (s && s.reason) ? el('div', 'plan-step-reason', s.reason) : null;
      if (action) text.appendChild(action);
      if (target) text.appendChild(target);
      if (reason) text.appendChild(reason);
      row.appendChild(text);
      ol.appendChild(row);
    });
    card.appendChild(ol);
  }
  if (Array.isArray(plan.risks) && plan.risks.length) {
    const risks = el('div', 'plan-risks');
    risks.appendChild(el('div', 'plan-risks-title', '⚠ 风险'));
    plan.risks.forEach((r) => risks.appendChild(el('div', 'plan-risk', '· ' + r)));
    card.appendChild(risks);
  }
  return card;
}

// ---------- 写操作确认卡片（每次单独确认） ----------
function showConfirm(card) {
  const { id, action, params } = card;
  const c = el('div', 'confirm-card');
  const head = el('div', 'confirm-head');
  head.appendChild(el('span', 'confirm-icon', '⚠'));
  head.appendChild(el('span', 'confirm-title', `写操作确认 [${action}]`));
  c.appendChild(head);
  const pre = el('pre');
  pre.textContent = JSON.stringify(params, null, 2);
  c.appendChild(pre);

  const btns = el('div', 'btns');
  const yes = el('button', 'yes simpui-btn primary sm', '确认写入');
  const no = el('button', 'no simpui-btn danger sm', '拒绝');
  yes.onclick = () => {
    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok: true }),
    });
    c.remove();
  };
  no.onclick = () => {
    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok: false }),
    });
    c.remove();
  };
  btns.appendChild(yes);
  btns.appendChild(no);
  c.appendChild(btns);
  appendToActive(c);
}

// ---------- 自愈状态横幅（验证失败后自动重试修复的全局进度提示） ----------
// 横幅浮于消息列表上方，随 heal_* 事件显示/更新/收起，让用户一眼看到「模型正在自我修复」。
const HEAL_BANNER_META = {
  heal_start: { cls: 'running', icon: '🔧', badge: '自愈中', badgeCls: 'warning' },
  heal_attempt: { cls: 'running', icon: '🔧', badge: '重试中', badgeCls: 'warning' },
  heal_pass: { cls: 'ok', icon: '✅', badge: '已修复', badgeCls: 'success' },
  heal_exhausted: { cls: 'fail', icon: '⛔', badge: '需人工', badgeCls: 'danger' },
  heal_error: { cls: 'fail', icon: '⚠', badge: '异常', badgeCls: 'danger' },
};
function showHealBanner(ev) {
  const banner = $('#heal-banner');
  if (!banner) return;
  const meta = HEAL_BANNER_META[ev.status] || { cls: 'running', icon: '🔧', badge: '自愈中', badgeCls: 'warning' };
  banner.className = 'heal-banner heal-' + meta.cls;
  banner.querySelector('.heal-icon').textContent = meta.icon;
  banner.querySelector('.heal-text').textContent = healBannerText(ev);
  const badge = banner.querySelector('.heal-badge');
  badge.className = 'heal-badge simpui-badge sm ' + meta.badgeCls;
  // 重试计数 N/M：自愈进行中显示当前第几次 / 上限，让用户看到收敛进度
  badge.textContent = meta.badge + (ev.max ? ` ${ev.attempt || 0}/${ev.max}` : '');
  banner.classList.remove('hidden');
}
function healBannerText(ev) {
  switch (ev.status) {
    case 'heal_start': return '验证失败，正在启动自动修复…';
    case 'heal_attempt': return '模型根据报错修复代码（退避后重试）…';
    case 'heal_pass': return '自愈成功：修复后验证通过';
    case 'heal_exhausted': return '自愈重试耗尽，仍未通过，需人工处理';
    case 'heal_error': return '自愈异常：' + (ev.output || '');
    default: return '自愈中';
  }
}
function hideHealBanner() {
  const banner = $('#heal-banner');
  if (banner) banner.classList.add('hidden');
}

// ---------- 验证器结果（run_tests / run_lint 闭环） ----------
// 自愈合事件的「第 N/M 次」后缀，便于在步骤行里也看到重试收敛进度
function healCountSuffix(ev) {
  return ev.max ? `（第 ${ev.attempt || 0}/${ev.max} 次）` : '';
}
function appendVerify(ev) {
  let text;
  let type = 'verify';
  if (ev.status === 'running') {
    text = '⏳ 验证中：运行测试 / Lint…';
  } else if (ev.status === 'pass') {
    text = '✓ 验证通过';
  } else if (ev.status === 'fail') {
    text = '✗ 验证失败';
    type = 'error';
  } else if (ev.status === 'heal_start') {
    text = '🔧 自愈启动：验证失败，进入自动修复重试' + healCountSuffix(ev);
  } else if (ev.status === 'heal_attempt') {
    text = '🔧 自愈重试：模型根据报错修复代码…' + healCountSuffix(ev);
  } else if (ev.status === 'heal_pass') {
    text = '✅ 自愈成功：修复后验证通过' + healCountSuffix(ev);
  } else if (ev.status === 'heal_exhausted') {
    text = '⛔ 自愈耗尽：重试次数用尽仍未通过，需人工处理' + healCountSuffix(ev);
    type = 'error';
  } else if (ev.status === 'heal_error') {
    text = '⚠ 自愈异常：' + (ev.output || '');
    type = 'error';
  } else {
    text = '⚠ 验证异常：' + (ev.output || '');
    type = 'error';
  }
  if (ev.output && ev.status !== 'running' && ev.status !== 'heal_start' && ev.status !== 'heal_attempt') {
    text += '\n' + String(ev.output).slice(0, 1200);
  }
  appendStep(type, text);
}

// ---------- ask_user 提问卡片（模型向用户澄清） ----------
function showAskUser(card) {
  const { id, question } = card;
  const c = el('div', 'confirm-card ask-user-card');
  const head = el('div', 'confirm-head');
  head.appendChild(el('span', 'confirm-icon', '❓'));
  head.appendChild(el('span', 'confirm-title', '模型提问'));
  c.appendChild(head);

  // 解析可选回答：提取"（可选回答：A / B / C）"格式
  let displayQuestion = question || '';
  let options = [];
  const optMatch = displayQuestion.match(/（可选回答[：:]\s*(.+?)）/);
  if (optMatch) {
    options = optMatch[1].split(/\s*[\/／]\s*/).map(s => s.trim()).filter(Boolean);
    displayQuestion = displayQuestion.slice(0, optMatch.index).trim();
  }
  const q = el('div', 'ask-question', displayQuestion);
  c.appendChild(q);

  // 发送回答的函数
  function sendAnswer(answer) {
    fetch('/api/ask-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, answer }),
    });
    c.remove();
  }

  // 有可选回答时，渲染为按钮
  if (options.length > 0) {
    const optBtns = el('div', 'ask-options');
    options.forEach(opt => {
      const btn = el('button', 'simpui-btn secondary sm', opt);
      btn.onclick = () => sendAnswer(opt);
      optBtns.appendChild(btn);
    });
    c.appendChild(optBtns);
  }

  // 输入框（用于自定义回答）
  const input = el('textarea', 'ask-input simpui-textarea');
  input.placeholder = options.length > 0 ? '或输入自定义回答…' : '输入你的回答…';
  input.rows = 2;
  c.appendChild(input);

  const btns = el('div', 'btns');
  const send = el('button', 'simpui-btn primary sm', '发送回答');
  send.onclick = () => {
    if (input.value.trim()) sendAnswer(input.value.trim());
  };
  btns.appendChild(send);
  c.appendChild(btns);
  appendToActive(c);
  input.focus();
}
