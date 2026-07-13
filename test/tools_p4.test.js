'use strict';

// P4 工具丰富单元测试（纯逻辑，无需 Ollama / 网络）
// 运行：node --test test/tools_p4.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const applyDiff = require('../src/tools/apply_diff');
const { parseDiff, applyHunks } = applyDiff;
const semantic = require('../src/tools/semantic_grep');
const { tokenize, overlap } = semantic;
const repoMap = require('../src/tools/repo_map');
const { extractSymbols } = repoMap;
const notes = require('../src/tools/notes');
const todos = require('../src/tools/todos');
const db = require('../src/storage/db');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-test-'));
const ctx = { root: TMP };

test('apply_diff: 解析单文件 unified diff', () => {
  const diff = [
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,3 +1,3 @@',
    ' line1',
    '-old2',
    '+new2',
    ' line3',
  ].join('\n');
  const files = parseDiff(diff);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].file, 'foo.txt');
  const h = files[0].hunks[0];
  assert.strictEqual(h.old.join('\n'), 'line1\nold2\nline3');
  assert.strictEqual(h.neu.join('\n'), 'line1\nnew2\nline3');
});

test('apply_diff: 应用并真正落盘（经 run）', async () => {
  const f = path.join(TMP, 'apply1.txt');
  fs.writeFileSync(f, 'a\nb\nc\n');
  const diff = [
    '--- a/apply1.txt',
    '+++ b/apply1.txt',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
  ].join('\n');
  const r = await applyDiff.run({ diff }, ctx);
  assert.ok(/已应用 diff 到 1 个文件/.test(r));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'a\nB\nc');
});

test('apply_diff: 上下文不匹配时拒绝并回滚', async () => {
  const f = path.join(TMP, 'apply2.txt');
  fs.writeFileSync(f, 'DIFFERENT\n');
  const diff = [
    '--- a/apply2.txt',
    '+++ b/apply2.txt',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
  ].join('\n');
  const r = await applyDiff.run({ diff }, ctx);
  assert.ok(/失败/.test(r));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'DIFFERENT\n'); // 未改动
});

test('apply_diff: applyHunks 基础替换', () => {
  const orig = ['a', 'b', 'c'];
  const h = { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, old: ['b'], neu: ['B'] };
  const out = applyHunks(orig, [h]);
  assert.deepStrictEqual(out, ['a', 'B', 'c']);
});

test('semantic_grep: tokenize 中英文', () => {
  const t = tokenize('const getUser 用户');
  assert.ok(t.has('const'));
  assert.ok(t.has('getuser'));
  assert.ok(t.has('用户')); // 中文按词（>=2 字）
});

test('semantic_grep: overlap Jaccard', () => {
  assert.strictEqual(overlap(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.strictEqual(overlap(new Set(['a']), new Set(['b'])), 0);
});

test('repo_map: 提取符号（含非导出顶层定义）', () => {
  const src = 'export function foo() {}\nclass Bar {}\nconst baz = 1;\nfunction notExported() {}';
  const syms = extractSymbols(src);
  assert.ok(syms.includes('foo'));
  assert.ok(syms.includes('Bar'));
  assert.ok(syms.includes('baz'));
  assert.ok(syms.includes('notExported')); // 顶层定义也提取（repo map 关注整体结构）
});

test('notes: add/list/delete 闭环', async () => {
  await db.initDB();
  const r1 = await notes.run({ action: 'add', content: '记住用 JWT' }, ctx);
  assert.ok(/已保存/.test(r1));
  const list = await notes.run({ action: 'list' }, ctx);
  assert.ok(/记住用 JWT/.test(list));
  const id = db.getNotes()[0].id;
  await notes.run({ action: 'delete', id }, ctx);
  assert.strictEqual(db.getNotes().length, 0);
});

test('todos: add/list/doing/done/delete 闭环', async () => {
  const a = await todos.run({ action: 'add', text: '重构登录' }, ctx);
  assert.ok(/已添加/.test(a));
  const id = db.getTodos()[0].id;
  assert.strictEqual(db.getTodos()[0].status, 'todo');
  await todos.run({ action: 'doing', id }, ctx);
  assert.strictEqual(db.getTodos()[0].status, 'doing');
  await todos.run({ action: 'done', id }, ctx);
  assert.strictEqual(db.getTodos()[0].status, 'done');
  await todos.run({ action: 'delete', id }, ctx);
  assert.strictEqual(db.getTodos().length, 0);
  db.closeDB();
});

test('ask_user: 空问题报错', async () => {
  const r = await require('../src/tools/ask_user').run({ question: '' }, ctx);
  assert.ok(/不能为空/.test(r));
});
