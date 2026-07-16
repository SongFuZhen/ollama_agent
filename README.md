<p align="right">
  <a href="./README-en.md">English</a> | <strong>中文</strong>
</p>

# 本地 Agent 客户端

> 内网断网环境下的本地 AI 助手。弱模型 + 强约束 + 真数据 = 不瞎编。

一个跑在你自己机器上的本地智能体：模型通过 Ollama 在本地推理，工具调用限制在单一项目目录内，所有回答基于工具返回的真实数据。纯 Node 内置模块，无需 `npm install`，U 盘直拷即跑。

---

## 核心特性

- **本地 Agent**：先调工具读真数据，再回答，杜绝凭空发挥。
- **单目录沙箱**：工具仅能读写一个项目目录，路径越界自动拦截。
- **上下文压缩**：长对话自动摘要压缩，避免超出模型上下文窗口。
- **记忆召回**：基于语义相似度的三级记忆（L1 最近对话 / L2 语义召回 / L3 关联记忆）。
- **规划模式**：只读调研阶段，限制只读工具，先输出执行计划再确认实施。
- **验证闭环**：写操作后自动跑测试/lint，验证修改效果。
- **零依赖**：纯 Node 内置模块 + sql.js/WASM，无需安装依赖，开箱即用。
- **过程可见**：思考链、工具调用、验证结果实时展示，可折叠查看。
- **跨平台**：Windows / macOS / Linux 统一入口，U 盘直拷即跑。

## 模型

通过设置页面的模型下拉菜单从 Ollama 已安装列表中选取，或通过环境变量 `MODEL` 指定默认模型（缺省 `deepseek-r1:8b`）。对话中途可随时切换。

## 快速开始

```bash
# 1. 确保 Ollama 已启动且拉好模型
ollama pull deepseek-r1:8b

# 2. 启动（无需 npm install，三端通用）
npm start
# 等价于： node src/server.js
# Windows 也可双击 start.ps1 或 start.bat；macOS/Linux 可用 ./start.sh

# 3. 浏览器打开
http://localhost:3000
```

> 三端统一入口：`npm start`（= `node src/server.js`）。无任何原生编译依赖，U 盘直拷到 Windows/macOS/Linux 上 `npm start` 即可运行。

## 配置

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 地址，可指向局域网其他机器 |
| `MODEL` | `deepseek-r1:8b` | 默认对话模型 |
| `PROJECT_ROOT` | `./workspace` | 沙箱根目录（单目录） |
| `NUM_CTX` | `16384` | 模型上下文窗口大小 |
| `AGENT_TIMEOUT_MS` | `90000` | Agent 整体超时（毫秒） |
| `OLLAMA_TIMEOUT_MS` | `90000` | 单次 Ollama 调用超时（毫秒） |
| `PORT` | `3000` | 服务端口 |

### 前端设置

启动后可在设置页面（右上角菜单）配置：

- Ollama 地址
- 项目目录（绝对路径）
- 模型选择（从 Ollama 已安装列表中选取）
- Markdown 渲染引擎（markdown-it / marked）

## 工具与技能

### 工具（tools）

| 工具 | 说明 | 需确认 |
|------|------|--------|
| `read_file` | 读取文件内容 | - |
| `read_lines` | 读取指定行范围 | - |
| `list_dir` | 列出目录内容 | - |
| `tree` | 树状列出目录结构 | - |
| `search_files` | 按文件名搜索 | - |
| `glob` | glob 模式匹配文件 | - |
| `grep` | 搜索文件内容（正则） | - |
| `count_loc` | 统计代码行数 | - |
| `semantic_grep` | 语义级代码搜索 | - |
| `repo_map` | 生成仓库结构地图 | - |
| `write_file` | 写入/覆盖文件 | ✓ |
| `edit_file` | 精确编辑（查找替换） | ✓ |
| `apply_diff` | 应用 diff 补丁 | ✓ |
| `bash` | 执行 shell 命令 | ✓ |
| `run_tests` | 自动跑测试 | ✓ |
| `run_lint` | 自动跑 lint | ✓ |
| `todos` | 任务列表管理 | ✓ |
| `notes` | 笔记管理 | ✓ |
| `ask_user` | 向用户提问 | - |

### 技能（skills）

| 技能 | 说明 |
|------|------|
| `git_status` | 查看工作区状态 |
| `git_diff` | 查看文件差异 |
| `git_log` | 查看提交历史 |
| `git_show` | 查看某次提交内容 |
| `explain_symbol` | 解释符号定义 |
| `find_references` | 查找符号引用 |

> 这些可执行 skill 及全部工具均可通过 `@命令名` 语法强制直接调用，绕过模型推理。完整用法（含 `@`/`!` 语法、slash 命令、三套机制对比）见 [docs/skills-and-tools.md](docs/skills-and-tools.md)。

## 目录结构

```
ollama_agent/
├── src/                              后端源码
│   ├── server.js                     HTTP 服务 + SSE 对话
│   ├── config.js                     全局配置
│   ├── core/                         Agent 引擎
│   │   ├── agent.js                  Agent 主循环（工具调用、推理）
│   │   ├── ollama.js                 Ollama 调用（含超时）
│   │   ├── ollama-tools.js           Ollama 原生 tools API
│   │   └── compact.js                上下文压缩（摘要化）
│   ├── tools/                        动作类工具
│   │   ├── index.js                  工具注册与入口
│   │   ├── test/                     run_tests / run_lint
│   │   └── *.js                      各工具实现
│   ├── skills/                       技能（分析/查看类）
│   │   ├── index.js                  技能注册
│   │   ├── git/                       Git 相关技能
│   │   └── analyze/                  代码分析技能
│   ├── storage/                      持久化
│   │   ├── db.js                     SQLite 对话存储（sql.js/WASM）
│   │   └── rootstore.js              项目根目录持久化
│   ├── memory/
│   │   └── recall.js                 语义记忆召回
│   └── device/
│       └── device.js                 设备信息
│
├── public/                           前端静态文件
│   ├── index.html                    主页面
│   ├── frontend/js/modules/          前端 JS 模块（global-script，按功能拆分）
│   │   ├── refs.js                    共享 DOM 引用与状态栏/用户菜单点击接线（最先加载）
│   │   ├── app.js                    主入口：仅负责启动与事件接线
│   │   ├── chat.js                   消息流渲染 / SSE 分发 / 思考态 / 图片 / 发送·中止
│   │   ├── sidebar.js                侧栏 tab / 待办·笔记 / 日志抽屉 / 添加弹框
│   │   ├── history.js                历史对话抽屉 / 列表 / 加载回放 / 删除确认
│   │   ├── statusbar.js              状态栏 / 上下文用量 / 模型下拉 / git 分支 / 详情弹框
│   │   ├── composer.js               输入框自适应 / 发送快捷键 / 对话名 / URL 持久化 / 新对话
│   │   ├── state.js                  状态管理
│   │   ├── api.js                    API 调用
│   │   ├── render.js                 消息渲染（Markdown）
│   │   ├── settings.js               设置管理
│   │   ├── theme.js                  主题切换
│   │   ├── commands.js               命令面板
│   │   ├── file-browser.js           文件浏览器
│   │   └── utils.js                  工具函数
│   ├── frontend/css/modules/         模块化样式
│   ├── components/                   可复用 UI 组件
│   └── lib/                          第三方库（禁止修改）
│       ├── simpui/                   UI 框架
│       ├── lucide/                   图标库
│       ├── markdown-it/              Markdown 渲染
│       ├── marked/                   Markdown 渲染（备选）
│       ├── highlight/                代码高亮
│       ├── purify/                   XSS 防护
│       └── mermaid/                  图表渲染
│
├── workspace/                        沙箱工作目录
├── data/                             数据库文件
├── docs/                             文档
│   ├── agent-design.md               Agent 引擎架构设计
│   ├── discussions/                  讨论与对比分析
│   └── superpowers/plans/            实施计划
├── start.sh / start.bat / start.ps1  跨平台启动脚本
├── package.json                      无外部依赖
└── README.md                         本文档
```

## 安全

- 工具调用限制在 `PROJECT_ROOT` 单目录内（路径沙箱）。
- 写操作需每次单独人工确认。
- Ollama 地址、模型均可配置，未硬编码。
- XSS 防护：所有 Markdown 输出经 DOMPurify 净化。

## 文档

| 文档 | 说明 |
|---|---|
| [README-en.md](./README-en.md) | 项目概述与快速开始（英文） |
| [CLAUDE.md](./CLAUDE.md) | 开发规范与编码标准 |
| [docs/agent-design.md](./docs/agent-design.md) | Agent 引擎架构设计 |
| [docs/discussions/](./docs/discussions/) | 讨论与对比分析 |
| [docs/superpowers/plans/](./docs/superpowers/plans/) | 实施计划 |
