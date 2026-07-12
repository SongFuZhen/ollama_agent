'use strict';

/* theme.js - 主题切换 */

const THEME_KEY = 'local-agent-theme';
const themeSwitch = $('#theme-switch');

// 当前存储的模式：'light' | 'dark'（缺省视为 dark）
function storedTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  const root = document.documentElement;
  const body = document.body;

  if (theme === 'light') {
    // 明亮主题
    root.setAttribute('data-theme', 'light');
    body.classList.remove('dark');
  } else {
    // 暗色主题（默认）
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
applyTheme(storedTheme());

// 监听主题切换
if (themeSwitch) {
  themeSwitch.addEventListener('change', () => {
    const next = themeSwitch.checked ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}
