'use strict';

const http = require('http');
const { OLLAMA_HOST, NUM_CTX } = require('../config');
const { hostParts, TIMEOUT_MS } = require('./ollama');

function processLine(json, state) {
  if (json.error) return json.error;
  if (json.prompt_eval_count != null) state.promptTokens = json.prompt_eval_count;
  if (json.eval_count != null) state.completionTokens = json.eval_count;
  if (!json.message) return null;
  const m = json.message;
  if (m.reasoning_content) {
    state.fullText += `<think>${m.reasoning_content}</think>`;
    if (!state.firstTokenTime) state.firstTokenTime = Date.now();
    if (state.onToken) state.onToken(`<think>${m.reasoning_content}</think>`);
  }
  if (m.content) {
    state.fullText += m.content;
    if (!state.firstTokenTime) state.firstTokenTime = Date.now();
    if (state.onToken) state.onToken(m.content);
  }
  if (m.tool_calls) state.toolCalls = m.tool_calls;
  return null;
}

// 流式调用 + Ollama 原生 tools，返回 { content, tool_calls }
async function chatStreamWithTools(model, messages, tools, opts = {}) {
  const { host, port } = hostParts(opts.ollamaHost);
  const body = JSON.stringify({ model, messages, stream: true, tools, options: { num_ctx: NUM_CTX } });
  const startTime = Date.now();
  const state = { fullText: '', toolCalls: null, promptTokens: 0, completionTokens: 0, firstTokenTime: null, onToken: opts.onToken };

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try { const err = processLine(JSON.parse(line), state); if (err) { reject(new Error(err)); return; } } catch (e) {}
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          if (buffer.trim()) {
            try { processLine(JSON.parse(buffer), state); } catch (e) {}
          }
          const total = Date.now() - startTime;
          const ttft = state.firstTokenTime ? state.firstTokenTime - startTime : total;
          if (opts.onStats) opts.onStats({ ttft, total, promptTokens: state.promptTokens, completionTokens: state.completionTokens });
          resolve({ content: state.fullText, tool_calls: state.toolCalls });
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error('Ollama 流式调用超时（>' + TIMEOUT_MS + 'ms）'));
    }, TIMEOUT_MS);

    req.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(/超时/.test(e.message) ? e.message : '无法连接 Ollama (' + (opts.ollamaHost || OLLAMA_HOST) + ')：' + (e.code || e.message)));
    });

    req.write(body);
    req.end();
  });
}

module.exports = { chatStreamWithTools };
