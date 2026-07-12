// composer.js - 输入区组件
function renderComposer() {
  return `
  <footer class="composer">
    <div class="composer-box">
      <textarea id="input" class="composer-input" placeholder="输入问题，或输入 / 唤起命令"></textarea>
      <div class="composer-fab">
        <button id="img-btn" class="toolbar-btn" title="选择图片" aria-label="选择图片">
          <i data-lucide="paperclip" class="toolbar-icon"></i>
        </button>
        <button id="send" class="send-btn-round simpui-btn primary sm" title="发送">
          <i data-lucide="send" class="send-icon"></i>
        </button>
      </div>
    </div>
    <input id="img-input" type="file" accept="image/*" multiple hidden>
  </footer>`;
}
