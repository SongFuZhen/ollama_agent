<p align="right">
  <a href="./README-en.md">English</a> | <strong>中文</strong>
</p>

# 本地 Agent 客户端

> 内网断网环境下的本地 AI 助手。弱模型 + 强约束 + 真数据 = 不瞎编。

一个跑在你自己机器上的本地智能体：模型通过 Ollama 在本地推理，工具调用被限制在单一项目目录内，所有回答都基于工具返回的真实数据，不凭空发挥。纯 Node 内置模块，无需 `npm install`，U 盘直拷即跑。

---

## 核心特性

- **分场景标签**：代码补全、逻辑排查、通用对话、图片识别，各绑定最合适的本地模型。
- **Agent 模式**：先调工具读真数据，再回答，杜绝凭空发挥。
- **单目录沙箱**：工具仅能读写一个项目目录，路径越界自动拦截。
- **零依赖**：纯 Node 内置模块，无需安装依赖，开箱即用。
- **过程可见**：思考链与工具调用实时展示，可折叠查看。

## 场景与模型

| 标签 | 模型 | 用途 |
|---|---|---|
| 代码补全 / 解释 | `qwen2.5-coder:7b` | 读代码、解释函数与模块 |
| 逻辑排查 / 找 bug | `deepseek-r1:8b` | 读日志、追踪调用链、定位异常 |
| 通用对话 | `llama3.1:8b` | 文档总结、报告起草、闲聊 |
| 图片识别 | `gemma3:4b` | 粘贴/拖拽图片，多模态看图回答 |

> 模型名可在设置页面或环境变量中覆盖。

## 快速开始

```bash
# 1. 确保 Ollama 已启动且拉好模型
ollama pull qwen2.5-coder:7b
ollama pull deepseek-r1:8b
ollama pull llama3.1:8b
ollama pull gemma3:4b

# 2. 启动（无需 npm install）
./start.sh
# 或直接： node src/server.js

# 3. 浏览器打开
http://localhost:3000
```

## 配置

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 地址，可指向局域网其他机器 |
| `PROJECT_ROOT` | `./workspace` | 沙箱根目录（单目录） |
| `MODEL_CODER` | `qwen2.5-coder:7b` | 代码场景模型 |
| `MODEL_DEBUG` | `deepseek-r1:8b` | 排查场景模型 |
| `MODEL_GENERAL` | `llama3.1:8b` | 通用场景模型 |
| `MODEL_VISION` | `gemma3:4b` | 图片识别场景模型 |
| `OLLAMA_TIMEOUT_MS` | `120000` | Ollama 调用超时（毫秒） |
| `PORT` | `3000` | 服务端口 |

### 前端设置

启动后可在设置页面（右上角菜单）配置：

- Ollama 地址
- 项目目录（绝对路径）
- 各场景模型名

## 目录结构

```
ollama_agent/
├── src/                          后端源码
│   ├── server.js                 HTTP 服务 + SSE 对话
│   ├── agent.js                  Agent 主循环
│   ├── tools/                    工具注册与实现
│   │   ├── index.js              工具入口
│   │   ├── read_file.js          读文件
│   │   ├── list_dir.js           列目录
│   │   ├── read_lines.js         读指定行范围
│   │   ├── edit_file.js          精确编辑（查找替换）
│   │   ├── write_file.js         写文件
│   │   ├── tree.js               目录树
│   │   ├── search_files.js       搜索文件
│   │   ├── glob.js               glob 匹配
│   │   ├── grep.js               内容检索
│   │   └── count_loc.js          行数统计
│   ├── ollama.js                 Ollama 对接
│   ├── config.js                 场景与模型配置
│   ├── db.js                     SQLite 持久化
│   ├── rootstore.js              项目目录管理
│   └── device.js                 设备信息
│
├── public/                       前端静态文件
│   ├── index.html                主页面
│   ├── frontend/                 前端资源
│   │   ├── css/modules/          模块化样式
│   │   └── js/modules/           模块化逻辑
│   └── lib/                      第三方库（禁止修改）
│
├── workspace/                    沙箱工作目录
├── data/                         数据库文件
├── start.sh                      启动脚本
├── package.json                  无 dependencies
└── README.md                     本文档
```

## 安全

- 工具调用限制在 `PROJECT_ROOT` 单目录内（路径沙箱）。
- 写操作需每次单独人工确认。
- Ollama 地址、模型均可配置，未硬编码。

## 文档

| 文档 | 说明 |
|---|---|
| [README-en.md](./README-en.md) | 项目概述与快速开始（英文） |
| [docs/CLAUDE.md](./docs/CLAUDE.md) | 开发规范与编码标准 |
| [docs/产品设计书.md](./docs/产品设计书.md) | 详细产品设计文档 |
| [docs/UI-SPEC.md](./docs/UI-SPEC.md) | UI 设计规范 |
| [docs/1-UI-REVIEW.md](./docs/1-UI-REVIEW.md) | UI 审计报告 |
