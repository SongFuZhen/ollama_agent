# 头脑风暴：下一轮优化方案

> 日期：2026-07-15
> 背景：P0-P4 路线图（跨平台 / 三级记忆 / 工作流 / 上下文 / 工具）已全部完成；
>       代码审查（CODE_REVIEW_REPORT）遗留 3 项低优先级待办（T1-T3）；
>       同类项目调研（similar-projects-comparison.md）给出可借鉴方向。
> 性质：**头脑风暴 + 候选清单**，非执行计划。每条标注「来源」与「优先级初判」，待评审后筛选落地。
> 硬约束（继承，全程遵守）：
> - 零原生编译依赖、U 盘直拷即跑；新增依赖须纯 JS。
> - 完全离线、内网断网；不调任何云 API。
> - 三端可跑（Windows / macOS / Linux）。

---

## 一、清尾：审查遗留待办（T1-T3）

来自 CODE_REVIEW_REPORT §3.2，已知、低风险、应优先消化。

| # | 来源 | 内容 | 建议做法 | 优先级 |
|---|------|------|----------|--------|
| T1 | 审查 | `db.initDB` 并发可能重复初始化 | `ensureDB` 内用 promise 单例做防重入锁 | 低（但简单，顺手做） |
| T2 | 审查 | `resolveMode` 在 `explicitMode==='plan'` 时未剥离 `/plan` 前缀 | 加前缀剥离分支 | 低 |
| T3 | 审查 | `test/llm_tools.test.js` 需真 Ollama，被 `node --test test/` 收集后离线挂起，致 `npm test` 不退出 | 移入 `test/e2e/` 或 `--test-name-pattern` 排除 | **中**（影响 CI，建议优先） |

---

## 二、架构/健壮性（来自代码分析）

来自本轮「按逻辑整理」时发现的代码异味（未在轻量整理中动）。

| # | 内容 | 做法 | 收益 | 优先级 |
|---|------|------|------|--------|
| A1 | `src/core/agent.js` 过载（~600 行，混跑循环 + token 预算 + 读写分类） | 抽 `estimateTokens`/`truncateMessages` 到 `src/core/context.js`（或并入 `compact.js`） | 单一职责，便于单测 | 中 |
| A2 | `src/server.js` 仍较大（抽热重载后 ~660 行，含对话 CRUD 胶水 ~70 行） | 抽 `src/server/conversations.js` 处理对话增删改查 | 路由与持久化解耦 | 中 |
| A3 | 工具「只读/可写/需确认」元数据散落：agent.js 硬编码 READONLY/WRITE 集 + 各工具 `needConfirm` | 建集中式工具元数据表，agent.js 与 tools/index.js 共用 | 模式判定单一数据源 | 低 |
| A4 | skills 反向依赖 tools（`skills/analyze/*` require `../../../tools/grep`） | 显式声明单向依赖，或把 analyze/git 技能并入 tools 树 | 理顺分层 | 低 |

> A1-A4 属「深度重构」范围，用户此前选了轻量整理，故列为下一轮候选。

---

## 三、能力对齐竞品（来自同类调研）

对标 Aider / OpenCode / ollama-local-coding-agent 的可借鉴项。

| # | 来源 | 内容 | 做法（须满足硬约束） | 优先级 |
|---|------|------|----------------------|--------|
| C1 | Aider | **Repo Map / git 优先**：当前 `repo_map` 已有，但 git 工作流弱 | 强化 git 状态感知；写操作后可选自动 commit（需用户确认）；把 git 信息注入 plan | 中 |
| C2 | OpenCode | **build/plan Agent 权限分离**：当前仅 READONLY/WRITE 两档 | 细化模式（如 plan 完全只读、execute 才放开 bash），与现有 `/plan` 二段式融合 | 中 |
| C3 | ollama-local-coding-agent | **并行工具调用**：当前每步单工具 | 主循环支持一轮并行 tool call（弱模型需谨慎，避免互相依赖错乱） | 低（弱模型收益有限） |
| C4 | ollama-local-coding-agent | **`--json` 输出 / 可集成**：当前偏交互 | 提供 JSONL / 非交互输出模式，便于脚本/CI 调用 | 低 |
| C5 | Open WebUI | **MCP / 插件生态**：当前工具/技能硬编码 | 若未来开放生态，定义工具注册协议（MCP 或 OpenAPI）；当前不急 | 低（防范围蔓延，暂不做） |

---

## 四、体验/前端（已知缺口）

来自路线图 §执行状态尾注 + 审查风险。

| # | 内容 | 做法 | 优先级 |
|---|------|------|--------|
| U1 | `ask_user` 前端弹窗 + `/api/ask-user` 回传未完成 | 补 `ask_user_request` 弹窗与回传链路 | 中（功能闭环） |
| U2 | `notes`/`todos` 无专属展示 UI（后端就绪，仅对话调用） | 轻量面板/列表展示 | 低 |
| U3 | 历史依赖前端 DOM 文本收集（审查风险 3） | 改为后端消息结构为准，前端只渲染；降低渲染结构耦合 | 中（健壮性） |
| U4 | 取消链路依赖客户端断连（审查风险 1），未来若换 WebSocket 需应用层信号 | 预留应用层取消事件，不绑死 `res.on('close')` | 低（前瞻） |

---

## 五、测试/质量

| # | 内容 | 做法 | 优先级 |
|---|------|------|--------|
| Q1 | 离线 `npm test` 因 T3 挂起 | 同 T3；修后确保 `npm test` 离线可退出 | 中（与 T3 合并） |
| Q2 | 端到端仅模块加载 + 纯逻辑单测，Ollama 在线路径未冒烟 | 本机起 Ollama + `ollama pull nomic-embed-text` 后跑 `test/e2e/` 冒烟 | 中 |
| Q3 | `tools_p4.test.js` 命名无意义（_p4 后缀） | 改名按模块（如 `tools_verify.test.js`） | 低 |

---

## 六、明确不做（防范围蔓延）

- **不引入** MCP/插件生态（C5）：与「轻量、零依赖、内网」定位冲突，除非强需求。
- **不做** 完整 Forge 多角色硬切流水线（Planner/Coder/Verifier 分进程）：本地弱模型失败率高、徒增 token。
- **不引入** 任何需 node-gyp 编译的包（原生 sqlite、sharp、bcrypt）；embedding 走 Ollama 本地模型。
- **不接** 任何云 API（云 embedding / 云 RAG / 云搜索）。
- **不做** 偏离「内网断网编程 Agent」的泛化（聊天机器人为中心、Telegram/日历等）。

---

## 七、建议的下一步

1. **先清尾**：T3 + Q1（让 `npm test` 离线可退出）— 小改动、高收益，建议第一个做。
2. **再补体验闭环**：U1（ask_user 前端）+ Q2（Ollama 在线冒烟）— 把已就绪后端能力真正打通。
3. **后做架构梳理**：A1/A2（agent.js、server.js 拆分）— 中等工作量，提升可维护性。
4. **能力对齐按需**：C1(git 优先)、C2(权限细化) 视用户反馈再排期；C3/C4 弱模型收益低，暂缓。

> 以上为候选，待评审确定本轮实际落地项与顺序。每条可在立项后展开为独立计划文件。
