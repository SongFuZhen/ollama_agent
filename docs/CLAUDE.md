# CLAUDE.md

## 项目规则

- `public/lib/simpui/` 目录下的文件是第三方库，**禁止修改**。如需覆盖其样式，在对应页面目录下创建自定义样式文件。
- `public/lib/` 目录下的文件是第三方库，**禁止修改**。

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
