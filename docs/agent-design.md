# Ason Agent 设计文档

## 架构概览

```
用户输入 → HTTP SSE → Agent Loop → Ollama API → 模型推理
                         ↓
                    Tool Call 解析
                         ↓
                    Tool 执行 (沙箱)
                         ↓
                    反馈注入消息列表 → 下一轮循环
```

四个核心子系统：**LLM 集成**、**Memory 管理**、**Tool Use**、**Agent Loop**。

---

## 1. LLM 集成

### 1.1 通信层 (`src/core/ollama.js`)

基于 Node.js 原生 `http` 模块，零第三方依赖。支持两种调用模式：

| 模式 | 函数 | 用途 |
|------|------|------|
| 非流式 | `chat()` | 简单问答、模型列表查询 |
| 流式 | `chatStream()` | Agent 主循环，逐 token 推送前端 |

**流式调用流程：**
```
HTTP POST /api/chat (stream: true)
  → 逐行读取 NDJSON
  → 解析 content / reasoning_content
  → onToken 回调实时推送
  → onStats 回调推送性能指标 (TTFT, promptTokens, completionTokens)
```

**超时控制：** 每次调用设置 `STEP_TIMEOUT_MS`（默认 90s）定时器，超时直接 `req.destroy()`，防止模型假死导致 Agent 循环永久挂起。

**推理模型支持：** deepseek-r1 等模型的 `reasoning_content` 字段会被包装为 `<think>...</think>` 标签，与纯文本 `<think>` 块的检测逻辑统一处理。

### 1.2 双路线设计

系统支持两种工具调用路线，在 Agent 初始化时根据模型名判定：

```
supportsNativeTools(model)
  → 匹配 NATIVE_TOOLS_MODELS 列表
  → 命中: 走原生 tools API（tool_calls 字段）
  → 未命中: 走 prompt-based 路线（JSON 文本解析）
```

**Prompt-based 路线（默认，绝大多数模型走这条）：**
- 工具列表以 Markdown 格式注入 system prompt
- 模型输出 JSON 文本：`{"action":"工具名","params":{}}`
- Agent 解析文本中的 JSON，提取工具调用

**Native tools 路线：**
- 工具定义转为 Ollama `tools` 字段（JSON Schema 格式）
- 模型返回 `tool_calls` 数组
- 失败时自动回退到文本 JSON 解析

**选择理由：** 大多数社区 tool-calling 模型（如 MFDoom）实际上只输出 JSON 文本，走 prompt 路线更稳定。只有经验证支持原生 tools API 的模型才加入白名单。

### 1.3 模型配置 (`src/config.js`)

```js
OLLAMA_HOST      // Ollama 服务地址，默认 http://localhost:11434
DEFAULT_MODEL    // 默认模型，默认 deepseek-r1:8b
STEP_TIMEOUT_MS  // 单次调用超时 90s
NUM_CTX          // Context window 大小 16384
MAX_STEPS        // 最大循环步数 6
JSON_RETRY       // JSON 解析失败重试 2 次
```

所有配置可通过环境变量覆盖，方便部署时一行命令调整。

---

## 2. Memory 管理

### 2.1 会话记忆 — 消息列表

Agent 循环的消息结构：

```
[system]  ← 工具列表 + 指令（每次循环不变）
[user]    ← 历史消息（role=user/assistant，最多 20 条）
[user]    ← 当前输入
[assistant]  ← 模型输出（每步追加）
[user/tool]  ← 工具执行结果（每步追加）
```

**两种消息格式：**
- Prompt-based：`{ role:'assistant', content }` + `{ role:'user', content: '工具 X 返回:\n...' }`
- Native tools：`{ role:'assistant', content, tool_calls }` + `{ role:'tool', content }`

### 2.2 Token 截断 (`truncateMessages`)

防止对话历史超出模型的 context window：

```
策略：
1. 估算 token：text.length / 2.5（中英文混合保守估算）
2. 限制 = NUM_CTX - 2048（2048 留给模型输出）
3. 从旧到新累加，system 消息永不清除
4. 超限时丢弃最旧的非 system 消息
5. 作为最后兜底：截断当前输入内容并加提示
```

**设计要点：** system prompt 中的工具列表不可丢弃（否则模型不知道可用工具有哪些），所以 system 消息始终保留。

### 2.3 持久化存储 (`src/storage/db.js`)

SQLite（better-sqlite3），WAL 模式。三张核心表：

```
devices (id, hostname, username, platform, arch, mac, first_seen, last_seen)
  → 设备注册和追踪

conversations (id, device_id, title, project_root, created_at, updated_at)
  → 对话元信息，关联设备

messages (id, conversation_id, role, content, tools, thinks, images, stats, timestamp)
  → 完整消息记录，JSON 字段存储工具调用/思考/性能
```

**消息字段：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | TEXT | 消息正文 |
| `tools` | TEXT(JSON) | 该轮调用的工具列表 |
| `thinks` | TEXT(JSON) | 推理模型的思考过程 |
| `images` | TEXT(JSON) | 多模态图片路径 |
| `stats` | TEXT(JSON) | TTFT、总耗时、token 数 |

**会话统计：** `getConversationStats()` 聚合所有 assistant 消息的 stats 和 tools，计算平均 TTFT 和各工具调用频率。

---

## 3. Tool Use

### 3.1 工具注册表 (`src/tools/index.js`)

```
TOOLS (动作类)  +  SKILLS (分析/查看类)  =  ALL (统一注册表)
```

**架构：**
```
src/tools/           ← 动作类工具（读/写/执行）
  read_file.js        每个文件 export { name, desc, params, needConfirm, run() }
  list_dir.js
  write_file.js
  bash.js
  glob.js
  grep.js
  edit_file.js
  read_lines.js
  tree.js
  count_loc.js
  test/
    run_tests.js
    run_lint.js

src/skills/           ← 分析/查看类技能
  git/
    git_status.js
    git_diff.js
    git_log.js
    git_show.js
  analyze/
    explain_symbol.js
    find_references.js
```

**工具定义结构：**
```js
{
  name: 'read_file',                    // 工具名（LLM 看到的标识）
  desc: '读取项目内文件内容',            // 中文描述（注入 system prompt）
  params: { path: '相对项目根的文件路径' }, // 参数说明
  needConfirm: false,                   // 是否需要用户二次确认（写操作=true）
  async run({ path }, ctx) { ... }      // 执行函数
}
```

### 3.2 工具调用工作流

```
1. LLM 输出 JSON
2. parseToolCall() 解析
   ├── 提取 ```json ... ``` 代码块（优先）
   ├── 或用 { 到 } 之间内容
   ├── stripJSONComments(): 移除 // 和 /* */ 注释 + 尾部逗号
   ├── JSON.parse()
   └── 兼容 MFDoom 格式 {name, parameters/arguments/args} → {action, params}
3. 白名单校验: isAllowed(action)
4. 重复调用检测: 连续3次相同调用 → 强制收尾
5. needConfirm 写操作 → 弹出确认
6. tool.run(params, ctx) 执行
7. 结果截断到 6000 字符 → 注入消息列表
```

### 3.3 路径沙箱

所有文件操作经过 `safeResolve()`：

```
safeResolve(相对路径, 沙箱根)
  → realpath 解析沙箱根
  → resolve 拼接绝对路径
  → realpath 逐段校验：不包含 .. 越界
  → 符号链接也受限
  → 越界则抛错
```

### 3.4 JSON 解析容错

针对小模型常见的格式错误，`parseToolCall()` 做了多层容错：

1. **代码块提取** — 优先匹配 ` ```json ` 内内容
2. **注释剥离** — 移除 `//` 行注释和 `/* */` 块注释
3. **尾部逗号修复** — `{"a":1,}` → `{"a":1}`
4. **双格式兼容** — `{action, params}` 和 `{name, parameters}`
5. **think 块回退** — 若 answerBuffer 为空，从 `raw` 中去掉 `<think>` 后再解析

### 3.5 Native Tools Schema (`src/tools/schema.js`)

将工具 spec 转为 Ollama 原生 `tools` JSON Schema：

```js
{
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取项目内文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的文件路径' }
      },
      required: ['path']  // 不含"可选"或"默认"的参数标记为 required
    }
  }
}
```

---

## 4. Agent Loop

### 4.1 核心循环 (`runAgent`)

```
输入 → [Step 1] → [Step 2] → ... → [Step N] → 输出
         ↓             ↓
      LLM调用       LLM调用
      → JSON解析    → JSON解析
      → 工具执行    → 工具执行
      → 结果反馈    → 结果反馈
```

**伪码流程：**
```
messages = [system, ...history, userInput]
truncateMessages(messages)

for step = 1 to MAX_STEPS:
    if 超时 → 强制收尾，break
    
    raw = chatStream(model, messages)  // 流式 + 解析 think 块
    
    // 分离 think 和 answer
    text = answerBuffer || stripThink(raw).rest
    
    // 解析工具调用
    call = parseToolCall(text)
    if 无工具调用 → 返回 text 作为最终回答
    
    // 安全校验
    if 工具不存在 → 拒绝，提示模型换工具，continue
    if 连续3次相同调用 → 强制收尾
    if 需要确认 → 等待用户确认
    
    // 执行
    result = await tool.run(params, ctx)
    
    // 反馈
    messages.push({ assistant: text })
    messages.push({ user: '工具返回:\n' + result })
```

### 4.2 Think 块处理

推理模型（deepseek-r1）在 `<think>...</think>` 中输出推理过程。处理策略：

```
流式接收 token
  ├── 遇到 <think> → 进入思考缓冲模式，不推送到前端
  ├── 遇到 </think> → 退出思考模式，emit thought 事件
  ├── 思考块外 → answerBuffer 累积，emit token 实时推送
  └── 流结束仍未闭合 → 缓冲内容作为思考输出
```

**答案组装优先级：**
1. `answerBuffer`（think 块外的内容）
2. `stripThink(raw).rest`（去掉 think 块后的 raw）
3. `stripThink(raw).think`（整个回答都在 think 内）
4. `raw`（兜底）

### 4.3 重复调用检测

防止模型陷入死循环（对同一工具反复调用）：

```js
// tree/list_dir 只检查工具名（不同路径也视为重复）
// 其他工具：工具名 + 参数 JSON 组合作为 key
callKey = action + ':' + JSON.stringify(params)

连续3次相同 → 强制收尾："请基于已获取的数据回答"
连续2次相同 → 警告提示，不阻止但给反馈
```

### 4.4 安全边界

| 层级 | 机制 | 说明 |
|------|------|------|
| 路径安全 | `safeResolve()` | 沙箱越界检测，含符号链接 |
| 命令安全 | 黑名单 (`rm -rf /`, `mkfs` 等) | bash 工具前置检查 |
| 写操作确认 | `needConfirm` + 二次确认弹窗 | 前端 SSE 双向确认 |
| 工具白名单 | `isAllowed()` | 未知工具直接拒绝 |
| 输出截断 | `RESULT_MAX = 6000` | 防止工具结果撑爆 context |
| 墙钟超时 | `AGENT_TIMEOUT_MS = 90s` | 全局超时强制收尾 |
| 步数上限 | `MAX_STEPS = 6` | 防止无限循环消耗 token |
| 请求体限制 | `MAX_BODY = 1MB` | DoS 防护 |

### 4.5 流式推送事件

Agent 循环通过 `emit(event)` 实时推送状态到前端（SSE）：

| 事件类型 | 触发时机 | 关键字段 |
|----------|----------|----------|
| `thinking_start` | 检测到 `<think>` 开始 | step |
| `thought` | think 块结束 | step, content |
| `token` | 每个文本 token | step, content |
| `stats` | 每次 LLM 调用完成 | ttft, total, promptTokens |
| `tool` | 工具执行前 | step, action, params |
| `tool_result` | 工具执行后 | step, action, result |
| `confirm_request` | 写操作待确认 | id, action, params |
| `confirm_result` | 用户确认结果 | ok |
| `answer` | 最终回答 | content |
| `error` | 异常 | msg |

### 4.6 多模态支持

Agent 支持图片输入（`images` 参数），走 Ollama 多模态格式：`{ role:'user', content, images: [] }`。图片上传到 `photos/<日期>/<对话ID>/` 目录，路径随对话持久化。

---

## 5. 数据流全景

```
浏览器                     HTTP Server              Agent Engine
  │                           │                        │
  ├─ POST /api/chat ─────────→│                        │
  │  { message, images,       │                        │
  │    model, history }       │                        │
  │                           ├─ runAgent() ──────────→│
  │                           │                        ├─ truncateMessages()
  │                           │                        ├─ systemPrompt(specs)
  │                           │                        │
  │                           │    ←─── SSE ────       ├─ chatStream()
  │  ←── token 事件 ──────────│                        │   (Ollama /api/chat)
  │  ←── thought 事件 ────────│                        │
  │  ←── stats 事件 ──────────│                        │
  │                           │                        ├─ parseToolCall()
  │                           │                        ├─ isAllowed()
  │                           │                        ├─ repeatCheck()
  │                           │                        │
  │  ←── confirm_request ────│                        ├─ confirm()
  │  ── POST /api/confirm ──→│──→ pendingConfirm ────→│
  │                           │                        │
  │                           │                        ├─ tool.run(params, ctx)
  │  ←── tool 事件 ──────────│                        │
  │  ←── tool_result 事件 ───│                        │
  │                           │                        │
  │                           │                        ├─ addStepMessages()
  │                           │                        ├─ next step...
  │                           │                        │
  │  ←── answer 事件 ────────│                        ├─ return final answer
  │                           │                        │
  │  ←── SSE 流关闭 ─────────│                        │
```

---

## 6. 关键设计决策

1. **零第三方 HTTP 依赖** — 用 Node 原生 `http` 模块直连 Ollama，减少链路开销和故障面
2. **Prompt-based tool calling 为默认** — 社区小模型原生 tools API 不稳定，JSON 文本解析 + 多层容错更可靠
3. **System message 永不清除** — 工具列表在 system prompt 中，截断历史时跳过 system，保证模型始终知道可用工具
4. **写操作二次确认** — 通过 SSE `confirm_request/confirm` 双向通信，前端弹出确认框，避免误写
5. **多重收尾机制** — 步数上限 + 墙钟超时 + 重复调用检测，三层保障防止 Agent 空转
6. **推理模型透明化** — `<think>` 内容不参与工具解析，但作为 `thought` 事件单独推送，前端可折叠展示

---

## 7. 响应式 UI 架构

### 7.1 总体设计

```
前端(SPA)                          后端
  state.js ←── SSE 事件流 ──── agent.js (emit)
  render.js                        server.js (SSE)
  app.js                           db.js
```

纯 vanilla JS + CSS，零前端框架。模块按职责拆分：`state.js` 管数据，`render.js` 管渲染，`app.js` 管交互流程，`api.js` 管网络。

### 7.2 状态管理 (`state.js`)

单一全局 `state` 对象，无 Redux/MobX：

```js
state = {
  session,              // 当前消息容器 DOM
  conversationId,       // 对话 ID（URL hash 同步）
  busy,                 // 请求进行中标志
  streamingAnswer,      // 当前流式气泡 DOM
  streamingSteps,       // 思考/工具步骤容器 DOM
  streamingText,        // 流式累积文本
  streamingThink,       // 当前思考块 DOM
  activeModel,          // 用户选择的模型
  installedModels,      // Ollama 已安装模型列表
  tools,                // 后端工具规格（meta 事件注入）
  currentProjectRoot,   // 当前沙箱根
  sessionStats,         // 会话级统计 { toolCounts, ttftSum, contextTokens, ... }
  gitBranch,            // 当前目录 git 分支
}
```

**关键设计：** `streamingAnswer` / `streamingSteps` / `streamingThink` 在流式过程中持续引用当前消息的各部分 DOM，到达后置 null 表示本轮完成。

### 7.3 SSE 事件 → DOM 渲染管线

```
SSE data: 行 → JSON.parse → handleEvent(ev)
  ├── meta        → 注入 tools 列表
  ├── thinking_start → 创建思考块 <think-block>（折叠态）
  ├── thought     → 写入思考内容
  ├── tool        → 创建工具调用块（图标+参数+加载态）
  ├── tool_result → 回填工具结果，替换"执行中…"
  ├── token       → 追加到气泡，实时 re-render markdown
  ├── stats       → 写入气泡 footer (TTFT/耗时)，更新状态栏
  ├── confirm_request → 弹出确认卡片，等待用户点击
  ├── confirm_result  → 显示确认结果
  ├── answer      → 最终化气泡内容
  └── error       → 追加错误步骤
```

**渲染要点：**
- `ensureMessageContainer()` — 首个 token/tool 到达时创建消息 DOM 骨架（steps 容器 + 气泡 + footer）
- `appendToken()` — 每个 token 触发 `renderMarkdown(state.streamingText)` 全量重渲染（markdown 是上下文相关的，增量追加不可靠）
- `appendThinkBlock()` — 默认折叠（`data-collapsed=true`），点击展开/收起
- `appendToolCall()` — 不传 result 时显示加载态 spinner + "执行中…"，result 到达后 `updateToolResult()` 替换
- `finalizeAnswer()` — 标记 answer-card 完成，触发 mermaid 渲染，清理残留加载态，保存对话到 DB

### 7.4 思考块渲染（推理模型）

```
token 流解析:
  ┌─ <think> 出现 → inThinkBlock=true → 停止推送前端，缓冲到 thinkBuffer
  │                 emit 'thinking_start'
  ├─ </think> 出现 → inThinkBlock=false → emit 'thought' (完整思考内容)
  │                 前端创建 .think-block（默认折叠）
  ├─ 普通 token → 不在 think 内 → answerBuffer 累积 → emit 'token'
  │               前端实时 append 到 .bubble
  └─ 流结束仍 open → 缓冲内容作为 thought 输出（部分模型省略 </think>）
```

**前端展示：** think-block 默认折叠，标题 "思考过程 ▶"，点击展开后显示 "思考过程 ▼"。tool-block 执行中保持展开，有结果后默认折叠。

### 7.5 消息气泡渲染

```html
<div class="msg agent answer-card">
  <div class="steps">       <!-- 思考 + 工具步骤（独立于气泡） -->
    <div class="think-block">...</div>
    <div class="tool-block">...</div>
  </div>
  <div class="bubble mdit"> <!-- Markdown 渲染的气泡 -->
    <p>回答内容</p>
    <pre class="hljs"><code>...</code></pre>
  </div>
  <div class="answer-footer">
    <span class="role">deepseek-r1:8b</span>
    <span class="time">14:32</span>
    <span class="stats">TTFT: 234ms | 总耗时: 12.3s</span>
    <button class="copy">...</button>
  </div>
</div>
```

**双渲染引擎：** 默认 `marked`，可选 `markdown-it` + `highlight.js`（路由由 `mdEngine()` 控制）。输出经 `DOMPurify.sanitize()` 净化，阻断 XSS。支持 Mermaid 图表（`renderMermaidBlocks` 将 `<code class="language-mermaid">` 替换为 SVG）。

### 7.6 状态栏 + 上下文可视化

底部状态栏实时展示：

| 字段 | 来源 | 说明 |
|------|------|------|
| 模型 | `state.activeModel` | 当前下拉选中的模型 |
| 消息数/TTFT/耗时 | `state.sessionStats` | 从 stats 事件累计 |
| 目录 | `effectiveRoot()` | 当前沙箱根最后一段 |
| git 分支 | `state.gitBranch` | 异步查询 `/api/fs/git-branch` |
| Tools/Skills 数 | `state.tools` | 点击弹出工具/技能列表 |
| 上下文用量 | `contextTokens / contextLimit` | 进度条 + 百分比，>70% 黄色，>90% 红色 |

**上下文查询：** stats 事件的 `promptTokens` 即当前上下文用量；`/api/model/context` 查询模型 context window 上限。切换模型时重置统计。

### 7.7 确认机制（写操作）

```
SSE: confirm_request { id, action, params }
  → appendToActive(confirm-card)
  → 用户点 [确认写入] → POST /api/confirm { id, ok: true }
  → 用户点 [拒绝]     → POST /api/confirm { id, ok: false }
  → 后端 pendingConfirm Map 拿到结果 → agent loop 继续/跳过
```

卡片在消息流中就地渲染，不阻塞其他 SSE 事件。超时或连接断开时自动视为拒绝。

### 7.8 对话持久化

```
saveConversation():
  收集 DOM 中所有 .msg 元素
    → user: .bubble textContent + images[].path
    → agent: .bubble textContent + .steps 中的 think/tool 块
        + .answer-footer .stats 的 ttft/total
    → POST /api/conversation { id, title, messages }

加载:
  GET /api/conversations       → 历史列表
  GET /api/conversation/:id    → 完整消息 + 统计
      → 逐条重建 DOM（按保存顺序交替恢复 think/tool/content）
      → 恢复上下文用量、TTFT 累计
      → 恢复项目目录与文件树
```

### 7.9 用户交互

| 功能 | 实现 |
|------|------|
| 发送 | Enter 发送，Shift+Enter 换行 |
| 中止 | 发送按钮变为方框中止按钮，AbortController 中断 fetch |
| 图片 | 粘贴/拖拽/选择，上传到 `photos/<日期>/<对话ID>/` |
| 模型切换 | `/models` 命令或状态栏点击，持久化 localStorage |
| 历史 | 左侧抽屉，支持加载/删除（二次确认） |
| URL 持久化 | `#/session/<id>` hash，刷新恢复 |
| 热重载 | EventSource `/api/hotreload`，`public/` 变更自动刷新 |
| 新对话 | 左上角按钮，清空 DOM + 生成新 ID |

---

## 8. 对比 Claude Code：缺失设计

以下参照 Claude Code / Cursor / Copilot Chat 等成熟 Agent 产品，梳理当前尚未实现的关键设计。

### 8.1 规划与任务分解 (Plan Mode)

**现状：** Agent 循环是单纯的「理解→调工具」往复，无显式规划步骤。模型面对复杂任务时容易跑偏，反复调用无关工具。

**Claude Code 做法：** 进入 plan mode 后，先让模型输出完整执行计划（文件列表、修改范围、步骤顺序），用户确认后再逐步实施。

**建议实现：**
```
用户输入 → 检测复杂度 → 若复杂则先输出计划
  plan = LLM(userInput + "请先列出执行计划")
  emit({ type:'plan', steps: [...] })
  等待用户确认
  for each step in plan:
    runAgent(step.prompt)
```

关键点：计划步骤可被编辑、跳过、重排；规划阶段限制工具调用（只读，不写）。

### 8.2 子代理委托 (Sub-agent Delegation)

**现状：** 单一 Agent 循环，所有工具调用串行执行。无法并行搜索多个目录、同时分析多个文件。

**Claude Code 做法：** 主 Agent 可 spawn 多个子 Agent 执行独立子任务（搜索、分析），结果汇总回主 Agent。

**建议实现：**
```
runAgent:
  if 任务可并行分解:
    results = await Promise.all([
      spawnSubAgent("搜索前端组件引用", { tools: [grep, glob] }),
      spawnSubAgent("搜索后端路由定义", { tools: [grep, glob] }),
    ])
    messages.push({ role:'user', content: '子任务结果:\n' + results.join('\n') })
```

关键点：子 Agent 共享沙箱根但独立 messages 上下文；子 Agent 工具集可裁剪（只读子集）；超时独立控制。

### 8.3 工作区隔离 (Worktree Isolation)

**现状：** Agent 直接操作真实文件系统。对于有破坏性风险的操作（重构、批量重命名），无沙盒副本机制。

**Claude Code 做法：** `git worktree` 创建临时分支工作区，Agent 在隔离副本中操作，确认后再合并回主分支。

**建议实现：**
```
确认执行高风险操作时:
  worktree = git worktree add /tmp/agent-{uuid} main
  ctx.root = worktree.path
  // 执行操作...
  // 完成后提示用户 git diff 对比、确认合并
```

### 8.4 钩子系统 (Hooks)

**现状：** 无生命周期扩展点。无法在工具执行前后插入自定义逻辑（通知、审计、审批流程）。

**Claude Code 做法：** 配置文件定义 hooks，支持 `pre-tool`、`post-tool`、`on-error` 等事件，可执行 shell 命令或调用外部 API。

**建议实现：**
```json
// .claude/settings.json
{
  "hooks": {
    "pre:bash": "echo 'about to run: {command}' >> audit.log",
    "post:write_file": "git add {path}",
    "on:error": "curl -X POST webhook.example.com/alert"
  }
}
```

### 8.5 内存与知识持久化 (Memory Beyond Conversation)

**现状：** 对话历史按 session 持久化，但跨对话知识完全丢失。每次新对话，模型对用户偏好、项目约定一无所知。

**Claude Code 做法：** `CLAUDE.md` 文件 + 持久化 memory 系统，记录用户角色、反馈偏好、项目决策背景。

**建议实现：**
```
memory 类型:
  user:     用户角色、偏好、知识背景
  feedback: 用户纠正过的行为模式
  project:  项目目标、截止日期、关键决策
  reference: 外部资源链接（Linear、Grafana、Slack 频道）

每次对话初始化:
  system prompt += 读取 memory/*.md → 注入为上下文
```

### 8.6 上下文压缩 (Context Compaction)

**现状：** `truncateMessages` 简单丢弃旧消息。工具返回的大量输出（如 grep 结果 6000 字符）直接注入历史，迅速占满 context window。

**Claude Code 做法：** 当上下文接近上限时，调用小模型对历史做摘要压缩，保留关键信息的同时大幅减少 token 消耗。

**建议实现：**
```
当 contextTokens > contextLimit * 0.7:
  summary = await chat(compactModel, [
    { role:'user', content: '请将以下对话历史压缩为摘要：\n' + oldMessages }
  ])
  messages = [system, summary, ...recentMessages]
```

### 8.7 结构化输出 / 类型安全

**现状：** 工具调用 JSON 靠 `parseToolCall()` 的宽松解析，经常遇到格式错误（尾部逗号、注释、未闭合引号）。重试机制（`JSON_RETRY=2`）是唯一兜底。

**Claude Code/API 做法：** 使用 `response_format: { type: "json_object" }` 或 `tool_choice` 强制 JSON 输出；OpenAI 的 `strict` 模式确保 schema 完全匹配。

**建议实现（依赖模型支持）：**
```
// Ollama 尚未广泛支持 structured output
// 当前方案：多层 JSON 容错（注释剥离、逗号修复、代码块提取）
// 后续：接入支持 json_mode 的模型时切换为强制 JSON 模式
```

### 8.8 对话回溯与分支

**现状：** 对话线性推进。用户无法回到某个步骤分叉尝试不同方案，只能重新开始。

**Claude Code 做法：** 每个用户输入都是一个分支点，可以回溯到任意位置重新出发。

**建议实现：**
```
messages 表增加 parent_id 字段:
  conversation → message (parent=null)
    ├── message (分支A)
    │   ├── message
    │   └── message
    └── message (分支B, 回溯后重新生成)
        └── message

前端: 分支位置显示 "↩" 按钮，点击创建新分支
```

### 8.9 权限分级系统

**现状：** 工具只有 `needConfirm: boolean` 二分。无「该会话始终允许」「该目录始终允许」的细粒度控制。

**Claude Code 做法：** 四级权限模型——deny / prompt / allow-once / allow-always，支持按工具、按路径、按会话范围配置。

**建议实现：**
```yaml
permissions:
  bash:
    default: confirm
    rules:
      - pattern: "echo|ls|cat|head|tail"
        action: allow
      - pattern: "rm|mv|chmod"
        action: deny
  write_file:
    default: confirm
    paths:
      - "src/components/**" → allow
      - "*.config.js" → confirm
```

### 8.10 后台任务与通知

**现状：** Agent 执行期间前端阻塞（busy 态），无法发起新对话或切换会话。长任务（如 `npm install`）无后台执行能力。

**Claude Code 做法：** 长任务 spawn 到后台，完成后通过通知提醒用户。

**建议实现：**
```
bash(command, { background: true }):
  taskId = uuid()
  spawn(command, {
    onComplete: () => emit({ type:'task_done', taskId })
  })
  emit({ type:'task_started', taskId })
  // 前端: 显示后台任务气泡，带进度/取消
```

### 8.11 缺失功能优先级矩阵

| 功能 | 复杂度 | 收益 | 依赖 |
|------|--------|------|------|
| 上下文压缩 | 中 | 高 — 直接提升长对话体验 | 无 |
| 权限分级 | 中 | 高 — 减少确认打断 | 无 |
| 记忆系统 | 低 | 高 — 跨对话知识保留 | 无（文件系统即可） |
| 钩子系统 | 中 | 中 — 自动化工作流 | 配置文件设计 |
| 规划模式 | 高 | 高 — 复杂任务准确率 | 需模型配合 |
| 后台任务 | 中 | 中 — 不阻塞 UI | 进程管理 |
| 子代理 | 高 | 高 — 并行加速 | 上下文隔离 |
| 工作区隔离 | 中 | 中 — 安全性 | git worktree |
| 对话分支 | 高 | 中 — 探索性对话 | 数据结构改造 |
| 结构化输出 | 低 | 中 — 解析可靠性 | 模型支持 |
