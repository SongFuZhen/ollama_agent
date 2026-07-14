# 对比 Claude Code：能力差距与 Ollama 7B 小模型优化建议

> 本文档整理自一次针对 `ollama_agent` 现状的复盘：
> 1. 对比 Claude Code 的架构能力，找出我们目前的差距；
> 2. 结合公开实战资料，给出针对 Ollama 7B 级别小模型的具体、可落地优化建议。
>
> 检索参考（2026-07-14）：
> - DeepWiki: anthropics/claude-code System Architecture
> - 《Ollama Tool Calling 完全教程》blog.axiaoxin.com
> - 《Ollama 2026 最新实践：本地+云端+Agent 工具链》jishuzhan.net
> - n8n 社区：7B/14B 本地模型工具链「第二个工具不执行」问题

---

## 一、对比 Claude Code：我们现在的差距

基于 Claude Code 架构拆解（`claude` 命令 → 会话管理 → 工具执行引擎 → 多代理编排 → 插件/MCP 生态），按能力维度对比本项目现状。

| 能力 | Claude Code | ollama_agent 现状 | 差距 |
|------|-------------|-------------------|------|
| **Agent 循环** | 主代理 + 多子代理（Task 工具）分层编排 | 单代理循环 + 工具，无子代理 | ⚠️ 无 subagent 委派 |
| **上下文管理** | 自动压缩 + 会话持久化（`~/.claude/sessions`） | `src/core/compact.js` + 动态截断预算 | ✅ 已有，接近 |
| **工具系统** | 文件/Shell/权限分级 | 25 工具 + 沙箱 `safeResolve` | ✅ 基本齐 |
| **权限/确认** | 细粒度 allow/deny + 分类器 | `needConfirm` 字段 | ⚠️ 较粗，无 deny 分类 |
| **Hooks** | 事件钩子（pre/post tool） | `docs/superpowers` 计划中有，代码未见 | ❌ 未实现 |
| **Skills/Plugins** | 插件市场 + 技能系统 | `src/skills`（analyze 类） | ✅ 有雏形 |
| **MCP** | 完整 MCP 协议 + OAuth | 无 | ❌ 无（内网场景可省） |
| **后台任务** | 后台代理 + 崩溃恢复 | 无 | ❌ 无 |
| **流式 thinking** | 支持 | `streamThink` 已实现 | ✅ 已有 |
| **工具调用路线** | 原生 function calling | prompt 路线 + 原生可切换 | ✅ 优于预期 |

**核心差距**：
1. 无多代理/子代理委派（小模型最怕长任务，分层能救命）；
2. 无 Hooks 事件钩子；
3. 无会话持久化（重启丢上下文）；
4. 权限粒度粗（仅有确认，无 deny 分类）。

---

## 二、针对 Ollama 7B 小模型的具体优化建议

结合检索到的实战资料，落到**具体可操作**的点。

### 1. 模型选型（最关键）
- 7B 必须用 **tool-tuned** 模型，否则直接忽略工具。推荐：
  - `qwen2.5-coder:7b`（工具调用最稳）
  - `llama3.2:7b`（原生 tools 支持）
  - `deepseek-r1:8b`（本项目默认，走 prompt 路线更稳，已做）
- 当前 `DEFAULT_MODEL=deepseek-r1:8b` 合理，但 **8B 在纯 7B 任务上仍偏弱**。
  建议在沙箱机器上 `ollama pull qwen2.5-coder:7b` 做 A/B 对比。

### 2. 工具 Schema 优化（代码已部分做对）
- 本项目 `src/tools/schema.js` 生成语义化 JSON Schema——**描述要极具体**，
  模糊描述会让 7B 幻觉或跳过工具（axiaoxin 教程「坑一」）。
- 建议：每个工具 `description` 补一句「何时用」。例如 `grep` 明确写
  「检索代码关键字，返回 文件:行号:内容」。

### 3. 采样参数（检索资料缺失，给工程经验值）
- **temperature: 0.0~0.2**（工具调用要确定性，别让 7B 自由发挥）。
- 当前 `src/core/ollama.js` **未显式设置 temperature**——这是隐患。
  建议显式写：`options: { temperature: 0.1, top_p: 0.9 }`。

### 4. 上下文/输出长度（已知 7B 失败模式）
- 本项目已做 `TOOL_RESULT_MAX=6000` 截断 + `COMPACT_THRESHOLD=0.7` 压缩——
  正是资料强调的「工具结果过长 → 截断/越界」。✅
- 再加一项：**单工具结果也按 token 软截断**，避免一个大文件读穿上下文。

### 5. 多工具调用失败（n8n 经典坑）
- 7B/14B 经常**只执行第一个工具，丢掉第二个**（`2nd tool never executed`）。
- 本项目 `JSON_RETRY=2` 只重试解析。建议：
  - **一次只让模型调用一个工具**（prompt 路线天然是串行，比原生 tools 更稳）；
  - 保留 `assistant` 带 tool_calls 的消息在 history（本项目 `role:"user"` 路线已规避此坑）。

### 6. thinking 控制
- deepseek-r1 / qwen3 支持 `think`：简单任务关 thinking 提速，复杂多步开。
- 本项目已 `stripThink` 剥离推理块。✅

### 7. 容错（资料强调）
- 本项目工具错误返回字符串给模型（不崩溃循环）——符合
  「让模型自己理解失败并重试」最佳实践。✅

---

## 三、优先级行动清单

| 优先级 | 动作 | 理由 |
|--------|------|------|
| 🔴 高 | 在 `src/core/ollama.js` 显式设 `temperature: 0.1`（+`top_p: 0.9`） | 7B 工具调用确定性关键，当前疑似缺失 |
| 🔴 高 | 试用 `qwen2.5-coder:7b` 对比 `deepseek-r1:8b` | 7B 工具稳定性可能更好 |
| 🟡 中 | 工具 `description` 补「何时用」一句 | 降低 7B 跳过/幻觉工具概率 |
| 🟡 中 | 实现会话持久化（重启不丢上下文） | 对齐 Claude Code，内网拷贝即走也受益 |
| 🟢 低 | 加 Hooks 事件钩子 | Claude Code 差异化能力 |
| 🟢 低 | 子代理委派（长任务拆分） | 小模型抗长任务的最强手段 |

**建议起点**：先改 `ollama.js` 加 temperature + 拉 `qwen2.5-coder:7b` 测一轮——
这两步对 7B 效果提升最直接。
