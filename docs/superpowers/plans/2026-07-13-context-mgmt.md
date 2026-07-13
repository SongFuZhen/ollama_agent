# P3 上下文管理：压缩 + 真实 token 预算

> 前置：P0 跨平台先完成。
> 现状：`truncateMessages` 简单丢旧消息；`estimateTokens` 用 `text.length/2.5` 粗估；无压缩、无跨会话记忆（L3 见 P1）。

## 两块

| 块 | 作用 | 接现有代码 |
|----|------|--------------|
| **A. 上下文压缩** | promptTokens 接近 `NUM_CTX*0.7` 时，用模型对历史做摘要 | 新 `src/core/compact.js`，插在 `truncateMessages` **之前** |
| **B. 真实 token 预算** | 用 Ollama 流式回的 `prompt_eval_count` 替代粗估 | `agent.js` 的 `onStats` 已拿 `promptTokens`，接进预算判断 |

## A. Context Compaction

### 新增 `src/core/compact.js`
```js
async function compactMessages(messages, model, ollamaHost) {
  // 输入: [system, ...history, userMsg]
  // 取 system + 最近 K 条 + 中间段摘要
  // 调 ollama.chat()（非流式）把中间消息压成一条 {role:'system', content:'[历史摘要]...'}
  // 输出: [system(原), system(摘要), ...recent]
}
```
- 摘要模型用同 `model`（或 config 里的 compact 模型，默认同模型）。
- 落点：`runAgent` 主循环每轮开始前：
  ```js
  if (lastPromptTokens > NUM_CTX * 0.7) messages = await compactMessages(messages, model, ollamaHost);
  ```
- `lastPromptTokens` 在 `runAgent` 顶部声明，在 `onStats` 回调用 `promptTokens` 更新。

## B. 真实 token 估算

- `ollama.js` 的 `captureTokens` 已抓 `prompt_eval_count` → `onStats({promptTokens})` → `agent.js` 的 `emit stats`。
- **`estimateTokens` 保留作首次预算兜底**（流式还没拿到真实数时用），但：
  - `truncateMessages(messages, reserve, knownPromptTokens)` 增加可选 `knownPromptTokens` 参数——若传入真实值直接用于预算，不再逐条 `estimateTokens` 累加。
  - 粗估仅用于"还没拿到真实数"的兜底，不删除。

## 改动文件清单
- 新增 `src/core/compact.js` —— `compactMessages(messages, model, ollamaHost)`。
- 改 `src/core/agent.js`：
  - `runAgent` 顶部声明 `let lastPromptTokens = 0`；
  - `onStats` 回调里 `lastPromptTokens = stats.promptTokens`；
  - 主循环每轮前插 compaction 判断；
  - `truncateMessages` 增加可选 `knownPromptTokens` 参数。
- 改 `src/config.js`：加 `COMPACT_RECENT_K`（默认 6）、`COMPACT_THRESHOLD`（默认 0.7）。

## 验证
- 长对话（> NUM_CTX*0.7）时，status 栏 context 用量不再爆红、历史被摘要而非硬丢。
- 压测：连续 30 轮工具调用，模型仍能引用早期上下文（摘要保住了）。
- `promptTokens` 真实数生效：status 栏数字与 Ollama 回报一致（不再用 length/2.5 粗估）。

## 实现状态（2026-07-13 已完成）
- ✅ `src/config.js` 新增 `COMPACT_RECENT_K = 6`、`COMPACT_THRESHOLD = 0.7`。
- ✅ 新增 `src/core/compact.js`：`compactMessages(messages, {model, ollamaHost, recentK, threshold})`——把中间历史（除最近 K 条）用本地 Ollama `chat` 压成一条 `[历史对话摘要]` system 消息；未超阈值或摘要失败时原样返回（不阻断）。
- ✅ `src/core/agent.js`：
  - `truncateMessages` 增加可选 `knownPromptTokens` 参数：传入真实数直接做预算，不再逐条粗估累加；`runAgent` 首轮截断用 `lastPromptTokens`（无则 null 回退）。
  - `runAgent` 顶部声明 `lastPromptTokens`；`onStats` 回调里用 Ollama 真实 `promptTokens`（prompt_eval_count）更新它。
  - 主循环每轮前：`lastPromptTokens > NUM_CTX*阈值` 时调 `compactMessages` 并 `emit({type:'compact'})`。
- ✅ 纯逻辑单测 `test/context.test.js`（6 例，压缩触发/不触发/Ollama 失败兜底/真实 token 预算/粗估回退）全绿。
- ⚠️ 端到端压缩需 Ollama 在线：长对话触发摘要，验证"早期上下文被摘要保住"。本机 Ollama 未启动，仅做了逻辑单测 + 模块加载。

## 实现状态（2026-07-13 已完成）
- ✅ `src/config.js` 新增 `COMPACT_RECENT_K=6`、`COMPACT_THRESHOLD=0.7`。
- ✅ 新增 `src/core/compact.js`：`compactMessages(messages, {model, ollamaHost, recentK})`——保留 system + 最近 recentK 条，把中间 user/assistant 段用本地 Ollama `chat` 压成一条 `[历史对话摘要]` system 消息；Ollama 不可用时原样返回（不阻断）；不再内部按粗估 token 二次拦截（是否压缩由调用方根据真实 `lastPromptTokens` 决定）。
- ✅ `src/core/agent.js`：
  - 顶部 `let lastPromptTokens = 0`；`onStats` 回调里 `lastPromptTokens = stats.promptTokens`（真实数覆盖粗估）。
  - 主循环每轮前：`if (lastPromptTokens > NUM_CTX * COMPACT_THRESHOLD)` 调 `compactMessages` 并 `emit({type:'compact'})`。
  - `truncateMessages(messages, reserve, knownPromptTokens)` 新增可选第三参：传真实 token 数直接用其做预算，不逐条粗估累加；兜底"至少留一条 user"仅在 `knownPromptTokens==null`（无真实数）时触发。
- ✅ 纯逻辑单测 `test/context.test.js`（6 例：压缩阈值、Ollama 失败回退、knownPromptTokens 超限丢弃、无真实数兜底截断等）全绿。
- ✅ 全量单测 79 例全绿。
- ⚠️ 端到端压缩验证需 Ollama 在线（真实 prompt_eval_count 触发）；本机未启动，仅做了模块加载 + 逻辑单测。
