// context-actions.js - 上下文操作组件（清除上下文按钮）
function renderContextActions() {
  return `
  <div class="context-actions" data-context-actions>
    <button
      class="simpui-btn ghost sm context-clear"
      type="button"
      data-action="clear-context"
      title="清除上下文：后续对话不再携带历史记录（本地保留完整记录）"
      aria-label="清除上下文"
    >
      <svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">
        <path d="M3 6h18"></path>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
      <span>清除上下文</span>
    </button>
  </div>`;
}