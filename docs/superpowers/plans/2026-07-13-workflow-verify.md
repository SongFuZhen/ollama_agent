# P2 工作流：规划 + 验证闭环（轻量 Forge）

> 前置：P0 跨平台、P1 memory 完成更佳（验证器可写记忆，非必须）。
> 定位：内网断网**编程 Agent**——不做 Telegram/日历；不做完整 Forge 多角色硬切流水线。

## 决策：只做"规划 + 验证闭环"

> 不做完整 Forge（Planner/Coder/Verifier 分进程）：本地弱模型硬切角色失败率高、徒增 token。
> 在**现有单循环 `runAgent`** 之上加两层，核心循环零重写：

| 层 | 作用 | 怎么接现有代码 |
|----|------|--------------|
| **Plan Mode** | 复杂任务先只规划（限制工具为只读），用户确认后再执行 | `runAgent` 加 `mode:'plan'|'execute'` 分支 + 只读工具过滤 |
| **Verifier** | 改动后真跑 `run_tests`/`run_lint`（已有），失败反馈喂回循环再修 | 主循环写操作后插后处理钩子，复用现有工具 |

## A. Plan Mode

### 改动（`src/core/agent.js`）
- `runAgent` 签名加 `mode = 'execute'`、`planApprove`（确认回调）。
- 顶部定义常量：
  ```js
  const READONLY = new Set(['read_file','list_dir','grep','glob','tree','read_lines','search_files','count_loc']);
  const WRITE = new Set(['write_file','edit_file','bash']);
  ```
- `specsFor()` 调用处改为按 `mode` 过滤：
  ```js
  const specs = mode === 'plan' ? specsFor().filter(s => READONLY.has(s.name)) : specsFor();
  ```
- system 文案：plan 模式追加"只调研、不修改文件，输出可确认的执行计划"。
- 主循环前插分支：**plan 模式只跑 1 轮** → 把最后一条 answer `emit({type:'plan', content})` 并 `return`（不进 execute）。
- 调用方（server.js / 前端）控制二段式：先 `mode:'plan'` 拿计划 → 用户点确认 → 再以 `mode:'execute'` 重调 `runAgent`（history 带上计划）。
- `needConfirm` 校验在 plan 模式**绕过**（只读工具无副作用）。

### 暴露
- `/plan <任务>` slash 命令（前端或 server 解析）→ `mode:'plan'`。

## B. Verifier（验证器闭环）

### 改动（`src/core/agent.js` 主循环）
在 `result = await tool.run(params, toolCtx)` 之后插：
```js
if (mode === 'execute' && WRITE.has(action) && step % VERIFY_EVERY === 0) {
  const out = await runTool('run_tests', {}, toolCtx)
    + '\n' + await runTool('run_lint', {}, toolCtx);
  // 失败反馈自然回到主循环继续修（主循环已支持多轮）
  addStepMessages(messages, stepUsedNative, text, null, `验证结果:\n${out.slice(0, TOOL_RESULT_MAX)}`);
}
```
- `VERIFY_EVERY`（config.js，默认 2 步验一次）。
- `run_tests`/`run_lint` 已返回"退出码 + 输出"，解析 `out.includes('退出码')` 即判失败。
- **不新增工具、不新写循环**——失败反馈进 messages，主循环自动再修。

## 改动文件清单
- `src/core/agent.js`：加 `mode`/`READONLY`/`WRITE`/`VERIFY_EVERY`、plan 分支、`planApprove` 钩子、Verifier 后处理。
- `src/config.js`：加 `VERIFY_EVERY`。
- `src/server.js` / 前端：`/plan` 命令 + 二段式调用（确认计划按钮）。
- `src/tools/test/run_tests.js`、`run_lint.js`：**直接复用**，不改。

## 验证
- `/plan` 给"重构 X 模块" → 只调 read/grep，输出计划不碰文件。
- 确认后 execute → 改完 `run_tests` 失败 → 反馈喂回 → 模型再修 → 通过。
- 非 plan 模式行为不变（回归）。

## 实现状态（2026-07-13 已完成）
- ✅ `src/config.js` 新增 `VERIFY_EVERY = 2`（执行模式每 N 步跑验证器）。
- ✅ `src/core/agent.js`：
  - 新增 `READONLY`/`WRITE` 工具分类集合并导出。
  - `runAgent` 加 `mode` 参数；plan 模式 `specsFor()` 过滤为只读工具，system prompt 追加"只调研、不改动、输出执行计划"约束。
  - plan 模式最终回答以 `emit({type:'plan'})` 返回（不进 execute）。
  - 执行模式主循环：每 `VERIFY_EVERY` 步且刚做写操作后，自动跑 `run_tests`+`run_lint`，结果 `emit({type:'verify'})` 并作为反馈喂回主循环继续修。
- ✅ `src/server.js`：`/plan <任务>` slash 命令入口（剥离前缀、`mode:'plan'` 调 `runAgent`）。
- ✅ `run_tests`/`run_lint` 直接复用，未改动。
- ✅ 纯逻辑单测 `test/workflow.test.js`（5 例，READONLY/WRITE 分类、plan 模式工具过滤）全绿。
- ⚠️ 端到端验证需 Ollama 在线：用 `/plan 重构 X` 验证只调研；确认后 execute 验证验证器闭环。本机 Ollama 未启动，仅做了模块加载 + 逻辑单测。
