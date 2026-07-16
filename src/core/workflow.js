'use strict';

// Workflow 模式推导：把「先规划再执行」固化为 agent 默认行为的一部分。
// 抽离到独立模块，避免测试/子代理 require 时连带启动 HTTP 服务（server.js 在加载期监听端口）。
const { WORKFLOW_MODE, COMPLEX_TASK_PATTERNS } = require('../config');
const { specsFor } = require('../tools');

// 可执行 skill 名称集合（来自 specsFor 中 kind==='skill' 的项）。
// 用于 @ 前缀解析时判断是否为已知 skill。
const SKILL_TOOLS = specsFor().filter((s) => s.kind === 'skill').map((s) => s.name);

// 直接调用解析：把「指定后必须直接调用」固化为输入前缀语法。
//   - `!<命令>`    → 直接调用 bash 工具执行 shell 命令（沿用其写操作确认逻辑）
//   - `@<skill> `  → 直接调用 src/skills 下注册的可执行 skill（绕过模型推理）
// 优先级：! > @ > /plan；输入以哪个前缀开头就用哪个，互不共存。
// 返回 { type: 'bash'|'skill'|null, command?, skill?, rawArgs?, restMessage? }
function resolveDirectCall(message) {
  if (typeof message !== 'string') return { type: null };
  const trimmed = message.trim();

  // ! 前缀：直接调 bash
  if (trimmed.startsWith('!')) {
    const command = trimmed.slice(1).replace(/^\s+/, '');
    if (!command) return { type: null };
    return { type: 'bash', command, restMessage: '' };
  }

  // @ 前缀：直接调可执行 skill
  const m = trimmed.match(/^@(\w+)\s*([\s\S]*)$/);
  if (m) {
    const skill = m[1];
    const rawArgs = m[2].trim();
    if (SKILL_TOOLS.includes(skill)) {
      return { type: 'skill', skill, rawArgs, restMessage: rawArgs };
    }
    // 未知 skill：标 type='skill' 但 skill 不在集合，由调用方回退并提示
    return { type: 'skill', skill, rawArgs, restMessage: rawArgs, unknown: true };
  }

  return { type: null };
}

// 把 @/! 原始参数的 key=value 片段解析为对象，剩余位置参数收集为数组。
// 例："max=5 path=src/a.js 其它" → { max:'5', path:'src/a.js', _positional:['其它'] }
function parseArgs(rawArgs) {
  const params = {};
  const positional = [];
  if (!rawArgs) return { params, positional };
  for (const tok of rawArgs.split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq > 0) {
      const k = tok.slice(0, eq);
      const v = tok.slice(eq + 1);
      // 数字值转为 number，便于 max 等数值参数
      params[k] = /^\d+$/.test(v) ? Number(v) : v;
    } else {
      positional.push(tok);
    }
  }
  return { params, positional };
}

// 依据 skill 的 params schema，把用户输入的原始参数映射为调用参数对象。
// 位置参数按 skill 的第一个必填/主参数填入（symbol/ref），其余走 key=value。
function buildSkillParams(skill, rawArgs) {
  const { params, positional } = parseArgs(rawArgs);
  switch (skill) {
    case 'git_status':
      return {};
    case 'git_show':
      // ref 必填，位置参数或 key=value 均可
      return { ref: params.ref || positional.join(' ') };
    case 'explain_symbol':
    case 'find_references':
      // symbol 必填；path 可选
      return Object.assign({}, params.path ? { path: params.path } : {},
        { symbol: params.symbol || positional.join(' ') });
    case 'git_diff':
    case 'git_log': {
      const p = {};
      if (params.path) p.path = params.path;
      if (params.max != null) p.max = params.max;
      if (params.staged != null) p.staged = params.staged === true || params.staged === 'true';
      // 位置参数若未用 key=value，视为 path
      if (positional.length && !params.path) p.path = positional.join(' ');
      return p;
    }
    default:
      return params;
  }
}

// 复杂任务判定：命中任一「写/构建意图」信号即视为复杂，需先规划。
// 用于 WORKFLOW_MODE='auto' 时自动决定是否进 Plan Mode。
// 规则：
//   - 多文件/全量信号（MULTI_FILE）直接判复杂；
//   - 含写意图关键词（CN/EN）判复杂；
//   - 仅含只读/问答意图（SIMPLE）且无写意图时短路为不规划；
//   - 兜底：含请求性动词（请/帮/让/给/把）或实现类问句，倾向规划以免漏判。
function isComplexTask(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const t = text.trim();
  const { CN, EN, MULTI_FILE, SIMPLE } = COMPLEX_TASK_PATTERNS;
  if (MULTI_FILE.test(t)) return true;
  if (CN.test(t) || EN.test(t)) return true;
  if (SIMPLE.test(t)) return false; // 仅只读/问答意图 → 不规划
  return /(请|帮|让|给|把|需要|应该|如何.*实现)/.test(t);
}

// 根据消息与显式 mode 推导运行模式。
// 优先级：body.mode 显式值 > /plan 前缀 > WORKFLOW_MODE 三档 > 默认 execute。
// 注意：以 ! 或 @ 开头的输入走「直接调用」通道，不进入 plan 模式。
// 返回 { mode, planMessage }。
function resolveMode(message, explicitMode) {
  let mode = 'execute';
  let planMessage = message;
  const isDirect = typeof message === 'string' && /^(!|@)/.test(message.trim());
  if (!isDirect && (explicitMode === 'plan' || (typeof message === 'string' && message.trim().startsWith('/plan')))) {
    mode = 'plan';
    planMessage = (explicitMode === 'plan') ? message : message.trim().slice(5).replace(/^\s+/, '') || message;
  } else if (!explicitMode && WORKFLOW_MODE === 'always') {
    mode = 'plan';
  } else if (!explicitMode && WORKFLOW_MODE === 'auto' && isComplexTask(message)) {
    mode = 'plan';
  }
  return { mode, planMessage };
}

module.exports = { isComplexTask, resolveMode, resolveDirectCall, buildSkillParams, WORKFLOW_MODE };
