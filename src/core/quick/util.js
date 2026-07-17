'use strict';

// 命令后处理共用：从 markdown 中提取第一个围栏代码块内容。
function extractCodeBlock(text) {
  if (!text) return null;
  const m = text.match(/```(?:[a-zA-Z0-9_-]*)?\n([\s\S]*?)```/);
  if (m) return m[1].replace(/\n$/, '');
  return null;
}

// 提取全部围栏代码块内容（按顺序）
function extractAllCodeBlocks(text) {
  const out = [];
  if (!text) return out;
  const re = /```(?:[a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/\n$/, ''));
  return out;
}

module.exports = { extractCodeBlock, extractAllCodeBlocks };
