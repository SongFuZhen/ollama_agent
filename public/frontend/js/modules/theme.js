'use strict';

/* theme.js - 主题切换（支持系统偏好） */

const THEME_KEY = 'local-agent-theme';
const themeSwitch = $('#theme-switch');

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

  // 同步主题切换开关
  if (themeSwitch) {
    themeSwitch.checked = theme === 'light';
  }
}

// 初始化主题
const stored = storedTheme();
applyTheme(getResolvedTheme(stored));

// 监听主题切换（checkbox 手动切换）
if (themeSwitch) {
  themeSwitch.addEventListener('change', () => {
    const next = themeSwitch.checked ? 'light' : 'dark';
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
