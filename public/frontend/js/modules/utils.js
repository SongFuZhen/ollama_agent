'use strict';

/* utils.js - 工具函数 */

// DOM 选择器
const $ = (sel) => document.querySelector(sel);

// 创建元素
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// HTML 转义
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 格式化时间 HH:MM
function formatTime(d) {
  const now = d || new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// 完整时间戳（用于悬浮提示）：YYYY-MM-DD HH:mm
function formatTimeFull(d) {
  const now = d || new Date();
  const p = (n) => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `${date} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

// 取路径最后一段
function lastSeg(p) {
  return p ? p.replace(/[/\\]$/, '').split(/[/\\]/).pop() : '';
}

// 判断是否为绝对路径
function isAbs(p) {
  return !!(p && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)));
}

// 生成对话 ID
function generateConvId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
