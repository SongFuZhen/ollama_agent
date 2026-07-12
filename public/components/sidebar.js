// sidebar.js - 侧边栏组件
function renderSidebar() {
  return `
  <aside id="file-panel" class="file-panel">
    <div class="panel-head">
      <span class="panel-title">
        <i data-lucide="folder" class="panel-icon"></i> 项目文件
      </span>
      <span class="panel-btns">
        <button id="fs-refresh" class="simpui-btn light sm" aria-label="刷新">
          <i data-lucide="refresh-cw" class="btn-icon"></i> 刷新
        </button>
      </span>
    </div>
    <div id="file-tree" class="file-tree"></div>
    <div class="panel-hint">绑定沙箱目录后，可在此浏览目录内的文件</div>
  </aside>`;
}
