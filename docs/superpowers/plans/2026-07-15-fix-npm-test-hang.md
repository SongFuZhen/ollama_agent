# 执行计划：修复 `npm test` 离线挂起（T3 / Q1）

> 日期：2026-07-15
> 来源：CODE_REVIEW_REPORT §3.2 T3 + 头脑风暴 §五 Q1
> 目标：让 `npm test`（= `node --test test/`）在**离线 / Ollama 未启动**时也能干净退出，不被端到端脚本拖死。
> 风险：低。纯测试组织调整，不触碰业务逻辑。

---

## 一、问题根因

- `package.json`：`"test": "node --test test/"`，会收集 `test/` 下所有 `*.test.js`。
- `test/llm_tools.test.js` 是一个**需要连真实 Ollama** 的端到端脚本：
  - 它不是用 `node:test` 写的，而是裸 IIFE 直接 `runAgent(...)`。
  - 离线时每个用例 `withTimeout` 等到 `TIMEOUT_PER_TEST=120000ms` 才失败，共 17 工具 × 3 轮 = **51 次调用 → 最长约 102 分钟挂起**。
  - 这正是 CODE_REVIEW_REPORT 记录的「`npm test` ⚠️ 挂起」根因。

---

## 二、方案

将在线端到端脚本移出默认收集范围，并保留其可手动运行的能力。

### 步骤 1：新建 `test/e2e/` 目录，迁移脚本
- 创建目录 `test/e2e/`。
- 将 `test/llm_tools.test.js` → `test/e2e/llm_tools.e2e.js`。
  - **改名关键点**：Node 测试运行器默认只收集 `*.test.js` / `*.spec.js` 等，`*.e2e.js` **不在匹配模式内**，因此 `node --test test/` 不会收集它。
  - 同步调整文件内：顶部用法注释 `node test/e2e/llm_tools.e2e.js`（保持准确）。

### 步骤 2：补 `package.json` 脚本
- 新增 `"test:e2e": "node test/e2e/llm_tools.e2e.js"`，让该脚本仍可一键运行（需 Ollama 在线）。
- 保持 `"test": "node --test test/"` 不变，或显式改为 `"node --test test/*.test.js"`（更稳妥，避免任何子目录被误收集）。

### 步骤 3：清理遗留 fixture（T3 已提）
- 确认 `test_llm_output*.txt` 已被之前的审查清理（CODE_REVIEW_REPORT F2）；迁移后脚本自身的 fixture 在 IIFE 内 `writeFile`/`unlink` 自管理，无需额外处理。

### 步骤 4：验证
- 离线环境下运行 `npm test`，确认**快速退出**且纯逻辑单测全绿（不再挂起）。
- 运行 `node --test test/` 确认输出中**不含** `llm_tools` 相关项。
- （可选，需 Ollama 在线）`npm run test:e2e` 验证脚本仍可用。

---

## 三、影响面

| 项 | 变化 |
|----|------|
| `test/llm_tools.test.js` | 删除（迁移到 `test/e2e/llm_tools.e2e.js`） |
| `test/e2e/llm_tools.e2e.js` | 新增（原内容，改名 + 注释微调） |
| `package.json` | 新增 `test:e2e` 脚本；`test` 脚本可显式限定 `*.test.js` |
| 业务逻辑（`src/`） | 无改动 |

---

## 四、不做

- 不重写 `llm_tools` 为 `node:test` 风格（保持手动 e2e 脚本语义，避免引入 Ollama 在线依赖到单测套件）。
- 不改动其他单测文件。

---

## 五、验收标准

- [ ] `npm test` 离线运行 ≤ 数秒退出，退出码 0，无挂起。
- [ ] `node --test test/` 输出不含 `llm_tools`。
- [ ] `npm run test:e2e`（Ollama 在线时）仍可正常跑完。
