# Agent UI 重新设计方案

## 设计理念

**Geek Terminal × Military Grade** — 融合终端极简主义与军工级专业感

### 核心特征
- **单字体系统**：JetBrains Mono 全覆盖（参考 OpenCode 的 Berkeley Mono 策略）
- **双模式**：暗色（默认）+ 亮色，一键切换
- **调试感知**：顶部状态栏实时显示系统状态（军工内网需求）
- **本地化**：所有字体、图标、依赖存储在 `/public/lib/` 下

### ⚠️ 重要设计规则

**所有 UI 组件必须基于 `lib/simpui` 库构建，禁止写原生样式！**

simpui 提供的组件：
- **按钮**：`.simpui-btn` (primary/secondary/success/danger/warning/info/dark/light)
- **输入框**：`.simpui-input`, `.simpui-textarea`
- **下拉菜单**：`.simpui-select`, `.dropdown-menu`
- **弹窗**：`.simpui-dialog-*`
- **复选框**：`.simpui-checkbox`
- **徽章**：`.simpui-badge`
- **Toast**：`simpui-toast`

**图标统一从 `lib/lucide` 获取，禁止使用其他图标库！**

### 组件复用规则

**可复用组件保存到 `public/components/` 目录：**
- 封装通用的 HTML + CSS + JS 组件
- 组件命名：`组件名.html`（如 `topbar.html`, `status-bar.html`）
- 页面通过 `<include>` 或 JS 动态加载复用

**组件示例：**
```
public/components/
├── topbar.html          # 顶栏组件
├── session-bar.html     # 会话栏组件
├── status-bar.html      # 状态栏组件
├── sidebar.html         # 侧边栏组件
├── chat-message.html    # 聊天消息组件
└── modal-settings.html  # 设置弹窗组件
```

自定义样式只能覆盖 simpui 变量或添加布局样式，不能重写组件本身。

---

## 色彩系统

### 暗色主题（默认）

```css
:root {
  /* 基础色 */
  --bg-primary: #0a0a0b;        /* 主背景 - 近纯黑 */
  --bg-secondary: #111113;      /* 次背景 - 面板 */
  --bg-tertiary: #1a1a1f;       /* 三级背景 - 卡片 */
  --bg-elevated: #222228;       /* 悬浮层 */
  
  /* 文本色 */
  --text-primary: #e8e8ec;      /* 主文本 - 近白 */
  --text-secondary: #8b8b94;    /* 次文本 - 灰 */
  --text-muted: #5a5a63;        /* 弱化文本 */
  
  /* 品牌色 - 青蓝（默认） */
  --accent: #00b4d8;            /* 主强调 */
  --accent-dim: rgba(0, 180, 216, 0.12);
  --accent-hover: #0096c7;
  
  /* 语义色 */
  --success: #00ff88;
  --warning: #ffb800;
  --error: #ff4444;
  --info: #00b4d8;
  
  /* 边框 */
  --border: #2a2a32;
  --border-hover: #3a3a44;
  
  /* 特殊 */
  --glow: 0 0 20px rgba(0, 180, 216, 0.15);
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
```

### 亮色主题

```css
[data-theme="light"] {
  --bg-primary: #fafafa;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f5f5f7;
  --bg-elevated: #ffffff;
  
  --text-primary: #1a1a1f;
  --text-secondary: #6b6b73;
  --text-muted: #9a9aa3;
  
  --accent: #0096c7;            /* 亮色下用深蓝 */
  --accent-dim: rgba(0, 150, 199, 0.10);
  --accent-hover: #0077b6;
  
  --border: #e5e5ea;
  --border-hover: #d0d0d8;
  
  --glow: none;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
```

### 主题色选项

| 名称 | 颜色 | Hex |
|------|------|-----|
| 青蓝 | 🔵 | `#00b4d8` |
| 翠绿 | 🟢 | `#00c853` |
| 紫罗兰 | 🟣 | `#9c27b0` |
| 玫瑰 | 🔴 | `#e91e63` |
| 琥珀 | 🟠 | `#ff9800` |

切换主题色时，只需修改 `--accent` 相关变量。

---

## 主题切换实现

### 防止闪烁（添加到 `<head>`）

```html
<script>
  (function() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  })();
</script>
```

### CSS 实现

```css
/* 默认亮色主题 */
:root {
  --bg-primary: #fafafa;
  /* ... 其他变量 */
}

/* 暗色主题 */
[data-theme="dark"] {
  --bg-primary: #0a0a0b;
  /* ... 其他变量 */
}

/* 跟随系统（无 data-theme 属性时） */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --bg-primary: #0a0a0b;
    /* ... 其他变量 */
  }
}
```

### JavaScript 切换

```javascript
function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}
```

### simpui 暗色主题覆盖

```css
.dark {
  --simpui-bg: var(--bg-primary);
  --input-bg: var(--bg-secondary);
  --simpui-heading-color: var(--text-primary);
  --simpui-text-dim: var(--text-primary);
  --simpui-text-light: var(--text-secondary);
  --modal-bg: var(--bg-secondary);
  --modal-fg: var(--text-primary);
  --backdrop-bg: rgba(0, 0, 0, 0.6);
  --simpui-placeholder: var(--text-muted);
}
```

---

## 字体系统

```css
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Medium.ttf") format("truetype");
  font-weight: 500;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Bold.ttf") format("truetype");
  font-weight: 700;
  font-display: swap;
}

:root {
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
  
  /* 字号阶梯 */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
  --text-2xl: 24px;
  --text-3xl: 32px;
}
```

---

## 布局结构（最终版）

```
┌─────────────────────────────────────────────────────────┐
│ TOPBAR (48px)                                           │
│ [◆ Ason Agent]     [调试信息]      [🌙][👤]             │
├────────────┬────────────────────────────────────────────┤
│            │  SESSION BAR (40px)                        │
│  SIDEBAR   │  [对话名称____]            [历史][+新对话] │
│  (文件树)  │────────────────────────────────────────────│
│            │                                            │
│            │           CHAT AREA                       │
│            │           (消息列表)                       │
│            │                                            │
│            ├────────────────────────────────────────────┤
│            │  COMPOSER (输入区)                         │
│            │  [输入框...]                    [📎][发送] │
│            ├────────────────────────────────────────────┤
│            │  STATUS BAR (28px)                        │
│            │  [● 就绪] [qwen2.5] [2.1k tok] [/path]   │
└────────────┴────────────────────────────────────────────┘
```

**信息分布：**

| 区域 | 内容 |
|------|------|
| **顶栏** | Logo + 品牌名 + 调试信息 + 主题切换 + 用户菜单（含设置/设备） |
| **会话栏** | 对话名称 + 历史按钮 + 新对话按钮 |
| **状态栏** | 状态 + 模型 + Token + 项目路径（输入区下方） |

### HTML 结构

```html
<!-- 顶栏：品牌 + 调试信息 + 用户 -->
<header class="topbar">
  <div class="brand">
    <div class="logo">◆</div>
    <h1>Ason Agent</h1>
  </div>
  <div class="debug-info" id="debug-info">
    <span class="debug-item">
      <i data-lucide="activity" class="debug-icon"></i>
      <span>Ollama: 已连接</span>
    </span>
  </div>
  <div class="topbar-spacer"></div>
  <div class="topbar-actions">
    <button class="simpui-btn light sm" id="theme-toggle" title="切换主题">
      <i data-lucide="moon"></i>
    </button>
    <div class="user-dropdown">
      <button class="simpui-btn light sm" id="user-btn">
        <i data-lucide="user"></i>
      </button>
      <div class="dropdown-menu">
        <button class="dropdown-item" id="settings-btn">
          <i data-lucide="settings"></i>
          <span>设置</span>
        </button>
        <a class="dropdown-item" href="/device.html">
          <i data-lucide="smartphone"></i>
          <span>设备信息</span>
        </a>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger">
          <i data-lucide="log-out"></i>
          <span>退出</span>
        </button>
      </div>
    </div>
  </div>
</header>

<!-- 主体布局 -->
<div class="layout">
  <!-- 侧边栏 -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">文件</span>
      <button class="simpui-btn light sm" id="refresh-btn">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>
    <div class="file-tree" id="file-tree"></div>
  </aside>

  <!-- 右侧内容区 -->
  <main class="main-content">
    <!-- 会话栏 -->
    <div class="session-bar">
      <input type="text" class="simpui-input" id="conv-name" placeholder="新对话" style="max-width: 300px;">
      <div class="session-actions">
        <button class="simpui-btn light sm" id="history-btn">
          <i data-lucide="history"></i>
          <span>历史</span>
        </button>
        <button class="simpui-btn primary sm" id="new-chat-btn">
          <i data-lucide="plus"></i>
          <span>新对话</span>
        </button>
      </div>
    </div>

    <!-- 聊天区 -->
    <div class="chat-area" id="chat-area">
      <!-- 消息列表 -->
    </div>

    <!-- 输入区 -->
    <div class="composer">
      <div class="composer-box">
        <textarea class="simpui-textarea" placeholder="输入消息..." rows="1"></textarea>
        <div class="composer-actions">
          <button class="simpui-btn light sm">
            <i data-lucide="paperclip"></i>
          </button>
          <button class="simpui-btn primary sm">
            <i data-lucide="send"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <div class="status-left">
        <span class="status-item status-ready">
          <i data-lucide="circle" class="status-dot"></i>
          <span>就绪</span>
        </span>
        <span class="status-sep">|</span>
        <span class="status-item" id="ss-model">qwen2.5-coder</span>
        <span class="status-sep">|</span>
        <span class="status-item" id="ss-chars">1.2k 字</span>
      </div>
      <div class="status-right">
        <span class="status-item" id="ss-dir">/path/to/project</span>
        <span class="status-sep">|</span>
        <span class="status-item" id="ss-tools">Tools: 12</span>
        <span class="status-more" id="ss-more">详情</span>
      </div>
    </div>
  </main>
</div>
```

---

## 组件设计

### 设计原则
- 所有按钮使用 `.simpui-btn` 及其变体
- 所有输入框使用 `.simpui-input`
- 图标使用 Lucide Icons (`<i data-lucide="icon-name">`)
- 自定义样式仅用于布局和覆盖 simpui 变量

### 1. 顶栏 (Topbar)

```html
<header class="topbar">
  <!-- 品牌 -->
  <div class="brand">
    <div class="logo">◆</div>
    <h1>Ason Agent</h1>
  </div>
  
  <!-- 调试信息 -->
  <div class="debug-info">
    <span class="debug-item">
      <i data-lucide="activity" class="debug-icon"></i>
      <span>Ollama: 已连接</span>
    </span>
    <span class="debug-item">v1.0.0</span>
  </div>
  
  <div class="topbar-spacer"></div>
  
  <!-- 操作按钮 -->
  <div class="topbar-actions">
    <button class="simpui-btn light sm" id="theme-toggle" title="切换主题">
      <i data-lucide="moon"></i>
    </button>
    <div class="user-dropdown">
      <button class="simpui-btn light sm" id="user-btn">
        <i data-lucide="user"></i>
      </button>
      <div class="dropdown-menu">
        <button class="dropdown-item" id="settings-btn">
          <i data-lucide="settings"></i>
          <span>设置</span>
        </button>
        <a class="dropdown-item" href="/device.html">
          <i data-lucide="smartphone"></i>
          <span>设备信息</span>
        </a>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger">
          <i data-lucide="log-out"></i>
          <span>退出</span>
        </button>
      </div>
    </div>
  </div>
</header>
```

```css
/* 顶栏布局 */
.topbar {
  height: 48px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
}

/* 品牌 */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand .logo {
  width: 28px;
  height: 28px;
  background: var(--accent);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: var(--bg-primary);
}

.brand h1 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

/* 调试信息 */
.debug-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.debug-icon {
  width: 12px;
  height: 12px;
}

/* 弹性空间 */
.topbar-spacer {
  flex: 1;
}

/* 覆盖 simpui 暗色主题变量 */
.dark {
  --simpui-bg: var(--bg-primary);
  --modal-bg: var(--bg-secondary);
  --modal-fg: var(--text-primary);
}
```

---

### 2. 会话栏 (Session Bar)

```html
<div class="session-bar">
  <input type="text" class="simpui-input" id="conv-name" placeholder="新对话" style="max-width: 300px;">
  <div class="session-actions">
    <button class="simpui-btn light sm" id="history-btn">
      <i data-lucide="history"></i>
      <span>历史</span>
    </button>
    <button class="simpui-btn primary sm" id="new-chat-btn">
      <i data-lucide="plus"></i>
      <span>新对话</span>
    </button>
  </div>
</div>
```

```css
/* 会话栏布局 */
.session-bar {
  height: 40px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.session-actions {
  display: flex;
  gap: 6px;
}
```

---

### 4. 状态栏 (Status Bar)

```html
<div class="status-bar">
  <div class="status-left">
    <span class="status-item status-ready">
      <i data-lucide="circle" class="status-dot"></i>
      <span>就绪</span>
    </span>
    <span class="status-sep">|</span>
    <span class="status-item" id="ss-model">qwen2.5-coder</span>
    <span class="status-sep">|</span>
    <span class="status-item" id="ss-chars">1.2k 字</span>
  </div>
  <div class="status-right">
    <span class="status-item" id="ss-dir">/path/to/project</span>
    <span class="status-sep">|</span>
    <span class="status-item" id="ss-tools">Tools: 12</span>
    <span class="status-more" id="ss-more">详情</span>
  </div>
</div>
```

```css
.status-bar {
  height: 28px;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 11px;
}

.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-item {
  color: var(--text-muted);
}

.status-ready {
  color: var(--success);
}

.status-dot {
  width: 8px;
  height: 8px;
}

.status-sep {
  color: var(--border);
}

.status-more {
  color: var(--text-muted);
  cursor: pointer;
}

.status-more:hover {
  color: var(--text-primary);
}
```

---

### 3. 侧边栏 (Sidebar)

```css
.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.file-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.file-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.file-item.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.file-item .icon {
  width: 14px;
  height: 14px;
}
```

---

### 5. 聊天区域 (Chat Area)

```css
.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 用户消息 */
.message.user {
  flex-direction: row-reverse;
}

.message.user .content {
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: 12px 12px 4px 12px;
  max-width: 70%;
  padding: 12px 16px;
}

/* Agent 消息 */
.message.assistant .content {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: 12px 12px 12px 4px;
  max-width: 85%;
  padding: 16px 20px;
}

/* 消息内容 */
.message .content {
  font-size: 14px;
  line-height: 1.6;
}

.message .content code {
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.message .content pre {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 12px 0;
}

.message .content pre code {
  background: transparent;
  padding: 0;
}

/* 消息元信息 */
.message .meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
```

---

### 6. 输入区 (Composer) - 使用 simpui 组件

```html
<div class="composer">
  <div class="composer-box">
    <textarea class="simpui-textarea" placeholder="输入消息..." rows="1"></textarea>
    <div class="composer-actions">
      <button class="simpui-btn light sm">
        <i data-lucide="paperclip"></i>
      </button>
      <button class="simpui-btn primary sm">
        <i data-lucide="send"></i>
      </button>
    </div>
  </div>
</div>
```

```css
/* 输入区布局 */
.composer {
  padding: 16px 20px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border);
}

.composer-box {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.composer-actions {
  display: flex;
  gap: 8px;
}
```

---

### 7. 弹窗 - 使用 simpui-dialog

```html
<div class="simpui-dialog-backdrop">
  <div class="simpui-dialog-panel">
    <div class="simpui-dialog-header">
      <h3 class="simpui-dialog-title">设置</h3>
      <button class="simpui-dialog-close">×</button>
    </div>
    <div class="simpui-dialog-body">
      <!-- 内容 -->
    </div>
    <div class="simpui-dialog-actions">
      <button class="simpui-btn light">取消</button>
      <button class="simpui-btn primary">保存</button>
    </div>
  </div>
</div>
```

---

### 8. 斜杠命令菜单 - 自定义组件

```html
<div class="slash-menu" id="slash-menu">
  <div class="slash-menu-item" data-command="/models">
    <i data-lucide="cpu" class="slash-menu-icon"></i>
    <div class="slash-menu-text">
      <span class="slash-menu-name">/models</span>
      <span class="slash-menu-desc">切换模型</span>
    </div>
  </div>
  <div class="slash-menu-item" data-command="/skills">
    <i data-lucide="sparkles" class="slash-menu-icon"></i>
    <div class="slash-menu-text">
      <span class="slash-menu-name">/skills</span>
      <span class="slash-menu-desc">查看技能</span>
    </div>
  </div>
  <div class="slash-menu-item" data-command="/tools">
    <i data-lucide="wrench" class="slash-menu-icon"></i>
    <div class="slash-menu-text">
      <span class="slash-menu-name">/tools</span>
      <span class="slash-menu-desc">查看工具</span>
    </div>
  </div>
  <div class="slash-menu-item" data-command="/compress">
    <i data-lucide="minimize-2" class="slash-menu-icon"></i>
    <div class="slash-menu-text">
      <span class="slash-menu-name">/compress</span>
      <span class="slash-menu-desc">压缩对话历史</span>
    </div>
  </div>
</div>
```

```css
.slash-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slash-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease);
}

.slash-menu-item:hover {
  background: var(--bg-tertiary);
}

.slash-menu-icon {
  width: 16px;
  height: 16px;
  color: var(--accent);
}

.slash-menu-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slash-menu-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.slash-menu-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
```

---

## 交互状态

### Hover
- 背景色轻微变化
- 边框色加深
- 无阴影变化

### Focus
- 边框色变为 accent
- 外发光 `box-shadow: 0 0 0 3px var(--accent-dim)`

### Active/Pressed
- 背景色加深 5%
- 无位移

### Disabled
- 透明度 50%
- `pointer-events: none`

---

## 动画

```css
:root {
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}

/* 减少动效模式 */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 响应式

```css
/* 平板 */
@media (max-width: 1024px) {
  .sidebar {
    width: 200px;
  }
}

/* 移动端 */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }
  
  .sidebar.open {
    transform: translateX(0);
  }
  
  .debug-info {
    display: none; /* 移动端隐藏调试信息 */
  }
}
```

---

## 文件依赖清单

所有依赖需下载到 `/public/lib/`：

```
/public/lib/
├── fonts/
│   ├── JetBrainsMono-Regular.ttf
│   ├── JetBrainsMono-Medium.ttf
│   └── JetBrainsMono-Bold.ttf
├── lucide.min.js               # 图标库
├── marked.min.js               # Markdown 渲染
├── purify.min.js               # XSS 防护
├── highlight/
│   ├── highlight.min.js
│   ├── github-dark.min.css
│   └── github.min.css
└── simpui/                     # 已有 UI 库（不修改）
    ├── css/
    │   └── simpui.css
    └── js/
        └── simpui.js
```

---

## 验收标准

1. **视觉**：暗色/亮色主题切换正常，无闪烁
2. **字体**：覆盖 simpui 的 Geist 字体，使用 JetBrains Mono
3. **顶栏**：品牌 + 调试信息 + 主题切换 + 用户菜单，一行显示
4. **会话栏**：对话名称 + 历史按钮 + 新对话按钮
5. **状态栏**：状态 + 模型 + 字数 + 项目路径，输入区下方，使用新变量体系
6. **交互**：所有按钮、输入框有正确的 hover/focus 状态
7. **响应式**：桌面/平板/移动端布局正确
8. **性能**：首屏加载 < 100ms（本地资源）
9. **斜杠命令**：输入 `/` 弹出自定义菜单，点击命令打开对应弹窗
10. **组件复用**：可复用组件保存到 `public/components/` 目录

---

## 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 字体 | JetBrains Mono 覆盖 Geist | 极客感，参考 OpenCode |
| 主色调 | 青蓝 #00b4d8 | 可切换（翠绿/紫罗兰/玫瑰/琥珀） |
| 圆角 | 小圆角 (4-8px) | 参考 OpenCode，保持锐利 |
| 阴影 | 极少使用 | 参考 OpenCode，平面设计为主 |
| 布局 | 三栏（顶栏+会话栏+状态栏） | 信息分布均衡 |
| 主题切换 | data-theme 属性 + localStorage | 支持手动切换和系统偏好 |
| 图标 | Lucide | 轻量、现代、单色风格 |
| 组件 | 基于 simpui | 统一 UI 风格，减少重复代码 |
