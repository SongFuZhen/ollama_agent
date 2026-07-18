# Ason Agent 架构与设计要点

> 基于 Ollama 本地 7B/8B 模型的**内网零依赖本地 AI 助手**：数据不出内网、零 API 费用、复制即跑。
> 本文件是 `docs/` 下多份分析文档的合集精简版，聚焦「还能用得上」的核心设计。

---

## 一、定位与设计哲学

**一句话**：本地小模型（7B 级）的本地 AI 助手 —— 数据不出内网、零 API 费用、U 盘直拷即跑。

**核心等式**（贯穿整个项目）：

```
弱模型  +  强约束  +  真数据  =  不瞎编
```

7B 小模型的三大缺陷与工程化解法：

| 问题 | 解法 | 实现手段 |
|------|------|----------|
| 模型易编造代码 | 真数据优先 | Agent 主循环强制 tool-first |
| 模型不知何时停 | 强约束 | 单目录沙箱 + 写操作确认 |
| 长对话丢上下文 | 上下文压缩 | compact 自动摘要 |
| 跨会话无记忆 | 三级记忆召回 | L1 最近 → L2 语义 → L3 关联 |
| 改完代码不可控 | 验证闭环 | 改完自动跑 run_tests / run_lint |
| 怕模型乱改 | 规划模式 | /plan 只读调研 → 出计划 → 确认执行 |

**7B 能力边界**：
- 靠谱（⭐⭐⭐+）：单文件/模板代码生成、行级补全、代码解释、简单 Bug 修复、正则/SQL、文件读写搜索、单测生成、格式化重命名。
- 吃力（⭐⭐ 以下）：跨多文件架构设计、10+ 文件重构、精确工具调用（易幻觉）、超 4K token 长上下文推理、多步复杂调试。

> 直觉：**7B 不是"小号 Claude"，而是"另一种工具"**。把它从「理解+推理+执行」降级为「按模板填空」。
> 最该走的方向是**模板化 Agent 工作流引擎**：通用场景模板（代码审查 / Bug 定位 / 重构…）沉淀 → 打磨 Prompt 与步骤 → 用户用 yaml 声明式自定义 → 飞轮迭代。

**与竞品差异**（唯一一个零依赖、U 盘直拷、纯本地的本地 AI 助手；竞品都要某种安装）：
- Claude Code / Cursor：★★★★★ 商业闭源，需联网+API
- Aider+GPT4 / Cline：★★★★☆ 开源 + API
- Continue：★★★☆☆ 开源 IDE 插件
- ollama-local-coding-agent：零依赖，但无原生 Web UI、沙箱可选
- **Ason Agent：★★★☆☆，内网友好 ★★★★★（Web UI + 单目录强制沙箱 + 三级记忆 + 规划/验证闭环）**

---

## 二、技术架构

```
用户请求 → Web/CLI 前端 → Node 后端(Agent 框架) → Ollama API → 本地 7B 模型
                                     │
                                     └─ 工具调用层：文件读写 / 命令执行 / 代码搜索
```

**四大亮点**：
1. **零依赖架构** — 纯 Node 内置模块 + sql.js(WASM)，无 node_modules，npm install 可跳过；U 盘直拷到内网机器即跑。
2. **三级记忆系统** — L1 最近对话（短期）→ L2 语义召回（向量相似搜索）→ L3 跨会话关联。多数 Agent 只做 L1。
3. **三套命令优先级（确定性逃生舱）** — `!` 直接执行 shell > `@` 强制调工具 > `/plan` 只读规划 > 自然语言完整循环。小模型不靠谱时绕过模型直接驱动工具。
4. **写操作安全设计** — write_file / edit_file / apply_diff / bash / run_tests / run_lint 全部需用户确认；读操作无感通过。

### 2.1 LLM 集成 (`src/core/ollama.js`)
- 基于 Node 原生 `http`，零第三方依赖；支持非流式 `chat()` 与流式 `chatStream()`。
- **双路线工具调用**：
  - Prompt-based（默认）：工具列表注入 system prompt，模型输出 `{"action":"工具名","params":{}}` JSON，多层容错解析。
  - Native tools（仅白名单模型）：用 Ollama `tools` JSON Schema；失败时自动回退文本解析。
- **超时控制**：`STEP_TIMEOUT_MS=90s`，超时 `req.destroy()` 防进程假死。
- **推理模型**：deepseek-r1 等 `reasoning_content` 包装为 `<think>...</think>`。

### 2.2 模型配置 (`src/config.js`)
| 配置 | 默认值 | 说明 |
|------|--------|------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 地址 |
| `DEFAULT_MODEL` | `deepseek-r1:8b` | **建议改 `qwen2.5-coder:7b`**（编码更强） |
| `NUM_CTX` | `16384` | **建议默认 `8192`，高端配置再开 16K** |
| `STEP_TIMEOUT_MS` | `90s` | 单次调用超时 |
| `MAX_STEPS` | `6` | 最大循环步数（防空转） |
| `TEMP` | `0.1` | 小模型工具调用要确定性 |
| `JSON_RETRY` | `2` | JSON 解析失败重试 |

### 2.3 Memory 管理
- 消息结构：`[system]`（工具列表，永不清除）+ `[user/assistant]` 历史（最多 20 条）+ 当前输入 + 工具结果。
- **Token 截断** (`truncateMessages`)：`text.length/2.5` 估算，保留 system + 最近 K 条，超限丢最旧非 system 消息。
- **持久化** (`src/storage/db.js`)：sql.js（SQLite WASM，零原生编译），单文件 `data/conversations.db`。写操作防抖 200ms + 原子写；进程退出前同步落盘。

### 2.4 Tool Use
- 注册表：`src/tools/`（动作类：读/写/执行）+ `src/skills/`（分析/查看类：git_*、explain_symbol、find_references），合并为统一 `ALL`。
- 每个工具：`{ name, desc, params, needConfirm, run() }`。
- **调用工作流**：LLM 输出 JSON → `parseToolCall()`（代码块提取→剥注释→修尾逗号→双格式兼容）→ 白名单校验 → 重复检测（连续3次相同强制收尾）→ `needConfirm` 写操作确认 → 执行 → 结果截断 6000 字符回注。
- **路径沙箱** (`safeResolve`)：realpath 逐段校验越界与符号链接。
- **Native Schema** (`src/tools/schema.js`)：工具 spec 转 Ollama `tools` JSON Schema。

### 2.5 Agent Loop (`src/core/agent.js`)
```
messages = [system, ...history, userInput] → truncateMessages()
for step = 1 to MAX_STEPS:
    超时 → 强制收尾
    raw = chatStream(model, messages)         // 流式 + 分离 <think>
    call = parseToolCall(text)
    无调用 → 返回最终回答
    不存在/重复/需确认 → 处理
    result = tool.run(params, ctx)
    messages.push(assistant + 工具结果)
```
- **Think 块处理**：`<think>` 内容不参与工具解析，作为 `thought` 事件单独推送（前端折叠）。
- **重复调用检测**：`callKey = action + JSON(params)`；tree/list_dir 只查工具名；连续 2 次警告、3 次强制收尾。
- **安全边界**：路径沙箱 + 命令黑白名单 + 写确认 + 工具白名单 + 输出截断(6000) + 墙钟超时(90s) + 步数上限(6) + 请求体限制(1MB)。
- **自愈闭环**：每 2 步跑 run_tests/run_lint，失败注入真实报错，最多重试 3 次（`MAX_HEAL_STEPS`）+ 指数退避。绝不采信模型自述（含"退出码"即失败）。

### 2.6 前端（响应式 SPA，`public/`）
- 纯 vanilla JS + CSS，零前端框架：`state.js`（数据）/ `render.js`（渲染）/ `app.js`（交互）/ `api.js`（网络）。
- SSE 事件：`thinking_start / thought / token / stats / tool / tool_result / confirm_request / confirm_result / answer / error`。
- 双渲染引擎（marked / markdown-it + highlight.js），`DOMPurify.sanitize()` 净化防 XSS，支持 Mermaid。
- 底部状态栏：模型、消息数/TTFT/耗时、目录、git 分支、工具数、上下文用量进度条（>70% 黄，>90% 红）。
- 写操作确认卡片就地渲染，超时/断连自动视为拒绝。

### 2.7 对比强模型 Agent（Claude Code / OpenCode）的范式差异
| 维度 | 强模型 Agent | Ason Agent（弱模型） |
|------|--------------|----------------------|
| 模型角色 | 强引擎 | 弱引擎 |
| 框架角色 | 传输层 | babysitter（护栏） |
| 信任输出/判断/收敛/记忆/规划 | 是 | **否**，全部靠工程兜底 |

**7B 专项优化亮点**：验证器+自愈闭环、路径容错归一化、重复检测含路径参数、delegate 子代理（短上下文换可靠性）、`!`/`@` 直接调用逃生通道、JSON 多层容错、System 永不清除、三级记忆、指数退避、四层安全防护。

---

## 三、命令与工具参考

### 3.1 三套机制（不要混淆）
| 机制 | 位置 | 本质 | 触发 |
|------|------|------|------|
| 可执行 skill | `src/skills/`（git / analyze） | JS 函数模块 | `@skillName` 或模型自主调用 |
| 指令型 skill | `.agents/skills/`（→ `.claude/skills/`） | 纯 Markdown 提示词 | 模型按意图自动匹配，无触发符 |
| 前端 slash 命令 | `commands.js` | UI 快捷键 | `/命令名` 唤起弹窗 |

### 3.2 `@<命令>` 强制调用（绕过模型，直接执行）
- 格式：`@<工具或技能名> [key=value 参数]`，位置参数自动填入主参数。
- 写类命令执行前弹二次确认；未知命令回退普通对话。
- 可用：`@git_status` / `@git_log max=5` / `@git_diff path=src/x.js` / `@read_file src/x.js` / `@grep pattern=xxx path=src` / `@write_file path=.. content=..` 等（详见 `/skills`、`/tools`）。

### 3.3 `!<shell 命令>` 直接执行
- `!ls -la src/core` / `!git log --oneline -3` / `!npm test`。沿用 bash 确认流程，危险命令被安全策略拦截。
- 优先级：`!` > `@` > `/plan`。

### 3.4 前端 slash 命令
- 查看：`/skills` `/tools` `/help`
- 切换：`/models`
- 上下文：`/clear` `/compress` `/recall`
- 模式：`/plan`（只读调研 → 可确认执行计划）
- 工具箱（窄场景单轮命令，见下）

---

## 四、优化方向（按优先级）

**总体思路**：7B 根本问题是「推理弱 + 上下文短 + 易跑偏」。策略 = 降低模型负担（模板/示例/约束）+ 提高单步成功率（标准答案）+ 强化外部闭环（确定性代码判断）。

### P0（投入小、收益大，先做）
1. **Few-Shot 示例库** — 高频工具各附 1 个标准调用示例注入 system prompt（≤800 token）。
2. **任务模板** — `templates/`（fix-bug / add-function / refactor-rename / explain-code），关键词自动触发或 `/template` 手动调。
3. **工具调用预检查** — 文件存在性、参数类型、路径合理性，失败直接返回提示不浪费步数。
4. **System Prompt 硬约束** — 清单式「必须/禁止」（如：禁止未读就改、禁止连续调同工具>2次）。

### P1（P0 稳定后）
5. **工具结果摘要化** — read_file 首尾截断、bash 长输出保留 error 行、加机器摘要行。
6. **工作记忆注入** — 每轮在 messages 前注入「已读/已改/已知问题/当前目标」，永不截断。
7. **Plan Mode 结构化** — 强制输出固定 JSON 计划，前端渲染可勾选步骤列表。
8. **模型路由** — compact 用更小模型（如 qwen2.5:3b），小活小模型、大活大模型。

### P2（视情况）
9. **Plan-and-Execute 模式**（与 ReAct 并存）。
10. **工具结果缓存**（只读工具单轮内缓存，写操作后失效）。
11. **微调小模型**（LoRA，收集真实工具调用对）。

**度量指标（建议先埋点再优化）**：`json_parse_failures < 5%`、`avg_steps_to_converge < 4`、`repeat_tool_calls < 10%`、`task_success_rate > 80%`。

---

## 五、Quick Toolbox（窄场景单轮命令，7B 稳定可用）

> 思路：7B 在「单轮 + 单文件 + 固定 prompt」下稳定，在「多步推理 + 长上下文」基本失败。
> Toolbox 通过 `/api/quick` 走**全新单轮通道**，完全不经过 `runAgent`，与 Agent 循环并存。

**命令清单**（按可靠性）：
- P0（强项，先做）：`/explain <path>`、`/commit`、`/comment <path>`、`/review <path>`、`/error <报错>`
- P1：`/test <path>`、`/regex <需求>`、`/fix <path> <报错>`（唯一允许写，需确认）
- P2（视需求）：`/sql`、`/doc`、`/refactor`、`/rename`
- 明确不做：多文件改造、跨文件重构、新功能设计（提示换更强模型）

**边界**：完全不动 `src/core/agent.js`、现有 `/api/chat`、`src/tools/*`；仅新增 `src/core/quick/`（registry.js + runner.js + commands/）与 2 个路由（`/api/quick`、`/api/quick/commands`）；复用 `chatStream` / `safeResolve` / `getProjectRoot` 等。

---

## 六、模型选型推荐

| 模型 | 编码 | 中文 | 工具 | 推荐 |
|------|------|------|------|------|
| Qwen2.5-Coder-7B | ★★★★ | ★★★★★ | ★★★ | **首选** |
| DeepSeek-Coder-V2-Lite | ★★★★ | ★★★★ | ★★★ | 次选 |
| CodeLlama-7B | ★★★★ | ★★ | ★★ | 英文场景 |
| Mistral-7B-Instruct | ★★★ | ★★★ | ★★★★ | 通用 |
| Yi-Coder-9B | ★★★★ | ★★★★ | ★★★ | 超 7B 但值得 |

> 现默认 `deepseek-r1:8b` 偏重推理、编码非最强，建议切 `qwen2.5-coder:7b`；`NUM_CTX` 默认 `8192`。
