'use strict';

// 加载所有工具（按分类目录组织）
const read_file = require('./read_file');
const list_dir = require('./list_dir');
const search_files = require('./search_files');
const write_file = require('./write_file');
const bash = require('./bash');
const glob = require('./glob');
const grep = require('./grep');
const edit_file = require('./edit_file');
const read_lines = require('./read_lines');
const tree = require('./tree');
const count_loc = require('./count_loc');

// 测试 / Lint 工具
const run_tests = require('./test/run_tests');
const run_lint = require('./test/run_lint');

// 技能（分析 / 查看类，来自 src/skills）
const { SKILLS } = require('../skills');

// 动作类工具注册表
const TOOLS = {
  read_file,
  list_dir,
  search_files,
  write_file,
  bash,
  glob,
  grep,
  edit_file,
  read_lines,
  tree,
  count_loc,
  run_tests,
  run_lint,
};

// 合并工具与技能，供统一调度 / 展示
const ALL = { ...TOOLS, ...SKILLS };

// 导出工具名称列表
const TOOL_NAMES = Object.keys(ALL);

// 各场景可用工具集
const READONLY_TOOLS = [
  'read_file', 'list_dir', 'search_files', 'glob', 'grep', 'read_lines', 'tree', 'count_loc',
  ...Object.keys(SKILLS),
];
const ALL_TOOLS = [...READONLY_TOOLS, 'write_file', 'edit_file', 'bash', 'run_tests', 'run_lint'];

const SCENARIO_TOOLS = {
  coder: ALL_TOOLS,        // 代码场景：全部工具
  debug: ALL_TOOLS,        // 排查场景：全部工具（deepseek-r1 可用）
  general: READONLY_TOOLS, // 通用场景：只读工具
  vision: [],              // 图片识别：无工具
};

// 技能名称集合（用于区分 工具 / 技能）
const SKILL_TOOLS = Object.keys(SKILLS);

// 按场景裁剪可用工具集
function allowedFor(scenarioKey) {
  return (SCENARIO_TOOLS[scenarioKey] || []).slice();
}

// 获取工具规格（用于发送给 LLM）
function specsFor(scenarioKey) {
  return allowedFor(scenarioKey)
    .map(name => ({
      name,
      desc: ALL[name].desc,
      params: ALL[name].params,
      needConfirm: ALL[name].needConfirm,
      kind: SKILL_TOOLS.includes(name) ? 'skill' : 'tool',
    }));
}

// 检查工具是否允许
function isAllowed(scenarioKey, name) {
  return allowedFor(scenarioKey).includes(name);
}

// 全部工具的规格（用于 /skills 展示，不区分场景）
function allSpecs() {
  return TOOL_NAMES.map(name => ({
    name,
    desc: ALL[name].desc,
    params: ALL[name].params,
    needConfirm: ALL[name].needConfirm,
    kind: SKILL_TOOLS.includes(name) ? 'skill' : 'tool',
  }));
}

// 执行工具
async function runTool(name, params, ctx = {}) {
  const tool = ALL[name];
  if (!tool) {
    throw new Error(`未知工具: ${name}`);
  }
  return await tool.run(params, ctx);
}

module.exports = {
  TOOLS: ALL,
  TOOL_NAMES,
  allowedFor,
  specsFor,
  allSpecs,
  isAllowed,
  runTool,
  safeResolve: require('./utils').safeResolve,
  PROJECT_ROOT: require('./utils').PROJECT_ROOT,
};
