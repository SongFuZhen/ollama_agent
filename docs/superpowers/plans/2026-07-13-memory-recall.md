# P1 三级 Memory + 跨会话 Recall

> 前置：P0 跨平台先完成。
> 硬约束：零原生编译依赖；完全离线（embedding 走本地 Ollama，不调云）；纯 JS。

## 设计：三级记忆（对标 Claudette 的 memory 体系）

| 级 | 类型 | 存哪 | 内容 | 注入时机 |
|----|------|------|------|----------|
| L1 | **会话内** | 已在 `messages` 表（sql.js） | 当前对话的完整消息 | 每轮自然带入 |
| L2 | **跨会话事实/偏好** | 新增 `memory_chunks` 表 | 用户偏好、项目约定、反馈修正（user/feedback/project 型） | 新对话首轮或 `/recall` 检索后注入 system prompt |
| L3 | **语义检索片段** | `memory_chunks` 表（含 embedding BLOB） | 历史会话的有用片段（代码、决策、解释） | 新对话首轮或 `/recall <query>` 语义搜 top-K 注入 |

> 克制原则：**不做**大而全的知识图谱。就做"历史片段存起来，新对话时用语义/关键词搜相关片段注入"。

## 关键技术决策（已调研确认）

1. **本地 embedding = Ollama `nomic-embed-text`**
   - 走现有 Ollama `/api/embeddings`（与 `chat` 同构），不引 npm 包、零额外体积、纯离线。
   - 维度 768；用户需 `ollama pull nomic-embed-text`（~274MB），**缺失时降级为关键词（LIKE）检索**，不阻断。
2. **向量存进 sql.js 现有 `conversations.db`**
   - 新增 `memory_chunks` 表：`id, conv_id, role, content, embedding BLOB, ts, summary`。
   - BLOB 读写：`Buffer.from(float32Array)` 写；读用 `new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength/4)`（**注意 byteOffset，否则错位**）。
   - 相似度：纯 JS 余弦 `dot(a,b)/(|a||b|)`，几千条全扫 <10ms，无需 ANN 索引。
3. **写入时机**
   - 每条 user/assistant 消息落库后**异步**切分（按消息或 ~200 字窗口）调 `embed()` 写一条；
   - 可选：会话结束用 Ollama 生成 `summary` 高层记忆（L2 事实型）。
4. **检索时机**
   - 新对话首轮（或显式 `/recall <query>`）：query embed → 全表余弦 top-K(5) → 命中片段拼进 system prompt（`## 相关历史记忆:`）。

## 改动文件清单

- 改 `src/core/ollama.js` —— 新增 `embed(text, opts)`，复用 `hostParts`/`TIMEOUT_MS`，POST `/api/embeddings`，返回 `number[]`。
- 改 `src/storage/db.js` —— SCHEMA 加 `memory_chunks` 表；新增 `addMemory(convId, role, content, embedding, summary)`、`queryMemory(embedding, k)`（返回 top-K 片段 + 余弦分）。
- 新增 `src/memory/recall.js` —— `embedQuery(text)` / `cosineTopK(rows, q, k)` / `buildRecallPrompt(convId, query?)`，首轮或 `/recall` 注入。
- 改 `src/core/agent.js` —— `runAgent` 首轮调用 `buildRecallPrompt` 注入 system；消息落库后触发 `addMemory`（经 `db.addMessage` 之后的钩子，或 server 保存对话时调）。
- 改 `src/server.js` —— 启动时 `listModels()` 探测 `nomic-embed-text`，未就绪则 `recall` 降级关键词；`/recall` slash 命令接入。
- 改 `src/storage/db.js` 的 `closeDB()`/scheduleSave —— 确保 embedding 写入走现有落盘（退出不丢记忆）。

## 最大的坑（必读）
1. embedding 模型需用户额外 `ollama pull nomic-embed-text`；缺失→降级关键词检索（L3 退化为 L2 关键词）。
2. BLOB 还原**必须** `new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength/4)`，用 `new Float32Array(u8)` 会按字节数错位。
3. embedding 写入必须走现有 `scheduleSave()/flush()`，否则进程退出丢记忆。
4. query/chunk 同一模型同一维度；nomic 输出可归一化，余弦等价点积可省除法提效。

## 验证
- 存一条记忆→重启→`/recall` 能语义召回（"之前那个登录 bug" 命中对应片段）。
- `nomic-embed-text` 缺失时 `/recall` 走关键词不崩。
- 退出重启后 `memory_chunks` 数据仍在（落盘生效）。

## 实现状态（2026-07-13 已完成）
- ✅ `src/core/ollama.js` 新增 `embed(text, {model, ollamaHost})`，POST `/api/embeddings`，默认 `nomic-embed-text`（可在 `EMBED_MODEL` 覆盖）。
- ✅ `src/storage/db.js` SCHEMA 加 `memory_chunks` 表；新增 `addMemory` / `getAllMemory`（BLOB 还原用 `new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength/4)`）/ `searchMemoryKeyword`（LIKE 降级）/ `deleteMemory` / `clearMemory`；`initDB` 现每次启动跑 SCHEMA 保证旧库升级补齐表。
- ✅ 新增 `src/memory/recall.js`：`probeEmbed` 惰性探测、`cosine`/`cosineTopK` 纯 JS 余弦 Top-K、`buildRecallPrompt(query?)`（有 query 语义召回，无 query 取最近片段；embedding 失败降级关键词）。
- ✅ `src/core/agent.js`：首轮根据用户输入异步注入召回片段到 system prompt；对话结束异步 `recordMemory`（user 提问 + assistant 回答各存一段，embedding 失败不影响落库）。
- ✅ `src/server.js`：新增 `GET /api/recall?query=&k=` 端点（返回结构化 chunks + 注入 prompt）；`handleChat` 透传前端下发的 `conversationId`。
- ✅ 前端 `app.js`：chat 请求体带 `conversationId`。
- ✅ 纯函数单测 `test/memory.test.js`（5 例，余弦/TopK/长度不匹配/无向量跳过）全绿；63→68 单元测试全绿。
- ⚠️ 需用户在 Ollama 端 `ollama pull nomic-embed-text` 才能启用语义召回；未拉取时自动降级关键词检索，不阻断。
