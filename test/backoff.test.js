'use strict';

// 指数退避延迟工具单元测试（纯逻辑，无网络）
// 运行：node --test test/backoff.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sleep, backoffDelay } = require('../src/core/agent');

// AbortController 为 Node >=15 内置全局
const AC = global.AbortController;

test('sleep: 基础延迟后 resolve', async () => {
  const t0 = Date.now();
  await sleep(50);
  const dt = Date.now() - t0;
  assert.ok(dt >= 45, '应等待约 50ms，实际 ' + dt);
});

test('sleep: signal 已 abort 时立即 reject(ABORTED)', async () => {
  const ac = new AC();
  ac.abort();
  await assert.rejects(() => sleep(1000, ac.signal), (e) => e.code === 'ABORTED');
});

test('sleep: 等待期间 abort 会中断', async () => {
  const ac = new AC();
  const p = sleep(10000, ac.signal);
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(() => p, (e) => e.code === 'ABORTED');
});

test('backoffDelay: 第1次=base，第2次=base*2，封顶 maxMs', async () => {
  const t0 = Date.now();
  await backoffDelay(1, { base: 100, maxMs: 500 });
  const t1 = Date.now();
  await backoffDelay(2, { base: 100, maxMs: 500 });
  const t2 = Date.now();
  const d1 = t1 - t0;
  const d2 = t2 - t1;
  assert.ok(Math.abs(d1 - 100) < 40, '第1次应≈100ms，实际 ' + d1);
  assert.ok(Math.abs(d2 - 200) < 40, '第2次应≈200ms，实际 ' + d2);
});

test('backoffDelay: 超过 maxMs 后不再增长', async () => {
  const t0 = Date.now();
  await backoffDelay(10, { base: 100, maxMs: 150 });
  const dt = Date.now() - t0;
  assert.ok(dt < 250, '封顶 150ms，实际 ' + dt);
});

test('backoffDelay: 尊重 signal，abort 即中断', async () => {
  const ac = new AC();
  const p = backoffDelay(3, { base: 1000, maxMs: 8000, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(() => p, (e) => e.code === 'ABORTED');
});
