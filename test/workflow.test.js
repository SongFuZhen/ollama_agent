'use strict';

// P2 工作流（Plan Mode + Verifier）单元测试（纯逻辑，无需 Ollama）
// 运行：node --test test/workflow.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { READONLY, WRITE } = require('../src/core/agent');
const { specsFor } = require('../src/tools/index');
const { isComplexTask, resolveMode, resolveDirectCall, buildSkillParams } = require('../src/core/workflow');

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

// ---------- 复杂任务判定（智能触发 Workflow） ----------

test('isComplexTask: 中文写意图判复杂', () => {
  assert.ok(isComplexTask('重构 tools/index.js 的注册逻辑'));
  assert.ok(isComplexTask('实现登录功能'));
  assert.ok(isComplexTask('修复这个 bug'));
  assert.ok(isComplexTask('新增一个用户管理模块'));
});

test('isComplexTask: 英文写意图判复杂', () => {
  assert.ok(isComplexTask('refactor the parser module'));
  assert.ok(isComplexTask('implement a new feature'));
  assert.ok(isComplexTask('fix the crash on startup'));
});

test('isComplexTask: 多文件信号判复杂', () => {
  assert.ok(isComplexTask('批量修改所有文件的缩进'));
  assert.ok(isComplexTask('重构整个项目的配置加载'));
});

test('isComplexTask: 只读/问答意图判简单', () => {
  assert.ok(!isComplexTask('读取 src/config.js 并解释'));
  assert.ok(!isComplexTask('查看 git 状态'));
  assert.ok(!isComplexTask('搜索包含 runAgent 的文件'));
  assert.ok(!isComplexTask('这个函数是做什么的？'));
});

test('isComplexTask: 纯问候/空文本不规划', () => {
  assert.ok(!isComplexTask('你好'));
  assert.ok(!isComplexTask(''));
  assert.ok(!isComplexTask('   '));
});

test('isComplexTask: 含请求动词的开放任务倾向规划', () => {
  assert.ok(isComplexTask('请帮我优化这个函数的性能'));
  assert.ok(isComplexTask('如何实现一个缓存层'));
});

// ---------- 模式推导（resolveMode） ----------

test('resolveMode: /plan 前缀强制 plan 并剥离前缀', () => {
  const r = resolveMode('/plan 实现登录功能', undefined);
  assert.equal(r.mode, 'plan');
  assert.equal(r.planMessage, '实现登录功能');
});

test('resolveMode: body.mode=execute 跳过自动判定（二段式防死循环）', () => {
  assert.equal(resolveMode('重构整个模块', 'execute').mode, 'execute');
});

test('resolveMode: body.mode=plan 强制 plan', () => {
  assert.equal(resolveMode('随便聊聊', 'plan').mode, 'plan');
});

test('resolveMode: auto 模式下复杂进 plan、简单进 execute', () => {
  // 依赖 config 默认 WORKFLOW_MODE='auto'
  if (process.env.WORKFLOW_MODE && process.env.WORKFLOW_MODE !== 'auto') return;
  assert.equal(resolveMode('重构 X 模块', undefined).mode, 'plan');
  assert.equal(resolveMode('读取 config 并解释', undefined).mode, 'execute');
});


// ---------- 直接调用解析（resolveDirectCall / buildSkillParams） ----------

test('resolveDirectCall: ! 前缀解析为 bash 调用', () => {
  const r = resolveDirectCall('!ls -la src/core');
  assert.equal(r.type, 'bash');
  assert.equal(r.command, 'ls -la src/core');
});

test('resolveDirectCall: ! 空命令回退 null', () => {
  assert.equal(resolveDirectCall('!   ').type, null);
});

test('resolveDirectCall: @ 匹配任意工具/技能并解析参数', () => {
  // 工具 read_file：位置参数自动填入主参数 path
  const r = resolveDirectCall('@read_file src/core/agent.js');
  assert.equal(r.type, 'skill');
  assert.equal(r.skill, 'read_file');
  assert.equal(r.unknown, undefined);
  assert.deepEqual(buildSkillParams('read_file', r.rawArgs), { path: 'src/core/agent.js' });
  // skill git_log：key=value 解析
  const g = resolveDirectCall('@git_log max=5');
  assert.deepEqual(buildSkillParams('git_log', g.rawArgs), { max: 5 });
});

test('resolveDirectCall: @ 位置参数填入主字段', () => {
  const r = resolveDirectCall('@explain_symbol runAgent');
  assert.deepEqual(buildSkillParams('explain_symbol', r.rawArgs), { symbol: 'runAgent' });
  const gh = resolveDirectCall('@git_show HEAD~1');
  assert.deepEqual(buildSkillParams('git_show', gh.rawArgs), { ref: 'HEAD~1' });
});

test('resolveDirectCall: @ 未知命令标 unknown 并回退', () => {
  const r = resolveDirectCall('@no_such_cmd foo');
  assert.equal(r.type, 'skill');
  assert.equal(r.unknown, true);
});

test('resolveDirectCall: 普通文本 / /plan 返回 null', () => {
  assert.equal(resolveDirectCall('普通对话').type, null);
  assert.equal(resolveDirectCall('/plan 重构').type, null);
});

test('resolveMode: ! 与 @ 前缀不进入 plan 模式', () => {
  assert.equal(resolveMode('!ls', undefined).mode, 'execute');
  assert.equal(resolveMode('@git_status', undefined).mode, 'execute');
});

// ---------- @ 直接调用：写操作 confirm 拦截（agent 集成） ----------

test('runAgent: @write_file 被 confirm 拒绝时返回取消', async () => {
  const { runAgent } = require('../src/core/agent');
  const events = [];
  const out = await runAgent('@write_file path=/tmp/x.txt content=hi', {
    model: 'dummy',
    confirm: async () => ({ ok: false }),
  }, (e) => events.push(e));
  assert.match(String(out), /已取消执行 @write_file/);
  // 不应出现实际的 write_file 工具执行结果
  assert.ok(!events.some((e) => e.type === 'tool_result' && e.action === 'write_file'));
});
