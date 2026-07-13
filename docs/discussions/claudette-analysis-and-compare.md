# 项目分析：Claudette vs 当前项目（ollama_agent / Ason Agent）

> 分析对象：`/Users/jia/ClaudeCode/AI/claudette`（v0.16.0）
> 对比对象：当前 `/Users/jia/ClaudeCode/ollama_agent`（Ason Agent，基于 Ollama 的本地智能体）
> 日期：2026-07-13

---

## 一、Claudette 是什么

一个**隐私优先、可物理断网（air-gapped）的 AI 编程 Agent**，用一个 Rust 二进制 + 一个本地模型（Ollama 或 LM Studio）运行，**完全不碰云**。除了核心的编程能力，它也是一个个人助理（笔记、日历、Telegram 语音等），但卖点是「能在无云机器上跑的编程 Agent」。

一句话定位：**和我们的 ollama_agent 是同一赛道（本地模型 + 工具调用 Agent），但成熟度、安全模型、工程纪律差了几个量级。**

### 关键事实（来自 README / Cargo.toml / architecture.md）
- **语言/形态**：Rust 单二进制 CLI + TUI（ratatui）。`cargo install claudette` 或预编译 release（自带 SHA256）。
- **规模**：`crates/claudette/src/` 下 **97 个 .rs 文件、约 59,000 行 Rust**；**28 个工具模块、约 80 个工具**，分 **20 个按需启用的工具组**。
- **模型**：默认 `qwen3.5:4b`（~3.4GB，CPU 也能跑）；16GB 显存上可上 35B。自带一套 50 题客观「工具循环可靠性」评测电池（不自评，用自动验证器判定）。
- **离线/断网是「结构保证」而非「设置项」**：
  - `--offline`（或 `CLAUDETTE_OFFLINE=1`）下，除本地模型服务 + loopback 外**所有出站调用被硬阻断**；
  - 因为原始 shell 是 allow-list 无法审计的逃逸通道，**`bash`/`bash_background` 在 offline 下被整类拒绝**（而非过滤），引导用结构化工具；
  - 双层防护：进程内 HTTP 层 + 子进程层（`git`/`gh`/TTS）都拦；
  - 还有集成测试逐个驱动联网工具证明它们确实拒绝——**air-gap 是被测出来的，不是写出来的**。
- **分层大脑（tiered brain）**：4B 卡住时自动升 9B；`/recall` 用本地 embedding 索引跨会话记忆；多模态图生输入。
- **Forge 自主代码流水线**：`--forge` 跑 Planner → Coder → Verifier（真构建+跑测试）→ 修复循环 → Submitter，**验证器每轮真编译真跑测试**，编译不过/测试挂的 diff 过不了关，且 PR 在你批准计划+完整 diff 前不开。
- **Brownfield missions**：`mission_start("owner/repo")` 克隆仓库、把文件操作路由进去、`mission_submit` 分支/提交/推送/开 PR，一条工具链。
- **权限分级**：只读 / 工作区写 自动放行；`bash`/`edit_file`/`git push` 每次 `[y/N]` 确认。
- **工程纪律极强**：
  - `#![forbid(unsafe_code)]`，**全 crate 零 unsafe**；
  - clippy pedantic 全开（warn），`panic = "abort"`（任何 panic 直接整进程退出，无 catch_unwind 恢复——所以要求所有不可信输入解析 panic-free）；
  - 1,000+ 测试 CI 全绿；提交前 `cargo fmt + clippy -D warnings + cargo test`；
  - 默认构建**不含任何云代码**（Google/Telegram 等只在 `--features integrations` 时才编译进来），从二进制层面保证「没有别的模式可切换」。
  - **自举**：Claudette 用 Forge 流水线改自己仓库，过真实 build/test gate 后开真实 PR，人类 review 才合并。

---

## 二、逐项对比表

| 维度 | Claudette | 当前 ollama_agent (Ason) |
|------|-----------|------------------------|
| **语言/形态** | Rust 单二进制 CLI + TUI | Node.js HTTP 服务 + 浏览器 SPA（vanilla JS + simpui） |
| **规模** | ~59k 行 Rust，97 文件，80 工具 / 20 组 | ~2.9k 行后端 JS + ~2.9k 行前端 JS，14 工具 + 8 技能 |
| **模型后端** | Ollama / LM Studio（本地） | Ollama（本地） |
| **默认模型** | qwen3.5:4b（小，CPU 可跑） | deepseek-r1:8b（配置可改） |
| **断网/隐私** | **结构级 air-gap**：offline 硬阻断所有出站，bash 整类拒绝，集成测试证明 | 仅「不主动连云」的**姿态**，无强制隔离；`bash` 工具存在（已加固黑名单，但仍是出站逃逸通道） |
| **工具调用路线** | 原生 tools + 按需启用工具组（基础 schema ~200 token，按需膨胀） | prompt-based JSON 解析（默认）+ 原生 tools 可选降级 |
| **工具丰富度** | 80+ 工具：git/搜索/测试/质量/语义检索/vision/recall/笔记/todo/日历/Gmail/Telegram/网页 | 14 动作工具 + 8 技能：文件/搜索/执行/git/代码分析 |
| **自主流水线** | Forge（规划→编码→验证→修复→提交，验证器真跑测试）、brownfield missions | 无（单轮 Agent 循环） |
| **上下文管理** | 自动 compaction + token 预算数学 + 跨会话 recall（本地向量库 rusqlite） | `truncateMessages` 简单丢弃旧消息，无压缩、无跨会话记忆 |
| **权限模型** | 五级（read-only / workspace-write / dangerous / prompt / allow），结构化 Operation 分类 | 二分 `needConfirm: true/false` |
| **安全边界** | unsafe 全禁、panic=abort、offline 双层、子进程审计、1k+ 测试 | 路径沙箱（safeResolve）、命令黑名单（已加固）、写操作确认、墙钟超时、步数上限 |
| **存储** | rusqlite（bundled libsqlite3，无系统依赖）+ JSONL 调度器 | **sql.js**（SQLite/WASM，纯 JS，零原生编译） |
| **前端** | ratatui TUI（5 tab，实验性），REPL 为主 | 完整 Web UI：SSE 流式、思考块折叠、工具调用可视化、对话持久化、文件浏览器 |
| **可移植性** | 单二进制 / 预编译 release（SHA256），无需 Node | 需 Node ≥16 + `node src/server.js`（依赖 sql.js 已在 node_modules） |
| **测试** | 1,000+ 单测 + 集成测试 + 模型评测电池，CI 绿 | 63 单测（tools/rootstore），无模型集成测试、无 CI |
| **文档** | README + 10+ docs（架构/硬件/Forge/对比/隐私清单…）+ CHANGELOG | README + CLAUDE.md + agent-design.md + UI-SPEC |
| **工程纪律** | forbid(unsafe)、clippy pedantic、panic=abort、Conventional Commits、自举开发 | ESLint 风格约定、Conventional Commits（见 CLAUDE.md） |

---

## 三、能力差距（对我们有启发、且可借鉴的点）

1. **断网是「保证」不是「设置」** —— 我们有 `bash` 工具，理论上模型/Prompt 注入可借它出站。Claudette 的做法（offline 硬阻断 + 对不可审计的 shell 整类拒绝）值得参考，尤其若本产品进入内网/敏感场景。

2. **按需启用工具组** —— 我们 14 个工具全量塞进 system prompt（token 浪费、小模型易跑偏）。可借鉴：按场景/懒加载启用工具组，基础 schema 保持极小。

3. **分层大脑 + 卡住才升级模型** —— 我们固定单模型。小模型在复杂任务上卡住时，自动升一档更大本地模型，是「小模型能干啥」的现成答案。

4. **验证器驱动的自主流水线（Forge）** —— 我们的 docs/agent-design.md §8 已规划 Plan Mode / 子代理 / 工作区隔离但**未实现**。Claudette 证明了「验证器真编译真跑测试」这条闭环的价值：diff 不过关就不开 PR。

5. **上下文压缩 + 跨会话 recall** —— 我们只有简单截断，长对话很快把 context 吃满；且无记忆（每次新对话模型对用户/项目一无所知）。这是体验上最大的差距之一。

6. **五级权限 vs 我们二分** —— `needConfirm` 只有 true/false。可加「本次会话始终允许 / 始终拒绝 / 按路径」一级，减少确认打断。

7. **工程纪律与测试文化** —— forbid(unsafe)、clippy pedantic、panic=abort、1k+ 测试、自举开发。我们是动态语言 + 63 单测，无 CI、无模型集成测试。对本地小模型 Agent 而言，**「小模型集成评测」** 特别值得做：用真实模型跑工具循环验证可靠性，而不是只靠人工。

---

## 四、我们的相对优势（Claudette 反而弱的地方）

- **开箱即用的 Web UI**：浏览器里流式渲染、思考折叠、工具可视化、文件树、对话持久化——Claudette 的 TUI 是实验性、REPL 才是日常驱动。我们这点在「给人用」上更顺。
- **零编译、纯 JS、改起来轻**：sql.js + Node，U 盘直拷；Claudette 要 Rust 工具链编译（虽然 release 是预编译二进制）。我们二次开发门槛低得多。
- **已经做对的硬核设计**：路径沙箱 `safeResolve`（防 symlink 逃逸）、双路线工具调用 + 同一步降级、JSON 多层容错（注释/尾逗号/双格式）、思考过程透明化——这些和 Claudette 的思路一致，说明方向没错。
- **更聚焦的场景**：我们明确对准「内网断网 + 弱模型 + 强约束 + 真数据不瞎编」，比 Claudette 的「编程+个人助理+Telegram」大杂烩更聚焦。

---

## 五、结论

两者是**同赛道不同阶段的产物**：Claudette 是一个已经产品化、安全模型严密、有自主流水线和评测体系的成熟项目；我们的 ollama_agent 是一个架构正确、但功能与工程纪律还处于早期的项目。

**最值得优先借鉴的四件事**（按性价比）：
1. 上下文压缩 + 跨会话记忆（直接提升长对话与复用体验）；
2. 按需工具组 / 场景化启用（省 token、减少小模型跑偏）；
3. 分层大脑（卡住升档更大本地模型）；
4. 小模型集成评测电池（用真实模型验证工具循环可靠性，替代纯人工）。

我们在 **Web UI 易用性、零编译可移植性、聚焦场景** 上反而更好，继续发挥即可。
