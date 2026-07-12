'use strict';

/* theme.js - 主题切换 */

const THEME_KEY = 'local-agent-theme';
const themeSwitch = $('#theme-switch');

// 当前存储的模式：'light' | 'dark'（缺省视为 dark）
function storedTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.classList.remove('dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.body.classList.add('dark');
  }
  // markdown 气泡（.mdx / .mdit）明暗随项目主题变量自动切换，无需单独样式表
  // 代码高亮主题随明暗切换
  const hlLight = document.getElementById('hljs-theme-light');
  const hlDark = document.getElementById('hljs-theme-dark');
  if (hlLight) hlLight.disabled = theme !== 'light';
  if (hlDark) hlDark.disabled = theme === 'light';
  if (themeSwitch) {
    themeSwitch.checked = theme === 'light';
  }
}

applyTheme(storedTheme());

if (themeSwitch) {
  themeSwitch.addEventListener('change', () => {
    const next = themeSwitch.checked ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}
