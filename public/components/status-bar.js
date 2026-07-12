// status-bar.js - 状态栏组件
function renderStatusBar() {
  return `
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item status-ready">
        <i data-lucide="circle" class="status-dot"></i>
        <span>就绪</span>
      </span>
      <span class="status-sep">|</span>
      <span class="status-item clickable" id="ss-tools" title="点击查看工具">Tools: 0</span>
      <span class="status-sep">|</span>
      <span class="status-item clickable" id="ss-skills" title="点击查看技能">Skills: 0</span>
      <span class="status-sep">|</span>
      <span class="status-item" id="ss-model">—</span>
      <span class="status-sep">|</span>
      <span class="status-item" id="ss-chars">0 字</span>
    </div>
    <div class="status-right">
      <span class="status-item" id="ss-dir">—</span>
      <span class="status-sep">|</span>
      <span class="status-more" id="ss-more">详情</span>
    </div>
  </div>`;
}
