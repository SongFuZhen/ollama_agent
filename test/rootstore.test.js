'use strict';

// 根目录校验单元测试（零依赖，使用 node:test + node:assert）
// 运行：node --test test/rootstore.test.js
// 或：  node test/rootstore.test.js  （脚本自带 runner 兜底）

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');

// 用临时目录隔离持久化文件，避免污染项目 data/ 目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rootstore-test-'));
const STORE_FILE = path.join(TMP, 'project-root.json');

// 复制 rootstore 逻辑到可控环境：直接 require 源码，但重定向其存储路径
// rootstore 内部 STORE_FILE 是模块常量，无法注入；改为用同名覆盖 + 重新加载模块不可行。
// 方案：直接调用源码函数，并在测试末尾清理其真实 data/ 文件，断言用返回值而非文件。
const rootstore = require('../src/rootstore');
const { validateRoot, saveProjectRoot, getProjectRoot, isRootPersisted } = rootstore;

const REAL_STORE = path.resolve(__dirname, '..', 'src', '..', 'data', 'project-root.json');

// 每次测试后清理可能产生的持久化文件
function cleanup() {
  for (const f of [STORE_FILE, REAL_STORE]) {
    try { fs.rmSync(f); } catch (e) {}
  }
}

// 构造一个真实存在的临时目录
function makeRealDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'realdir-'));
  return d;
}
// 构造一个真实存在的文件（非目录，用于非法校验）
function makeFile() {
  const f = path.join(TMP, 'a-file-' + Date.now() + '.txt');
  fs.writeFileSync(f, 'x');
  return f;
}

test('validateRoot: 真实存在的目录 -> 返回规范化绝对路径', async () => {
  const dir = makeRealDir();
  const got = await validateRoot(dir);
  assert.strictEqual(got, fs.realpathSync(dir));
  cleanup();
});

test('validateRoot: 不存在的路径 -> 返回 null', async () => {
  const got = await validateRoot(path.join(TMP, 'no-such-' + Date.now()));
  assert.strictEqual(got, null);
  cleanup();
});

test('validateRoot: 路径是文件而非目录 -> 返回 null', async () => {
  const f = makeFile();
  const got = await validateRoot(f);
  assert.strictEqual(got, null);
  cleanup();
});

test('validateRoot: 空串/无参 -> 返回 null', async () => {
  assert.strictEqual(await validateRoot(''), null);
  assert.strictEqual(await validateRoot(), null);
  cleanup();
});

test('validateRoot: 带 ../ 但仍落在真实目录内 -> 返回规范化路径', async () => {
  const dir = makeRealDir();
  const sub = path.join(dir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  const got = await validateRoot(path.join(sub, '..', '..'));
  assert.strictEqual(got, fs.realpathSync(dir));
  cleanup();
});

test('saveProjectRoot: 合法目录 -> ok 且持久化', async () => {
  const dir = makeRealDir();
  const r = await saveProjectRoot(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.root, fs.realpathSync(dir));
  assert.ok(fs.existsSync(REAL_STORE), '持久化文件应被写入');
  cleanup();
});

test('saveProjectRoot: 非法目录 -> ok=false 且回退默认沙箱', async () => {
  const r = await saveProjectRoot(path.join(TMP, 'no-such-' + Date.now()));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /回退默认沙箱/);
  // 持久化文件被清空（root: ""）
  const content = fs.existsSync(REAL_STORE) ? fs.readFileSync(REAL_STORE, 'utf8') : '{}';
  assert.strictEqual(JSON.parse(content).root, '');
  cleanup();
});

test('saveProjectRoot: 路径是文件 -> ok=false', async () => {
  const f = makeFile();
  const r = await saveProjectRoot(f);
  assert.strictEqual(r.ok, false);
  cleanup();
});

test('getProjectRoot: 默认回退到 PROJECT_ROOT', async () => {
  cleanup(); // 确保无持久化
  const got = await getProjectRoot();
  assert.strictEqual(got, require('../src/config').PROJECT_ROOT);
  cleanup();
});

test('getProjectRoot: 读取已持久化的有效根', async () => {
  const dir = makeRealDir();
  await saveProjectRoot(dir); // 写入持久化
  const got = await getProjectRoot();
  assert.strictEqual(got, fs.realpathSync(dir));
  cleanup();
});

test('isRootPersisted: 持久化的有效根 -> true', async () => {
  const dir = makeRealDir();
  await saveProjectRoot(dir);
  assert.strictEqual(await isRootPersisted(fs.realpathSync(dir)), true);
  cleanup();
});

test('isRootPersisted: 未持久化的目录 -> false', async () => {
  const dir = makeRealDir();
  cleanup(); // 确保干净
  assert.strictEqual(await isRootPersisted(dir), false);
  cleanup();
});
