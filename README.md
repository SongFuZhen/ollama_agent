# 本地 Agent 客户端 / Local Agent Client

> 内网断网环境下的本地 AI 助手。弱模型 + 强约束 + 真数据 = 不瞎编。
> A local AI assistant for air-gapped intranets. Weak model + strong constraints + real data = no hallucination.

---

## 核心特性 / Features

- **分场景三标签** / Scenario tabs：代码补全、逻辑排查、通用对话，各绑定最合适的本地模型
- **Agent 模式** / Agent mode：先调工具读真数据，再回答，不凭空发挥
- **单目录沙箱** / Single-dir sandbox：工具仅能读写一个项目目录
- **零依赖** / Zero dependencies：纯 Node 内置模块，U 盘直拷即跑，无需 `npm install`
- **过程可见** / Transparent：思考链 + 工具调用实时展示；R1 推理过程可折叠

## 场景与模型 / Scenarios & Models

| 标签 Tab | 模型 Model | 用途 Use |
|---|---|---|
| 代码补全 / 解释 | `qwen2.5-coder:7b` | 读代码、解释函数 |
| 逻辑排查 / 找 bug | `deepseek-r1:8b` | 读日志、追栈、定位异常 |
| 通用对话 | `llama3.1:8b` | 文档总结、报告起草 |

> 模型名可在 `src/config.js` 或环境变量中覆盖。
> Model names can be overridden in `src/config.js` or via env vars.

## 快速开始 / Quick Start

```bash
# 1. 确保 Ollama 已启动且拉好模型
ollama pull qwen2.5-coder:7b
ollama pull deepseek-r1:8b
ollama pull llama3.1:8b

# 2. 启动（无需 npm install）
./start.sh
# 或直接： node src/server.js

# 3. 浏览器打开
http://localhost:3000
```

## 配置 / Configuration（环境变量 / Env Vars）

| 变量 Var | 默认 Default | 说明 Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 地址，可指向局域网其他机器 |
| `PROJECT_ROOT` | `./workspace` | 沙箱根目录（单目录） |
| `MODEL_CODER` | `qwen2.5-coder:7b` | 代码场景模型 |
| `MODEL_DEBUG` | `deepseek-r1:8b` | 排查场景模型 |
| `MODEL_GENERAL` | `llama3.1:8b` | 通用场景模型 |
| `PORT` | `3000` | 服务端口 |

**示例 / Example** — 指向局域网另一台机器的 Ollama：

```bash
export OLLAMA_HOST=http://192.168.1.100:14113
./start.sh
```

## U 盘部署 / USB Deployment

本项目**零第三方依赖**，无需 `npm install`。将整个目录复制到内网电脑即可：

```
local-agent-client/
├── src/                后端（server / agent / tools / ollama / config）
├── public/             前端（index.html + frontend/css + frontend/js）
├── start.sh            启动脚本
├── package.json        无 dependencies
└── README.md
```

Ollama 安装包与模型文件需另随 U 盘携带，并提前在内网装好。
Ollama installer and model files must be carried separately on the USB and installed on the intranet first.

## 安全 / Security

- 工具调用限制在 `PROJECT_ROOT` 单目录内（路径沙箱）
- V1 仅开放只读工具；写操作（V2）需每次单独人工确认
- Ollama 地址、模型均可配置，未硬编码

## 目录结构 / Structure

```
src/server.js   HTTP 服务 + SSE 对话 + 确认接口 + preflight
src/agent.js    Agent 主循环（场景模型 + R1 think 剥离 + 白名单校验）
src/tools.js    Tool Registry + 路径沙箱 + 按场景工具白名单
src/ollama.js   Ollama 对接（纯 http）
src/config.js   场景→模型映射与配置
public/index.html           页面骨架（三标签）
public/frontend/css/        样式
public/frontend/js/app.js   前端逻辑（标签/会话隔离/SSE/think 折叠）
```
