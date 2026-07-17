'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');

const { precheck } = require('../src/core/precheck');
const { fewShotExamples } = require('../src/core/prompts/examples');
const { allTemplates, matchTemplate, loadTemplate, parseFrontmatter } = require('../src/core/template-loader');
const { snapshot, recordMetric, recordSteps, recordTaskSuccess } = require('../src/core/metrics');
const { summarizeReadFile, summarizeBash } = require('../src/tools/utils');

test('precheck: read_file 不存在应被拦截', async () => {
  const r = await precheck('read_file', { path: 'no/such/file.js' }, { root: process.cwd() });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /文件不存在/);
});

test('precheck: read_file 存在应通过', async () => {
  const r = await precheck('read_file', { path: 'package.json' }, { root: process.cwd() });
  assert.strictEqual(r.ok, true);
});

test('precheck: 数字参数类型错误应被拦截', async () => {
  const r = await precheck('read_lines', { path: 'package.json', start: 'abc' }, { root: process.cwd() });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /数字/);
});

test('precheck: 写类工具未存在文件不拦截（用于新建）', async () => {
  const r = await precheck('write_file', { path: 'new/file.js', content: 'x' }, { root: process.cwd() });
  assert.strictEqual(r.ok, true);
});

test('fewShotExamples: 仅返回可用工具示例', () => {
  const specs = [{ name: 'read_file', params: { path: 'a' }, desc: '' }, { name: 'weird_tool', params: {}, desc: '' }];
  const ex = fewShotExamples(specs);
  assert.match(ex, /read_file/);
  assert.doesNotMatch(ex, /weird_tool/);
});

test('template-loader: 关键词匹配 fix-bug', () => {
  const t = matchTemplate('帮我修复这个 bug，运行报错');
  assert.ok(t);
  assert.strictEqual(t.name, 'fix-bug');
});

test('template-loader: 无命中返回 null', () => {
  assert.strictEqual(matchTemplate('今天天气真好'), null);
});

test('template-loader: 按名称加载', () => {
  const t = loadTemplate('add-function');
  assert.ok(t);
  assert.strictEqual(t.name, 'add-function');
  assert.match(t.body, /新增函数/);
});

test('template-loader: allTemplates 至少 4 个', () => {
  assert.ok(allTemplates().length >= 4);
});

test('template-loader: parseFrontmatter 解析 name/keywords', () => {
  const raw = '---\nname: x\ntitle: X\nkeywords: a, b, c\n---\nbody text';
  const { meta, body } = parseFrontmatter(raw);
  assert.strictEqual(meta.name, 'x');
  assert.deepStrictEqual(meta.keywords, ['a', 'b', 'c']);
  assert.strictEqual(body, 'body text');
});

test('metrics: recordMetric/snapshot 累计', () => {
  const before = snapshot().total_calls;
  recordMetric('total_calls');
  recordMetric('json_parse_failures');
  const after = snapshot();
  assert.strictEqual(after.total_calls, before + 1);
  assert.strictEqual(after.json_parse_failures, 1);
  assert.ok(after.json_parse_failure_rate > 0);
});

test('metrics: recordSteps 不抛错', () => {
  assert.doesNotThrow(() => recordSteps(3, { model: 'x' }));
});

test('metrics: recordTaskSuccess 更新成功率', () => {
  const before = snapshot().task_total;
  recordTaskSuccess(true);
  assert.strictEqual(snapshot().task_total, before + 1);
});

test('summarizeReadFile: 小文件原样返回', () => {
  const small = 'line1\nline2\nline3';
  assert.strictEqual(summarizeReadFile(small), small);
});

test('summarizeReadFile: 大文件摘要化并保留头尾', () => {
  const lines = Array.from({ length: 300 }, (_, i) => 'L' + i);
  const out = summarizeReadFile(lines.join('\n'));
  assert.match(out, /L0/);            // 头部保留
  assert.match(out, /L299/);          // 尾部保留
  assert.match(out, /省略/);
});

test('summarizeBash: 长输出保留头尾与错误行', () => {
  const lines = [];
  for (let i = 0; i < 80; i++) lines.push('normal ' + i);
  lines.push('Error: something failed');
  const out = summarizeBash(lines.join('\n'));
  assert.match(out, /normal 0/);
  assert.match(out, /Error: something failed/);
  assert.match(out, /省略/);
});

// 用本地 mock Ollama 跑一次 runAgent，验证 no-call 答案路径能正常调用 recordSteps（不抛 ReferenceError）
test('runAgent: 纯文本回答走 no-call 路径并埋点（mock Ollama）', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: '这是一个不需要调用工具的普通回答。' }, done: true }) + '\n');
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const host = 'http://127.0.0.1:' + port;

  const { runAgent } = require('../src/core/agent');
  const { snapshot } = require('../src/core/metrics');
  const before = snapshot().total_calls;
  const events = [];
  await runAgent('你好', { model: 'x', confirm: async () => true, askUser: async () => 'a', ollamaHost: host }, (ev) => events.push(ev));
  srv.close();

  assert.ok(events.find((e) => e.type === 'answer'), '应当产出 answer 事件');
  assert.ok(snapshot().total_calls > before, '应当记录 total_calls（证明 no-call 路径埋点生效）');
});
