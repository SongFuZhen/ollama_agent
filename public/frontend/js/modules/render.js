'use strict';

/* render.js - 消息渲染、Markdown 处理 */

// 时间标签：显示 HH:mm，悬浮显示完整日期时间
function timeSpan() {
  const t = el('span', 'time', formatTime());
  t.title = formatTimeFull();
  return t;
}

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
function appendUser(text, images) {
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
  
  // 底部：复制 + 时间
  const footer = el('div', 'user-footer');
  const copy = el('button', 'copy lightbtn sm');
  copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  copy.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => {
      copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      }, 1200);
    });
  };
  footer.appendChild(copy);
  footer.appendChild(timeSpan());
  
  m.appendChild(footer);
  appendToActive(m);
}

// Agent 最终回答卡片（气泡 + 底部信息）
function appendAnswer(text) {
  const m = el('div', 'msg agent answer-card');
  const bubble = elMarkdownBubble();
  bubble.innerHTML = renderMarkdown(text);
  bindImagePreview(bubble); // markdown 内图片点击预览
  renderMermaidBlocks(bubble);

  // 底部：模型名 + 时间 + 复制
  // 模型名优先使用下拉选中的模型，否则用后端默认
  const footer = el('div', 'answer-footer');
  const modelName = state.currentStreamModel || state.activeModel || state.defaultModel || 'Agent';
  footer.appendChild(el('span', 'role', modelName));
  footer.appendChild(timeSpan());
  const copy = el('button', 'copy lightbtn sm');
  copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  copy.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => {
      copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      }, 1200);
    });
  };
  footer.appendChild(copy);
  
  m.appendChild(bubble);
  m.appendChild(footer);
  appendToActive(m);
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
function appendToolCall(action, params, result, root) {
  const toolWrap = el('div', 'tool-block');
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

  // 参数显示：同时展示模型传入的参数和当前生效的沙箱根
  const displayParams = Object.assign({}, params);
  if (root) displayParams.root = root;
  const paramsStr = JSON.stringify(displayParams, null, 2);
  const paramsEl = el('div', 'tool-params', paramsStr);

  // 工具结果：结果未返回前显示加载占位，避免空白块
  const body = el('div', 'tool-result');
  if (result !== null && result !== undefined && String(result).length > 0) {
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

  toolWrap.appendChild(header);
  toolWrap.appendChild(paramsEl);
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
      setToolResult(resultEl, result);
    }
  }
}

// 写入工具结果：空结果也去掉「执行中…」占位，避免结束后仍显示加载态
function setToolResult(resultEl, result) {
  resultEl.classList.remove('loading');
  resultEl.innerHTML = '';
  const text = result === null || result === undefined ? '' : String(result);
  if (text.length === 0) {
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
function ensureMessageContainer() {
  if (state.streamingAnswer) return;
  
  const m = el('div', 'msg agent answer-card');
  const steps = el('div', 'steps');  // 思考/工具/步骤容器（独立于气泡）
  const bubble = elMarkdownBubble();
  
  // 底部：模型名 + 时间 + 统计 + 复制
  // 模型名优先使用下拉选中的模型，否则用后端默认
  const footer = el('div', 'answer-footer');
  const modelName = state.currentStreamModel || state.activeModel || state.defaultModel || 'Agent';
  footer.appendChild(el('span', 'role', modelName));
  footer.appendChild(timeSpan());
  const stats = el('span', 'stats');
  footer.appendChild(stats);
  const copy = el('button', 'copy lightbtn sm');
  copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  footer.appendChild(copy);
  
  m.appendChild(steps);
  m.appendChild(bubble);
  m.appendChild(footer);
  appendToActive(m);
  
  state.streamingAnswer = bubble;
  state.streamingSteps = steps;
  state.streamingText = '';
  state.streamingHead = footer;
  
  copy.onclick = () => {
    navigator.clipboard?.writeText(state.streamingText).then(() => {
      copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        copy.innerHTML = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      }, 1200);
    });
  };
}

// 追加 token 到当前答案
function appendToken(token) {
  state.streamingText += token;
  state.streamingAnswer.innerHTML = renderMarkdown(state.streamingText);
  bindImagePreview(state.streamingAnswer); // 流式过程中新出现的 img 也绑定
  scrollDown();
}

// 最终确定答案
function finalizeAnswer(content) {
  if (state.streamingAnswer) {
    // 已有流式输出，更新为最终内容
    state.streamingAnswer.innerHTML = renderMarkdown(content);
    bindImagePreview(state.streamingAnswer);
    renderMermaidBlocks(state.streamingAnswer);
  } else {
    // 没有流式输出，创建新的答案元素
    ensureMessageContainer();
    state.streamingAnswer.innerHTML = renderMarkdown(content);
    bindImagePreview(state.streamingAnswer);
    renderMermaidBlocks(state.streamingAnswer);
  }
  
  // 清理状态
  state.streamingAnswer = null;
  state.streamingSteps = null;
  state.streamingText = '';
  state.streamingHead = null;

  // 执行结束：清理可能残留的「执行中…」占位
  clearToolLoading();

  // 更新状态栏
  if (typeof renderSessionState === 'function') renderSessionState();
  
  // 保存对话到数据库
  saveConversation();
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
