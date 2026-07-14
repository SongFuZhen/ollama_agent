'use strict';

// delegate 子代理委派工具：纯逻辑测试（mock runAgent，无需 Ollama / 网络）
// 运行：node --test test/delegate.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

// 加载 delegate 前，先准备好对 runAgent 的 mock。
// delegate 通过 require('../core/agent').runAgent 取函数，
// 我们在加载后直接替换该模块的导出属性即可（require 缓存共享同一对象）。
const agentMod = require('../src/core/agent');
const delegate = require('../src/tools/delegate');

let lastCall = null;
function installMock(returnValue) {
  lastCall = null;
  agentMod.runAgent = async (task, opts, emit) => {
    lastCall = { task, opts, emitType: typeof emit };
    return returnValue;
  };
}

test('delegate: 透传 task 并调用 runAgent（静默 emit）', async () => {
  installMock('子代理的结论文本');
  const ctx = { root: '/srv', model: 'deepseek-r1:8b', ollamaHost: 'http://localhost:11434' };
  const out = await delegate.run({ task: '调研一下登录模块' }, ctx);
  assert.ok(lastCall, 'runAgent 应被调用');
  assert.equal(lastCall.task, '调研一下登录模块');
  assert.equal(lastCall.emitType, 'function'); // 静默收集器
  assert.equal(lastCall.opts.model, 'deepseek-r1:8b');
  assert.equal(lastCall.opts.ollamaHost, 'http://localhost:11434');
  assert.equal(lastCall.opts.projectRoot, '/srv');
  assert.equal(lastCall.opts.mode, 'execute');
  assert.deepEqual(lastCall.opts.history, []); // 独立上下文
  assert.match(out, /子代理结论/);
  assert.match(out, /子代理的结论文本/);
});

test('delegate: tools 白名单裁剪（非法工具名被剔除）', async () => {
  installMock('ok');
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  await delegate.run({ task: 't', tools: ['read_file', 'not_a_tool', 'grep'] }, ctx);
  assert.ok(lastCall.opts.allowedTools, '应下发 allowedTools');
  assert.deepEqual(lastCall.opts.allowedTools.sort(), ['grep', 'read_file']);
});

test('delegate: tools 全非法时返回错误', async () => {
  installMock('ok');
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  const out = await delegate.run({ task: 't', tools: ['bad1', 'bad2'] }, ctx);
  assert.match(out, /没有任何合法工具名/);
  assert.equal(lastCall, null, '不应调用 runAgent');
});

test('delegate: 不传 tools 则不限（allowedTools 不下发）', async () => {
  installMock('ok');
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  await delegate.run({ task: 't' }, ctx);
  assert.equal(lastCall.opts.allowedTools, undefined);
});

test('delegate: mode=plan 透传为 plan', async () => {
  installMock('ok');
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  await delegate.run({ task: 't', mode: 'plan' }, ctx);
  assert.equal(lastCall.opts.mode, 'plan');
});

test('delegate: 超长结论被截断', async () => {
  const long = 'x'.repeat(100000);
  installMock(long);
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  const out = await delegate.run({ task: 't' }, ctx);
  assert.ok(out.length < 100000, '输出应被截断');
  assert.match(out, /已截断/);
});

test('delegate: task 为空返回错误', async () => {
  installMock('ok');
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  const out = await delegate.run({ task: '   ' }, ctx);
  assert.match(out, /task 不能为空/);
  assert.equal(lastCall, null);
});

test('delegate: runAgent 抛错时返回失败信息（不向上抛）', async () => {
  agentMod.runAgent = async () => { throw new Error('模型挂了'); };
  lastCall = 'set';
  const ctx = { root: '/srv', model: 'm', ollamaHost: 'h' };
  const out = await delegate.run({ task: 't' }, ctx);
  assert.match(out, /子代理执行失败/);
  assert.match(out, /模型挂了/);
});
