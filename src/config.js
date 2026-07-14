'use strict';

const path = require('path');

// 从环境变量读取配置，便于 U 盘部署时一行命令调整
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(process.cwd(), 'workspace');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// 默认对话模型（可通过环境变量 MODEL 覆盖，例如 MODEL=qwen2.5-coder:7b）
const DEFAULT_MODEL = process.env.MODEL || 'deepseek-r1:8b';

const MAX_STEPS = 6;          // 7B 循环步数上限，防空转
const JSON_RETRY = 2;         // 工具调用 JSON 解析失败重试次数
const STEP_TIMEOUT_MS = 90000; // 本地模型响应较慢，适当放宽超时
const NUM_CTX = Number(process.env.NUM_CTX) || 16384; // context window，agent 循环需较大上下文
// 采样温度：小模型工具调用要确定性，默认压低到 0.1（可用 TEMP 环境变量覆盖，如 TEMP=0.3）
const TEMPERATURE = Number(process.env.TEMP) || 0.1;
const TOP_P = Number(process.env.TOP_P) || 0.9;
const CTX_RESERVE = 2048;     // 为模型输出预留的 token 数
const TOOL_RESULT_MAX = 6000; // 工具结果回传模型的最大字符数
const TRUNCATE_MIN = 200;     // 单条消息可保留的最小字符数（小于则整条丢弃）
const VERIFY_EVERY = 2;       // 执行模式下每 N 步自动跑一次验证器（run_tests/run_lint）
const COMPACT_RECENT_K = 6;    // 压缩时保留最近 K 条消息不摘要
const COMPACT_THRESHOLD = 0.7; // prompt token 越过 NUM_CTX*该比例时触发压缩

// 支持原生 Ollama tools API 的模型（按名称前缀匹配）
// 注意：大多数社区 tool-calling 模型只是文本输出 JSON，不适合走原生 tools
const NATIVE_TOOLS_MODELS = [
  // 'deepseek-r1-tool-calling',  // MFDoom 模型文本输出 JSON，走 prompt-based 路线更稳定
];

module.exports = {
  NATIVE_TOOLS_MODELS,
  PROJECT_ROOT,
  OLLAMA_HOST,
  DEFAULT_MODEL,
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
  COMPACT_RECENT_K,
  COMPACT_THRESHOLD,
  PORT: process.env.PORT || 3000,
};
