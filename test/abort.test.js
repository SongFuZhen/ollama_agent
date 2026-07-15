'use strict';

// 后端真正取消机制（AbortController + signal）单元测试（纯逻辑，无需 Ollama）
// 运行：node --test test/abort.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runAgent } = require('../src/core/agent');
const { makeAbortError } = require('../src/core/ollama');

// 用一个本地 http 服务模拟 Ollama，验证 chatStream 在 signal abort 时
// 立即 reject 带 ABORTED 标记（真正断开连接，而非挂起等待）。
const http = require('http');

test('makeAbortError 带 ABORTED 标记', () => {
  const e = makeAbortError();
  assert.equal(e.code, 'ABORTED');
  assert.match(e.message, /取消/);
});

test('runAgent: signal 已 abort 时首步即退出（不调用模型、不挂起）', async () => {
  const controller = new AbortController();
  controller.abort(); // 进入前已取消
  const events = [];
  // runAgent 需要的回调 stub（未真正触发，因 signal 在首步前已中止）
  const noop = async () => true;
  const askUser = async () => '（已中断）';
  let threw = null;
  try {
    await runAgent('重构 X 模块', { model: 'x', confirm: noop, askUser, signal: controller.signal }, (ev) => events.push(ev));
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, '应当抛出取消错误');
  assert.equal(threw.code, 'ABORTED');
  // 不应有任何工具/回答事件（模型未被调用）
  assert.ok(events.length === 0, '取消后不应产生任何事件');
});

test('chatStream: signal abort 立即 reject（ABORTED），不等待连接', async () => {
  // 起一个永远不返回数据的「Ollama」模拟服务
  const srv = http.createServer((req, res) => {
    // 故意不 end，模拟模型长时间生成
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;

  const { chatStream } = require('../src/core/ollama');
  const controller = new AbortController();

  const p = chatStream('x', [{ role: 'user', content: 'hi' }], {
    ollamaHost: 'http://127.0.0.1:' + port,
    signal: controller.signal,
  });

  // 发出后立刻取消
  setImmediate(() => controller.abort());

  let err = null;
  try { await p; } catch (e) { err = e; }
  assert.ok(err, '应当 reject');
  assert.equal(err.code, 'ABORTED');
  srv.close();
});
