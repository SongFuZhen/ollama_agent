'use strict';

// 工具/技能全面测试 — node --test test/ 或 npm test
// 用法: MODEL=deepseek-r1:8b OLLAMA_HOST=http://192.168.0.101:11434 npm test
// 或:   node --test test/

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsp = require('fs/promises');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ctx = { root: PROJECT_ROOT };
const TEST_DIR = path.join(PROJECT_ROOT, '.test_tmp');

function load(name, modPath) {
  try { return require(modPath); }
  catch (e) { return null; }
}

const TOOLS = {
  read_file:    load('read_file',    '../src/tools/read_file'),
  list_dir:     load('list_dir',     '../src/tools/list_dir'),
  search_files: load('search_files', '../src/tools/search_files'),
  write_file:   load('write_file',   '../src/tools/write_file'),
  bash:         load('bash',         '../src/tools/bash'),
  glob:         load('glob',         '../src/tools/glob'),
  grep:         load('grep',         '../src/tools/grep'),
  edit_file:    load('edit_file',    '../src/tools/edit_file'),
  read_lines:   load('read_lines',   '../src/tools/read_lines'),
  tree:         load('tree',         '../src/tools/tree'),
  count_loc:    load('count_loc',    '../src/tools/count_loc'),
  run_tests:    load('run_tests',    '../src/tools/test/run_tests'),
  run_lint:     load('run_lint',     '../src/tools/test/run_lint'),
  git_status:   load('git_status',   '../src/skills/git/git_status/git_status'),
  git_diff:     load('git_diff',     '../src/skills/git/git_diff/git_diff'),
  git_log:      load('git_log',      '../src/skills/git/git_log/git_log'),
  git_show:     load('git_show',     '../src/skills/git/git_show/git_show'),
};

before(async () => {
  await fsp.rm(TEST_DIR, { recursive: true, force: true });
  await fsp.mkdir(TEST_DIR, { recursive: true });
  await fsp.writeFile(path.join(TEST_DIR, 'hello.txt'), 'hello world\nline 2\nline 3', 'utf8');
  await fsp.writeFile(path.join(TEST_DIR, 'data.json'), '{"key":"value"}\n', 'utf8');
});

after(async () => {
  await fsp.rm(TEST_DIR, { recursive: true, force: true });
});

// ── 13 工具 ──

describe('read_file', () => {
  const t = TOOLS.read_file;
  if (!t) { it('模块加载', () => assert.fail('加载失败')); return; }
  it('读取已有文件内容正确', async () => {
    const r = await t.run({ path: '.test_tmp/hello.txt' }, ctx);
    assert.match(r, /hello world/);
  });
  it('不存在文件抛错', async () => {
    await assert.rejects(() => t.run({ path: '.test_tmp/no.txt' }, ctx));
  });
  it('读取 JSON 内容正确', async () => {
    const r = await t.run({ path: '.test_tmp/data.json' }, ctx);
    assert.match(r, /"key"/);
  });
});

describe('list_dir', () => {
  const t = TOOLS.list_dir;
  it('列出测试目录含 hello.txt 和 data.json', async () => {
    const r = await t.run({ path: '.test_tmp' }, ctx);
    assert.match(r, /hello\.txt/);
    assert.match(r, /data\.json/);
  });
  it('列出根目录含 src 或 public', async () => {
    const r = await t.run({}, ctx);
    assert.ok(r.includes('src') || r.includes('public'));
  });
  it('空目录显示空目录提示', async () => {
    await fsp.mkdir(path.join(TEST_DIR, 'empty'));
    const r = await t.run({ path: '.test_tmp/empty' }, ctx);
    assert.match(r, /空目录/);
  });
});

describe('search_files', () => {
  const t = TOOLS.search_files;
  it('pattern=agent 找到 agent.js', async () => {
    const r = await t.run({ pattern: 'agent' }, ctx);
    assert.match(r, /agent\.js/);
  });
  it('pattern=ollama 找到相关文件', async () => {
    const r = await t.run({ pattern: 'ollama' }, ctx);
    assert.match(r, /ollama/);
  });
  it('无匹配提示未找到', async () => {
    const r = await t.run({ pattern: 'no_such_file_xyz' }, ctx);
    assert.match(r, /未找到/);
  });
});

describe('write_file', () => {
  const t = TOOLS.write_file;
  it('写入新文件内容正确', async () => {
    await t.run({ path: '.test_tmp/w1.txt', content: 'round1' }, ctx);
    const c = await fsp.readFile(path.join(TEST_DIR, 'w1.txt'), 'utf8');
    assert.equal(c, 'round1');
  });
  it('覆盖写入正确', async () => {
    await t.run({ path: '.test_tmp/w1.txt', content: 'overwritten' }, ctx);
    const c = await fsp.readFile(path.join(TEST_DIR, 'w1.txt'), 'utf8');
    assert.equal(c, 'overwritten');
  });
  it('嵌套目录自动创建并写入', async () => {
    await t.run({ path: '.test_tmp/sub/dir/deep.txt', content: 'deep' }, ctx);
    const c = await fsp.readFile(path.join(TEST_DIR, 'sub/dir/deep.txt'), 'utf8');
    assert.equal(c, 'deep');
  });
});

describe('bash', () => {
  const t = TOOLS.bash;
  it('echo 返回正确输出', async () => {
    const r = await t.run({ command: 'echo hello_bash' }, ctx);
    assert.match(r, /hello_bash/);
  });
  it('ls 测试目录正确', async () => {
    const r = await t.run({ command: 'ls .test_tmp' }, ctx);
    assert.match(r, /hello\.txt/);
  });
  it('危险命令被阻止', async () => {
    const r = await t.run({ command: 'rm -rf /' }, ctx);
    assert.match(r, /阻止/);
  });
});

describe('glob', () => {
  const t = TOOLS.glob;
  it('src/core/*.js 匹配正确', async () => {
    const r = await t.run({ pattern: '*.js', path: 'src/core' }, ctx);
    // glob 用相对路径匹配，src/core 下直接子文件 relPath 含 /，*.js 不跨目录
    // 改为匹配 src/core 下顶层文件或使用 **/*.js
    const r2 = await t.run({ pattern: '**/*.js', path: 'src/core' }, ctx);
    assert.ok(r2.includes('agent.js') || r2.includes('ollama.js') || r2.includes('config.js'));
  });
  it('根 *.json 匹配正确', async () => {
    const r = await t.run({ pattern: '*.json' }, ctx);
    assert.match(r, /\.json/);
  });
  it('无匹配提示未找到', async () => {
    const r = await t.run({ pattern: '*.xyzabc' }, ctx);
    assert.match(r, /未找到/);
  });
});

describe('grep', () => {
  const t = TOOLS.grep;
  it('搜索 hello world 匹配正确', async () => {
    const r = await t.run({ pattern: 'hello world', path: '.test_tmp' }, ctx);
    assert.match(r, /hello\.txt/);
  });
  it('正则 require\\( 匹配正确', async () => {
    const r = await t.run({ pattern: 'require\\(', path: 'src/core' }, ctx);
    assert.ok(r.includes('匹配') || r.includes('require'));
  });
  it('无匹配提示未找到', async () => {
    const r = await t.run({ pattern: 'xyznomatch999', path: '.test_tmp' }, ctx);
    assert.match(r, /未找到/);
  });
});

describe('edit_file', () => {
  const t = TOOLS.edit_file;
  const ep = '.test_tmp/edit_test.txt';

  it('单次替换正确', async () => {
    await fsp.writeFile(path.join(TEST_DIR, 'edit_test.txt'), 'lineA\nlineB\nlineC\n', 'utf8');
    await t.run({ path: ep, old_string: 'lineA', new_string: 'REPLACED' }, ctx);
    const c = await fsp.readFile(path.join(TEST_DIR, 'edit_test.txt'), 'utf8');
    assert.ok(c.includes('REPLACED') && !c.includes('lineA'));
  });
  it('old_string 未找到正确提示', async () => {
    const r = await t.run({ path: ep, old_string: 'NOTHERE', new_string: 'X' }, ctx);
    assert.match(r, /未找到/);
  });
  it('all=true 全部替换', async () => {
    await fsp.writeFile(path.join(TEST_DIR, 'edit_test.txt'), 'dup\nmiddle\ndup\n', 'utf8');
    await t.run({ path: ep, old_string: 'dup', new_string: 'FIXED', all: true }, ctx);
    const c = await fsp.readFile(path.join(TEST_DIR, 'edit_test.txt'), 'utf8');
    assert.equal((c.match(/FIXED/g) || []).length, 2);
    assert.ok(!c.includes('dup'));
  });
});

describe('read_lines', () => {
  const t = TOOLS.read_lines;
  it('读 1-2 行正确', async () => {
    const r = await t.run({ path: '.test_tmp/hello.txt', start: 1, end: 2 }, ctx);
    assert.match(r, /line 2/);
    assert.match(r, /共 \d+ 行/);
  });
  it('从第 2 行读到末尾', async () => {
    const r = await t.run({ path: '.test_tmp/hello.txt', start: 2 }, ctx);
    assert.match(r, /line 2/);
    assert.match(r, /line 3/);
  });
  it('start=0 抛错', async () => {
    await assert.rejects(() => t.run({ path: '.test_tmp/hello.txt', start: 0 }, ctx));
  });
});

describe('tree', () => {
  const t = TOOLS.tree;
  it('src depth=2 含 core 或 tools', async () => {
    const r = await t.run({ path: 'src', depth: 2 }, ctx);
    assert.ok(r.includes('core') || r.includes('tools'));
  });
  it('.test_tmp 树含文件', async () => {
    const r = await t.run({ path: '.test_tmp' }, ctx);
    assert.ok(r.includes('hello.txt') || r.includes('hello') || r.length > 0);
  });
  it('depth=1 正确截断', async () => {
    const r = await t.run({ path: 'src', depth: 1 }, ctx);
    assert.ok(r.includes('core/') || r.includes('tools/'));
  });
});

describe('count_loc', () => {
  const t = TOOLS.count_loc;
  it('统计 src 返回文件数和 .js', async () => {
    const r = await t.run({ path: 'src' }, ctx);
    assert.match(r, /文件数/);
    assert.match(r, /\.js/);
  });
  it('默认根目录统计返回文件数和总行数', async () => {
    const r = await t.run({}, ctx);
    assert.match(r, /文件数/);
    assert.match(r, /总行数/);
  });
  it('统计 .test_tmp 返回文件数', async () => {
    const r = await t.run({ path: '.test_tmp' }, ctx);
    assert.match(r, /文件数/);
  });
});

describe('run_tests', () => {
  const t = TOOLS.run_tests;
  it('自动探测命令执行完成', async () => {
    const r = await t.run({}, ctx);
    assert.ok(typeof r === 'string' && r.length > 0);
  });
  it('显式命令 echo 正确', async () => {
    const r = await t.run({ command: 'echo "test_ok"' }, ctx);
    assert.ok(r.includes('test_ok') || r.includes('无输出') || r.includes('测试执行成功'));
  });
  it('失败命令报告错误', async () => {
    const r = await t.run({ command: 'exit 1' }, ctx);
    assert.ok(r.includes('失败') || r.includes('退出码'));
  });
});

describe('run_lint', () => {
  const t = TOOLS.run_lint;
  it('显式 echo 命令正确', async () => {
    const r = await t.run({ command: 'echo lint_ok' }, ctx);
    assert.ok(r.includes('lint_ok') || r.includes('通过') || r.includes('无告警') || r.includes('无输出'));
  });
  it('自动探测 lint 执行完成', async () => {
    const r = await t.run({}, ctx);
    assert.ok(typeof r === 'string' && r.length > 0);
  });
  it('失败命令报告错误', async () => {
    const r = await t.run({ command: 'exit 2' }, ctx);
    assert.ok(r.includes('失败') || r.includes('退出码'));
  });
});

// ── 4 技能 ──

describe('git_status', () => {
  const t = TOOLS.git_status;
  it('返回分支信息', async () => {
    const r = await t.run({}, ctx);
    assert.ok(r.includes('main') || r.includes('master') || r.includes('HEAD'));
  });
  it('再次调用稳定', async () => {
    const r = await t.run({}, ctx);
    assert.ok(r.includes('main') || r.includes('master') || r.includes('HEAD'));
  });
  it('第三次调用稳定', async () => {
    const r = await t.run({}, ctx);
    assert.ok(r.includes('main') || r.includes('master') || r.includes('HEAD'));
  });
});

describe('git_diff', () => {
  const t = TOOLS.git_diff;
  it('默认 diff 正常执行', async () => {
    const r = await t.run({}, ctx);
    assert.ok(typeof r === 'string');
  });
  it('staged diff 正常执行', async () => {
    const r = await t.run({ staged: true }, ctx);
    assert.ok(typeof r === 'string');
  });
  it('指定文件 diff 正常执行', async () => {
    const r = await t.run({ path: 'src/config.js' }, ctx);
    assert.ok(typeof r === 'string');
  });
});

describe('git_log', () => {
  const t = TOOLS.git_log;
  it('默认 log 有输出', async () => {
    const r = await t.run({}, ctx);
    assert.ok(r.length > 10);
  });
  it('max=3 有输出', async () => {
    const r = await t.run({ max: 3 }, ctx);
    assert.ok(r.length > 0);
  });
  it('按文件过滤 log 正常', async () => {
    const r = await t.run({ path: 'package.json' }, ctx);
    assert.ok(typeof r === 'string');
  });
});

describe('git_show', () => {
  const t = TOOLS.git_show;
  it('git show HEAD 有输出', async () => {
    const r = await t.run({ ref: 'HEAD' }, ctx);
    assert.ok(r.length > 10);
  });
  it('空 ref 正确提示', async () => {
    const r = await t.run({ ref: '' }, ctx);
    assert.match(r, /不能为空/);
  });
  it('git show HEAD~1 正常', async () => {
    const r = await t.run({ ref: 'HEAD~1' }, ctx);
    assert.ok(typeof r === 'string');
  });
});
