# 斜杠命令系统实现计划

## 概述
在对话输入框中实现 `/` 斜杠命令系统，参考 Claude Code CLI / OpenCode CLI 设计。用户输入 `/` 后弹出命令菜单，支持四个核心命令：`/models`（模型选择）、`/skills`（技能选择）、`/tools`（工具选择）、`/compress`（压缩对话历史）。

## 架构决策
- **保持现有架构**：继续使用 `agent.js` 作为 Agent 循环，无需新增 Agent Runner
- **斜杠命令**：输入 `/` 触发命令菜单弹窗，支持模糊搜索
- **四个命令**：`/models`（模型切换）、`/skills`（技能查看）、`/tools`（工具查看）、`/compress`（压缩对话）
- **上下文管理**：本地模型 context 仅 8k，需要压缩机制防止 context 溢出
- **前端渲染**：命令菜单 + 弹窗选择，类似 CLI 交互体验
- **状态持久化**：选中的模型保存在会话记录中（conversations.current_model），加载会话时自动恢复
- **完整持久化**：所有对话内容（工具调用、输入输出、压缩结果）保存到数据库

---

---

## T1：后端模型列表 API
**文件**：`src/server.js`（修改）
**依赖**：无

1. 在 `server.js` 中添加路由：
   - `GET /api/models` —— 调用 `ollama.listModels()` 返回可用模型列表
2. 返回格式：`{ models: [{ name, size, modified_at }] }`

**验收**：curl 测试——GET /api/models 返回模型列表

---

## T2：前端斜杠命令状态管理
**文件**：`public/frontend/js/modules/state.js`（修改）
**依赖**：T1

1. 在 `state.js` 中添加：
   - `models: []` —— 可用模型列表
   - `currentModel: null` —— 当前选中的模型名称
   - `slashCommandMenu: { visible: false, items: [], filter: '' }` —— 命令菜单状态
   - `commandPalette: { visible: false, type: null, items: [] }` —— 命令弹窗状态
2. 添加操作：
   - `loadModels()` —— 从 `/api/models` 获取，更新状态
   - `selectModel(modelName)` —— 设置 currentModel，同时调用 API 更新会话的 current_model 字段
   - `showSlashMenu()` —— 显示命令菜单
   - `hideSlashMenu()` —— 隐藏命令菜单
   - `showCommandPalette(type)` —— 显示命令弹窗（models/skills/tools）
   - `hideCommandPalette()` —— 隐藏命令弹窗
3. 初始化时自动加载模型列表
4. 加载会话时，从会话数据中恢复 currentModel（conversations.current_model 字段）

**验收**：控制台日志——`state.slashCommandMenu` 和 `state.commandPalette` 状态正确

---

## T3：斜杠命令菜单逻辑
**文件**：`public/frontend/js/modules/render.js`（修改）
**依赖**：T2

1. 添加渲染函数 `renderSlashMenu(container)`：
   - 从预定义命令列表渲染：`/models`、`/skills`、`/tools`、`/compress`
   - 每项显示命令名 + 简短描述（如截图样式）
   - 点击命令 → 调用对应方法（`showCommandPalette('models')` 等），关闭菜单
2. 在输入框添加事件监听：
   - 检测输入内容是否以 `/` 开头
   - 若以 `/` 开头且前面是空行或行首 → 显示菜单
   - 否则 → 关闭菜单
   - 点击菜单外部 → 关闭菜单

**验收**：功能——输入 `/` 弹出菜单，点击命令打开对应弹窗，点击外部关闭菜单

---

## T4：命令弹窗 UI（模型/技能/工具选择）
**文件**：`public/frontend/js/modules/render.js`（修改）
**依赖**：T3

1. 使用 `simpui-dialog` 组件创建命令弹窗：
   - 使用 `.simpui-dialog-backdrop` 作为遮罩
   - 使用 `.simpui-dialog-panel` 作为弹窗容器
   - 使用 `.simpui-dialog-header` + `.simpui-dialog-title` 作为标题栏
   - 使用 `.simpui-dialog-body` 作为内容区
   - 使用 `.simpui-dialog-actions` 作为底部按钮区
2. 添加渲染函数 `renderCommandPalette(container, type)`：
   - `type: 'models'` → 显示模型列表，点击切换模型
   - `type: 'skills'` → 显示技能列表（从后端获取）
   - `type: 'tools'` → 显示工具列表（从后端获取）
3. 为每个类型添加数据获取：
   - 模型：`GET /api/models`
   - 技能：`GET /api/skills`（需后端添加）
   - 工具：`GET /api/tools`（需后端添加）

**验收**：视觉——三种弹窗均可正确显示，点击选择后关闭

---

## T5：后端技能和工具列表 API
**文件**：`src/server.js`（修改）
**依赖**：无

1. 在 `server.js` 中添加路由：
   - `GET /api/skills` —— 返回技能列表（从 `src/skills/index.js` 获取）
   - `GET /api/tools` —— 返回工具列表（从 `src/tools/index.js` 获取）
2. 返回格式：
   - 技能：`{ skills: [{ id, name, description, category }] }`
   - 工具：`{ tools: [{ id, name, description, parameters }] }`

**验收**：curl 测试——GET /api/skills 和 GET /api/tools 返回正确数据

---

## T6：对话使用选中模型
**文件**：`public/frontend/js/modules/api.js`（修改）、`src/server.js`（修改）
**依赖**：T2、T4

1. 修改 `api.js` 的 `sendMessage()`：
   - 在请求体中包含 `model: state.currentModel`
2. 修改 `server.js` 的 `/api/chat` 路由：
   - 接受可选的 `model` 字段
   - 若提供 `model`，使用该模型；否则使用默认模型
3. 切换模型时，调用 API 更新会话的 `current_model` 字段（通过 `updateConversationModel()`）
4. 加载历史会话时，从会话数据恢复 `state.currentModel`（在 T9.5 中实现）

**验收**：
1. 发送消息 → 使用选中的模型响应
2. 切换会话 → 模型自动恢复为该会话上次使用的模型

---

## T7：错误处理
**文件**：`public/frontend/js/modules/api.js`（修改）
**依赖**：T6

1. 前端：加载模型列表失败 → 显示 toast，使用默认模型
2. 前端：选中的模型不可用 → 自动切换到第一个可用模型
3. 后端：模型不存在 → 返回错误事件并建议切换模型

**验收**：用不存在的模型请求 → 优雅回退，不崩溃

---

## T8：对话历史压缩（/compress）
**文件**：`src/core/agent.js`（修改）、`public/frontend/js/modules/state.js`（修改）、`src/server.js`（修改）
**依赖**：T6

### 8.1 后端压缩 API
1. 在 `server.js` 中添加路由：
   - `POST /api/compress` —— 压缩当前对话历史
2. 压缩策略（按优先级）：
   - **保留最近 N 轮**：保留最近 3 轮完整对话
   - **摘要旧历史**：将早期对话用 LLM 生成摘要（使用当前选中模型）
   - **工具结果精简**：工具调用结果只保留关键输出，移除冗余信息
   - **消息合并**：连续的同类型消息合并为一条
3. 返回压缩后的对话历史 + 压缩统计（压缩前 token 数、压缩后 token 数）

### 8.2 前端压缩状态
1. 在 `state.js` 中添加：
   - `tokenCount: { used: 0, max: 8192 }` —— 当前 context 使用量估算
   - `compressThreshold: 0.75` —— 触发自动压缩的阈值（75%）
2. 添加操作：
   - `estimateTokens(messages)` —— 估算当前消息的 token 数（粗略：中文 1 字 ≈ 2 token，英文 1 词 ≈ 1.3 token）
   - `compressHistory()` —— 调用压缩 API，更新对话历史
   - `autoCompressCheck()` —— 每次发送消息前检查，超过阈值自动提示压缩

### 8.3 自动压缩触发
1. 在 `api.js` 的 `sendMessage()` 中添加检查：
   - 发送前估算 token 数
   - 超过阈值（75%）→ 弹窗提示："对话历史较长，建议压缩以保持质量"
   - 用户确认 → 调用 `/compress`
   - 用户拒绝 → 继续发送（但可能 context 溢出）
2. 超过 90% → 强制压缩（不提示）

### 8.4 `/compress` 斜杠命令
1. 在命令菜单中添加 `/compress` 选项
2. 执行时：
   - 显示压缩进度提示
   - 调用后端压缩 API
   - 更新前端对话历史
   - 显示压缩结果（"已压缩：X → Y tokens，节省 Z%"）

**验收**：
1. 手动测试：输入 `/compress` → 对话历史被压缩 → 显示统计
2. 自动测试：发送大量消息 → 超过阈值 → 弹窗提示压缩
3. 边界测试：空对话 → `/compress` → 提示"无需压缩"

---

## T9：完整内容持久化
**文件**：`src/storage/db.js`（修改）、`src/core/agent.js`（修改）、`public/frontend/js/modules/api.js`（修改）
**依赖**：T6、T8

### 9.1 数据库 Schema 扩展
在 `db.js` 的 `initDB()` 中添加迁移：

1. **conversations 表新增字段**：
   - `current_model TEXT DEFAULT NULL` —— 当前使用的模型（跟随会话）

2. **messages 表新增字段**：
   - `model TEXT DEFAULT NULL` —— 使用的模型名称
   - `metadata TEXT DEFAULT NULL` —— 扩展元数据（JSON），存储：
     - `tokenCount`：该条消息的 token 估算
     - `compressed`：是否为压缩后的消息
     - `compressStats`：压缩统计（原 token 数、压缩后 token 数、节省比例）
     - `toolCallId`：工具调用 ID（用于关联调用与结果）

3. 更新 `addMessage()` 函数签名：
   ```js
   addMessage(conversationId, role, content, { tools, thinks, images, model, metadata })
   ```

4. 新增 `updateConversationModel(id, model)` —— 更新会话的当前模型

5. 更新 `getMessages()` 和 `getConversations()` 返回完整字段

### 9.2 Agent 持久化工具调用
修改 `src/core/agent.js`：

1. **每轮工具调用保存为独立消息**：
   - `role: 'assistant'` + `tools: [...]`（工具调用请求）
   - `role: 'tool'` + `content: toolResult`（工具执行结果）
   
2. **保存模型信息**：每条 assistant 消息记录使用的模型名

3. **压缩结果保存**：
   - 压缩后保存一条 `role: 'system'` 消息，内容为压缩摘要
   - `metadata.compressed = true`，记录压缩统计

### 9.3 前端完整渲染
修改 `public/frontend/js/modules/render.js`：

1. **工具调用渲染**：从 `msg.tools` 渲染工具名、参数、结果
2. **压缩消息渲染**：压缩摘要以特殊样式显示（灰色、可折叠）
3. **模型标签**：每条 assistant 消息显示使用的模型名

### 9.4 压缩 API 持久化
修改 `POST /api/compress`：

1. 压缩前：保存原始消息的完整备份（可选，用于调试）
2. 压缩后：将压缩摘要作为新消息写入数据库
3. 更新对话的 `updated_at` 时间戳

### 9.5 会话恢复
修改 `public/frontend/js/modules/api.js` 的 `saveConversation()` 和 `loadConversation()`：

1. **保存时**：`saveConversation()` 同时保存 `currentModel` 到会话
2. **加载时**：`loadConversation()` 恢复以下状态到前端：
   - `state.currentModel` ← `conversation.current_model`
   - `state.currentProjectRoot` ← `conversation.project_root`
   - 触发文件浏览器刷新（用恢复的 `project_root` 重新加载文件树）
   - 触发模型下拉框刷新（选中恢复的模型）

**验收**：
1. 发送消息 → 数据库中有 user + assistant + tool 消息
2. 执行工具调用 → 数据库中有工具调用和结果记录
3. 压缩对话 → 数据库中有压缩摘要消息
4. 刷新页面 → 所有内容完整恢复
5. 切换会话 → 模型选择和项目目录自动恢复

---

## 依赖图

```
T1（模型列表API）──→ T2（状态管理）──→ T3（命令菜单UI）──→ T4（命令弹窗UI）──→ T6（对话集成）──→ T8（压缩）──→ T9（持久化）
                           ↑                                     ↑                   ↑
                           └── T5（技能/工具API）──────────────────┘                   │
                                                                                T7（错误处理）
```

**依赖说明**：
- T1、T5：后端API，无依赖，可并行开发
- T2：依赖T1（需要模型列表数据）
- T3：依赖T2（需要状态管理）
- T4：依赖T3（需要菜单UI）
- T6：依赖T4（需要弹窗UI完成）
- T7：依赖T6（针对对话集成的错误处理）
- T8：依赖T6（压缩需要对话集成支持）
- T9：依赖T6、T8（持久化需要对话和压缩功能完成）

## 执行波次

### 第 1 波（后端）—— T1、T5
- T1：模型列表 API
- T5：技能和工具列表 API

### 第 2 波（前端核心）—— T2、T3
- T2：状态管理
- T3：命令菜单 UI

### 第 3 波（前端集成）—— T4
- T4：命令弹窗 UI

### 第 4 波（对话集成）—— T6、T7
- T6：对话集成
- T7：错误处理

### 第 5 波（压缩功能）—— T8
- T8：对话历史压缩（/compress + 自动压缩）

### 第 6 波（持久化）—— T9
- T9：完整内容持久化（schema 扩展 + agent 保存 + 前端渲染）

---

## UI 组件迁移任务（基于代码审查）

### T10：simpui-dialog 组件迁移
**文件**：`public/frontend/css/modules/modal.css`、各弹窗 HTML
**依赖**：无

1. 将所有自定义弹窗改用 `simpui-dialog-*` 样式：
   - 历史对话抽屉 (`#history-drawer`)
   - 删除确认弹窗 (`#delete-confirm`)
   - 设置弹窗 (`#settings-modal`)
   - 会话状态弹框 (`#state-modal`)
   - 命令列表弹窗 (`#cmd-modal`)
2. 使用 `.simpui-dialog-backdrop`、`.simpui-dialog-panel`、`.simpui-dialog-header`、`.simpui-dialog-body`、`.simpui-dialog-actions`

**验收**：所有弹窗使用统一的 simpui 样式

---

### T11：simpui-toast 组件
**文件**：`public/frontend/js/modules/app.js`、`render.js`
**依赖**：无

1. 替换 `alert()` 和 DOM 提示为 simpui-toast
2. 实现 toast 通知组件：
   - 成功、错误、警告、信息四种类型
   - 自动消失（3-5秒）
   - 可手动关闭

**验收**：所有提示使用 toast 组件

---

### T12：simpui-checkbox 组件
**文件**：`public/frontend/js/modules/theme.js`、`index.html`
**依赖**：无

1. 主题切换改用 simpui 复选框组件
2. 替换原生 `<input type="checkbox">` + 自定义 slider

**验收**：主题切换使用 simpui 样式

---

### T13：simpui-badge 组件
**文件**：`public/frontend/js/modules/render.js`、`components.css`
**依赖**：无

1. 工具标签（如"需确认"）改用 simpui-badge
2. 替换自定义 `.cmd-row-tag` 样式

**验收**：工具标签使用 simpui-badge 样式

---

### T14：创建 `public/components/` 目录
**文件**：新建目录及组件文件
**依赖**：无

1. 创建 `public/components/` 目录
2. 封装可复用组件：
   - `topbar.html` - 顶栏组件
   - `session-bar.html` - 会话栏组件
   - `status-bar.html` - 状态栏组件
   - `sidebar.html` - 侧边栏组件
   - `chat-message.html` - 聊天消息组件
   - `modal-settings.html` - 设置弹窗组件

**验收**：组件可通过 `<include>` 或 JS 动态加载复用

---

### T15：系统偏好跟随
**文件**：`public/frontend/js/modules/theme.js`
**依赖**：无

1. 主题自动跟随 `prefers-color-scheme`
2. 监听系统主题变化事件
3. 未手动设置主题时，自动跟随系统

**验收**：切换系统主题，页面自动跟随

---

### T16：/help 命令
**文件**：`public/frontend/js/modules/commands.js`
**依赖**：无

1. 添加 `/help` 斜杠命令
2. 显示所有可用命令列表及说明

**验收**：输入 `/help` 显示命令帮助

---

### T17：/clear 命令
**文件**：`public/frontend/js/modules/commands.js`
**依赖**：无

1. 添加 `/clear` 斜杠命令
2. 清空当前对话内容

**验收**：输入 `/clear` 清空对话

---

## 更新后的依赖图

```
第1波（后端）：T1、T5
第2波（前端核心）：T2、T3
第3波（前端集成）：T4
第4波（对话集成）：T6、T7
第5波（压缩功能）：T8
第6波（持久化）：T9
第7波（UI组件迁移）：T10、T11、T12、T13、T14
第8波（命令扩展）：T15、T16、T17
```

---

## 更新后的执行波次

### 第 1 波（后端）—— T1、T5
- T1：模型列表 API
- T5：技能和工具列表 API

### 第 2 波（前端核心）—— T2、T3
- T2：状态管理
- T3：命令菜单 UI

### 第 3 波（前端集成）—— T4
- T4：命令弹窗 UI

### 第 4 波（对话集成）—— T6、T7
- T6：对话集成
- T7：错误处理

### 第 5 波（压缩功能）—— T8
- T8：对话历史压缩（/compress + 自动压缩）

### 第 6 波（持久化）—— T9
- T9：完整内容持久化（schema 扩展 + agent 保存 + 前端渲染）

### 第 7 波（UI组件迁移）—— T10、T11、T12、T13、T14
- T10：simpui-dialog 组件迁移
- T11：simpui-toast 组件
- T12：simpui-checkbox 组件
- T13：simpui-badge 组件
- T14：创建 `public/components/` 目录

### 第 8 波（命令扩展）—— T15、T16、T17
- T15：系统偏好跟随
- T16：/help 命令
- T17：/clear 命令
