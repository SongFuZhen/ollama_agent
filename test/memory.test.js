'use strict';

// 三级记忆 recall 单元测试（纯函数，无需 Ollama / 网络）
// 运行：node --test test/memory.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cosine, cosineTopK } = require('../src/memory/recall');

test('cosine: 相同向量 = 1', () => {
  const a = [1, 2, 3];
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6);
});

test('cosine: 正交向量 = 0', () => {
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-6);
});

test('cosine: 长度不匹配 = 0', () => {
  assert.strictEqual(cosine([1, 2], [1, 2, 3]), 0);
});

test('cosineTopK: 返回最相似的 K 条且无 embedding 的被跳过', () => {
  const q = [1, 0, 0];
  const rows = [
    { id: 1, content: 'a', embedding: new Float32Array([0, 1, 0]) },   // 正交，分 0
    { id: 2, content: 'b', embedding: new Float32Array([0.9, 0, 0]) }, // 最相似
    { id: 3, content: 'c', embedding: new Float32Array([0.5, 0, 0]) }, // 次相似
    { id: 4, content: 'd', embedding: null },                          // 无向量，跳过
  ];
  const top = cosineTopK(rows, Float32Array.from(q), 2);
  assert.strictEqual(top.length, 2);
  assert.strictEqual(top[0].id, 2);
  assert.strictEqual(top[1].id, 3);
});

test('cosineTopK: k 大于总数时返回全部有向量的', () => {
  const q = [1, 0];
  const rows = [
    { id: 1, content: 'a', embedding: new Float32Array([1, 0]) },
    { id: 2, content: 'b', embedding: new Float32Array([0, 1]) },
    { id: 3, content: 'c', embedding: null },
  ];
  const top = cosineTopK(rows, Float32Array.from(q), 10);
  assert.strictEqual(top.length, 2);
});
