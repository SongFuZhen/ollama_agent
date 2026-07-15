'use strict';

// Workflow 模式推导：把「先规划再执行」固化为 agent 默认行为的一部分。
// 抽离到独立模块，避免测试/子代理 require 时连带启动 HTTP 服务（server.js 在加载期监听端口）。
const { WORKFLOW_MODE, COMPLEX_TASK_PATTERNS } = require('../config');

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
// 返回 { mode, planMessage }。
function resolveMode(message, explicitMode) {
  let mode = 'execute';
  let planMessage = message;
  if (explicitMode === 'plan' || (typeof message === 'string' && message.trim().startsWith('/plan'))) {
    mode = 'plan';
    planMessage = (explicitMode === 'plan') ? message : message.trim().slice(5).replace(/^\s+/, '') || message;
  } else if (!explicitMode && WORKFLOW_MODE === 'always') {
    mode = 'plan';
  } else if (!explicitMode && WORKFLOW_MODE === 'auto' && isComplexTask(message)) {
    mode = 'plan';
  }
  return { mode, planMessage };
}

module.exports = { isComplexTask, resolveMode, WORKFLOW_MODE };
