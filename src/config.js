'use strict';

const path = require('path');

// 从环境变量读取配置，便于 U 盘部署时一行命令调整
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(process.cwd(), 'workspace');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// 按场景配置模型：不同任务用最合适的本地模型
// 可通过环境变量覆盖，例如 MODEL_CODER=qwen2.5-coder:7b
const SCENARIOS = {
  coder: {
    key: 'coder',
    label: '代码补全 / 解释代码',
    model: process.env.MODEL_CODER || 'qwen2.5-coder:7b',
    desc: '读代码、补全、解释函数与模块',
    agent: true, // 是否启用工具调用 Agent 模式
  },
  debug: {
    key: 'debug',
    label: '复杂逻辑排查 / 找 bug',
    model: process.env.MODEL_DEBUG || 'deepseek-r1:8b',
    desc: '读日志、追踪调用链、定位异常',
    agent: true,
  },
  general: {
    key: 'general',
    label: '通用对话（非代码）',
    model: process.env.MODEL_GENERAL || 'llama3.1:8b',
    desc: '文档总结、报告起草、闲聊',
    agent: true,
  },
  vision: {
    key: 'vision',
    label: '图片识别',
    model: process.env.MODEL_VISION || 'gemma3:4b',
    desc: '粘贴图片，多模态看图回答',
    agent: false, // 纯多模态对话，不挂文件工具
  },
};

const MAX_STEPS = 6;          // 7B 循环步数上限，防空转
const JSON_RETRY = 2;         // 工具调用 JSON 解析失败重试次数
const STEP_TIMEOUT_MS = 90000; // 本地模型响应较慢，适当放宽超时

module.exports = {
  PROJECT_ROOT,
  OLLAMA_HOST,
  SCENARIOS,
  MAX_STEPS,
  JSON_RETRY,
  STEP_TIMEOUT_MS,
  PORT: process.env.PORT || 3000,
};
