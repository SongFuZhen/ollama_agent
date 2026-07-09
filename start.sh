#!/usr/bin/env bash
# 本地 Agent 客户端 — 启动脚本（内网断网可用）
set -e

echo "== 自检 =="
node -v || { echo "未找到 node，请先安装 Node 16+"; exit 1; }

# ===== 可选环境变量（取消注释并修改）=====
# 项目沙箱根目录（单目录，工具仅能读写此目录内）
# export PROJECT_ROOT=/path/to/your/project
# Ollama 服务地址（可指向局域网其他机器，例如）
# export OLLAMA_HOST=http://192.168.1.100:14113
# 各场景模型（默认见 src/config.js，可在此覆盖）
# export MODEL_CODER=qwen2.5-coder:7b
# export MODEL_DEBUG=deepseek-r1:8b
# export MODEL_GENERAL=llama3.1:8b
# 服务端口
# export PORT=3000

if [ -z "$PROJECT_ROOT" ]; then
  export PROJECT_ROOT="$(pwd)/workspace"
fi
mkdir -p "$PROJECT_ROOT"

echo "项目根目录: $PROJECT_ROOT"
echo "Ollama 地址: ${OLLAMA_HOST:-http://localhost:11434}"
echo "启动中... 浏览器打开 http://localhost:${PORT:-3000}"
node "$(dirname "$0")/src/server.js"
