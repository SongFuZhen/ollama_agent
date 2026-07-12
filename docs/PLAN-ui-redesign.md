# UI 重构方案 - 2026 现代专业风格

## 设计理念

参考 Linear、Vercel、Raycast 等专业工具的设计语言，打造**干净、专业、专注**的界面。

**核心原则：**
- 大量留白，呼吸感
- 中性色系，颜色只用于语义
- 清晰的排版层级（字体大小/粗细）
- 无多余装饰（无渐变、无复杂阴影、无花哨图标）
- 暗色优先，同时支持明暗切换

## 色彩系统

### 暗色主题（默认）
```css
--bg: #09090b;           /* zinc-950 */
--surface: #18181b;       /* zinc-900 */
--surface-2: #27272a;     /* zinc-800 */
--border: #3f3f46;        /* zinc-700 */
--text: #fafafa;          /* zinc-50 */
--text-secondary: #a1a1aa; /* zinc-400 */
--text-muted: #71717a;    /* zinc-500 */
--accent: #3b82f6;        /* blue-500 */
--success: #22c55e;       /* green-500 */
--warning: #f59e0b;       /* amber-500 */
--error: #ef4444;         /* red-500 */
```

### 明亮主题
```css
--bg: #fafafa;
--surface: #ffffff;
--surface-2: #f4f4f5;
--border: #e4e4e7;
--text: #18181b;
--text-secondary: #52525b;
--text-muted: #a1a1aa;
```

## 组件化设计

### 新建组件目录 `public/frontend/css/components/`

| 组件 | 说明 |
|------|------|
| `button.css` | 按钮（primary/secondary/ghost/danger） |
| `input.css` | 输入框、文本域 |
| `dialog.css` | 弹窗（替代现有 modal） |
| `select.css` | 下拉选择器 |
| `dropdown.css` | 下拉菜单 |
| `badge.css` | 徽章/标签 |
| `toast.css` | 提示消息 |

## 页面结构

```
┌─────────────────────────────────────────────────────────┐
│  Logo   Ason Agent        [状态栏]           [用户] [⚙] │  <- 顶栏 56px
├──────────┬──────────────────────────────────────────────┤
│          │  [对话名称]              [历史] [+ 新对话]    │  <- 会话栏 48px
│  项目文件 │──────────────────────────────────────────────│
│  ────── │                                              │
│  📁 src  │              对话区域                         │
│  📄 App  │              (聊天消息)                       │
│  📄 ...  │                                              │
│          │──────────────────────────────────────────────│
│          │  [📎] [输入问题...]                    [发送] │
│          │  模型 · 目录 · 分支 · 耗时 · 工具 · 消息      │  <- 保持原样
└──────────┴──────────────────────────────────────────────┘
```

## 具体改动

### 1. 顶栏（topbar.css）
- 高度 56px，背景与主背景一致，底部 1px 边框
- Logo 简化，去掉渐变，使用纯色
- 状态栏改为圆角胶囊样式
- 用户下拉菜单简化

### 2. 侧边栏（layout.css）
- 背景与主背景一致，右侧 1px 边框
- 文件树去掉左侧边框高亮，改用背景色 hover
- 图标统一使用 Lucide，大小 16px

### 3. 对话区域（chat.css）
- 消息气泡去掉背景色，使用纯文本 + 边框区分
- Agent 消息左侧 2px accent 色竖线
- 用户消息右对齐，浅色背景
- 思考块/工具块简化样式

### 4. 输入区域（input.css）
- 输入框圆角 12px，1px 边框
- focus 状态：边框变 accent 色 + 3px 外发光
- 发送按钮：圆形，accent 色背景
- 去掉所有阴影效果

### 5. 空状态（chat.css）
- 居中显示
- 标题：24px，font-weight 600
- 描述：14px，secondary 色
- 输入框：简洁样式，自动填入默认路径
- 去掉所有装饰性元素

### 6. 弹窗（modal.css → dialog.css）
- 背景半透明黑色遮罩
- 弹窗圆角 16px，无阴影
- 标题 18px，内容区 14px
- 按钮：primary（accent 色）/ secondary（灰色）

## 组件规范

### Button
```css
.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
}
.btn-primary { background: var(--accent); color: white; }
.btn-secondary { background: var(--surface-2); color: var(--text); }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn-danger { background: var(--error); color: white; }
```

### Input
```css
.input {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  outline: none;
}
```

### Dialog
```css
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
.dialog {
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid var(--border);
  max-width: 480px;
  width: 90vw;
}
```

## 实施步骤

1. 创建组件 CSS 文件（button, input, dialog, select, dropdown, badge）
2. 更新 base.css 变量
3. 重写 topbar.css
4. 重写 layout.css
5. 重写 chat.css
6. 重写 input.css
7. 重写 modal.css → dialog.css
8. 更新 index.html 结构
9. 测试明暗主题切换

## 验证清单

- [ ] 暗色主题显示正常
- [ ] 明亮主题显示正常
- [ ] 主题切换无闪烁
- [ ] 所有组件样式统一
- [ ] 响应式布局正常
- [ ] 对比度符合 WCAG AA 标准
