'use strict';

const http = require('http');
const { OLLAMA_HOST, STEP_TIMEOUT_MS, NUM_CTX, TEMPERATURE, TOP_P } = require('../config');

// 构造 Ollama options：以 config 默认值为基准，允许单次调用通过 opts.options 覆盖
// （例如前端/测试临时调高 temperature）。小模型工具调用依赖低温度保证确定性。
function buildOptions(opts = {}) {
  return Object.assign({ num_ctx: NUM_CTX, temperature: TEMPERATURE, top_p: TOP_P }, opts.options || {});
}

// Ollama 调用超时：避免进程假死导致 Agent 循环永久挂起
// 可通过环境变量 OLLAMA_TIMEOUT_MS 覆盖（毫秒），否则用 config 默认
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || STEP_TIMEOUT_MS;

function hostParts(hostStr) {
  const src = hostStr || OLLAMA_HOST;
  // 支持 http://host:port
  const m = src.match(/^https?:\/\/([^:]+):(\d+)$/);
  if (!m) throw new Error('OLLAMA_HOST 格式应为 http://host:port，当前: ' + src);
  return { host: m[1], port: parseInt(m[2], 10) };
}

// 非流式调用，返回完整文本
// opts.ollamaHost 可选，覆盖默认 OLLAMA_HOST（前端设置面板可下发）
function chat(model, messages, opts = {}) {
  return new Promise((resolve, reject) => {
    const { host, port } = hostParts(opts.ollamaHost);
    const body = JSON.stringify({ model, messages, stream: false, options: buildOptions(opts) });
    const req = http.request(
      { host, port, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          clearTimeout(timer);
          if (!data) return reject(new Error('Ollama 返回空响应（HTTP ' + res.statusCode + '）'));
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            resolve(json.message ? json.message.content : '');
          } catch (e) { reject(new Error('Ollama 响应解析失败 (HTTP ' + res.statusCode + '): ' + data.slice(0, 200))); }
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error('Ollama 调用超时（>' + TIMEOUT_MS + 'ms），请检查 Ollama 是否假死'));
    }, TIMEOUT_MS);
    req.on('error', (e) => {
      clearTimeout(timer);
      if (/超时/.test(e.message)) {
        reject(new Error(e.message)); // 超时信息已自解释，不再套连接前缀
      } else {
        reject(new Error('无法连接 Ollama (' + (opts.ollamaHost || OLLAMA_HOST) + ')：' + (e.code || e.message)));
      }
    });
    req.write(body);
    req.end();
  });
}

// 检查 Ollama 可用的模型列表
// ollamaHost 可选，覆盖默认 OLLAMA_HOST（前端设置面板可下发）
function listModels(ollamaHost) {
  return new Promise((resolve, reject) => {
    const { host, port } = hostParts(ollamaHost);
    const req = http.request({ host, port, path: '/api/tags', method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data).models || []); }
        catch (e) { reject(new Error('Ollama /api/tags 解析失败')); }
      });
    });
    const timer = setTimeout(() => {
      req.destroy(new Error('Ollama 列表查询超时（>' + TIMEOUT_MS + 'ms），请检查 Ollama 是否假死'));
    }, TIMEOUT_MS);
    req.on('error', (e) => {
      clearTimeout(timer);
      if (/超时/.test(e.message)) {
        reject(new Error(e.message)); // 超时信息已自解释，不再套连接前缀
      } else {
        reject(new Error('无法连接 Ollama (' + (ollamaHost || OLLAMA_HOST) + ')：' + (e.code || e.message)));
      }
    });
    req.end();
  });
}

// 流式调用，每次 yield 一个 token
// opts.onToken(token) 每收到一个 token 时回调
// opts.onStats({ ttft, total, promptTokens, completionTokens }) 连接统计回调
async function chatStream(model, messages, opts = {}) {
  const { host, port } = hostParts(opts.ollamaHost);
  const body = JSON.stringify({ model, messages, stream: true, options: buildOptions(opts) });
  const startTime = Date.now();
  let firstTokenTime = null;
  let promptTokens = 0;
  let completionTokens = 0;

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let buffer = '';
        let fullText = '';

        // 从 JSON 行中提取 token 计数
        function captureTokens(json) {
          if (json.prompt_eval_count != null) promptTokens = json.prompt_eval_count;
          if (json.eval_count != null) completionTokens = json.eval_count;
        }

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          // Ollama 流式响应每行是一个 JSON 对象
          const lines = buffer.split('\n');
          buffer = lines.pop(); // 保留不完整的行

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.error) {
                reject(new Error(json.error));
                return;
              }
              captureTokens(json);
              if (json.message) {
                // 推理模型（deepseek-r1 / qwen3 等）把思考内容放在 reasoning_content，
                // 统一转成 <think>...</think> 文本交给上层，沿用已有的 think-block 检测逻辑
                if (json.message.reasoning_content) {
                  const reason = json.message.reasoning_content;
                  fullText += `<think>${reason}</think>`;
                  if (!firstTokenTime) firstTokenTime = Date.now();
                  if (opts.onToken) opts.onToken(`<think>${reason}</think>`);
                }
                if (json.message.content) {
                  const token = json.message.content;
                  fullText += token;
                  if (!firstTokenTime) firstTokenTime = Date.now();
                  if (opts.onToken) opts.onToken(token);
                }
              }
            } catch (e) {
              // 忽略解析错误，可能是不完整的行
            }
          }
        });

        res.on('end', () => {
          clearTimeout(timer);
          // 处理缓冲区中剩余的数据
          if (buffer.trim()) {
            try {
              const json = JSON.parse(buffer);
              captureTokens(json);
              if (json.message) {
                if (json.message.reasoning_content) {
                  const reason = json.message.reasoning_content;
                  fullText += `<think>${reason}</think>`;
                  if (!firstTokenTime) firstTokenTime = Date.now();
                  if (opts.onToken) opts.onToken(`<think>${reason}</think>`);
                }
                if (json.message.content) {
                  const token = json.message.content;
                  fullText += token;
                  if (!firstTokenTime) firstTokenTime = Date.now();
                  if (opts.onToken) opts.onToken(token);
                }
              }
            } catch (e) {}
          }
          const total = Date.now() - startTime;
          const ttft = firstTokenTime ? firstTokenTime - startTime : total;
          if (opts.onStats) opts.onStats({ ttft, total, promptTokens, completionTokens });
          resolve(fullText);
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error('Ollama 流式调用超时（>' + TIMEOUT_MS + 'ms）'));
    }, TIMEOUT_MS);

    req.on('error', (e) => {
      clearTimeout(timer);
      if (/超时/.test(e.message)) {
        reject(new Error(e.message));
      } else {
        reject(new Error('无法连接 Ollama (' + (opts.ollamaHost || OLLAMA_HOST) + ')：' + (e.code || e.message)));
      }
    });

    req.write(body);
    req.end();
  });
}

// 本地 embedding：走 Ollama /api/embeddings（不引 npm 包、纯离线）
// model 默认 nomic-embed-text（维度 768）；缺失时上层降级为关键词检索。
function embed(text, opts = {}) {
  return new Promise((resolve, reject) => {
    const { host, port } = hostParts(opts.ollamaHost);
    const model = opts.model || process.env.EMBED_MODEL || 'nomic-embed-text';
    const body = JSON.stringify({ model, prompt: text });
    const req = http.request(
      { host, port, path: '/api/embeddings', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          clearTimeout(timer);
          if (!data) return reject(new Error('Ollama embeddings 返回空'));
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            const emb = json.embedding;
            if (!Array.isArray(emb)) return reject(new Error('Ollama embeddings 无 embedding 字段'));
            resolve(emb);
          } catch (e) { reject(new Error('Ollama embeddings 解析失败: ' + data.slice(0, 200))); }
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error('Ollama embeddings 超时（>' + TIMEOUT_MS + 'ms）'));
    }, TIMEOUT_MS);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('无法连接 Ollama (' + (opts.ollamaHost || OLLAMA_HOST) + ')：' + (e.code || e.message)));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { chat, chatStream, listModels, embed, hostParts, TIMEOUT_MS };
