# 移除场景（Scenario）设计方案

## 背景

当前系统支持多种场景（coder/debug/general/vision），每个场景有独立的模型和工具白名单。设计过于复杂，用户使用门槛高，需要简化为单一模型配置。

## 修改范围

### 后端

| 文件 | 修改内容 |
|------|----------|
| `src/config.js` | 移除 `SCENARIOS` 对象，添加 `DEFAULT_MODEL` |
| `src/server.js` | 移除场景相关路由、preflight 场景检测、对话存储场景参数 |
| `src/storage/db.js` | 移除 `scenario` 字段及索引，添加迁移逻辑 |
| `src/tools/index.js` | 移除 `SCENARIO_TOOLS`、`allowedFor`，简化 `specsFor` 和 `isAllowed` |
| `src/core/agent.js` | 移除 `scenarioKey` 参数，简化工具白名单校验 |

### 前端

| 文件 | 修改内容 |
|------|----------|
| `public/frontend/js/modules/state.js` | 移除 `scenarios` 和 `activeScenario` 状态 |
| `public/frontend/js/modules/api.js` | 移除场景相关 API 调用，简化 `preflight` 和 `config` 响应处理 |
| `public/frontend/js/app.js` | 移除场景切换逻辑、场景选择器事件 |
| `public/frontend/js/modules/settings.js` | 移除场景模型设置 UI，改为单一模型配置 |
| `public/frontend/js/modules/render.js` | 移除场景相关的模型名称获取逻辑 |
| `public/frontend/js/modules/file-browser.js` | 移除场景相关的对话保存逻辑 |
| `public/frontend/css/style.css` | 移除 `.scenario-select-inline` 等场景相关样式 |

## 前端修改详情

### 1. state.js
- 移除 `scenarios: {}` 和 `activeScenario` 状态
- 保留 `modelOverride` 用于用户手动覆盖模型

### 2. api.js
- `preflight()`: 移除 `d.scenarios` 处理，直接使用 `d.defaultModel`
- `config()`: 移除 `d.scenarios` 处理
- `saveConversation()`: 移除 `scenario` 参数
- `loadConversations()`: 移除 `scenario` 参数

### 3. app.js
- 移除场景选择器事件绑定
- 移除 `state.activeScenario` 引用
- 对话保存/加载改为不依赖场景

### 4. settings.js
- 移除 `modelFor(scenarioKey)` 函数
- 移除场景模型设置 UI（`#set-coder`、`#set-debug` 等）
- 改为单一模型配置输入框

### 5. render.js
- 简化模型名称获取逻辑，直接使用 `state.defaultModel` 或 `modelOverride`

### 6. file-browser.js
- 移除对话保存时的 `scenario` 参数

### 7. style.css
- 移除 `.scenario-select-inline` 相关样式

## 数据库迁移

已有迁移逻辑在 `db.js` 中：
```sql
ALTER TABLE conversations DROP COLUMN scenario
```

## 验证步骤

1. 启动服务 `npm start`
2. 访问页面，确认无场景选择器
3. 发送消息，确认使用默认模型
4. 保存/加载对话，确认正常
5. 检查数据库，确认 `scenario` 字段已移除
