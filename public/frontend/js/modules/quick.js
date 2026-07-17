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
    const copy = el('button', 'simpui-btn secondary sm', '复制 message');
    copy.onclick = () => {
      navigator.clipboard?.writeText(state.quickLastOutput || '').then(() => {
        showSimpuiToast('已复制', 'commit message 已复制到剪贴板');
      });
    };
    const submit = el('button', 'simpui-btn primary sm', '直接提交');
    submit.onclick = () => doQuickCommit(state.quickLastOutput || '');
    wrap.appendChild(copy);
    wrap.appendChild(submit);
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

// 用生成的 message 直接 git commit
async function doQuickCommit(message) {
  if (!message || !message.trim()) return;
  const root = (state.currentProjectRoot && isAbs(state.currentProjectRoot)) ? state.currentProjectRoot : null;
  const body = { message };
  if (root) body.projectRoot = root;
  try {
    const r = await fetch('/api/quick/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) showSimpuiToast('已提交', (d.msg && d.msg.slice(0, 80)) || '提交成功');
    else showSimpuiToast('提交失败', d.msg || 'git commit 失败');
  } catch (e) {
    showSimpuiToast('提交失败', e.message);
  }
}

// ---------- 主入口：执行一个 Toolbox 命令 ----------
async function runQuickCommand(text) {
  if (state.busy) return;
  if (!text || !text.trim()) return;

  const name = text.slice(1).split(/\s+/)[0];
  const args = parseQuickArgs(name, text.slice(1 + name.length));

  // 清空输入框
  inputEl.value = '';
  autoResizeInput();

  const um = appendUser(text, [], nextMid());
  renderSessionState();
  setBusy(true);
  toggleThinking(true, '工具箱 · 准备中');

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
    // 若命令在模型输出中途失败（未走到 quick_done），冲刷已收到的片段并复位状态，
    // 避免遗留半截答案卡片污染下一次发送。quick_done 已调用 finalize 时 streamingAnswer 为 null，跳过。
    if (state.streamingAnswer) {
      finalizeAnswer(state.streamingText || '');
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
    case 'quick_step':
      toggleThinking(true, '工具箱 · ' + quickStepText(ev.step, ev.status));
      appendStep('step', quickStepText(ev.step, ev.status) + (ev.msg ? '：' + ev.msg : ''));
      break;
    case 'quick_token':
      if (!_quickHaveAnswer) {
        ensureMessageContainer();
        _quickHaveAnswer = true;
      }
      appendToken(ev.content);
      break;
    case 'quick_done':
      state.quickLastOutput = ev.output || '';
      if (ev.apply) state.quickMeta.apply = ev.apply;
      if (!_quickHaveAnswer) {
        ensureMessageContainer();
        _quickHaveAnswer = true;
      }
      finalizeAnswer(ev.output || '');
      // 附加动作按钮（commit 复制/提交；fix/comment 应用修改）
      const card = state.session.querySelectorAll('.msg.agent.answer-card');
      appendQuickActions(card[card.length - 1], state.quickMeta);
      break;
    case 'error':
      appendStep('error', '⚠ ' + ev.msg);
      break;
  }
}

// 标记：本次 quick 命令是否已创建答案容器（避免重复 ensureMessageContainer）
let _quickHaveAnswer = false;
