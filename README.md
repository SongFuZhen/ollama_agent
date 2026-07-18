<p align="right">
  <a href="./README-en.md">English</a> | <strong>中文</strong>
</p>

# 本地 Agent 客户端

> 内网断网环境下的本地 AI 助手。弱模型 + 强约束 + 真数据 = 不瞎编。

一个跑在你自己机器上的本地智能体：模型通过 Ollama 在本地推理，工具调用限制在单一项目目录内，所有回答基于工具返回的真实数据。除 `sql.js`（已随仓库 vendored 到 `public/lib`，离线即用）外均为 Node 内置模块，正常克隆后 `npm start` 即可运行，也可用 `scripts/build-offline-pack.sh` 打包成 U 盘直拷的离线部署包。

---

## 核心特性

- **本地 Agent**：先调工具读真数据，再回答，杜绝凭空发挥。
- **单目录沙箱**：工具仅能读写一个项目目录，路径越界自动拦截。
- **上下文压缩**：长对话自动摘要压缩，避免超出模型上下文窗口。
- **记忆召回**：基于语义相似度的三级记忆（L1 最近对话 / L2 语义召回 / L3 关联记忆）。
- **规划模式**：只读调研阶段，限制只读工具，先输出执行计划再确认实施。
- **验证闭环**：写操作后自动跑测试/lint，验证修改效果。
- **Toolbox 工具箱**：`/explain` `/review` `/commit` `/fix` 等单轮命令，固定 prompt 走独立通道（不经多步 Agent 循环），弱模型也能稳定产出。
- **零安装**：除随仓库 vendored 的 `sql.js` 外均为 Node 内置模块，克隆即运行，亦可打包成离线部署包。
- **过程可见**：思考链、工具调用、验证结果实时展示，可折叠查看。
- **跨平台**：Windows / macOS / Linux 统一入口，U 盘直拷即跑。

## 模型

通过设置页面的模型下拉菜单从 Ollama 已安装列表中选取，或通过环境变量 `MODEL` 指定默认模型（缺省 `qwen2.5-coder:7b`）。对话中途可随时切换。

## 快速开始

```bash
# 1. 确保 Ollama 已启动且拉好模型
ollama pull qwen2.5-coder:7b

# 2. 启动（无需 npm install，三端通用）
npm start
# 等价于： node src/server.js
# Windows 也可双击 start.ps1 或 start.bat；macOS/Linux 可用 ./start.sh

# 3. 浏览器打开
http://localhost:3000
```

> 三端统一入口：`npm start`（= `node src/server.js`）。除随仓库 vendored 的 `sql.js` 外无原生编译依赖，U 盘直拷到 Windows/macOS/Linux 上 `npm start` 即可运行；完整离线部署包见 `scripts/build-offline-pack.sh`。

## 配置

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 地址，可指向局域网其他机器 |
| `MODEL` | `qwen2.5-coder:7b` | 默认对话模型（编码优先；可用 `MODEL_CODER`/`MODEL_DEBUG`/`MODEL_GENERAL` 分场景覆盖） |
| `PROJECT_ROOT` | `./workspace` | 沙箱根目录（单目录） |
| `NUM_CTX` | `8192` | 模型上下文窗口大小（大显存可设 `16384`） |
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

> 这些可执行 skill 及全部工具均可通过 `@命令名` 语法强制直接调用，绕过模型推理。

### 命令语法

除了自然语言对话，还支持三种前缀/斜杠语法，直接驱动工具与技能：

**`@命令` — 强制直接调用**（绕过模型推理，结果直接喂给模型作答）

```
@<工具或技能名> [参数...]
```

- 参数可用 `key=value`（如 `path=src/x.js`、`max=5`），位置参数会自动填入主参数（如 `@read_file src/x.js`）。
- 可调用全部已注册工具与技能；写操作（`write_file`/`edit_file`/`bash` 等）执行前弹二次确认。
- 示例：`@git_status`、`@git_log max=5`、`@read_file src/core/agent.js`、`@grep pattern=foo path=src`、`@write_file path=/tmp/n.txt content=hi`

**`!命令` — 直接执行 shell**

```
!<shell 命令>
```

- 直接调用 `bash` 工具执行 shell 命令，沿用其确认流程（含只读命令），危险命令被安全策略拦截。
- 示例：`!ls -la src/core`、`!git log --oneline -3`、`!npm test`
- 优先级：`!` > `@` > `/plan`。

**`/命令` — 前端 slash 命令**

常规命令：

| 命令 | 作用 |
|------|------|
| `/skills` | 弹出可用技能列表 |
| `/tools` | 弹出可用工具列表 |
| `/models` | 切换模型 |
| `/help` | 显示所有命令 |
| `/clear` | 清空当前对话上下文 |
| `/compress` | 压缩中间历史以省 token |
| `/recall` | 语义召回跨会话记忆 |
| `/template` | 使用任务模板（固化高频任务步骤） |
| `/quick` | 浏览指令集（用法/参数/示例），点「使用」把命令填入输入框 |
| `/metrics` | 查看优化指标（运行埋点） |
| `/plan` | 进入只读规划模式，返回可确认的执行计划 |

**Toolbox 工具箱命令**（单轮执行，固定 prompt，**不经过 Agent 多步循环**，适合弱模型稳定完成的任务；通过 `/quick` 指令集面板浏览用法/参数/示例，点「使用」填入输入框）：

| 命令 | 作用 | 类别 |
|------|------|------|
| `/explain <path>` | 解释指定文件的代码 | 只读 |
| `/review <path>` | 代码审查，列出潜在问题 | 只读 |
| `/comment <path>` | 为代码添加中文注释 | 写（产出可应用文件） |
| `/fix <path> <报错>` | 根据报错尝试修复代码 | 写（产出可应用文件） |
| `/test <path> [fn]` | 为代码生成单元测试 | 只读 |
| `/commit` | 根据改动生成 commit message | 只读 |
| `/error <报错文本>` | 解读报错信息 | 只读 |
| `/regex <需求>` | 根据需求写正则表达式 | 只读 |

> 三套机制对比、`@`/`!` 完整参数与示例见 [docs/skills-and-tools.md](docs/skills-and-tools.md)。

## 目录结构

```
ollama_agent/
├── src/                              后端源码
│   ├── server.js                     HTTP 服务入口 + SSE 对话
│   ├── config.js                     全局配置
│   ├── core/                         Agent 引擎
│   │   ├── agent.js                  Agent 主循环（工具调用、推理）
│   │   ├── ollama.js                 Ollama 调用（含超时、退避）
│   │   ├── ollama-tools.js           Ollama 原生 tools API
│   │   ├── compact.js                上下文压缩（摘要化）
│   │   ├── workflow.js               Workflow 模式推导（先规划再执行）
│   │   ├── precheck.js               工具调用预检查（确定性错误提前拦截）
│   │   ├── metrics.js                运行指标埋点（data/metrics.jsonl）
│   │   ├── template-loader.js        任务模板加载（固化高频任务路径）
│   │   ├── prompts/                  system prompt 与示例
│   │   └── quick/                    Toolbox 单轮命令（与 Agent 循环隔离）
│   │       ├── runner.js             命令执行器
│   │       ├── registry.js           命令注册表（扫描 commands/）
│   │       └── commands/             comment/commit/error/explain/fix/regex/review/test
│   ├── tools/                        动作类工具
│   │   ├── index.js                  工具注册与入口
│   │   ├── utils.js                  沙箱路径解析等公共工具
│   │   ├── test/                     run_tests / run_lint
│   │   └── *.js                      各工具实现
│   ├── skills/                       技能（分析/查看类）
│   │   ├── index.js                  技能注册
│   │   ├── utils.js                  技能公共工具
│   │   ├── git/                       Git 相关技能
│   │   └── analyze/                  代码分析技能
│   ├── storage/                      持久化
│   │   ├── db.js                     SQLite 对话存储（sql.js/WASM）
│   │   └── rootstore.js              项目根目录持久化
│   ├── memory/
│   │   └── recall.js                 语义记忆召回
│   ├── server/                       服务侧辅助
│   │   ├── hotreload.js              前端热重载（SSE 通知刷新）
│   │   └── logger.js                 文件日志 + 轮转（data/agent.log）
│   ├── device/
│   │   └── device.js                 设备信息
│   └── templates/                    任务模板（.md，注入 system prompt）
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
├── data/                             数据库 / 日志 / 指标文件
├── docs/                             文档
│   ├── agent-design.md               Agent 引擎架构设计
│   ├── skills-and-tools.md           @/!/slash 命令机制详解
│   ├── discussions/                  讨论与对比分析
│   ├── optimization-plan.md          优化效果量化基线
│   └── superpowers/plans/            实施计划
├── scripts/
│   └── build-offline-pack.sh         构建内网离线部署包（源码+模型+安装脚本）
├── start.sh / start.bat / start.ps1  跨平台启动脚本
├── package.json                      依赖 sql.js（已打包进 public/lib，离线即用）
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
| [docs/usage-guide.md](./docs/usage-guide.md) | 新手使用教程（从零上手） |
| [docs/usage-guide-en.md](./docs/usage-guide-en.md) | Beginner usage tutorial (English) |
| [docs/agent-design.md](./docs/agent-design.md) | Agent 引擎架构设计 |
| [docs/skills-and-tools.md](./docs/skills-and-tools.md) | `@`/`!`/slash 命令机制详解 |
| [docs/optimization-plan.md](./docs/optimization-plan.md) | 优化效果量化基线 |
| [docs/discussions/](./docs/discussions/) | 讨论与对比分析 |
| [docs/superpowers/plans/](./docs/superpowers/plans/) | 实施计划 |
test change
