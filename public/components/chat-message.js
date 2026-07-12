// chat-message.js - 聊天消息组件
function renderChatMessage(role, content, options = {}) {
  const isUser = role === 'user';
  const msgClass = isUser ? 'msg user' : 'msg assistant';

  return `
  <div class="${msgClass}">
    <div class="bubble">${content}</div>
    ${options.thinks ? `<div class="steps">${options.thinks}</div>` : ''}
    ${options.tools ? `<div class="steps">${options.tools}</div>` : ''}
  </div>`;
}

function renderThinkBlock(content) {
  return `
  <div class="think-block" data-collapsed="false">
    <div class="think-header">
      <span class="think-label">💭 思考</span>
      <button class="think-toggle" aria-label="折叠/展开">▾</button>
    </div>
    <div class="think-body">${content}</div>
  </div>`;
}

function renderToolBlock(name, params, result) {
  const paramsStr = typeof params === 'object' ? JSON.stringify(params, null, 2) : params;
  return `
  <div class="tool-block" data-collapsed="false">
    <div class="tool-header">
      <span class="tool-name">🔧 ${name}</span>
      <button class="tool-toggle" aria-label="折叠/展开">▾</button>
    </div>
    <div class="tool-params"><pre><code>${escapeHtml(paramsStr)}</code></pre></div>
    ${result ? `<div class="tool-result"><pre><code>${escapeHtml(result)}</code></pre></div>` : ''}
  </div>`;
}
