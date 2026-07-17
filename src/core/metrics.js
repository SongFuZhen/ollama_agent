'use strict';

// 运行指标埋点：为优化效果提供量化基线。
// 记录到 data/metrics.jsonl（追加写入，供离线聚合），并在内存维护进程级计数快照。
// 指标（详见 docs/optimization-plan.md）：
//   json_parse_failures / total_calls
//   steps_to_converge
//   repeat_tool_calls
//   self_heal_triggered
//   context_compact_triggered
//   task_success (由前端用户标记)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.jsonl');

// 进程内累加计数（重启清零；同时落盘 JSONL 供跨进程分析）
const counters = {
  total_calls: 0,
  json_parse_failures: 0,
  repeat_tool_calls: 0,
  self_heal_triggered: 0,
  context_compact_triggered: 0,
  template_hit: 0,
  task_success: 0,
  task_total: 0,
};

let _warnOnce = false;

function _append(event, data = {}) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), event, ...data }) + '\n';
    fs.appendFileSync(METRICS_FILE, line);
  } catch (e) {
    if (!_warnOnce) {
      console.warn('[metrics] 写入失败（已静默忽略）: ' + e.message);
      _warnOnce = true;
    }
  }
}

// 记录一次事件。event 为指标名；data 为附加字段（如 step/model/action）。
function recordMetric(event, data = {}) {
  if (event in counters) counters[event] += 1;
  _append(event, data);
}

// 记录任务收敛步数（每个 agent 任务结束记一条）
function recordSteps(steps, data = {}) {
  _append('steps_to_converge', { steps, ...data });
}

// 用户标记任务成功/失败（前端调用）
function recordTaskSuccess(ok) {
  counters.task_total += 1;
  if (ok) counters.task_success += 1;
  _append('task_success', { ok: !!ok });
}

// 进程级指标快照（供 /api/metrics 接口）
function snapshot() {
  const c = counters;
  return {
    total_calls: c.total_calls,
    json_parse_failures: c.json_parse_failures,
    json_parse_failure_rate: c.total_calls ? +(c.json_parse_failures / c.total_calls).toFixed(4) : 0,
    repeat_tool_calls: c.repeat_tool_calls,
    self_heal_triggered: c.self_heal_triggered,
    context_compact_triggered: c.context_compact_triggered,
    template_hit: c.template_hit,
    task_total: c.task_total,
    task_success: c.task_success,
    task_success_rate: c.task_total ? +(c.task_success / c.task_total).toFixed(4) : 0,
  };
}

module.exports = { recordMetric, recordSteps, recordTaskSuccess, snapshot };
