'use strict';

const path = require('path');

// 从环境变量读取配置，便于 U 盘部署时一行命令调整
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(process.cwd(), 'workspace');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// 默认对话模型（可通过环境变量 MODEL 覆盖，例如 MODEL=qwen2.5-coder:7b）
const DEFAULT_MODEL = process.env.MODEL || 'qwen2.5-coder:7b';

const MAX_STEPS = 6;          // 7B 循环步数上限，防空转
const JSON_RETRY = 2;         // 工具调用 JSON 解析失败重试次数
const STEP_TIMEOUT_MS = 90000; // 本地模型响应较慢，适当放宽超时
const NUM_CTX = Number(process.env.NUM_CTX) || 16384; // context window，agent 循环需较大上下文

module.exports = {
  PROJECT_ROOT,
  OLLAMA_HOST,
  DEFAULT_MODEL,
  MAX_STEPS,
  JSON_RETRY,
  STEP_TIMEOUT_MS,
  NUM_CTX,
  PORT: process.env.PORT || 3000,
};
