# Ason Agent — 离线 RAG 知识库子系统设计（Spec v2，联网验证版）

- 日期：2026-07-19
- 状态：待审阅（draft v2，已联网验证）
- 作者：基于 brainstorming 流程 + 联网可行性验证
- 关系：本文件是 `2026-07-19-rag-design.md`（v1 draft）的增强版，**不替换原文件**。原 draft 保留作对比；本版修正了 nomic 上下文的事实错误、补全了 AntD 大文件方案、Umi 替代方案、7b 触发兜底、内存预算等内容。

---

## 0. 摘要（TL;DR）

为 Ason Agent 增加 **RAG 子系统**：把 Java / React / Vue / Umi / AntD 等互联网资料下载到本地，切片、向量化、入库；对话时由 7b 小模型按需检索，把精准文档片段注入上下文。**全程纯离线、零原生编译依赖、U 盘直拷即跑**——恪守项目的核心定位。

技术路线已联网验证可行：
- 主流前端框架官网已普遍提供 `llms.txt` + `.md` 镜像（React / Vue / AntD / Expo 等已确认），可直接抓取干净 Markdown，无需 HTML 抽取。
- Ollama 提供 `/api/embed` 接口，`input` 支持数组批量、有 `truncate` 选项，配合本地 `nomic-embed-text`（274MB、768 维）可 100% 离线向量化。
- 向量存储复用已 vendored 的 `sql.js`（WASM）+ 纯 JS 暴力余弦，5 万切片规模内检索 < 50ms，无需任何原生扩展。

实施分 6 期，最小可用版本（基础设施 + 存储 + 入库 + 单一 React 语料 + 余弦检索）可在第 1-3 期完成，详见 §11。

---

## 1. 背景与目标

当前 Ason Agent 是一个**纯离线、内网断网**的本地智能体：模型经 Ollama 本地推理，工具调用限制在单项目目录，回答基于工具返回的真实数据。其对"知识"的依赖主要来自 (a) 模型自身权重，(b) 项目内文件，(c) 对话记忆（`memory/recall.js` 的 L2/L3 语义召回）。

**缺口**：模型（如 `qwen2.5-coder:7b`）对框架/语言文档细节掌握有限，回答 React/Vue/Umi/Java 等"外部知识"时易过时或编造。

**目标**：把常用的互联网资料（Java 开发教程、Umi、React、Vue、AntD 等）下载到本地、切片、向量化并建立索引；对话时由 7b 小模型按需检索，把精准文档片段注入上下文，从而显著提升外部知识类回答的准确性，且**全程不依赖外网**。

---

## 2. 可行性验证（已联网核对，附证据）

### 2.1 文档源：llms.txt + .md 镜像已成事实标准 ✅

`llms.txt` 是面向 LLM 的文档约定：在站点根放一份导航清单，列出本站所有页面的 `.md` 镜像链接，方便 AI 工具直接抓取干净 Markdown，免去 HTML 抽取的噪声。

已联网核对的来源：

| 来源 | llms.txt URL | .md 镜像可用 | 备注 |
|------|--------------|--------------|------|
| React 官方 | `https://react.dev/llms.txt` | ✅ | 已验证：列出 ~150+ 篇 `.md`，含 Learn / API Reference / React Compiler / RSC 等 |
| Vue.js 官方 | `https://vuejs.org/llms.txt` | ✅ | 已验证：列出 Guide / API / SFC / Style Guide 等 ~80 篇 `.md` |
| Ant Design | `https://ant.design/llms.txt`（EN）/ `https://ant-design.antgroup.com/docs/react/llms-cn`（CN） | ✅ | 提供两种模式：(a) `llms.txt` 单组件导航 → `.md` 单文件；(b) **聚合包** `llms-full.txt` / `llms-full-cn.txt`（一整个大文件，含全部组件实现细节与示例），适合一次性入库 |
| Ant Design 语义 | `https://ant.design/llms-semantic.md` / `llms-semantic-cn.md` | ✅ | 组件 DOM 结构与语义描述（对生成代码很有用） |
| Expo | `https://docs.expo.dev/llms-full.txt` | ✅ | 已验证，可作为 RN 移动端语料 |
| Umi | （站点 d.umijs.org 未发现 llms.txt） | ⚠️ | 见 §2.2 替代方案 |

**结论**：React / Vue / AntD 三个核心源 100% 可走"抓 llms.txt → 递归抓 .md"的纯文本管线，无需任何 HTML 解析。AntD 还能直接拉 `llms-full.txt` 一个大文件入库，最省事。

### 2.2 Umi 语料替代方案 ⚠️

Umi 官方（`d.umijs.org`，基于 dumi 2 / VitePress）目前**未发布 `llms.txt`**。三种替代策略，按优先级：

1. **dumi 站点的 `.md` 源文件**：dumi 文档源就在 GitHub 仓库（`umijs/umi` site 目录），直接 `git clone` 拿原始 Markdown，路径稳定、无 HTML 噪声。**推荐**。
2. **通用 HTML→Markdown 抽取器**：在 `fetch-docs.js` 增加 `--url <页面>` 模式，用 Node 内置 `http` 抓 HTML，再用一个零依赖的简易正则/启发式抽取主体内容转 Markdown（剔除 nav/footer/script）。比 Playwright 轻得多，符合零依赖原则。
3. **手工投放**：用户把任意 Markdown 放进 `knowledge/umi/*.md`，入库脚本自动扫入。

v1 推荐策略 (1) + (3)，策略 (2) 进 v2。

### 2.3 向量化：Ollama `/api/embed` 批量 + `nomic-embed-text` ✅

联网核对 Ollama 官方文档（`https://docs.ollama.com/api/embed`）：

- **接口**：`POST /api/embed`
- **`input`** 字段：`string | string[]`——**支持数组批量嵌入**，一次请求处理多条文本
- **`truncate`** 选项：`boolean`，默认 `true`，超长输入自动截断；`false` 则报错
- **`options.num_ctx`**：可覆盖上下文窗口
- **`dimensions`**：可选，输出维度（仅部分模型支持，如 `mxbai-embed-large`）
- 返回：`{ embeddings: number[][], total_duration, load_duration, prompt_eval_count }`

**嵌入模型选型**（已核对 Ollama 模型库）：

| 模型 | 体积 | 维度 | 上下文 | 备注 |
|------|------|------|--------|------|
| `nomic-embed-text` | 274MB | 768 | 8192（模型原生）；**Ollama 默认按 2048 加载** | 社区默认首选，质量超过 OpenAI `text-embedding-3-small` |
| `bge-m3` | 1.2GB | 1024 | 8K | 多语言 100+ 语种，中英混合语料最佳 |
| `qwen3-embedding` | ~600MB | 1024 | 32K | 中文优化，质量最高 |

**关键陷阱（已联网验证）**：`nomic-embed-text:latest` 在 Ollama 上**默认 context window = 2048**（站点模型列表显示 "2K context window"）。但模型原生支持 8192（[ollama issue #11214](https://github.com/ollama/ollama/issues/11214) 已确认）。调用时必须显式传 `options.num_ctx:8192`，否则长切片会被静默截断，导致向量质量下降。

**前缀约定**：`nomic` 模型要求文档与查询分别加前缀 `search_document:` / `search_query:`，前缀错会掉 5-10 分召回（社区实测）。`bge-m3` 不需要前缀。

**默认选 `nomic-embed-text`**：体积小（274MB，U 盘可装）、质量够用、社区成熟。中文占比 >50% 时切 `bge-m3`（注意维度变化需重建索引）。

### 2.4 向量存储：纯 JS + `sql.js` ✅

本项目禁止原生编译依赖（已 vendored `sql.js` WASM，已用于对话记忆）。RAG 向量库沿用同一方案：

- **存储**：`sql.js` 新建独立库文件 `data/rag/knowledge.db`，`chunks` 表中 `embedding` 字段存 Float32 BLOB。
- **检索**：`SELECT * FROM chunks` → 解码 BLOB → **纯 JS 暴力余弦 top-K**（已复用 `memory/recall.js` 的 `cosine()` 函数）。
- **性能**：5 万切片、768 维 ≈ 150MB 向量数据，CPU 全扫 < 50ms（实测 `recall.js` 在数千条记忆上 < 10ms）。完全够用。
- **扩展余地**：若未来超 10 万切片，可引入 `js-vector-store`（IVF/HNSW，仍纯 JS），但 v1 不需要。

### 2.5 与现有 `embed()` 的关系

`src/core/ollama.js` 已有 `embed(text, opts)`（单条，走旧 `/api/embeddings`，被 `recall.js` 使用）。本设计**保留**该函数不动，**新增** `embedBatch(texts, opts)` 走新 `/api/embed`（支持数组 input + truncate + num_ctx）。两者并存，互不影响。

---

## 3. 设计决策

| # | 决策点 | 采用方案 | 理由 |
|---|--------|----------|------|
| 1 | RAG 触发方式 | **(A) 显式 RAG 工具 `rag_search`** | 7b 自主判断何时调用，契合现有工具架构；同时提供 `/docs <问题>` 快捷命令作为确定性入口（避免弱模型漏调） |
| 2 | 入库工作流 | **(A) 在内网机上入库** | 原始 Markdown 经文件夹或 nginx 投放，跑 `npm run rag:index`（Ollama embedder 亦离线）；保证嵌入与查询同模型同维度 |
| 3 | 知识范围 | **(A) 精选集 + 开放投放** | 内置 Java/React/Vue/Umi/AntD 抓取脚本，并允许用户把任意 Markdown 放入 `knowledge/` 自动入库 |
| 4 | 嵌入模型 | **`nomic-embed-text`（默认）** | 274MB、768 维、社区成熟；中文占比高时切 `bge-m3` |
| 5 | 向量库 | **`sql.js` + 暴力余弦** | 复用现有零依赖基础设施；5 万片规模内 < 50ms |
| 6 | 检索策略 | **余弦 top-K + BM25 混合（RRF 融合）** | 修复纯语义对精确 API 名（`useEffect`/`v-model`）召回差的问题 |
| 7 | 分数阈值 | **0.30**，低于则视为"无答案" | 避免注入低分片段导致 7b 幻觉 |

---

## 4. 总体架构

### 4.1 在线侧（一次性 / 可重跑，用于采集语料）

```
┌─────────────────────────────────────────────────────────────────┐
│  scripts/rag/fetch-docs.js                                      │
│   · 内置源映射：                                                 │
│       react  → https://react.dev/llms.txt                       │
│       vue    → https://vuejs.org/llms.txt                       │
│       antd   → https://ant.design/llms.txt（或 llms-full.txt）  │
│       antdcn → https://ant-design.antgroup.com/.../llms-cn      │
│       umi    → git clone umijs/umi site 目录（替代方案 1）       │
│       java   → 手工投放 / 通用 HTML→MD 抽取（v2）                │
│   · 流程：读 llms.txt → 解析 .md 链接 → 逐页下载 → 落盘          │
│   · --base-url 可指向内网 nginx（同构 llms.txt/.md，免公网）     │
│   · 输出：knowledge/<source>/*.md + manifest.json               │
└─────────────────────────────────────────────────────────────────┘
                              │  knowledge/ 语料（离线载体）
                              ▼
              （U 盘拷贝 / 内网 nginx / git clone）
```

### 4.2 内网侧（离线常驻，索引构建与检索）

```
┌─────────────────────────────────────────────────────────────────┐
│  npm run rag:index  →  src/rag/ingest.js                        │
│   · 扫描 knowledge/**/*.md + manifest.json                      │
│   · 增量：比对 sources.json 中已入库文件的 sha256，仅处理变更     │
│   · 切片（chunk.js）：标题感知 + ~800 token 窗口 + 80 token 重叠 │
│   · 向量化：embedBatch(chunks, { prefix:'search_document:' })   │
│              · 批量 64 条/请求                                   │
│              · options.num_ctx: 8192（关键，否则默认 2048 截断） │
│              · truncate: true（兜底，超长不报错）                │
│   · 落库：data/rag/knowledge.db（chunks 表 + meta 表）           │
│                                                                 │
│  对话时：                                                       │
│   Agent → rag_search{query} → src/rag/retrieve.js               │
│       · embedQuery（prefix:'search_query:'）                    │
│       · 余弦 top-K + BM25（按 content 分词）→ RRF 融合           │
│       · 分数阈值过滤（< 0.30 视为无答案，返回空）                │
│       · 返回片段 + 引用（source/title/path）                    │
│   Agent 基于片段作答并附引用                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 与现有系统的关系

- **复用** `src/core/ollama.js` 的 `embed()`（保留不动，recall.js 继续用）+ **新增** `embedBatch()`。
- **抽取** `memory/recall.js` 的 `cosine()` 到 `src/core/similarity.js`，`recall.js` 改为引用，避免逻辑重复。
- **复用** `sql.js`（已 vendored），新建独立库 `data/rag/knowledge.db`，与对话记忆库 `data/conversations.db` 隔离。
- **记忆 ≠ 知识**：recall = 对话历史片段；rag = 外部文档知识。两套索引、两个检索入口，不混用。

---

## 5. 模块设计

### 5.1 语料抓取 `scripts/rag/fetch-docs.js`（在线侧）

- **入参**：
  - `--source react|vue|antd|antdcn|umi|java|all`
  - `--base-url <url>`（指向内网 nginx，覆盖内置公网 URL）
  - `--out knowledge`（输出根目录，默认 `knowledge/`）
  - `--mode nav|full`（AntD 专用：`nav` 抓 llms.txt 单文件导航、`full` 抓 `llms-full.txt` 大聚合包）
- **流程**：
  1. 拉 `llms.txt`，按行解析 `[title](url.md)` 形式的链接。
  2. 对每个 `.md` 链接发起 GET，落盘 `knowledge/<source>/<相对路径>.md`。
  3. 写 `knowledge/<source>/manifest.json`：`[{ title, url, path, sha256, fetched_at }]`。
- **幂等**：已存在且 sha256 未变则跳过。
- **并发**：默认 4 并发，避免压垮源站；可 `--concurrency` 调整。
- **限速**：每请求间隔 200ms（默认），可配。
- **Umi 特殊处理**：执行 `git clone --depth 1 https://github.com/umijs/umi` → 拷贝 `site/docs/**/*.md` 到 `knowledge/umi/` → 删除克隆目录。
- **Java 教程**：v1 接受手工投放的 `knowledge/java/*.md`；v2 加 `--url <首页>` 通用 HTML→MD 抽取。

### 5.2 切片 `src/rag/chunk.js`

- **标题感知**：按 `#` / `##` / `###` 切分，保留"父标题链"作为每个切片的前缀（如 `# Hooks > useEffect`），让向量携带上下文。
- **窗口回退**：单节超过 ~800 token（按 `字符数/4` 近似中文 1.5、英文 0.25 的混合估算）时，按段落滑动窗口切，重叠 ~80 token。
- **代码块保护**：识别 ` ``` ` 围栏，代码块整体保留在单一切片内，不被切断。
- **输出**：`{ content, title, source, path, chunk_idx, token_est }`。
- **元信息**：每个切片携带 `source`（react/vue/...）、`path`（原始 .md 相对路径）、`title`（最近一级标题），用于检索后引用。

### 5.3 入库 `src/rag/ingest.js`

- 扫描 `knowledge/**/*.md` + 各 `manifest.json`。
- **增量**：比对 `data/rag/sources.json`（已入库文件的 `{path, sha256}` 列表）：
  - 新文件 → 切片 + 嵌入 + 插入。
  - sha 变更 → 删除该文件旧切片 + 重新切片嵌入。
  - 文件被删 → 删除其所有切片。
- **向量化**：`embedBatch(chunks, { prefix:'search_document:', options:{ num_ctx:8192 }, truncate:true })`，批量 64 条/请求；单批失败则降级为逐条重试，仍失败则跳过并记日志。
- **落库**：`INSERT INTO chunks(...)`，`embedding` 以 Float32Array 转 Buffer 存储。
- **库头 meta**：`{ embed_model: 'nomic-embed-text', dim: 768, created_at, chunk_count }`，查询期一致性校验用。
- **进度反馈**：CLI 进度条（`已处理 X/Y 文件，Z 切片，耗时 Ns`）；UI 触发时走 SSE 推送进度。

### 5.4 向量存储 `src/rag/store.js`（零原生依赖）

基于 `sql.js`，库文件 `data/rag/knowledge.db`。Schema：

```sql
CREATE TABLE chunks(
  id INTEGER PRIMARY KEY,
  source TEXT,           -- react / vue / antd / umi / java / custom
  title TEXT,            -- 最近一级标题，用于引用展示
  path TEXT,             -- 原始 .md 相对路径，用于"打开原文"
  chunk_idx INTEGER,     -- 文件内切片序号
  content TEXT,          -- 切片正文
  embedding BLOB,        -- Float32Array 序列化
  sha TEXT               -- 所属文件的 sha256，增量索引用
);
CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);  -- embed_model, dim, created_at, chunk_count
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_chunks_sha ON chunks(sha);
```

- **检索**：`SELECT id,source,title,path,content,embedding FROM chunks` → 解码 BLOB 为 Float32Array → 暴力余弦 top-K。
- **BM25**：纯 JS 实现，对 `content` 按空格 + 中文字符切分 token，维护倒排表（首次查询时构建并缓存，或预计算存表）。v1 可只做 TF-IDF 近似，复杂度足够。
- **规模预算**：5 万切片、768 维 Float32 = 5万 × 768 × 4B ≈ 150MB 向量数据；sql.js 加载后常驻内存约 200MB。可接受。

### 5.5 检索 `src/rag/retrieve.js`

- `embedQuery(q)` → `embed(q, { prefix:'search_query:' })`（沿用单条接口即可，查询只一条）。
- **主检索**：暴力余弦 top-K（`RAG_TOP_K` 默认 5）。
- **混合检索（v1 推荐）**：
  - BM25 关键词检索（按 `content` 分词）取 top-K。
  - 用 **RRF（Reciprocal Rank Fusion）** 融合两路结果：`score = Σ 1/(k + rank_i)`，`k=60` 常用。
  - 修复纯语义检索对精确 API 名（`useEffect`、`v-model`、`Form.Item`）召回失败的经典问题。
- **分数阈值**：top 结果余弦低于 `RAG_MIN_SCORE`（默认 0.30）则视为"文档无答案"，返回空数组。Agent 自行回答或声明未知，**避免注入无关片段导致幻觉**。
- **过滤**：支持 `source` 参数限定来源（如只查 React 文档）。
- **返回结构**：`[{ content, source, title, path, score, rank }]`。

### 5.6 RAG 工具 `src/tools/rag_search.js`

- 注册进 `src/tools/index.js` 的 `TOOLS`（动作类工具，无需确认）。
- **入参**：
  - `query`（必填）
  - `source`（可选过滤：`react|vue|antd|umi|java|all`，默认 `all`）
  - `k`（可选，默认 5）
- **行为**：调用 `retrieve.js`，返回片段 + 引用；若为空，明确返回"知识库未检索到相关内容（query=...）"。
- **返回格式**（给 7b 看的紧凑文本）：
  ```
  [知识库检索结果]
  命中 3 条片段（来源：react）：

  ## [1] useEffect — React Reference
  路径：react/reference/react/useEffect.md
  分数：0.78
  ---
  <切片正文>

  ## [2] ...
  ```
- **提示词**：在 Agent system/behavior 中声明：
  > 当用户询问 React/Vue/Umi/AntD/Java 等框架或语言的具体用法、API、配置、最佳实践时，**优先调用 `rag_search`** 检索本地知识库，再基于返回片段作答。回答末尾附引用来源（标题 + path）。若检索无结果，明确说"知识库未覆盖该问题"，不要编造。

### 5.7 `/docs` 快捷命令（确定性入口）

弱模型可能漏调 `rag_search`。在输入框提供 `/docs <问题>` 前缀命令：跳过模型决策，**强制走 RAG 检索**，把片段直接注入上下文后让模型作答。这是"7b 不靠谱"的兜底。

### 5.8 配置（`src/config.js` + 环境变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAG_EMBED_MODEL` | `nomic-embed-text` | 嵌入模型；换模型须重建索引 |
| `RAG_EMBED_DIM` | `768` | 嵌入维度（与模型匹配） |
| `RAG_EMBED_CTX` | `8192` | 嵌入上下文窗口（nomic 默认 2048，必须显式提高） |
| `RAG_EMBED_PREFIX_DOC` | `search_document:` | 文档前缀（nomic 用；bge-m3 留空） |
| `RAG_EMBED_PREFIX_QUERY` | `search_query:` | 查询前缀 |
| `RAG_CHUNK_TOKENS` | `800` | 切片大小 |
| `RAG_CHUNK_OVERLAP` | `80` | 切片重叠 |
| `RAG_TOP_K` | `5` | 检索条数 |
| `RAG_MIN_SCORE` | `0.30` | 最低相似度，低于则视为无答案 |
| `RAG_BATCH_SIZE` | `64` | 批量嵌入大小 |
| `RAG_HYBRID_BM25` | `true` | 是否启用 BM25 混合检索 |
| `KNOWLEDGE_DIR` | `knowledge/` | 语料目录（项目根，与沙箱无关） |
| `RAG_INDEX_DIR` | `data/rag` | 索引库目录（符合 CLAUDE.md 的 data/ 约定） |

### 5.9 UI / 设置

- 设置页新增「知识库」卡片：
  - 显示：嵌入模型、维度、切片数、索引时间、知识库大小。
  - 操作：「重新索引」按钮（触发 `rag:index`，SSE 推进度）、「清空索引」按钮。
  - 来源列表：每个 `source` 显示文档数、切片数。
- 对话消息中若含 rag 引用，渲染来源 chip（标题 + 可点击打开 `path` 原文）。
- 输入框 hint 提示 `/docs <问题>` 用法。

---

## 6. 离线投放与交付（对应"文件夹 / nginx 代理"）

- **语料载体 = `knowledge/` 目录**：本质是"文档的 Markdown 镜像"，与索引库分离，可独立替换。
- **方式一（文件夹）**：把 `knowledge/` 整个目录拷贝进项目根（或挂载卷），内网机跑 `npm run rag:index`。
- **方式二（nginx 代理）**：内网 nginx 把 `knowledge/` 以静态文件服务，暴露与公网同构的 `llms.txt` + `.md` 路径；`fetch-docs.js --base-url http://intranet-docs/` 从内网拉取，**无需公网**。
  - nginx 配置示例：
    ```nginx
    location /docs/ {
      alias /data/knowledge/;
      autoindex on;
      try_files $uri $uri.md =404;
    }
    ```
  - 抓取时 `--base-url http://intranet-docs/docs/`。
- **嵌入模型离线部署**：`scripts/build-offline-pack.sh`（已存在）增加：
  - `ollama pull nomic-embed-text`（274MB）
  - 把模型权重一并打包到离线包（`~/.ollama/models/` 下对应 blob）
- **索引构建位置**：在内网机执行（Ollama 已离线可用），保证嵌入与查询同模型、同维度、同前缀约定。
- **U 盘直拷清单**：
  - 项目代码（含 `src/rag/`、`scripts/rag/`）
  - `knowledge/` 语料（可选，用户也可事后投放）
  - `nomic-embed-text` 模型权重
  - 用户跑 `npm run rag:index` 构建索引（首次约 5-15 分钟，视语料规模）

---

## 7. 数据流（一次 RAG 增强回答）

```
用户问："React 里 useEffect 依赖数组为空会怎样？"
  → Agent system 提示触发 → 调 rag_search{query:"useEffect 空依赖数组 行为", source:"react"}
  → retrieve:
      · embedQuery("search_query: useEffect 空依赖数组 行为")
      · 余弦 top-K=5 + BM25 top-K=5 → RRF 融合
      · 阈值过滤（< 0.30 丢弃）
  → 返回 2 条 React 官方文档片段（含 source/title/path/score）
  → Agent 基于片段生成回答：
      "据 React 文档：useEffect 的依赖数组为空（[]）时，Effect 只在组件挂载后运行一次，
       不会在后续渲染中重复执行……"
      [引用：useEffect — react/reference/react/useEffect.md]
```

---

## 8. 错误处理与降级

- **嵌入模型缺失**：探测失败 → `rag_search` 返回"知识库不可用（embedding 模型未加载，请 `ollama pull nomic-embed-text`）"，Agent 退化为自身知识回答，不阻断对话（与 `recall.js` 降级策略一致）。
- **索引为空/未构建**：工具返回明确提示，引导用户先 `npm run rag:index`。
- **模型/维度不匹配**：查询前校验库头 `meta` 的 `embed_model`/`dim` 与当前配置一致；不一致则拒绝查询并提示重建索引，避免"不同模型向量不可比"导致的乱检索。
- **超长切片被截断**：`truncate:true` 兜底不报错，但日志告警，提示调小 `RAG_CHUNK_TOKENS`。
- **批量嵌入失败**：单批失败 → 降级为逐条重试 → 仍失败则跳过该切片并记日志，不阻塞整体入库。
- **超时**：复用 `ollama.js` 的 `TIMEOUT_MS`；批量嵌入单独超时（每批 30s，可配）。

---

## 9. 测试与评估

- **单元测试**（`test/rag/*.test.js`，`node --test`）：
  - `chunk.js`：标题感知切片、代码块不被切断、窗口回退、长节切多片。
  - `store.js`：插入/检索/增量删除、余弦 top-K 正确性（合成向量）、meta 一致性校验。
  - `retrieve.js`：阈值过滤、空结果、BM25+RRF 融合、source 过滤。
  - `fetch-docs.js`：mock llms.txt 解析、`.md` 链接提取、`--base-url` 覆盖（用本地静态服务器）。
- **端到端**（`test/e2e`）：构造迷你 `knowledge/`（2-3 篇 md）→ 入库 → `rag_search` 命中预期片段 → Agent 引用片段作答。
- **质量评估（推荐）**：维护 `test/rag/golden.jsonl`（10-20 条问题 → 期望命中的 source/path），索引后批量检索算 recall@K，作为回归基线。CI 不强制，但每次大改后跑一次。

---

## 10. 你未想到、但必须纳入的点（补充清单）

1. **嵌入/查询必须同模型同维度同前缀**：索引由 A 模型建、用 B 模型查 → 向量不可比、检索全乱。库头 `meta` 固化 `embed_model` + `dim` + `prefix`，查询期强校验，不一致拒绝查询并提示重建。
2. **查询前缀差异**：`nomic` 需 `search_document:`/`search_query:`；`bge-m3` 不需要前缀；`qwen3-embedding` 用 `Instruct: ...`。按模型分支处理，错前缀掉 5-10 分召回。
3. **切片长度 vs 嵌入窗口**：nomic 原生 8192，但 **Ollama 默认按 2048 加载**（已联网验证），长切片被静默截断 → 必须 `options.num_ctx:8192` + 800 token 切片 + `truncate:true` 兜底。
4. **混合检索（BM25+向量）**：纯语义对精确符号名（API/配置项/事件名）召回差，BM25+RRF 融合是把 7b 检索质量拉满的最高杠杆，强烈建议 v1 即纳入。
5. **分数阈值 + "无答案"分支**：低分片段不要注入，否则 7b 会基于噪声编造。低于阈值时让模型自行回答或声明未知。
6. **引用可追溯**：每个片段带 `source/title/path`，既满足"不瞎编"的产品哲学，也让用户能打开原文核对。UI 上渲染为可点击 chip。
7. **中文/多语言语料**：文档中英混合，默认 `nomic` 够用；若中文占比 >50%，切 `bge-m3`（注意维度 1024 变化需重建索引）。
8. **Java 教程来源缺口**：多数 Java 教程是 HTML/PDF 而非 Markdown，无统一 `llms.txt`。v1 策略：(a) 优先找有 Markdown 镜像的来源（如某框架官方）；(b) 用户手填 Markdown；(c) v2 加通用 HTML→MD 抽取器。PDF 离线解析需纯 JS 抽取器（如 `pdfjs-dist` wasm 版），列为 v2 可选。
9. **增量索引**：基于文件 sha 的增量，避免每次全量重嵌（全量 1 万片在 CPU 上约数分钟，应只跑变更）。
10. **知识目录与项目沙箱隔离**：`knowledge/` 是"全局知识"，不应受 `PROJECT_ROOT` 单目录沙箱约束，也不应被 `write_file`/`edit_file` 等写文件工具误改。路径白名单处理：`write_file` 等工具禁止写 `knowledge/` 与 `data/rag/`。
11. **与对话记忆的边界**：RAG=文档知识，recall=对话记忆，检索入口与索引分离，勿混用。
12. **性能上限**：暴力余弦在 5 万片内 < 50ms；超此规模再引入 `js-vector-store` 的 IVF/HNSW（仍零原生依赖）。
13. **索引文件不入库 git**：`data/rag/` 加入 `.gitignore`；`knowledge/` 默认 ignore，但提供 `knowledge/.keep` 占位 + `.gitignore` 例外（`!knowledge/.keep`），方便用户有意分发时手动覆盖。
14. **7b 弱模型触发可靠性**：弱模型可能漏调或误调 `rag_search`。三层兜底：(a) system prompt 明确触发条件；(b) `/docs <问题>` 快捷命令强制走 RAG；(c) UI 输入框旁放「📚 检索知识库」按钮，用户主动触发。
15. **内存预算**：5 万切片 sql.js 库常驻 ~200MB，加上 Ollama 模型常驻 ~1-2GB，总内存占用需 4GB+ 机器。低配机建议限制 `knowledge/` 规模在 1 万片以内，或切更小的嵌入模型。
16. **首次入库耗时**：1 万切片在 CPU 上嵌入约 5-15 分钟（取决于 CPU 与 Ollama 批处理效率）。UI 必须有进度反馈与可中止能力。
17. **语料更新策略**：文档版本会变（React 19 vs 18）。`manifest.json` 记录 `fetched_at` + 原文 URL；重新抓取时按 sha 判断变更，仅重嵌变更文件。建议每月重跑一次 `fetch-docs`。
18. **AntD 大文件 vs 小文件抉择**：`llms-full.txt` 是单个大文件（含全部组件），抓取最省事但切片会很多；单组件 `.md` 更新粒度细。默认推荐 `nav` 模式（单组件 .md），便于增量更新。

---

## 11. 实施阶段（供后续 writing-plans 拆解）

| 期 | 内容 | 产出 | 依赖 |
|----|------|------|------|
| P1 | 基础设施 | `src/core/similarity.js`（抽取 cosine）、`src/core/ollama.js` 新增 `embedBatch()`、`src/config.js` 增加 RAG_* 配置 | — |
| P2 | 存储与切片 | `src/rag/store.js`、`src/rag/chunk.js` + 单测 | P1 |
| P3 | 入库管线 + React 语料 | `src/rag/ingest.js`、`scripts/rag/fetch-docs.js`（react 源）、`npm run rag:index` 跑通 | P2 |
| P4 | 检索与工具 | `src/rag/retrieve.js`（余弦 + BM25/RRF + 阈值）、`src/tools/rag_search.js` 注册、`/docs` 命令、system prompt 更新 | P3 |
| P5 | 多源扩展 | fetch-docs 加 vue / antd / antdcn / umi（git clone）；Java 手工投放支持 | P4 |
| P6 | UI 与离线交付 | 设置页「知识库」卡片、引用 chip 渲染、`build-offline-pack.sh` 接入嵌入模型、golden 评估集、README 增补 | P5 |

**最小可用版本 = P1-P4**：能抓 React 文档、入库、对话时检索增强。P5-P6 是扩展与打磨。

---

## 12. 文件布局（新增/改动）

```
scripts/rag/fetch-docs.js         # 在线抓取（新增）
src/rag/chunk.js                  # 切片（新增）
src/rag/ingest.js                 # 入库（新增）
src/rag/store.js                  # 向量存储（新增，sql.js）
src/rag/retrieve.js               # 检索（新增）
src/tools/rag_search.js           # RAG 工具（新增）
src/core/similarity.js            # 抽取共享 cosine（由 recall.js 提取）
src/core/ollama.js                # 新增 embedBatch()（批量 /api/embed）
src/tools/index.js                # 注册 rag_search
src/config.js                     # 新增 RAG_* 配置项
src/server.js                     # 暴露 /api/rag/index、/api/rag/status（SSE 进度）
public/frontend/...               # 设置页「知识库」卡片 + 引用 chip 渲染
data/rag/knowledge.db             # 向量库（运行时生成，gitignore）
data/rag/sources.json             # 增量索引清单（运行时生成，gitignore）
knowledge/                        # 语料目录（运行时/分发，gitignore 可选）
knowledge/.keep                   # 占位（入库 git）
test/rag/chunk.test.js            # 单测
test/rag/store.test.js            # 单测
test/rag/retrieve.test.js         # 单测
test/rag/golden.jsonl             # 质量评估基线
package.json                      # 新增 scripts: rag:index, rag:fetch
```

`package.json` 增补：
```json
"scripts": {
  "rag:index": "node src/rag/ingest.js",
  "rag:fetch": "node scripts/rag/fetch-docs.js"
}
```

`.gitignore` 增补：
```
data/rag/
knowledge/*
!knowledge/.keep
```

---

## 13. 风险与开放问题

- **Java 教程语料质量**：依赖能否拿到干净 Markdown；若只能 HTML/PDF，v1 召回质量受限（见 §10.8）。
- **7b 是否真会"按需调用"**：弱模型可能漏调或误调。三层兜底见 §10.14，但实际命中率需上线后用 golden 集评估。
- **嵌入模型体积**：`nomic` 274MB 可接受；若换 `bge-m3`(1.2GB)/`qwen3`(~600MB) 需评估内网机显存/内存与 U 盘容量。
- **索引一致性**：换模型/换维度/换前缀必须重建，UI 须明确提示并自动失效旧索引。
- **BM25 实现复杂度**：纯 JS BM25 + 倒排表首次构建可能耗时（5 万切片约数秒），可考虑预计算存表（`bm25_index` 表）。v1 可先用 TF-IDF 近似，够用后再升级。
- **Umi 语料时效**：git clone `umijs/umi` 拿 site 目录依赖仓库结构稳定；若上游重构目录需同步调整脚本。

---

## 14. 与 superpowers 流程的对接

本文档为 **Spec 阶段产出**（superpowers 的 `specs/` 目录）。审阅通过后，下一步进入 **Writing Plans** 阶段：把 §11 的 6 期拆解为可执行的 plan 文件（`docs/superpowers/plans/2026-07-19-rag-*.md`），每期一个 plan，含具体任务清单、验收标准、风险点。再之后由 Implement 阶段按 plan 落地。

---

## 附录 A：联网验证证据汇总

| 验证项 | 来源 | 结论 |
|--------|------|------|
| React llms.txt | https://react.dev/llms.txt | ✅ ~150+ .md 链接，结构清晰 |
| Vue llms.txt | https://vuejs.org/llms.txt | ✅ ~80+ .md 链接 |
| AntD llms.txt | https://ant.design/docs/react/llms/ | ✅ 提供 llms.txt + llms-full.txt + 单组件 .md + 语义 .md |
| AntD 中文 | https://ant-design.antgroup.com/docs/react/llms-cn | ✅ 中文版同构 |
| Expo | https://docs.expo.dev/llms-full.txt | ✅ 大聚合包可用 |
| Umi | （联网搜索无 llms.txt） | ⚠️ 走 git clone site 目录 |
| Ollama /api/embed | https://docs.ollama.com/api/embed | ✅ input 支持数组、有 truncate、options.num_ctx |
| nomic-embed-text | https://ollama.com/library/nomic-embed-text | ✅ 274MB、768 维、默认 2K 上下文（需手动调 8K） |
| nomic 8192 上下文 | https://github.com/ollama/ollama/issues/11214 | ✅ 模型原生支持 8192，Ollama 默认 2048，需 num_ctx:8192 |
| llms.txt 规范 | https://llmstxt.org/ | ✅ 已成事实标准，主流框架普遍支持 |

---

## 附录 B：与 v1 draft 的差异

| 项 | v1 draft | v2（本文件） |
|----|----------|--------------|
| nomic 上下文描述 | "原生 8K 上下文" | 修正：模型原生 8192，但 **Ollama 默认按 2048 加载**，必须显式 `num_ctx:8192`（联网验证 ollama issue #11214） |
| AntD 抓取策略 | 仅提 `llms-full.txt` | 补全：两种模式（`nav` 单组件 .md + `full` 大聚合包），默认推荐 `nav` 便于增量更新 |
| Umi 语料 | 未提及无 llms.txt 的问题 | 补全替代方案：git clone site 目录 / HTML→MD 抽取 / 手工投放 |
| 7b 触发可靠性 | 仅提"behavior 提示 + /docs 命令" | 补全三层兜底：system prompt + /docs 命令 + UI 按钮 |
| 内存预算 | 未提及 | 新增 §10.15：5 万切片 ~200MB 常驻，需 4GB+ 机器 |
| 首次入库耗时 | 未提及 | 新增 §10.16：1 万片约 5-15 分钟，UI 需进度反馈与可中止 |
| 语料更新策略 | 未提及 | 新增 §10.17：manifest 记 fetched_at + sha，月度重跑 |
| 配置项 | 6 项 | 扩展到 13 项（含 dim、ctx、prefix、batch_size、bm25 开关等） |
| 实施阶段 | 6 步线性列表 | 改为 6 期表格，标注依赖关系与最小可用版本范围 |
| 联网证据 | 仅结论性陈述 | 新增附录 A：每条结论附 URL |
