'use strict';

// P3 上下文管理单元测试（压缩逻辑，mock Ollama chat）
// 运行：node --test test/context.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// mock ../core/ollama 的 chat，避免真实网络
const fakeSummary = '用户想重构登录模块，已确认用 JWT，token 刷新放在 middleware。';
let MOCK_FAIL = false; // 通过开关模拟 Ollama 失败
const ollamaMock = { chat: async () => { if (MOCK_FAIL) throw new Error('boom'); return fakeSummary; } };
const origLoad = Module._load;
Module._load = function (request, parent, ...args) {
  // 拦截所有解析到 src/core/ollama 的加载（compact.js 用 './ollama' 相对路径）
  if (request === './ollama' && parent && /core[\\/]agent\.js$|core[\\/]compact\.js$/.test(parent.filename)) {
    return ollamaMock;
  }
  return origLoad.call(this, request, parent, ...args);
};

const { compactMessages } = require('../src/core/compact');
const { truncateMessages } = require('../src/core/agent');

test('compactMessages: 消息少时不压缩', async () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ];
  const out = await compactMessages(msgs, { model: 'x' });
  assert.strictEqual(out.length, msgs.length);
});

test('compactMessages: 超阈值时中间段被摘要成一条 system', async () => {
  const msgs = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 20; i++) {
    // 每条足够长，使粗估总 token 越过 NUM_CTX*0.7
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(1500) });
  }
  msgs.push({ role: 'user', content: '最新问题' });
  const out = await compactMessages(msgs, { model: 'x', recentK: 4 });
  const systems = out.filter((m) => m.role === 'system');
  assert.ok(systems.length >= 2, '应至少含原 system + 摘要 system');
  assert.ok(systems.some((m) => m.content.includes('[历史对话摘要]')), '应有一条摘要 system');
  // 最近一条保留
  assert.strictEqual(out[out.length - 1].content, '最新问题');
});

test('compactMessages: Ollama 失败时原样返回', async () => {
  MOCK_FAIL = true;
  try {
    const msgs = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 20; i++) msgs.push({ role: 'user', content: 'x'.repeat(200) });
    const out = await compactMessages(msgs, { model: 'x' });
    assert.strictEqual(out.length, msgs.length);
  } finally {
    MOCK_FAIL = false;
  }
});

test('truncateMessages: 真实 knownPromptTokens 已知超限时直接丢弃 user', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a'.repeat(100000) },
  ];
  // 设一个很大的真实 token 数：上下文确实超出预算，user 应被丢弃（不再强塞兜底）
  const out = truncateMessages(msgs, 2048, 99999);
  const user = out.find((m) => m.role === 'user');
  assert.strictEqual(user, undefined, '真实 token 已超限，user 应被丢弃');
  assert.ok(out.some((m) => m.role === 'system'), 'system 仍保留');
});

test('truncateMessages: 无真实数且 user 过大时兜底截断保留一条 user', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a'.repeat(100000) },
  ];
  // 无真实数：靠粗估，system 把 budget 占满时兜底至少保留一条截断后的 user
  const out = truncateMessages(msgs, 2048, null);
  const user = out.find((m) => m.role === 'user');
  assert.ok(user, '无真实数时兜底应保留一条 user');
  assert.ok(user.content.length < 100000, '超限的 user 内容应被截断');
});

test('truncateMessages: 无真实数时回退粗估', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'short' },
  ];
  const out = truncateMessages(msgs, 2048, null);
  assert.strictEqual(out.length, 2);
});
