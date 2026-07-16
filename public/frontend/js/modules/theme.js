'use strict';

/* theme.js - 主题切换（支持系统偏好） */

const THEME_KEY = 'local-agent-theme';
const themeToggle = $('#theme-toggle');

// 当前存储的模式：'light' | 'dark' | 'auto'（缺省视为 auto）
function storedTheme() {
  return localStorage.getItem(THEME_KEY) || 'auto';
}

// 获取实际应用的主题
function getResolvedTheme(stored) {
  if (stored === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return stored;
}

function applyTheme(theme) {
  const root = document.documentElement;
  const body = document.body;

  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
    body.classList.remove('dark');
  } else {
    root.removeAttribute('data-theme');
    body.classList.add('dark');
  }

  // 代码高亮主题随明暗切换
  const hlLight = document.getElementById('hljs-theme-light');
  const hlDark = document.getElementById('hljs-theme-dark');
  if (hlLight) hlLight.disabled = theme !== 'light';
  if (hlDark) hlDark.disabled = theme === 'light';

  // 更新按钮图标与文字
  updateThemeButton(theme);
}

// 更新主题按钮：图标 + 当前主题文字（明亮 / 暗黑）
function updateThemeButton(theme) {
  if (!themeToggle) return;
  // 图标：lucide 会把 <i> 替换为 <svg>，故每次重建图标节点
  const iconHolder = themeToggle.querySelector('.theme-icon');
  const iconName = theme === 'light' ? 'sun' : 'moon';
  if (iconHolder) {
    iconHolder.innerHTML = '<i data-lucide="' + iconName + '"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  const label = document.getElementById('theme-label');
  if (label) label.textContent = theme === 'light' ? '明亮' : '暗黑';
  themeToggle.title = theme === 'light' ? '当前：明亮，点击切换为暗黑' : '当前：暗黑，点击切换为明亮';
}

// 初始化主题
const stored = storedTheme();
applyTheme(getResolvedTheme(stored));

// 监听主题切换（按钮点击）
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = getResolvedTheme(storedTheme());
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// 监听系统主题变化（仅 auto 模式下跟随）
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (storedTheme() === 'auto') {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});
