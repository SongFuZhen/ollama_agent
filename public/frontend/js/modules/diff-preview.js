'use strict';

// 编辑结果 diff 预览：用 simpui 对话框并排展示原始/修改，逐行标记。
// 纯展示组件，不依赖任何框架；edit_file / apply_diff 结果渲染时由 render.js 调用。
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

window.DiffPreview = {
  // original: 修改前内容（可选，缺省为空）；modified: 工具返回的新内容；filePath: 文件相对路径
  show(original, modified, filePath) {
    const html = `
      <div class="simpui-dialog-backdrop">
        <div class="simpui-dialog simpui-dialog-lg">
          <div class="simpui-dialog-header">Diff 预览 — ${esc(filePath || '')}</div>
          <div class="diff-grid">
            <pre class="diff-old">${esc(original)}</pre>
            <pre class="diff-new">${esc(modified)}</pre>
          </div>
          <div class="simpui-dialog-footer">
            <button class="simpui-btn simpui-btn-secondary" data-act="close">关闭</button>
          </div>
        </div>
      </div>`;
    const el = document.createElement('div');
    el.innerHTML = html;
    el.querySelector('[data-act="close"]').onclick = () => el.remove();
    document.body.appendChild(el);
  },
};
