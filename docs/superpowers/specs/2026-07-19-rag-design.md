# Ason Agent — 离线 RAG 知识库子系统设计（Spec）

- 日期：2026-07-19
- 状态：待审阅（review 版，按 Step 组织）
- 作者：opencode（brainstorming 流程 + 联网可行性验证）

---

## 1. 背景与目标

Ason Agent 是**纯离线、内网断网**的本地智能体：模型经 Ollama 本地推理，工具调用限制在单项目目录，回答基于真实数据。其对"外部知识"的依赖仅来自 (a) 模型权重、(b) 项目内文件、(c) 对话记忆（`memory/recall.js`）。

**缺口**：7b 小模型（如 `qwen2.5-coder:7b`）对 React/Vue/Umi/Java 等框架/语言文档细节掌握有限，易过时或编造。

**目标**：新增 **RAG 知识库子系统**——把常用互联网资料（Java 教程、Umi、React、Vue、AntD 等）下载到本地、提纯、切片、向量化并建立索引；对话时由 7b 按需检索，把精准文档片段注入上下文，显著提升外部知识类回答的准确性，**全程不依赖外网**。

### 可行性结论（已联网验证）

1. **向量化 100% 离线**：Ollama 提供本地 embedding 模型，拉取一次后离线可用。
   - `nomic-embed-text`（768 维，274MB，原生 8K 上下文，CPU 可跑，社区默认）✅
   - `bge-m3`（1024 维，多语言 100+ 语种，适合中英混合）
   - `qwen3-embedding`（中文优化，质量最高）
   统一经 `POST /api/embed`（批量）/ 现有 `/api/embeddings`（单条）。
2. **向量存储可零原生依赖**：本项目禁原生编译（已 vendored `sql.js`）。纯 Node 暴力余弦对 1万~5万 切片为毫秒~数十毫秒级。复用 `sql.js` + `memory/recall.js` 的 `cosine()`。
3. **文档可下载为干净 Markdown**：`react.dev/llms.txt`、`vuejs.org/llms.txt`、`ant.design/llms-full.txt`、Umi/VitePress 站均暴露 `.md`；HTML 站经 vendored 纯 JS 库（`readability`+`turndown`+`linkedom`）在线转 MD。
4. **项目已有基础设施可复用**：`src/core/ollama.js` 的 `embed()`、新增 `embedBatch()`；`recall.js` 的 `cosine()`；`sql.js` 存储。

---

## 2. 设计决策（已确认默认值）

| # | 决策点 | 采用方案 | 理由 |
|---|--------|----------|------|
| 1 | RAG 触发方式 | **(A) 显式 RAG 工具 `rag_search`** + `/docs` 快捷命令 | 7b 自主判断何时调用；`/docs` 作确定性入口防漏调 |
| 2 | 入库工作流 | **(A) 内网机入库** | 原始 Markdown 经文件夹/nginx 投放，跑 `npm run rag:index`（Ollama 离线） |
| 3 | 知识范围 | **(A) 精选集 + 开放投放** | 内置 React/Vue/Umi/AntD/Java 抓取，用户可丢任意 MD 进 `knowledge/` |
| 4 | 嵌入模型 | **`nomic-embed-text`** | 274MB/768 维/成熟；中文 >50% 切 `bge-m3` |
| 5 | 向量库 | **`sql.js` + 暴力余弦** | 复用零依赖基础设施；5 万片内 < 50ms |
| 6 | 混合检索 | **余弦 + BM25/RRF + 分数阈值** | 修复精确 API 名召回失败 + 防幻觉 |
| 7 | 弱模型兜底 | **Self-Route**：不足时 `read_file` 读全篇 | 复用现有工具，补 RAG 跨文档推理短板 |

---

## 3. 总体架构（在线侧 / 内网侧分离）

```
┌──────────────────── 在线侧（有公网，一次性/周期重跑）────────────────────┐
│  scripts/rag/fetch-docs.js  【知识提纯，脱离内网运行时】                  │
│   · llms 型：抓 llms.txt → 递归抓 .md                                    │
│   · html 型：抓 HTML → readability 抽正文 → turndown 转 MD              │
│   · 产出：knowledge/<source>/*.md + manifest.json                       │
│   · 依赖 readability/turndown/linkedom（vendored，仅在线阶段用）         │
└───────────────────────────────────┬───────────────────────────────────┘
                                     │  knowledge/ 语料（经文件夹拷贝或 nginx 投放）
┌──────────────────── 内网侧（纯离线，运行时）──────────────────────────┐
│  npm run rag:index → src/rag/ingest.js  【部署期，Ollama 离线】          │
│   · 切片（标题感知 + 窗口回退，含 .html 当场转 MD）                      │
│   · embedBatch（search_document: 前缀，批量 64）→ 写 sql.js 知识库       │
│  对话时：                                                                │
│   Agent → rag_search 工具 → src/rag/retrieve.js                         │
│     · embedQuery → 暴力余弦 top-K + BM25/RRF + 分数阈值                  │
│     · 返回 片段 + 引用(source/title/path)                               │
│   · 片段不足 → Self-Route：调 read_file(path) 读全篇 → 全文档推理        │
│   Agent 基于片段/全篇作答并附引用                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**关键原则**：① 公网依赖只在在线侧；② 提纯是构建期 CLI，不进运行时请求路径；③ 运行时只消费 `.md` 与本地索引，零外部依赖。

---

## 4. Step-by-Step 实施步骤（总览）

> 以下每一步标注「在线/内网」「新增文件」「依赖」，可逐 Step 交付与验收。

### Step 0 — 准备与环境
- **在线侧**：`npm i`（仅装 vendored 纯 JS 库 readability/turndown/linkedom 到 `lib/` 或 `scripts/rag/` 局部依赖，无原生编译）。
- **内网侧**：`ollama pull nomic-embed-text`（离线部署包 `build-offline-pack.sh` 一并打包权重）。
- 复用 `src/core/ollama.js` 的 `embed()`，新增 `embedBatch(texts, opts)`（走 `/api/embed`，数组 input，批量 64，`num_ctx:8192`）。
- 抽取 `src/core/similarity.js` 导出共享 `cosine()`（从 `recall.js` 提取）。
- 配置 `src/config.js`：加入 §9 的 `RAG_*` 变量。

### Step 1 — 在线提纯：抓取语料（`scripts/rag/fetch-docs.js`）
- 入参：`--source react|vue|antd|antdcn|umi|java|html|all`、`--url <首页>`（html 型）、`--base-url <url>`（内网 nginx 覆盖）、`--out knowledge`、`--mode nav|full`（AntD）。
- **llms 型**（react/vue/antd/antdcn/umi/java 有 `.md` 镜像）：拉 `llms.txt` → 解析 `[title](url.md)` → 逐页 GET 落盘 `.md`。
- **html 型**（无 MD 镜像，如多数 Java 教程）：首页出发，限同源发现链接 → 逐页 GET → `@mozilla/readability` 抽正文 → `turndown` 转 MD（代码块保留围栏）→ 落盘 `.md`。
- **SPA 站**（Umi/Docusaurus）：优先 llms.txt；否则抓预渲染静态 HTML；确需 JS 渲染才启 Playwright（默认关，提示用手工 MD）。
- 写 `knowledge/<source>/manifest.json`：`[{title,url,path,sha256,fetched_at,type}]`。
- 幂等（sha 未变跳过）、默认 4 并发 + 200ms 限速。Umi 用 `git clone --depth 1 umijs/umi` 取 `site/docs/**/*.md`。

### Step 2 — 切片（`src/rag/chunk.js`）
- 标题感知：按 `#`/`##`/`###` 切分，保留"父标题链"前缀（如 `# Hooks > useEffect`）。
- 窗口回退：单节 > ~800 token（字符数/4 近似）时按段落滑动窗口切，重叠 ~80 token。
- 代码块保护：围栏代码整体保留在单切片内，不切断。
- 输出：`{content,title,source,path,chunk_idx,token_est}`。

### Step 3 — 离线投放（交付语料到内网）
- **方式一（文件夹）**：拷贝 `knowledge/` 进项目根/挂载卷，内网跑 `npm run rag:index`。
- **方式二（nginx）**：内网 nginx 静态服务 `knowledge/`，暴露同构 `llms.txt`+`.md`；`fetch-docs --base-url http://intranet-docs/` 从内网拉（无需公网）。

### Step 4 — 内网索引（`src/rag/ingest.js` + `store.js`）
- 扫描 `knowledge/` 全部 `.md`（及 `.html`：当场用 vendored 库转 MD 并缓存同名 `.md`）。
- 增量：比对 `data/rag/sources.json` 的 sha256；仅处理新增/变更，删已移除文件切片。
- 向量化：`embedBatch(chunks,{prefix:'search_document:'})`（批量 64，`num_ctx:8192`）。
- 落库：`sql.js` 文件 `data/rag/knowledge.db`，`chunks` 表 `embedding` 存 Float32 BLOB；库头 `meta` 存 `embed_model`/`dim`/`created_at` 供查询期一致性校验。
- UI 必须有进度反馈与可中止能力（首次 1 万片 CPU 约 5–15 分钟）。

### Step 5 — 检索（`src/rag/retrieve.js`）
- `embedQuery(q)` → `embed(q,{prefix:'search_query:'})`（按模型用对应前缀）。
- 主检索：暴力余弦 top-K（`RAG_TOP_K` 默认 5）。
- **混合**：对 `content` 做 BM25 关键词检索，与向量结果用 RRF 融合（修复 `useEffect`/`v-model` 等精确名召回失败）。
- **分数阈值**：top 余弦 < `RAG_MIN_SCORE`（0.30）视为"文档无答案"，返回空，Agent 自行答/声明未知，防幻觉。
- 返回：`[{content,source,title,path,score}]`。

### Step 6 — RAG 工具接入（`src/tools/rag_search.js`）
- 注册进 `src/tools/index.js` 的 `TOOLS`（动作类，无需确认）。入参 `query`(必填)/`source`(可选)/`k`(可选)。
- 调用 `retrieve.js`；空结果明确返回"知识库未检索到相关内容"。
- 提示词：在 Agent behavior 中声明该工具专用于"框架/语言/库文档类问题"，由 7b 决定调用；并加 `/docs <问题>` 快捷命令强制走 RAG；UI 输入框旁放「📚 检索知识库」按钮（弱模型三层兜底）。
- **Self-Route**：`rag_search` 返回命中 `path`；7b 判片段不足时调现有 `read_file(path)` 读全篇做全文档推理。

### Step 7 — UI / 设置 + 引用渲染
- 设置页「知识库」卡片：显示嵌入模型、切片数、索引时间；「重新索引」按钮触发 `rag:index`。
- 对话中 rag 引用渲染为可点击 chip（标题 + 打开 `path` 原文）。

### Step 8 — 测试与评估
- 单测（`test/rag/*.test.js`，`node --test`）：`chunk`（标题感知/代码块保护/窗口回退）、`store`（增删/余弦 top-K）、`retrieve`（阈值/空结果/BM25 融合）。
- 端到端：迷你 `knowledge/`（2–3 篇 md）→ 入库 → `rag_search` 命中预期片段。
- 质量评估：维护 `test/rag/golden.jsonl`（问题→期望文档），索引后批量检索算 recall@K 作回归基线。

---

## 5. 模块设计明细

| 模块 | 文件 | 职责 |
|------|------|------|
| 抓取/提纯 | `scripts/rag/fetch-docs.js` | 在线：llms/html 两类源 → `knowledge/` MD（见 Step 1） |
| 切片 | `src/rag/chunk.js` | 标题感知 + 窗口回退（Step 2） |
| 入库 | `src/rag/ingest.js` | 扫描/增量/embedBatch/落库（Step 4） |
| 向量存储 | `src/rag/store.js` | sql.js BLOB + 暴力余弦 top-K |
| 检索 | `src/rag/retrieve.js` | 余弦 + BM25/RRF + 阈值（Step 5） |
| RAG 工具 | `src/tools/rag_search.js` | 工具注册 + 引用返回 + Self-Route path |
| 共享 | `src/core/similarity.js` | 抽取 `cosine()`；`ollama.embedBatch()` |
| 配置 | `src/config.js` | `RAG_*` 变量 |
| UI | `public/frontend/...` | 知识库卡片 + 引用 chip |
| 索引 | `data/rag/knowledge.db` | 运行时生成，gitignore |

### 数据表（store.js）
```sql
CREATE TABLE chunks(
  id INTEGER PRIMARY KEY,
  source TEXT, title TEXT, path TEXT, chunk_idx INTEGER,
  content TEXT, embedding BLOB, sha TEXT
);
CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT); -- embed_model, dim
```

### 配置项（src/config.js）
| 变量 | 默认 | 说明 |
|------|------|------|
| `RAG_EMBED_MODEL` | `nomic-embed-text` | 换模型须重建索引 |
| `RAG_CHUNK_TOKENS` | `800` | 切片大小 |
| `RAG_TOP_K` | `5` | 检索条数 |
| `RAG_MIN_SCORE` | `0.30` | 最低相似度，低于视为无答案 |
| `KNOWLEDGE_DIR` | `knowledge/` | 语料目录 |
| `RAG_INDEX_DIR` | `data/rag` | 索引目录（符合 CLAUDE.md 的 data/ 约定） |

---

## 6. 替代技术对比（补充调研结论）

对"外挂资料 + 问答"，在**本项目硬约束**（离线 / 7b 小上下文 8–16K / 零原生依赖 / 内网 / 已有自有工具框架）下：

| 方案 | 适配度 | 结论 |
|------|--------|------|
| **A. 工具增强阅读**（复用 `grep`/`read_file`/`semantic_grep` 翻 `knowledge/`） | ✅ 最贴合、零新设施 | `semantic_grep` 本就目录级语义检索；可作 v1 轻量验证/退化回退 |
| **B. RAG 原生工具**（本方案） | ✅ 质量最优选 | NL 文档问答质量显著高于 A |
| **C. MCP 文档服务器** | ⚠️ 冗余 | 项目已有 `src/tools/` 框架，立 MCP server 重复造轮且更重 |
| **D. 长上下文 / llms-full.txt 整篇塞** | ❌ 不现实 | 文档远超 7b 8–16K 窗口；研究一致：成本/中间遗忘崩盘 |
| **E. Fine-tuning / LoRA** | ❌ 不适合 | 研究一致：微调擅长行为/风格，**不擅长存事实**，加剧幻觉、训练后即过时 |

**采用**：主方案 RAG（B）；新增 Self-Route（Step 6）与 `semantic_grep` 轻量回退（A）；排除 MCP（C）/长上下文（D）/微调（E）。

---

## 7. 你未想到、但必须纳入的点（清单）

1. **嵌入/查询必须同模型同维度**：索引由 A 建、B 查 → 向量不可比、检索全乱。库头固化 `embed_model`+`dim`，查询期强校验。
2. **查询前缀差异**：`nomic` 需 `search_document:`/`search_query:`；`bge-m3` 需 `"Represent this sentence for searching relevant passages: "`。按模型分支，错前缀掉 5–10 分。
3. **切片长度 vs 嵌入窗口**：nomic 原生 8K 但 Ollama 默认 2048，长切片静默截断 → 必须 `num_ctx:8192` + 800 token 切片。
4. **混合检索（BM25+向量）**：纯语义对精确符号名召回差，BM25+RRF 是把质量拉满的最高杠杆，v1 即纳入。
5. **分数阈值 + "无答案"分支**：低分片段不注入，否则 7b 基于噪声编造。低于阈值让模型自答/声明未知。
6. **引用可追溯**：每片段带 `source/title/path`，满足"不瞎编"且用户可核对原文。UI 渲染 chip。
7. **中文/多语言**：默认 `nomic`；中文 >50% 切 `bge-m3`（维度 1024 变化需重建）。
8. **HTML 资料处理（已解决）**：见 Step 1 html 型；PDF 仍开放项（`pdfjs-dist` wasm，v2）。
9. **增量索引**：基于 sha，避免每次全量重嵌（全量数分钟，只跑变更）。
10. **知识目录与沙箱隔离**：`knowledge/`、`data/rag/` 不受 `PROJECT_ROOT` 沙箱约束，也不应被 `write_file`/`edit_file` 误改（路径白名单）。
11. **与对话记忆边界**：RAG=文档知识，recall=对话记忆，入口与索引分离。
12. **性能上限**：暴力余弦 5 万片内 < 50ms；超规模再引 `js-vector-store`（IVF/HNSW，仍纯 JS）。
13. **索引不入库 git**：`data/rag/` 与 `knowledge/` 加 `.gitignore`（`knowledge/.keep` 例外占位）。
14. **7b 弱模型触发可靠性**：三层兜底（behavior 提示 + `/docs` 命令 + UI 按钮）。
15. **内存预算**：5 万片 sql.js 常驻 ~200MB + Ollama ~1–2GB，需 4GB+ 机；低配限 1 万片内或更小嵌入模型。
16. **首次入库耗时**：1 万片 CPU 5–15 分钟，UI 须进度反馈 + 可中止。
17. **语料更新策略**：`manifest.json` 记 `fetched_at`+URL；按月重跑 `fetch-docs`，按 sha 仅重嵌变更。
18. **AntD 大/小文件抉择**：默认 `nav` 模式（单组件 .md）便于增量；`llms-full.txt` 省事但切片多。

---

## 8. 文件布局（新增/改动）

```
scripts/rag/fetch-docs.js         # 在线提纯（新增）
lib/ 或 scripts/rag/vendor/       # vendored: readability / turndown / linkedom（纯 JS）
src/rag/chunk.js                  # 切片（新增）
src/rag/ingest.js                 # 入库（新增）
src/rag/store.js                  # 向量存储 sql.js（新增）
src/rag/retrieve.js               # 检索（新增）
src/tools/rag_search.js           # RAG 工具（新增）
src/core/similarity.js            # 抽取共享 cosine（新增，从 recall.js 提）
src/core/ollama.js                # 新增 embedBatch()（改动）
src/tools/index.js                # 注册 rag_search（改动）
src/config.js                     # 新增 RAG_*（改动）
public/frontend/...               # 设置页卡片 + 引用 chip（改动）
data/rag/knowledge.db             # 索引（运行时生成，gitignore）
knowledge/                       # 语料（运行时/分发，gitignore 可选）
test/rag/*.test.js               # 单测 + golden 评估（新增）
scripts/build-offline-pack.sh    # 接入 ollama pull 嵌入模型（改动）
```

---

## 9. 风险与开放问题

- **Java/PDF 语料**：HTML 已解决；PDF 需 `pdfjs-dist`（v2）。
- **7b 漏调/误调**：三层兜底（§7.14）。
- **嵌入模型体积**：`nomic` 274MB 可接受；`bge-m3`(1.2GB)/`qwen3` 需评估内网机显存。
- **索引一致性**：换模型/维度必须重建，UI 明确提示并自动失效旧索引。
- **提纯独立成仓（可选）**：`knowledge/` 可放独立 git 仓库便于非开发同事维护语料，非必须。
