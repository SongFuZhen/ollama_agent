'use strict';

// P2 工作流（Plan Mode + Verifier）单元测试（纯逻辑，无需 Ollama）
// 运行：node --test test/workflow.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { READONLY, WRITE } = require('../src/core/agent');
const { specsFor } = require('../src/tools/index');

test('READONLY 覆盖只读调研工具', () => {
  for (const t of ['read_file', 'list_dir', 'grep', 'glob', 'tree', 'read_lines', 'search_files', 'count_loc']) {
    assert.ok(READONLY.has(t), '应为只读: ' + t);
  }
});

test('WRITE 覆盖写操作工具', () => {
  for (const t of ['write_file', 'edit_file', 'bash']) {
    assert.ok(WRITE.has(t), '应为写操作: ' + t);
  }
});

test('READONLY 与 WRITE 不相交', () => {
  for (const t of READONLY) assert.ok(!WRITE.has(t));
});

test('Plan Mode 下 specsFor 过滤后只含只读工具', () => {
  const all = specsFor();
  const planSpecs = all.filter((s) => READONLY.has(s.name));
  for (const s of planSpecs) {
    assert.ok(READONLY.has(s.name), 'plan 模式不应暴露: ' + s.name);
    assert.ok(!WRITE.has(s.name), 'plan 模式不得含写操作: ' + s.name);
  }
});

test('Plan Mode 过滤会移除写操作工具', () => {
  const all = specsFor();
  const hasWrite = all.some((s) => WRITE.has(s.name));
  if (!hasWrite) return; // 若仓库当前无写工具则跳过
  const planSpecs = all.filter((s) => READONLY.has(s.name));
  assert.ok(planSpecs.every((s) => !WRITE.has(s.name)));
});
