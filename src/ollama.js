'use strict';

const http = require('http');
const { OLLAMA_HOST, STEP_TIMEOUT_MS } = require('./config');

// Ollama 调用超时：避免进程假死导致 Agent 循环永久挂起
// 可通过环境变量 OLLAMA_TIMEOUT_MS 覆盖（毫秒），否则用 config 默认
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || STEP_TIMEOUT_MS;

function hostParts() {
  // 支持 http://host:port
  const m = OLLAMA_HOST.match(/^https?:\/\/([^:]+):(\d+)$/);
  if (!m) throw new Error('OLLAMA_HOST 格式应为 http://host:port');
  return { host: m[1], port: parseInt(m[2], 10) };
}

// 非流式调用，返回完整文本
function chat(model, messages) {
  return new Promise((resolve, reject) => {
    const { host, port } = hostParts();
    const body = JSON.stringify({ model, messages, stream: false });
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
        reject(new Error('无法连接 Ollama (' + OLLAMA_HOST + ')：' + (e.code || e.message)));
      }
    });
    req.write(body);
    req.end();
  });
}

// 检查 Ollama 可用的模型列表
function listModels() {
  return new Promise((resolve, reject) => {
    const { host, port } = hostParts();
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
        reject(new Error('无法连接 Ollama (' + OLLAMA_HOST + ')：' + (e.code || e.message)));
      }
    });
    req.end();
  });
}

module.exports = { chat, listModels };
