// topbar.html - 顶栏组件
function renderTopbar() {
  return `
  <header class="topbar">
    <div class="brand">
      <span class="logo">◆</span>
      <h1>Ason Agent</h1>
    </div>
    <div id="status" class="status" role="status" aria-live="polite">
      <span class="status-dot"></span>
      <span class="status-text">启动中…</span>
    </div>
    <div class="user-dropdown">
      <div id="user-info" class="user-info">
        <i data-lucide="user" class="user-icon"></i>
        <span id="user-name">加载中...</span>
        <i data-lucide="chevron-down" class="chevron-icon"></i>
      </div>
      <div class="dropdown-menu">
        <div class="dropdown-item theme-switch-row">
          <span class="theme-label">主题</span>
          <div class="theme-switch-wrap">
            <i data-lucide="moon" class="theme-text-icon"></i>
            <label class="simpui-checkbox">
              <input type="checkbox" id="theme-switch">
              <span class="simpui-box"></span>
            </label>
            <i data-lucide="sun" class="theme-text-icon"></i>
          </div>
        </div>
        <div class="dropdown-sep"></div>
        <button id="settings-btn" class="dropdown-item">
          <i data-lucide="settings" class="item-icon"></i>
          <span>设置</span>
        </button>
        <a href="/device.html" class="dropdown-item">
          <i data-lucide="smartphone" class="item-icon"></i>
          <span>设备信息</span>
        </a>
      </div>
    </div>
  </header>`;
}
