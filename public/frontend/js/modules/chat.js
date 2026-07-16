'use strict';

/* =========================================================================
 * chat.js — 消息流渲染、SSE 事件分发、思考态、图片、发送/中止。
 * 依赖全局：state($)、el、escapeHtml、renderMarkdown、
 *   appendUser/appendStep/appendThinkBlock/updateThinkContent/appendToolCall/
 *   updateToolResult/ensureMessageContainer/appendToken/finalizeAnswer/
 *   showConfirm/showHealBanner/hideHealBanner/appendVerify/showAskUser(render.js)、
 *   saveConversation/loadConfig/preflight/loadServerRoot/api.js)、
 *   settingsRoot/ollamaHost(settings.js)、
 *   effectiveRoot/updateProjectRootUI/renderSessionState/syncUrl/autoResizeInput/
 *   setBusy(statusbar.js、composer.js)。
 * ========================================================================= */

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
  // 事件委托：点击「清除上下文」按钮（持久：把该条消息移出上下文，再次点击恢复）
  state.session.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="clear-context"]');
    if (!btn) return;
    const msg = btn.closest('.msg');
    toggleContextExclusion(msg);
  });
  // 已移出上下文的消息：点击折叠气泡可展开/收起
  bindMsgCollapseToggle();
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

// 单条消息「移出上下文」：点击切换该消息 mid 是否进入后续发送的 history。
// 持久排除（红按钮），再次点击恢复；不影响其它消息，也不影响状态栏。
function toggleContextExclusion(msgEl) {
  if (!msgEl) return;
  const mid = msgEl.dataset.mid;
  if (!mid) return;
  const btn = msgEl.querySelector('[data-action="clear-context"]');
  if (state.excludedMids.has(mid)) {
    state.excludedMids.delete(mid);
    if (btn) applyContextClearState(btn, false);
    applyMsgCollapsed(msgEl, false);
    showSimpuiToast('提示', '已将该消息重新纳入上下文');
  } else {
    state.excludedMids.add(mid);
    if (btn) applyContextClearState(btn, true);
    applyMsgCollapsed(msgEl, true);
    showSimpuiToast('提示', '该消息已移出上下文，后续消息不再携带它');
  }
  // 立即落库，确保重开对话仍可见排除状态
  if (state.conversationId) saveConversation();
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

  // 顶栏项目目录 chip：元素可能不存在（遗留），不存在则跳过其渲染，但不阻断后续逻辑。
  if (chip) {
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
  }

  // 同步空状态的绑定提示
  if (typeof refreshEmptyRootStatus === 'function') refreshEmptyRootStatus();
  // 同步文件面板：无根显示提示，有根加载目录树
  if (typeof updateFilePanelState === 'function') updateFilePanelState();
  // 同步会话状态栏（模型 / 目录 / 分支）
  renderSessionState();
  // 绑定/切换目录后强制刷新 git 分支（绕过 lastGitRoot 缓存）
  fetchGitBranch(effectiveRoot(), true);
}

// ---------- SSE 事件分发 ----------
// 流程：user -> thinking_start -> thought* -> (tool -> tool_result)* -> token* -> answer
// 每个环节按顺序追加到当前消息容器中
function handleEvent(ev) {
  if (requestAborted) return;
  switch (ev.type) {
    case 'meta':
      state.tools = Array.isArray(ev.tools) ? ev.tools : [];
      if (ev.model) state.currentStreamModel = ev.model;
      // 服务端已收到请求并准备好（位于真正调用模型之前）：标记为「已连接」
      toggleThinking(true, '已连接 · 准备中');
      break;

    case 'thinking_start':
      // 模型已开始流式返回（推理/思考阶段）：说明已真正交给模型
      toggleThinking(true, '模型推理中' + phaseStep(ev.step));
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
      // 工具调用，追加到当前消息容器；标签明确显示正在跑哪个工具
      toggleThinking(true, '执行工具：' + ev.action + phaseStep(ev.step));
      ensureMessageContainer();
      appendToolCall(ev.action, ev.params, null, ev.root || effectiveRoot() || '');
      // 累计工具调用次数到状态栏
      state.sessionStats.toolCounts[ev.action] = (state.sessionStats.toolCounts[ev.action] || 0) + 1;
      renderSessionState();
      break;

    case 'tool_result':
      // 工具跑完，结果交回模型继续推理
      toggleThinking(true, '工具返回 · 模型整合中' + phaseStep(ev.step));
      updateToolResult(ev.result);
      break;

    case 'token':
      // 流式输出 token，开始输出最终答案
      toggleThinking(true, '生成回答中' + phaseStep(ev.step));
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

    case 'verify':
      // 验证器闭环：自动跑测试/Lint，及自愈重试进度
      if (ev.status === 'running') {
        toggleThinking(true, '验证中 · 运行测试/Lint' + phaseStep(ev.step));
      } else if (HEAL_STATUSES.has(ev.status)) {
        // 自愈进度：实时反映「验证失败→重试修复→通过/耗尽」
        toggleThinking(true, healLabel(ev) + phaseStep(ev.step));
        showHealBanner(ev);
        // 终态（成功/耗尽/异常）收起横幅，让出消息区空间
        if (ev.status === 'heal_pass' || ev.status === 'heal_exhausted' || ev.status === 'heal_error') {
          setTimeout(hideHealBanner, ev.status === 'heal_pass' ? 2500 : 6000);
        }
      } else {
        toggleThinking(true, (ev.status === 'pass' ? '验证通过' : ev.status === 'fail' ? '验证失败' : '验证异常') + phaseStep(ev.step));
        hideHealBanner(); // 普通验证结束也确保横幅收起
      }
      appendVerify(ev);
      break;

    case 'compact':
      // 上下文压缩（长任务时触发，此前前端未处理）
      toggleThinking(true, '压缩上下文 · 摘要历史' + phaseStep(ev.step));
      appendStep('system', '↧ ' + (ev.msg || '上下文已压缩'));
      break;

    case 'plan':
      // 规划模式最终返回的执行计划：渲染为答案卡片，并追加「确认执行」按钮
      // 形成二段式闭环——用户确认后以 mode:'execute' 重发原始消息（history 自动含本计划）。
      toggleThinking(false);
      finalizeAnswer(ev.content, true);
      appendPlanActions();
      break;

    case 'ask_user_request':
      // 模型通过 ask_user 向用户提问（此前前端未处理）
      toggleThinking(true, '等待你回答…');
      showAskUser(ev);
      break;

    case 'error':
      appendStep('error', '⚠ ' + ev.msg + (ev.content ? '\n' + ev.content : ''));
      break;
  }
}

// 阶段标签里的「第 N 步」后缀（模型每轮工具循环 +1），让长任务进度可见
function phaseStep(step) {
  return typeof step === 'number' && step > 0 ? `（第 ${step} 步）` : '';
}

// 自愈闭环相关状态集合与中文标签（验证失败后自动重试修复进度）
const HEAL_STATUSES = new Set(['heal_start', 'heal_attempt', 'heal_pass', 'heal_exhausted', 'heal_error']);
function healLabel(ev) {
  switch (ev.status) {
    case 'heal_start': return '自愈启动 · 验证失败，准备重试';
    case 'heal_attempt': return '自愈中 · 模型修复代码（退避后重试）';
    case 'heal_pass': return '自愈成功 · 验证通过';
    case 'heal_exhausted': return '自愈耗尽 · 重试次数用尽仍未通过';
    case 'heal_error': return '自愈异常';
    default: return '自愈';
  }
}

// ---------- 图片粘贴 / 拖拽（仅随消息发送，不落工作目录） ----------
const pendingImages = []; // [{ name, dataUrl, b64 }]

// 点击「＋ 图片」直接选择图片
const imgInput = $('#img-input');
if (imgInput) {
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
}

function addImage(dataUrl, name) {
  const b64 = dataUrl.split(',')[1];
  if (!b64) return;
  pendingImages.push({ name: name || 'image.png', dataUrl, b64 });
  renderImageThumbs();
  renderSessionState();
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
    x.onclick = () => { pendingImages.splice(i, 1); renderImageThumbs(); renderSessionState(); };
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

// 最近一次用户消息文本，供 plan 模式「确认执行」二段式复用（此时输入框可能已清空）
let lastUserMessage = '';
// 标记当前中止是否由用户主动触发（用于区分「用户中止」与「连接真正失败」）
let userAborted = false;

// ---------- 结构化历史（U3：解耦 DOM 收集） ----------
// 历史以结构化数组为权威来源：每轮 user/assistant 提交时 push，发送时直接切片上报，
// 不再从 #messages 的 .msg 节点文本 scrape，避免渲染结构变化影响上下文收集。
const HISTORY_LIMIT = 20; // 与后端 validHistory 上限一致，仅保留最近 N 轮
function pushHistory(role, content, mid) {
  if (!content || !content.trim()) return;
  state.history.push({ role, content: content.trim(), mid: mid || null });
  // 仅保留最近 HISTORY_LIMIT 条，避免无限增长
  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(state.history.length - HISTORY_LIMIT);
  }
}
// 用后端返回的结构化消息（加载历史对话时）重建前端 history
// mids：与渲染顺序对应的消息 id 数组，使「单条移出上下文」在加载后仍然生效
function loadHistoryFromMessages(messages, mids) {
  const list = (messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .slice(-HISTORY_LIMIT);
  state.history = list.map((m, i) => ({ role: m.role, content: m.content.trim(), mid: (mids && mids[i]) || null }));
}

// ---------- 发送请求（SSE 流式读取） ----------
async function send(opts = {}) {
  // 发起全新请求：清除上一次可能遗留的中止标志，避免新请求的初始事件被误丢弃
  requestAborted = false;
  userAborted = false;
  // 二段式闭环：plan 确认执行时传入原始消息文本（此时输入框可能已清空）
  const text = (opts.message != null ? opts.message : inputEl.value).trim();
  if (state.busy) return;
  if (!text && pendingImages.length === 0) return; // 文+图至少一项
  if (text) lastUserMessage = text; // 记录最近一次用户消息，供 plan 确认执行复用

  const convId = state.conversationId;

  const imgs = pendingImages.slice();
  inputEl.value = '';
  autoResizeInput();
  pendingImages.length = 0;
  renderImageThumbs();

  // 发图片时检测当前模型是否支持视觉：不支持则在状态栏模型名上提示
  if (imgs.length > 0) {
    const model = (state.activeModel || state.defaultModel || '').toLowerCase();
    const isVision = /vision|gemma|llava|bakllava|minicpm|moondream|cogvlm/i.test(model);
    if (!isVision) {
      showSimpuiToast('提示', '当前模型可能不支持图片识别，建议切换到 gemma3:4b 等视觉模型');
    }
  }

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

  const um = appendUser(text || '（图片）', imgs);
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

  // 收集对话历史（结构化，最近 HISTORY_LIMIT 条，不含当前输入）供模型感知上下文。
  // U3：直接读 state.history（权威来源），不再从 DOM .msg 节点 scrape。
  // 被「单条移出上下文」的消息（mid 在 excludedMids 中）从上报历史中剔除。
  let history = state.history.filter((h) => !h.mid || !state.excludedMids.has(h.mid)).slice(-HISTORY_LIMIT);
  // 当前用户输入不计入历史（它是本次请求本身），发送后再作为一轮 user 提交入栈。
  const body = { message: text, images: imgs.map((i) => i.b64), history };
  // 二段式闭环：plan 模式下用户点「确认执行」时，显式声明 execute 跳过自动判定，
  // 避免 auto 模式因同一复杂消息再次进 plan 造成死循环。
  if (opts.overrideMode) body.mode = opts.overrideMode;
  if (state.conversationId) body.conversationId = state.conversationId;
  if (state.activeModel) body.model = state.activeModel;    // 下拉选中的模型
  const oh = ollamaHost(); if (oh) body.ollamaHost = oh;     // 前端覆盖 Ollama 地址

  // 生效沙箱根：已绑定的绝对路径优先；否则设置页绝对路径；否则本地浏览目录名
  const boundAbs = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  if (!boundAbs) {
    const sAbs = (settingsRoot() && isAbs(settingsRoot())) ? settingsRoot() : null;
    if (sAbs) state.currentProjectRoot = sAbs;
  }
  const effRoot = boundAbs || state.currentProjectRoot || settingsRoot() || (typeof browseRoot !== 'undefined' ? browseRoot : '');
  if (effRoot) body.projectRoot = effRoot;
  if (!state.sessionStats.startTs) state.sessionStats.startTs = Date.now();
  updateProjectRootUI();

  // U3：当前用户输入作为一轮 user 提交入栈（不含在上方发送的 history 内）。
  // 必须在构造 body 之后调用，确保本次请求不带自己。带 mid 以支持单条移出上下文。
  pushHistory('user', text, um ? um.dataset.mid : null);

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
      // 用户主动中止不视为错误，不追加错误节点（半截卡片已在 abortCurrentRequest 清理）
      if (!userAborted) appendStep('error', '⚠ 已中止');
    } else {
      appendStep('error', '读取响应失败: ' + e.message);
    }
  } finally {
    currentAbortController = null;
    // 无论成功/失败/断开，都必须恢复输入框，避免一直 disabled
    setBusy(false);
  }
}

// plan 模式二段式闭环：在计划答案卡片末尾追加操作按钮。
// - 「确认执行」：以 mode:'execute' 重发原始用户消息，history 自动含本计划，模型按计划实施。
// - 「修改后执行」：把原始消息填回输入框，用户改完自行发送（同样会被 auto 判定，可再确认）。
function appendPlanActions() {
  // 取最后一个 agent 答案卡片：用 querySelectorAll 末尾项，比 :last-of-type 配合类选择器稳健
  // （:last-of-type 只看元素类型位置、不看类，若末尾 .msg 非 answer-card 会匹配失败）
  const cards = document.querySelectorAll('.msg.agent.answer-card');
  const card = cards[cards.length - 1];
  if (!card || card.querySelector('.plan-actions')) return; // 防重复追加
  const wrap = el('div', 'plan-actions');
  const confirm = el('button', 'simpui-btn primary sm', '✅ 确认执行');
  confirm.onclick = () => {
    wrap.remove();
    send({ overrideMode: 'execute', message: lastUserMessage });
  };
  const edit = el('button', 'simpui-btn secondary sm', '✏️ 修改后执行');
  edit.onclick = () => {
    wrap.remove();
    inputEl.value = lastUserMessage;
    autoResizeInput();
    inputEl.focus();
  };
  wrap.appendChild(confirm);
  wrap.appendChild(edit);
  card.appendChild(wrap);
}

// ---------- 中止当前请求 ----------
function abortCurrentRequest() {
  requestAborted = true;
  userAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  // 清理未完成的流式答案卡片：中止发生在 finalize 之前时，state.streamingAnswer
  // 仍指向半截卡片。若不清理，它会被下次发消息的 history 收集当成一条残缺的
  // assistant 回答，并因 ensureMessageContainer 复用旧卡片而把新输出追加进去，
  // 造成上下文错位/顺序混乱。已 finalize 的卡片 streamingAnswer 已置 null，不误删。
  if (state.streamingAnswer) {
    const card = state.streamingAnswer.closest('.msg.agent.answer-card');
    if (card && card.parentNode) card.parentNode.removeChild(card);
    state.streamingAnswer = null;
    state.streamingSteps = null;
    state.streamingText = '';
    state.streamingHead = null;
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
    sendBtn.innerHTML = '<i data-lucide="send" class="send-icon"></i><span>发送</span>';
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
    // 区分连接/思考状态
    thinkingEl.classList.toggle('connecting', msg === '正在连接');
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
