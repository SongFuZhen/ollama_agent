'use strict';

const path = require('path');

// 从环境变量读取配置，便于 U 盘部署时一行命令调整
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(process.cwd(), 'workspace');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// 默认对话模型：编码优先首选 qwen2.5-coder:7b；仍可用环境变量覆盖（MODEL=deepseek-r1:8b）
const DEFAULT_MODEL = process.env.MODEL || 'qwen2.5-coder:7b';

// 模型路由：按任务复杂度匹配不同模型，本地显存有限时让小模型干小活、大模型干大活。
//   default : 主对话 + 工具调用（强推理）
//   compact : 上下文压缩摘要（弱推理，可用更小更快的模型）
//   embed   : embedding（已是专用小模型）
//   simple  : 简单问候/解释（可选，省显存）
const MODEL_ROUTING = {
  default: DEFAULT_MODEL,
  compact: process.env.COMPACT_MODEL || 'qwen2.5:3b',
  embed: process.env.EMBED_MODEL || 'nomic-embed-text',
  simple: process.env.SIMPLE_MODEL || DEFAULT_MODEL,
};

const MAX_STEPS = Number(process.env.MAX_STEPS) || 8;  // Agent 循环步数上限，防空转；可通过环境变量覆盖
const JSON_RETRY = 2;         // 工具调用 JSON 解析失败重试次数
const STEP_TIMEOUT_MS = 90000; // 本地模型响应较慢，适当放宽超时
const NUM_CTX = Number(process.env.NUM_CTX) || 8192; // 7B/8B 默认 8K，质量更稳；大显存可 NUM_CTX=16384
// 采样温度：小模型工具调用要确定性，默认压低到 0.1（可用 TEMP 环境变量覆盖，如 TEMP=0.3）
const TEMPERATURE = Number(process.env.TEMP) || 0.1;
const TOP_P = Number(process.env.TOP_P) || 0.9;
const CTX_RESERVE = 2048;     // 为模型输出预留的 token 数
const TOOL_RESULT_MAX = 6000; // 工具结果回传模型的最大字符数
const TRUNCATE_MIN = 200;     // 单条消息可保留的最小字符数（小于则整条丢弃）
const VERIFY_EVERY = 2;       // 执行模式下每 N 步自动跑一次验证器（run_tests/run_lint）
// 自愈重试：验证失败时，注入「请修复」指令，给模型若干独立步修复，再重新验证。
// 这是为 7B/8B 弱模型设计的核心闭环——把「判断对不对」交给确定性测试，
// 模型只负责改，失败就把报错原样喂回重来，最多重试 MAX_HEAL_STEPS 次。
const SELF_HEAL = (process.env.SELF_HEAL || 'on') !== 'off'; // 默认开启，SELF_HEAL=off 关闭
const MAX_HEAL_STEPS = Number(process.env.MAX_HEAL_STEPS) || 3; // 单次验证失败后的最大修复重试步数
const COMPACT_RECENT_K = 6;    // 压缩时保留最近 K 条消息不摘要
const COMPACT_THRESHOLD = Number(process.env.COMPACT_THRESHOLD) || 0.6; // 8K 窗口下更早压缩，避免截断早期上下文

// 支持原生 Ollama tools API 的模型（按名称前缀匹配）
// 注意：大多数社区 tool-calling 模型只是文本输出 JSON，不适合走原生 tools
const NATIVE_TOOLS_MODELS = [
  // 'deepseek-r1-tool-calling',  // MFDoom 模型文本输出 JSON，走 prompt-based 路线更稳定
];

// Workflow 固化强度：决定「先规划再执行」是否默认开启
//   auto   : 复杂任务自动先规划、用户确认后执行；简单任务直跑（默认）
//   manual : 仅 /plan 前缀触发规划（历史行为）
//   always : 所有任务强制先规划
const WORKFLOW_MODE = process.env.WORKFLOW_MODE || 'auto';

// 复杂任务判定词表（isComplexTask 用）：命中任一「写/构建意图」即视为复杂。
// COMPLEX_CN/EN 为写意图关键词；MULTI_FILE 为多文件/全量信号；
// SIMPLE 为只读/问答意图，命中且无写意图时短路为不规划。
const COMPLEX_TASK_PATTERNS = {
  CN: /重构|实现|修复|增加|新增|创建|新建|修改|改写|重写|搭建|开发|完成|接入|集成|迁移|优化|补充|实现.*功能|写.*(脚本|程序|函数|模块)/,
  EN: /\b(refactor|implement|fix|add|create|modify|build|develop|migrate|setup|write)\b/i,
  MULTI_FILE: /多个文件|所有文件|整个项目|全局|批量|一次性.*(改|建)/,
  SIMPLE: /读取|查看|解释|说明|搜索|查找|列出|是什么|怎么|为什么|对比|总结|有什么区别|如何|能否.*(解释|说明)/,
};

module.exports = {
  NATIVE_TOOLS_MODELS,
  WORKFLOW_MODE,
  COMPLEX_TASK_PATTERNS,
  PROJECT_ROOT,
  OLLAMA_HOST,
  DEFAULT_MODEL,
  MODEL_ROUTING,
  MAX_STEPS,
  JSON_RETRY,
  STEP_TIMEOUT_MS,
  NUM_CTX,
  TEMPERATURE,
  TOP_P,
  CTX_RESERVE,
  TOOL_RESULT_MAX,
  TRUNCATE_MIN,
  VERIFY_EVERY,
  SELF_HEAL,
  MAX_HEAL_STEPS,
  COMPACT_RECENT_K,
  COMPACT_THRESHOLD,
  PORT: process.env.PORT || 3000,
};
