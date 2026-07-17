# ollama_agent 后续计划方向（Roadmap Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ollama_agent 现有能力之上做增量增强：收口模型与 Prompt、补上编辑 Diff 预览、内网可观测与模板生态，形成可交付的内网产品。所有改动以「新建文件 / 追加式修改」为原则，不删除既有代码。

**Architecture:** 沿用现有零依赖 Node + Ollama 架构；以 `src/core/template-loader.js` + `src/templates/*.md` 为模板内核，以 `src/core/quick/` 为模板化快捷命令，以 `config.js` 的 `MODEL_ROUTING`/`SELF_HEAL`/`WORKFLOW_MODE` 为控制面。本计划不做架构重构，只在既有模块上增量增强，并把「模板库沉淀 + 用户自定义模板」作为战略主线。

**Tech Stack:** Node.js 内置模块（零 npm 依赖）、sql.js (WASM)、Ollama REST API（`/api/generate`、`/api/chat`）、simpui（前端 UI）、lucide（图标）。

## 已具备能力（不在本计划内，避免重复造轮子）

- 模板系统：`src/core/template-loader.js` + `src/templates/{fix-bug,refactor-rename,add-function,explain-code,count-loc}.md`
- 规划模式 + 结构化计划渲染：`src/core/agent.js` 的 `tryParsePlan`（产出 `{goal,steps,risks}`）→ `public/frontend/js/modules/render.js` 的 `renderStructuredPlan`（已渲染可勾选步骤卡片）
- 文件树侧栏：前端 `public/frontend/js/modules/file-browser.js`（调 `/api/fs/list`）+ 后端 `src/server.js` 的 `handleFsList`
- 自检闭环：`config.js` 的 `SELF_HEAL`/`MAX_HEAL_STEPS`/`VERIFY_EVERY` + `src/tools/verify/{run_tests,run_lint}.js`
- 模型路由：`MODEL_ROUTING`（default/compact/embed/simple），`NUM_CTX`、`TEMPERATURE=0.1`
- 记忆：`src/memory/recall.js`（L1/L2/L3，embedding 缺失时自动降级关键词召回）、压缩：`src/core/compact.js`
- 语义检索：`src/tools/semantic_grep.js`（token 重叠实现，不依赖任何 embedding 模型）
- 快捷命令：`src/core/quick/`（自动扫描 `commands/` 目录注册，无需手动登记）

> 本计划仅覆盖上述能力之外的增量。

## Global Constraints

- 零运行时依赖：`package.json` 的 `dependencies` 必须保持为空；禁止新增 npm 包。确需能力时优先 Node 内置模块或已有 WASM（sql.js）。
- 数据目录固定为项目根 `data/`：`storage/` 用 `path.resolve(__dirname, '..', '..', 'data')`，勿写成 `'..', 'data`。
- `src/server.js` 为服务入口，禁止移动/重命名；新增路由在已有 `http.createServer((req,res)=>{...})` 的 `if` 链中追加一行，并新增对应 `handleXxx(res)` 函数，**不得新增第二个 `server.on('request')`**。
- 第三方库 `public/lib/`、`public/lib/simpui/` 禁止修改；所有 UI 须基于 simpui 类与令牌，图标统一用 `lib/lucide`。
- 代码风格：CommonJS（`module.exports`）、`'use strict'`、2 空格缩进、中文注释（解释 why）、函数单一职责。
- 工具/技能路径相对 `PROJECT_ROOT`，须经 `utils.safeResolve` 做越界校验；标记「需确认」的工具保持确认流程。
- 模型调用遵循 `config.js`：`STEP_TIMEOUT_MS`、`MAX_STEPS`、`SELF_HEAL`、`NUM_CTX`；新增模型相关默认值须用环境变量可覆盖。
- embedding 模型（`MODEL_ROUTING.embed`）为可选增强：缺省不拉取，记忆系统自动降级为关键词召回，应用功能不受影响；本计划不新增任何对 embedding 模型的依赖。
- **改动原则：所有 `Modify` 任务均为追加/分支式修改（新增一行调用、追加一个规则、追加一个扫描目录），不删除既有代码；新功能一律新建文件或新建路由处理函数。**
- 提交规范：`<type>: <description>`，type ∈ feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert，描述小写祈使句 ≤50 字符。

---

## 文件结构（按阶段）

Phase 0 — 模型与 Prompt 调优（MVP 收口）
- Modify: `src/config.js`（DEFAULT_MODEL、NUM_CTX、COMPACT_THRESHOLD 默认值）
- Modify: `src/core/prompts/behavior.js`（追加一条行为约束）

Phase 1 — 核心能力增强
- Create: `public/frontend/js/modules/diff-preview.js`（编辑结果 Diff 预览弹窗）
- Modify: `public/frontend/js/modules/render.js`（在 edit/apply_diff 工具结果渲染处挂载预览，追加一行调用）

Phase 2 — 产品化包装
- Create: `scripts/build-offline-pack.sh`（内网离线部署包，仅含编码模型）
- Modify: `src/server.js`（在路由链追加 `GET /api/health` 一行 + 新增 `handleHealth` 函数）

Phase 3 — 模板生态（战略主线）
- Create: `src/templates/{code-review,locate-bug,security-audit}.md`（更多内置模板）
- Modify: `src/core/template-loader.js`（追加扫描用户自定义模板目录，分支式）
- Create: `public/frontend/js/modules/template-manager.js`（模板管理 UI 新模块）
- Create: `src/core/quick/commands/{refactor,doc}.js`（新快捷命令，自动被发现）

Phase 4 — 长期
- Create: `docs/templates-guide.md`（模板编写指南）

---

### Task 1: 默认模型切换为编码优先模型

**Files:**
- Modify: `src/config.js:13`（单行改动，不删其他）
- Test: `node -e "console.log(require('./src/config').DEFAULT_MODEL)"`

**Interfaces:**
- 消费：`config.DEFAULT_MODEL` 被 `agent.js` / `ollama.js` 读取
- 产出：无新接口，仅改变量默认值

- [ ] **Step 1: 修改默认模型**

将 `src/config.js:13` 改为：

```js
// 默认对话模型：编码优先首选 qwen2.5-coder:7b；仍可用环境变量覆盖（MODEL=deepseek-r1:8b）
const DEFAULT_MODEL = process.env.MODEL || 'qwen2.5-coder:7b';
```

- [ ] **Step 2: 验证默认值生效**

Run: `node -e "console.log(require('./src/config').DEFAULT_MODEL)"`
Expected: `qwen2.5-coder:7b`

- [ ] **Step 3: 提交**

```bash
git add src/config.js
git commit -m "fix: 默认模型改为 qwen2.5-coder:7b 编码优先"
```

### Task 2: 收敛默认上下文窗口

**Files:**
- Modify: `src/config.js:30`（单行改动）
- Test: `node -e "console.log(require('./src/config').NUM_CTX)"`

**Interfaces:**
- 消费：`config.NUM_CTX` 被 `ollama.js` 用作 `options.num_ctx`
- 产出：无

- [ ] **Step 1: 调整默认 NUM_CTX**

将 `src/config.js:30` 改为（7B/8B 在 16K 下质量下降，默认 8K，高端机用 `NUM_CTX=16384` 覆盖）：

```js
const NUM_CTX = Number(process.env.NUM_CTX) || 8192; // 7B/8B 默认 8K，质量更稳；大显存可 NUM_CTX=16384
```

- [ ] **Step 2: 验证**

Run: `node -e "console.log(require('./src/config').NUM_CTX)"`
Expected: `8192`

- [ ] **Step 3: 提交**

```bash
git add src/config.js
git commit -m "fix: 默认 NUM_CTX 收敛为 8192 提升 7B 质量"
```

### Task 3: 强化系统 Prompt 行为约束

**Files:**
- Modify: `src/core/prompts/behavior.js`（在 `rules.push(...)` 后追加一条，不删既有）
- Test: `node -e "const {behaviorRules}=require('./src/core/prompts/behavior');console.log(behaviorRules(true))"`

**Interfaces:**
- 消费：`behaviorRules(hasTemplate)` 被 `agent.js` 的 prompt 组装调用
- 产出：无

- [ ] **Step 1: 补充模板场景下的第 7 条约束**

在 `behavior.js` 的 `rules.push(...)` 之后追加：

```js
  rules.push(
    '7. 命中任务模板时，必须严格按模板给定的步骤顺序执行，禁止跳步或自创流程；模板未覆盖的环节才允许自由发挥。'
  );
```

- [ ] **Step 2: 验证导出含第 7 条**

Run: `node -e "const {behaviorRules}=require('./src/core/prompts/behavior');console.log(behaviorRules(true).includes('命中任务模板时'))"`
Expected: `true`

- [ ] **Step 3: 提交**

```bash
git add src/core/prompts/behavior.js
git commit -m "feat: 模板模式补充按步骤执行硬约束"
```

### Task 4: 编辑结果 Diff 预览面板

**Files:**
- Create: `public/frontend/js/modules/diff-preview.js`（全新文件，暴露 `window.DiffPreview.show`）
- Modify: `public/frontend/js/modules/render.js`（在 tool-block 渲染函数中，对 `edit_file`/`apply_diff` 结果追加一行 `DiffPreview.show` 调用；不改动其他渲染逻辑）
- Modify: `public/frontend/css/modules/diff-preview.css`（新增，配套布局样式）
- Modify: `public/index.html`（引入上述 js/css，顺序在 render.js 之前）

**Interfaces:**
- 消费：render.js 的 tool 结果渲染（`appendToolCall`/`setToolResult`）
- 产出：`window.DiffPreview.show(original, modified, path)` 全局函数

- [ ] **Step 1: 新建 diff-preview.js（simpui 对话框，side-by-side）**

```js
'use strict';
// 编辑结果 diff 预览：用 simpui 对话框并排展示原始/修改，逐行标记。
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
window.DiffPreview = {
  show(original, modified, filePath) {
    const html = `
      <div class="simpui-dialog-backdrop">
        <div class="simpui-dialog simpui-dialog-lg">
          <div class="simpui-dialog-header">Diff 预览 — ${esc(filePath || '')}</div>
          <div class="diff-grid">
            <pre class="diff-old">${esc(original)}</pre>
            <pre class="diff-new">${esc(modified)}</pre>
          </div>
          <div class="simpui-dialog-footer">
            <button class="simpui-btn simpui-btn-secondary" data-act="close">关闭</button>
          </div>
        </div>
      </div>`;
    const el = document.createElement('div');
    el.innerHTML = html;
    el.querySelector('[data-act="close"]').onclick = () => el.remove();
    document.body.appendChild(el);
  },
};
```

- [ ] **Step 2: 在 render.js 的 tool 结果渲染处挂载预览（追加，不删）**

在 `appendToolCall` 中 `toolWrap.dataset.action = action;` 之后追加：`if (params && (params.path || params.file)) toolWrap.dataset.filePath = params.path || params.file;`

在 `setToolResult` 的 `resultEl.textContent = text;` 之后追加：

```js
if ((action === 'edit_file' || action === 'apply_diff') && typeof window.DiffPreview === 'object' && text.length) {
  const fp = resultEl.closest('.tool-block')?.dataset?.filePath || '';
  window.DiffPreview.show('', text, fp);
}
```

- [ ] **Step 3: 新增 diff-preview.css 并引入 index.html**

`public/frontend/css/modules/diff-preview.css`：

```css
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
.diff-grid pre { margin: 0; padding: 10px; border-radius: 6px; overflow: auto; max-height: 52vh; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; background: var(--simpui-surface-alt, #1b1b1f); color: var(--simpui-text, #e6e6e6); }
.diff-old { border-left: 3px solid var(--simpui-danger, #e5484d); }
.diff-new { border-left: 3px solid var(--simpui-success, #46a758); }
```

在 `public/index.html` 的 `</head>` 前加 `<link rel="stylesheet" href="/css/modules/diff-preview.css" />`，在 render.js 之前加 `<script src="/js/modules/diff-preview.js"></script>`。

- [ ] **Step 4: 验证语法并启动手测**

Run: `node --check public/frontend/js/modules/diff-preview.js && node --check public/frontend/js/modules/render.js`
Expected: 均通过（无语法错误）
手测：启动 `node src/server.js`，执行一次 edit_file，应弹出 Diff 预览对话框。

- [ ] **Step 5: 提交**

```bash
git add public/frontend/js/modules/diff-preview.js public/frontend/css/modules/diff-preview.css public/frontend/js/modules/render.js public/index.html
git commit -m "feat: 编辑结果 diff 预览面板"
```

### Task 5: 压缩触发阈值按小上下文收敛

**Files:**
- Modify: `src/config.js`（将 `COMPACT_THRESHOLD` 默认值由 0.7 调为 0.6；`agent.js:603` 已用 `NUM_CTX * COMPACT_THRESHOLD` 触发，无需改 agent.js）
- Test: `node -e "console.log(require('./src/config').COMPACT_THRESHOLD)"`

**Interfaces:**
- 消费：`config.COMPACT_THRESHOLD` 被 `agent.js:603` 使用
- 产出：无

- [ ] **Step 1: 调整 COMPACT_THRESHOLD 默认**

将 `src/config.js` 中 `COMPACT_THRESHOLD` 定义改为：

```js
const COMPACT_THRESHOLD = Number(process.env.COMPACT_THRESHOLD) || 0.6; // 8K 窗口下更早压缩，避免截断早期上下文
```

- [ ] **Step 2: 验证**

Run: `node -e "console.log(require('./src/config').COMPACT_THRESHOLD)"`
Expected: `0.6`

- [ ] **Step 3: 提交**

```bash
git add src/config.js
git commit -m "fix: COMPACT_THRESHOLD 默认收敛为 0.6"
```

### Task 6: 内网离线部署包脚本

**Files:**
- Create: `scripts/build-offline-pack.sh`（全新文件）
- Test: `bash -n scripts/build-offline-pack.sh`（语法检查）

**Interfaces:**
- 消费：本地已拉取的 Ollama 编码模型、项目源码
- 产出：`dist/ollama_agent-offline.tar.gz` 自包含包（仅含编码模型，不含 embedding 模型）

- [ ] **Step 1: 编写离线打包脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail
# 构建内网离线部署包：源码 + Ollama 二进制(三平台) + 已导出编码模型 + 安装脚本
OUT=dist/ollama_agent-offline
rm -rf "$OUT" && mkdir -p "$OUT"/{bin,models,src}
cp -r src package.json public "$OUT/src" 2>/dev/null || cp -r src package.json "$OUT/src"
# 导出本地已拉取编码模型（embedding 模型为可选，默认不打包）
for m in qwen2.5-coder:7b; do
  ollama show --modelfile "$m" >/dev/null 2>&1 && echo "packing $m" && \
    (ollama pull "$m" >/dev/null 2>&1; cp -r ~/.ollama/models/* "$OUT/models" 2>/dev/null || true)
done
cat > "$OUT/install.sh" <<'EOF'
#!/usr/bin/env bash
# 离线安装：解压后 ./install.sh 即启动（无需 npm install）
cd "$(dirname "$0")"
[ -x bin/ollama ] || echo "请将对应平台 ollama 二进制放入 bin/"
echo "运行:  MODEL=qwen2.5-coder:7b node src/server.js"
EOF
chmod +x "$OUT/install.sh"
tar -czf "$OUT.tar.gz" -C dist ollama_agent-offline
echo "built $OUT.tar.gz"
```

- [ ] **Step 2: 语法校验**

Run: `bash -n scripts/build-offline-pack.sh`
Expected: 无输出（语法通过）

- [ ] **Step 3: 提交**

```bash
git add scripts/build-offline-pack.sh
git commit -m "build: 新增内网离线部署打包脚本"
```

### Task 7: 健康检查自检端点

**Files:**
- Modify: `src/server.js`（在 `http.createServer((req,res)=>{...})` 的 `if` 路由链中追加一行 `GET /api/health`，并新增 `handleHealth(res)` 函数；不新增第二监听器）
- Test: `node src/server.js & curl -s localhost:3000/api/health`

**Interfaces:**
- 消费：已在 `server.js` 顶部的 `DEFAULT_MODEL`、`OLLAMA_HOST`、`sendJSON`
- 产出：JSON `{ollama, model, disk, gpu, ok}`

- [ ] **Step 1: 在路由链追加一行 + 新增 handleHealth**

在 `server.js` 现有路由链（如 `if (req.method === 'GET' && url === '/api/config') return handleConfig(res);` 附近）追加：

```js
  if (req.method === 'GET' && url === '/api/health') return handleHealth(res);
```

在文件内其它 `handleXxx` 函数旁新增：

```js
function handleHealth(res) {
  const out = { ok: true, ollama: false, model: DEFAULT_MODEL, disk: null, gpu: null };
  fetch(`${OLLAMA_HOST}/api/tags`)
    .then((r) => r.json())
    .then((data) => {
      out.ollama = true;
      out.model = data.models?.some((m) => m.name === DEFAULT_MODEL) ? DEFAULT_MODEL : `缺失:${DEFAULT_MODEL}`;
    })
    .catch((e) => { out.ok = false; out.error = e.message; })
    .finally(() => sendJSON(res, 200, out));
}
```

- [ ] **Step 2: 启动并验证**

Run: `node src/server.js & sleep 2; curl -s localhost:3000/api/health; kill %1`
Expected: 含 `"ollama":true` 或 `"ok":false`（Ollama 未启动时为降级 JSON）的 JSON

- [ ] **Step 3: 提交**

```bash
git add src/server.js
git commit -m "feat: 新增 /api/health 自检端点"
```

### Task 8: 扩充内置模板库

**Files:**
- Create: `src/templates/code-review.md`
- Create: `src/templates/locate-bug.md`
- Create: `src/templates/security-audit.md`

**Interfaces:**
- 消费：`template-loader.js` 自动扫描 `src/templates/*.md`（已有能力）
- 产出：三份新模板，匹配「审查/审查代码」「定位/排查 bug」「安全/审计」关键词

- [ ] **Step 1: 编写 code-review.md**

```markdown
---
name: code-review
title: 代码审查
keywords: 审查, review, 代码评审, cr
---
请按以下顺序对目标文件做审查，每步只调必要工具：
1. 用 read_file / grep 读取相关代码与测试。
2. 按正确性、可读性、安全性、性能四类列出问题（附文件:行号）。
3. 对每条问题给出具体修改建议（不擅自改，仅建议）。
4. 输出结构化报告：问题清单 + 风险等级（高/中/低）。
```

- [ ] **Step 2: 编写 locate-bug.md（关键词：定位, 排查, bug, 为什么报错）**

结构同上，步骤为：复现现象 → 用 grep/tree 缩小范围 → 读相关文件 → 给出根因假设与验证命令。

- [ ] **Step 3: 编写 security-audit.md（关键词：安全, 审计, 漏洞, secret）**

步骤：扫描硬编码密钥/危险函数 → 列风险 → 给加固建议。

- [ ] **Step 4: 验证模板被加载**

Run: `node -e "const {allTemplates}=require('./src/core/template-loader');console.log(allTemplates().map(t=>t.name))"`
Expected: 数组含 `code-review`、`locate-bug`、`security-audit`

- [ ] **Step 5: 提交**

```bash
git add src/templates/code-review.md src/templates/locate-bug.md src/templates/security-audit.md
git commit -m "feat: 新增代码审查/定位/安全审计模板"
```

### Task 9: 用户自定义模板支持

**Files:**
- Modify: `src/core/template-loader.js`（在 `allTemplates()` 中追加扫描 `data/templates` 目录，分支式，不删既有扫描）
- Create: `public/frontend/js/modules/template-manager.js`（全新 UI 模块）
- Modify: `public/index.html`（引入 template-manager.js，侧栏/设置加入口，追加式）
- Test: `node -e "const {allTemplates}=require('./src/core/template-loader');console.log(allTemplates().length)"`

**Interfaces:**
- 消费：`config.PROJECT_ROOT` 下 `data/templates/*.md`（用户目录，越界安全）
- 产出：内置 + 用户模板合并后的列表；UI 可新建/编辑/删除用户模板

- [ ] **Step 1: 让 loader 追加扫描用户目录（分支式）**

在 `template-loader.js` 的 `allTemplates()` 中，于扫描 `TEMPLATE_DIR` 之后追加扫描 `path.resolve(config.PROJECT_ROOT, 'data', 'templates')`（用 `fs.existsSync` 保护）；用户模板可与内置同名，用户优先。仅新增一段循环，不改动既有逻辑。

- [ ] **Step 2: 新增模板管理 UI 模块**

新建 `template-manager.js`：复用 simpui 卡片/对话框，列表展示全部模板（标注内置/用户），「新建」打开编辑器（name/title/keywords + 正文），保存写入 `data/templates/<name>.md`；「删除」仅对用户模板生效。在 `index.html` 引入该模块，并在侧栏或设置页加一个入口按钮（侧栏入口为追加式，不删现有 tab）。

- [ ] **Step 3: 验证合并加载**

Run: `node -e "const {allTemplates}=require('./src/core/template-loader');console.log(allTemplates().length)"`
Expected: 数量 = 内置(8) + 用户目录文件数

- [ ] **Step 4: 提交**

```bash
git add src/core/template-loader.js public/frontend/js/modules/template-manager.js public/index.html
git commit -m "feat: 支持用户自定义模板目录与模板管理 UI"
```

### Task 10: 扩展快捷命令

**Files:**
- Create: `src/core/quick/commands/refactor.js`
- Create: `src/core/quick/commands/doc.js`
- Test: `node -e "require('./src/core/quick/commands/refactor');require('./src/core/quick/commands/doc')"`

**Interfaces:**
- 消费：`src/core/quick/registry.js` 自动扫描 `commands/` 目录注册（**无需修改 registry.js**）
- 产出：两个新快捷命令；命令模块导出 `{ name, desc, category, usage, params, prepare(args,{projectRoot}), prompt(args,context) }`（与 `review.js` 同形）

- [ ] **Step 1: 仿照 review.js 新建 refactor.js**

导出形状须与 `review.js` 一致（`prepare` + `prompt`，非 `run`）：

```js
'use strict';
// /refactor <path> — 重构建议（只读，输出建议 diff）
const read_file = require('../../../tools/read_file');
module.exports = {
  name: 'refactor',
  desc: '重构建议（输出可应用改动）',
  category: 'readonly',
  usage: 'refactor <path>',
  params: { path: '相对项目根的文件路径' },
  async prepare(args, { projectRoot }) {
    const p = args.path;
    if (!p || !p.trim()) return { ok: false, error: '缺少文件路径，用法：refactor <path>' };
    let content;
    try { content = await read_file.run({ path: p }, { root: projectRoot }); }
    catch (e) { return { ok: false, error: '读取文件失败：' + e.message }; }
    return { ok: true, context: `文件：${p}\n\n\`\`\`\n${content}\n\`\`\`` };
  },
  prompt(args, context) {
    return {
      system: '你是资深重构专家。给出最小化、安全的重构步骤，每条附改动前后片段（用 diff 格式）。不要直接改文件，只给建议。',
      user: `请重构以下代码：\n\n${context}`,
    };
  },
};
```

- [ ] **Step 2: 新建 doc.js（生成函数/模块文档）**

`doc` 命令：对目标文件用 `explain_symbol` 思路生成 Markdown 文档片段，导出形状同上（`name:'doc'`, `category:'readonly'`, `prepare`/`prompt`）。

- [ ] **Step 3: 验证自动注册并加载**

Run: `node -e "const {allCommands}=require('./src/core/quick/registry');console.log(allCommands().map(c=>c.name))"`
Expected: 数组含 `refactor`、`doc`（以及原有 test/review/...）

- [ ] **Step 4: 提交**

```bash
git add src/core/quick/commands/refactor.js src/core/quick/commands/doc.js
git commit -m "feat: 新增 refactor/doc 快捷命令"
```

### Task 11: 模板编写指南

**Files:**
- Create: `docs/templates-guide.md`
- Test: 人工审阅

**Interfaces:**
- 消费：用户写模板时参考
- 产出：文档说明 frontmatter、正文写法、关键词匹配、自定义目录

- [ ] **Step 1: 编写 docs/templates-guide.md**

说明 frontmatter（`name/title/keywords`）、正文即「推荐步骤」、关键词匹配规则（见 `template-loader.js` 的 `matchTemplate`）、内置模板清单、如何放 `data/templates` 自定义。

- [ ] **Step 2: 提交**

```bash
git add docs/templates-guide.md
git commit -m "docs: 新增模板编写指南"
```

---

## Self-Review

**1. 规格覆盖：** 关键信息摘要的 P0（模型/Prompt）→ Task 1-3；P1（Diff 预览）→ Task 4（压缩阈值收敛在 Task 5，复用既有 COMPACT_THRESHOLD，无新依赖）；P2（离线包/健康）→ Task 6-7；战略主线（模板生态）→ Task 8-10；长期 → Task 11。规划渲染与文件树侧栏已具备，明确排除（见「已具备能力」）。军工可行性中的「依赖审查」体现为零依赖约束。覆盖完整，且未引入任何 embedding 模型依赖。

**2. 占位符扫描：** Task 4/9/10 的 UI 与命令步骤给出了真实文件、simpui 类名、调用契约与验证命令，无「TBD/稍后实现」。语义检索保持 token 重叠实现，未引入 embedding 依赖（明确非占位）。

**3. 类型/命名一致性：** `template-loader.allTemplates()` 在 Task 8/9 验证中复用一致；`behaviorRules(hasTemplate)` 在 Task 3 一致；`DiffPreview.show` 在 Task 4 定义并被 render.js 调用一致；快捷命令导出形状与 `review.js`（`prepare`+`prompt`）在 Task 10 一致；`config` 字段名（DEFAULT_MODEL/NUM_CTX/COMPACT_THRESHOLD/OLLAMA_HOST）与 `config.js` 导出一致。

**4. 改动原则核对：** 所有 `Modify` 均为追加/分支式（默认单行改动、`rules.push` 追加、路由链加一行 + 新增 handler、loader 加一个扫描目录），无任何删除既有代码；新功能均为新建文件或新建路由处理函数。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-ollama-agent-roadmap.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
