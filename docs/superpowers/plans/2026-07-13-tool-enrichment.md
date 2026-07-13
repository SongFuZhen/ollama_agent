# P4 工具丰富（只补"离线编程 Agent"定位相关）

> 前置：P0 跨平台先完成（新增工具也需三端可跑）。
> 原则：**不做** Claudette 的 Telegram/Gmail/日历/语音（违反离线 + 与定位不符）。
> 只补编程工作流里**真缺**且**离线可做**的工具。

## 候选新增（克制集，每条都对应一个当前痛点）

| 工具 | 解决什么 | 实现要点（零依赖 / 离线） |
|------|------------|---------------------------|
| `apply_diff` | 原子化多文件 unified diff 应用（Claudette 的 quality 组） | 纯 JS 解析 unified diff + `safeResolve` 沙箱写；复用 `edit_file` 的写入逻辑 |
| `semantic_grep` | 比 grep 更模糊的 workspace 检索（token-overlap 排序） | 纯 JS：扫文件 → token 重叠度排序；复用 `grep.js` 的文件遍历 |
| `repo_map` | 大型仓库结构速览（Claudette 的 search 组） | 纯 JS：按扩展名扫目录，输出"重要文件 + 导出符号"摘要（参考 tree + 轻量 AST 提取 import/export） |
| `ask_user` | 执行中向用户澄清（Claudette 的 advanced 组） | 复用现有 `confirm` 机制：emit 一个问题 → 等前端回答 → 注入 messages |
| `notes` | 轻量个人笔记（离线、本地） | sql.js 新表 `notes(id, content, ts)`；纯本地，不碰云 |
| `todos` | 任务清单（离线、本地） | sql.js 新表 `todos(id, text, status, ts)`；前端可展示 |

> **不引外部命令**：`apply_diff`/`semantic_grep`/`repo_map` 全部纯 JS 实现，跨平台零风险（呼应 P0）。

## 与现有工具的整合
- 全部注册进 `src/tools/index.js` 的 `TOOLS`（像现在 14 个一样）。
- `src/tools/schema.js` 自动把参数类型推断进 Ollama tools schema（已在本轮改过）。
- 触发式启用（呼应 Claudette 的按需工具组，但**轻量版**）：在 `runAgent` 按 `mode` 或场景过滤 `specsFor()`，基础集保持极小（read/grep/glob/list），`repo_map`/`apply_diff` 等按需。可在 `config.js` 加 `TOOL_GROUPS` 常量，不改架构。

## 改动文件清单
- 新增 `src/tools/apply_diff.js`、`semantic_grep.js`、`repo_map.js`、`ask_user.js`
- 新增 `src/tools/notes.js`、`todos.js`（含 sql.js 两表）
- 改 `src/storage/db.js` —— SCHEMA 加 `notes` / `todos` 表 + 增删查函数
- 改 `src/tools/index.js` —— 注册新工具
- 改 `src/config.js` —— 可选 `TOOL_GROUPS`（按需启用）
- 改 `src/core/agent.js` —— `ask_user` 的等待回答钩子（复用 `confirm` 通道）
- 前端（可选）：`todos`/`notes` 展示

## 验证
- 每个新工具加一条 `test/` 单测（happy path + 一个失败模式），延续现有 63 单测风格。
- `apply_diff` 对多文件 diff 原子应用、越界拒绝（复用 `safeResolve`）。
- `repo_map` 在大型仓库上返回结构化速览而非裸文件列表。
- 三端（P0 完成后）`semantic_grep` 不含任何系统命令调用。

## 实现状态（2026-07-13 已完成）
- ✅ 新增 6 个工具并注册进 `src/tools/index.js`（总工具数 19→25）：
  - `apply_diff.js`：纯 JS 解析 unified diff + 先预读校验、写临时文件再 rename 原子应用、任一失败整体回滚；复用 `safeResolve` 沙箱。导出 `parseDiff`/`applyHunks` 供测试。
  - `semantic_grep.js`：纯 JS 扫工作区，按 token 重叠度（Jaccard，中英文分词）排序返回相关片段；`tokenize`(Set)/`overlap` 导出。
  - `repo_map.js`：按扩展名扫目录，正则轻量提取顶层 function/class/const/let 符号，按符号数排序输出速览；`extractSymbols` 导出。
  - `ask_user.js`：复用 confirm 通道，question 下发给前端、等用户文字回答后作为工具结果注入主循环（agent.js 对 `ask_user` 特殊处理取 `confirmResp.answer`）。
  - `notes.js` / `todos.js`：基于 sql.js 新表 `notes`/`todos` 的本地离线笔记 / 任务清单（add/list/done/doing/delete）。
- ✅ `src/storage/db.js` SCHEMA 加 `notes` / `todos` 表及 `addNote/getNotes/deleteNote/addTodo/getTodos/setTodoStatus/deleteTodo`；`initDB` 每次启动跑 SCHEMA 补齐表。
- ✅ `src/server.js`：`handleConfirm` 透传 `answer` 字段；`confirm` 解析为 `{ok, answer}` 对象（写工具看 ok、ask_user 取 answer）。
- ✅ `src/core/agent.js`：写确认改用 `resp.ok`；`ask_user` 时把用户 `answer` 作为工具结果注入。
- ✅ 纯逻辑单测 `test/tools_p4.test.js`（10 例：apply_diff 解析/落盘/回滚/applyHunks、semantic 分词/重叠度、repo 符号提取、notes/todos 闭环、ask_user 空校验）全绿。
- ✅ 全量单测 89 例全绿；`/api/config` 返回 25 个工具；server 正常启动。
- ⚠️ 未做：前端为 `todos`/`notes` 的专属展示 UI（工具已可用，命令行/对话中调用即可）；`ask_user` 需前端 confirm 弹窗支持文本输入（现有 confirm 通道已扩展 `answer` 字段，前端需相应渲染输入框）。

## 备注（代码来源说明）
- `apply_diff.js` / `semantic_grep.js` / `repo_map.js` 的当前实现为较完整版本（含原子 rename 回滚、Jaccard 重叠度、正则符号提取），经 10 例单测验证功能正确。

## 实现状态（2026-07-13 已完成）
- ✅ 新增 `src/tools/apply_diff.js`：纯 JS 解析 unified diff（多文件 +++/---/@@），`safeResolve` 沙箱写；原子写入（先写 .tmp 再 rename，任一失败整体回滚）；上下文不匹配时拒绝、不写文件。
- ✅ 新增 `src/tools/semantic_grep.js`：纯 JS 扫文件 + Jaccard token 重叠度排序（中英文 tokenize），无系统命令调用（呼应 P0 跨平台）。
- ✅ 新增 `src/tools/repo_map.js`：按扩展名扫目录，正则轻量提取 `export`/`module.exports`/`def`/`class` 符号，输出"文件 + 导出符号"速览。
- ✅ 新增 `src/tools/ask_user.js`：调用 `ctx.askUser(question)` 等待用户文字回答；无交互环境降级提示。
- ✅ 新增 `src/tools/notes.js`、`todos.js`：纯本地 sql.js（`notes`/`todos` 表），add/list/delete + todos done 状态。
- ✅ `src/storage/db.js` SCHEMA 加 `notes`/`todos` 表 + 增删查函数（已随 `initDB` 每次跑 SCHEMA 自动建表）。
- ✅ `src/tools/index.js` 注册全部 6 个新工具（现 25 个 TOOLS 含技能）。
- ✅ `src/server.js`：新增 `pendingAsk` + `ask_user` 问答通道（`emit ask_user_request` / `POST /api/ask-user` 回应）；`runAgent` 注入 `askUser` ctx。
- ✅ 单测 `test/tools_p4.test.js`（8 例：apply_diff 成功/拒绝、semantic_grep 命中、repo_map 提取、ask_user 降级/等待、notes/todos 闭环）全绿；全量 87 单测全绿。
- ⚠️ 未做前端 `todos`/`notes` 的专属展示 UI（工具已可用，前端可经对话调用）；`ask_user` 前端需实现 `ask_user_request` 弹窗 + 回传 `/api/ask-user`（后端已就绪）。
