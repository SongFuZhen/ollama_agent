# CLAUDE.md

## 项目规则

- `public/lib/simpui/` 目录下的文件是第三方库，**禁止修改**。如需覆盖其样式，在对应页面目录下创建自定义样式文件。
- `public/lib/` 目录下的文件是第三方库，**禁止修改**。
- `src/server.js` 是服务入口，**禁止移动/重命名**；其余模块可归入子目录，但须保持其在 `src/` 顶层并同步更新 `require` 与脚本引用。
- 数据目录固定为项目根 `data/`（`src/` 上两级）；`storage/` 模块须用 `'..', '..', 'data'` 解析，勿写成 `'..', 'data`（会落进 `src/data/`）。

## 前端开发规范

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件/目录 | 小写+短横线，目录用复数 | `my-project.js`、`components/` |
| CSS 类名 | 小写+短横线 | `user-info` |
| CSS ID | 驼峰式 | `userInfo` |
| JS 变量/函数 | 驼峰式 | `userName`、`getData()` |
| JS 常量 | 全大写下划线 | `MAX_COUNT` |
| JS 类名 | 大驼峰 | `UserComponent` |

### 编码规范

**HTML**
- HTML5 doctype，缩进 2 空格，属性用双引号
- 语义化标签，减少 div 嵌套，自定义属性以 `data-` 开头

**CSS**
- 缩进 2 空格，分号结尾，十六进制小写
- 选择器不超过 4 层，避免 `*` 和 `!important`
- 使用 Flex/Grid 布局，0 值省略单位

**JavaScript**
- `let` 定义变量，`const` 定义常量
- 使用 `===`、箭头函数，避免全局变量
- 一个函数只做一件事

### 注释规范
- 解释"为什么"而非"做了什么"
- 文件级：用途、作者、版本
- 函数级：参数、返回值
- 关键行：非直观逻辑

### 提交规范
- 格式：`<type>: <description>`
- 类型：feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert
- 描述首字母小写，祈使句，50 字符内

## 文件组织

### CSS 模块 (`public/frontend/css/modules/`)
- `base.css` - 变量、主题、基础样式
- `topbar.css` - 顶栏
- `layout.css` - 主体布局
- `chat.css` - 对话区、消息气泡
- `input.css` - 输入区
- `modal.css` - 弹窗、抽屉
- `components.css` - 组件样式
- `responsive.css` - 响应式

### JS 模块 (`public/frontend/js/modules/`)
- `app.js` - 主入口
- `state.js` - 状态管理
- `api.js` - API 调用
- `render.js` - 渲染逻辑
- `file-browser.js` - 文件浏览器
- `theme.js` - 主题切换
- `settings.js` - 设置管理
- `utils.js` - 工具函数

### 后端模块 (`src/`)
- `server.js` - 服务入口（HTTP 路由、静态资源）
- `config.js` - 全局配置（项目根、端口、场景模型等）
- `core/` - Agent 引擎
  - `agent.js` - Agent 主循环（工具调用、推理）
  - `ollama.js` - Ollama 调用（含超时）
- `storage/` - 持久化
  - `db.js` - SQLite 对话存储
  - `rootstore.js` - 项目根目录持久化 + 校验
- `device/` - 设备信息
  - `device.js` - 设备详情 / ID
- `tools/` - 动作类工具（读/写/执行）
- `skills/` - 技能（分析 / 查看类：git、代码分析）

### 工具与技能 (`src/tools/`、`src/skills/`)

所有工具/技能路径均相对项目沙箱根（`PROJECT_ROOT`），调用前经 `utils.safeResolve` 做越界校验。标记「需确认」的工具在执行前会弹出二次确认。

**工具（tools）**

| 工具 | 说明 | 参数 | 需确认 |
|------|------|------|--------|
| `read_file` | 读取项目内文件内容 | `path` | - |
| `list_dir` | 列出目录下的文件与子目录（树状） | `path`（默认根） | - |
| `search_files` | 按文件名关键字递归搜索 | `pattern` | - |
| `read_lines` | 读取指定行范围（1 起，省 `end` 读到末尾） | `path`, `start`, `end?` | - |
| `glob` | 按 glob 模式查找文件（`*.js`、`src/**/*.ts`） | `pattern`, `path?` | - |
| `grep` | 搜索文件内容（支持正则） | `pattern`, `path?`, `include?` | - |
| `tree` | 树状列出目录（默认 2 层，排除 node_modules/隐藏目录） | `path?`, `depth?` | - |
| `count_loc` | 递归统计代码行数/文件数（按扩展名，区分空行与注释） | `path?` | - |
| `write_file` | 写入/覆盖文件 | `path`, `content` | ✓ |
| `edit_file` | 查找替换片段（`old_string` 须唯一，否则 `all=true` 全替换） | `path`, `old_string`, `new_string`, `all?` | ✓ |
| `bash` | 执行受限 shell 命令（禁止危险操作） | `command` | ✓ |
| `run_tests` | 按项目类型自动跑测试（npm/cargo/go/pytest/make），或 `command` 手动指定 | `command?` | ✓ |
| `run_lint` | 按项目类型自动跑 lint（eslint/clippy/go vet/flake8），或 `command` 手动指定 | `command?` | ✓ |

**技能（skills）**

| 技能 | 说明 | 参数 |
|------|------|------|
| `git_status` | 查看工作区状态（修改/新增/删除、当前分支） | - |
| `git_diff` | 查看差异（默认未暂存；`staged=true` 看已暂存；`path` 限定文件） | `path?`, `staged?` |
| `git_log` | 查看提交历史（`max` 条数默认 20；`path` 只看某文件） | `max?`, `path?` |
| `git_show` | 查看某次提交或某版本文件（`ref` 可为哈希/分支/标签，或 `哈希:文件路径`） | `ref` |
| `explain_symbol` | 解释符号（函数/类/变量）的定义位置与上下文 | `symbol`, `path?` |
| `find_references` | 查找符号的所有引用位置，评估改动影响 | `symbol`, `path?` |
