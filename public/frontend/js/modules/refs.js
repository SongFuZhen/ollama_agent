'use strict';

/* =========================================================================
 * refs.js — 共享 DOM 引用与全局点击接线。
 * 必须在其它功能模块之前加载（依赖 utils.js 的 $）。
 * 各模块（chat/sidebar/history/statusbar/composer）在加载时即会引用这些
 * 顶层 const，因此集中在此文件、置于加载顺序最前，避免 TDZ 报错。
 * ========================================================================= */

// ---------- 共享 DOM 引用（被各功能模块直接引用） ----------
const messagesEl = $('#messages');
const chatAreaEl = $('#chat-area');
const inputEl = $('#input');
const charCountEl = $('#char-count');
const INPUT_MAX = 20000;
const sendBtn = $('#send');
const ollamaStatusEl = $('#ollama-status');
const debugIconEl = $('#debug-icon');
const emptyEl = $('#empty');
const convNameEl = $('#conv-name');
const userNameEl = $('#user-name');

// 状态栏元素
const ssModelEl = $('#ss-model');
const ssCharsEl = $('#ss-chars');
const ssDirEl = $('#ss-dir');
const ssGitEl = $('#ss-git');
const ssToolsEl = $('#ss-tools');
const ssSkillsEl = $('#ss-skills');
const ssToolboxEl = $('#ss-toolbox');
const ssMoreEl = $('#ss-more');
const ssContextFill = $('#ss-context-fill');
const ssContextText = $('#ss-context-text');

// 用户下拉菜单
const userDropdown = $('.user-dropdown');

// 状态栏点击：打开工具/技能/模型列表（由 settings/commands 等模块提供）
if (ssToolsEl) {
  ssToolsEl.addEventListener('click', () => {
    if (typeof showTools === 'function') showTools();
  });
}
if (ssSkillsEl) {
  ssSkillsEl.addEventListener('click', () => {
    if (typeof showSkills === 'function') showSkills();
  });
}
if (ssToolboxEl) {
  ssToolboxEl.addEventListener('click', () => {
    if (typeof showToolbox === 'function') showToolbox();
  });
}
if (ssModelEl) {
  ssModelEl.addEventListener('click', () => {
    if (typeof showModels === 'function') showModels();
  });
}

// 下拉菜单切换
if (userDropdown) {
  const userBtn = userDropdown.querySelector('#user-btn');
  if (userBtn) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });
  }
  document.addEventListener('click', () => {
    userDropdown.classList.remove('open');
  });
}
