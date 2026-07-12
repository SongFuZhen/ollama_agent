'use strict';

/* api.js - API 调用和数据存储 */

// ---------- 对话存储 API ----------
async function saveConversation() {
  const session = state.session;
  if (!session) return;
  
  const convId = state.conversationId;
  if (!convId) return;
  
  // 收集消息（包含思考链、工具调用、图片）
  const messages = [];
  session.querySelectorAll('.msg').forEach(msg => {
    const role = msg.classList.contains('user') ? 'user' : 'assistant';
    const bubble = msg.querySelector('.bubble');

    let content = '';
    if (bubble) {
      content = bubble.innerHTML || '';
    }

    // 按 DOM 顺序收集思考链与工具调用（二者都在 .steps 容器内）
    const thinks = [];
    const tools = [];
    const stepsEl = msg.querySelector('.steps');
    if (stepsEl) {
      stepsEl.querySelectorAll(':scope > *').forEach(node => {
        if (node.classList.contains('think-block')) {
          const body = node.querySelector('.think-body');
          const text = body ? body.textContent : '';
          if (text.trim()) thinks.push(text);
        } else if (node.classList.contains('tool-block')) {
          const toolName = node.querySelector('.tool-name')?.textContent || '';
          const toolParamsText = node.querySelector('.tool-params')?.textContent || '';
          const toolResult = node.querySelector('.tool-result')?.textContent || '';
          if (toolName) {
            let toolParams = {};
            try {
              toolParams = JSON.parse(toolParamsText);
            } catch (e) {
              toolParams = { raw: toolParamsText };
            }
            tools.push({ name: toolName, params: toolParams, result: toolResult });
          }
        }
      });
    }

    // 收集用户发送的图片（仅持久化路径，历史回放时由后端按 root 提供）
    const images = [];
    msg.querySelectorAll('.msg-image img').forEach(im => {
      const p = im.dataset.path;
      if (p) images.push({ path: p, name: im.alt || 'image' });
    });

    if (content || tools.length > 0 || thinks.length > 0 || images.length > 0) {
      messages.push({
        role,
        content,
        tools: tools.length > 0 ? tools : undefined,
        thinks: thinks.length > 0 ? thinks : undefined,
        images: images.length > 0 ? images : undefined,
      });
    }
  });
  
  if (messages.length === 0) return;
  
  // 标题优先用用户编辑过的对话名称，否则从首条用户消息截取
  const editedTitle = state.conversationTitle;
  const firstUserMsg = messages.find(m => m.role === 'user');
  const autoTitle = firstUserMsg ? firstUserMsg.content.slice(0, 50) : '';
  const title = (editedTitle && editedTitle.trim()) ? editedTitle.trim() : autoTitle;
  
  // 获取当前项目目录（只保存绝对路径，相对路径无法在后端使用）
  const rawRoot = state.currentProjectRoot || '';
  const projectRoot = (rawRoot && (rawRoot.startsWith('/') || /^[A-Z]:\\/i.test(rawRoot))) ? rawRoot : '';
  
  try {
    await fetch('/api/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: convId,
        title,
        projectRoot,
        messages,
      }),
    });
  } catch (e) {
    console.error('保存对话失败:', e);
  }
}

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    return await res.json();
  } catch (e) {
    console.error('加载对话列表失败:', e);
    return [];
  }
}

async function loadConversation(convId) {
  try {
    const res = await fetch(`/api/conversation/${convId}`);
    return await res.json();
  } catch (e) {
    console.error('加载对话失败:', e);
    return null;
  }
}

// ---------- 加载后端默认配置（模型名等） ----------
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    state.defaultModel = d.defaultModel || null;
    state.tools = Array.isArray(d.tools) ? d.tools : [];
  } catch (e) { console.error('loadConfig failed', e); }
}

// 记录服务端默认沙箱根（兜底显示）
function setServerDefaultRoot(root) {
  state.serverDefaultRoot = root || null;
  if (typeof updateProjectRootUI === 'function') updateProjectRootUI();
}

// ---------- 启动自检 ----------
async function preflight() {
  try {
    const oh = ollamaHost();
    const r = await fetch('/api/preflight' + (oh ? '?ollamaHost=' + encodeURIComponent(oh) : ''));
    const d = await r.json();
    
    const installed = Array.isArray(d.models) ? d.models : [];
    state.installedModels = installed;
    state.defaultModel = d.defaultModel || null;
    
    // 初始化会话
    if (!state.session) {
      mountSession();
    }
    renderModelDropdown();

    // 记录服务端默认沙箱根用于顶栏显示
    if (d.projectRoot) state.serverDefaultRoot = d.projectRoot;
    if (typeof updateProjectRootUI === 'function') updateProjectRootUI();

    // 把默认沙箱地址填入空状态的输入框
    const emptyRootInput = document.getElementById('empty-root-input');
    if (emptyRootInput && d.projectRoot && !emptyRootInput.value) {
      emptyRootInput.value = d.projectRoot;
    }

    if (typeof updateFilePanelState === 'function') updateFilePanelState(); // 按是否有根决定加载树或显示提示

    if (d.ollama !== 'ok') {
      setStatus('warn', '⚠ Ollama 不可达 (' + (d.ollamaHost || '') + '): ' + (d.error || ''));
      return;
    }
    // 优先用左侧文件面板实际绑定的项目目录（currentProjectRoot），与文件树保持一致
    const root = state.currentProjectRoot || (typeof effectiveRoot === 'function' ? effectiveRoot() : null) || d.projectRoot || '';
    setStatus('ok', `就绪 | Node ${d.node} | Ollama: ${d.ollamaHost || '?'} | 根: ${root || '未绑定'}`);
  } catch (e) {
    setStatus('err', '⚠ 无法连接服务: ' + e.message);
  }
}

// 绑定目录后刷新状态栏的「根」显示（不重跑 preflight，避免重置对话）
function refreshStatusRoot() {
  const root = state.currentProjectRoot || (typeof effectiveRoot === 'function' ? effectiveRoot() : null) || state.serverDefaultRoot || '';
  setStatus('ok', `就绪 | Node ${(typeof process !== 'undefined' && process.version) || ''} | Ollama: ${ollamaHost()} | 根: ${root || '未绑定'}`);
  if (typeof renderSessionState === 'function') renderSessionState();
}

// 项目目录绝对路径：设置页填写优先，否则回退服务端持久化根，否则默认沙箱
let serverRootCache = null; // 服务端持久化的有效根（启动拉取）
async function loadServerRoot() {
  try {
    const r = await fetch('/api/root');
    const d = await r.json();
    if (d && d.persisted && d.root) serverRootCache = d.root;
  } catch (e) { /* 忽略 */ }
}
