'use strict';

// 上下文压缩：在 token 预算逼近上限时，把"中间的旧消息"压成一条系统摘要，
// 保留 system + 最近 K 条 + 摘要，避免 truncateMessages 直接硬丢早期上下文。
// 完全离线：摘要用本地 Ollama chat（与对话同模型）。Ollama 不可用时原样返回（不阻断）。

const { chat } = require('./ollama');
const { COMPACT_RECENT_K } = require('../config');

// 把若干条消息渲染成纯文本，供摘要模型消化
function render(messages) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role === 'user' ? '用户' : '助手'}：${c}`;
    })
    .join('\n');
}

/**
 * 压缩消息列表。
 * @param {Array} messages [system, ...history, userMsg]
 * @param {object} opts { model, ollamaHost, recentK, threshold }
 * @returns {Promise<Array>} 压缩后的消息列表（结构同输入）
 */
async function compactMessages(messages, opts = {}) {
  const recentK = opts.recentK || COMPACT_RECENT_K;
  const model = opts.model;
  const ollamaHost = opts.ollamaHost;

  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  // 不足以压缩：保留最近 recentK 条后已无中间段可压，则不动
  if (rest.length <= recentK) return messages;

  const recent = rest.slice(-recentK);
  const middle = rest.slice(0, rest.length - recentK);

  const summarizable = middle.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (summarizable.length === 0) return messages;

  const prompt =
    '请用简洁的中文总结以下对话片段的关键信息（已做的决定、重要代码位置、用户偏好、未完成的任务），' +
    '保留后续对话所需的事实，忽略寒暄与重复。只输出摘要正文，不要加"摘要："等前缀。\n\n' +
    render(summarizable);

  try {
    const summary = (await chat(model, [{ role: 'user', content: prompt }], ollamaHost ? { ollamaHost } : {}))
      .trim();
    if (!summary) return messages;
    const summaryMsg = { role: 'system', content: `[历史对话摘要]\n${summary}` };
    return [...systems, summaryMsg, ...recent];
  } catch (e) {
    // 摘要失败：原样返回，交给 truncateMessages 兜底
    return messages;
  }
}

module.exports = { compactMessages, render };
