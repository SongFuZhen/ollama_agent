// session-bar.js - 会话栏组件
function renderSessionBar() {
  return `
  <div class="session-bar">
    <div class="sb-left">
      <input id="conv-name" class="conv-name" type="text" placeholder="新对话" maxlength="60" spellcheck="false">
    </div>
    <div class="toolbar-btns">
      <button id="history-btn-toolbar" class="simpui-btn light sm" title="历史对话">
        <i data-lucide="history" style="width:14px;height:14px"></i>
        <span>历史对话</span>
      </button>
      <button id="new-chat" class="simpui-btn primary sm" title="清空当前对话">＋ 新对话</button>
    </div>
  </div>`;
}
