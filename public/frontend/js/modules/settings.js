'use strict';

/* settings.js - 设置管理 */

const SETTINGS_KEY = 'local-agent-settings';
const DEFAULT_OLLAMA_HOST = 'http://192.168.0.101:11434';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// 取某场景的模型名（前端覆盖优先，否则用后端默认）
function modelFor(scenarioKey) {
  const s = loadSettings();
  const map = { coder: s.coder, debug: s.debug, general: s.general, vision: s.vision };
  const v = map[scenarioKey];
  return v && v.trim() ? v.trim() : null; // null => 用后端默认
}

function ollamaHost() {
  const s = loadSettings();
  return s.ollama && s.ollama.trim() ? s.ollama.trim() : DEFAULT_OLLAMA_HOST;
}

function settingsRoot() {
  const s = loadSettings();
  const local = s.root && s.root.trim() ? s.root.trim() : null;
  return local || serverRootCache || null;
}

// Markdown 渲染引擎：'marked' | 'markdownit'（缺省 marked，保留原版）
function mdEngine() {
  const s = loadSettings();
  return s.mdEngine === 'markdownit' ? 'markdownit' : 'marked';
}

function scenarioDefault(key) {
  return state.scenarios[key]?.model || '';
}

// 设置弹窗
const settingsBtn = $('#settings-btn');
const settingsModal = $('#settings-modal');
const settingsClose = $('#settings-close');
const settingsSave = $('#settings-save');

settingsBtn.onclick = () => {
  const s = loadSettings();
  $('#set-ollama').value = s.ollama || DEFAULT_OLLAMA_HOST;
  $('#set-root').value = s.root || serverRootCache || '';
  $('#set-md-engine').value = mdEngine();
  $('#set-coder').value = s.coder || scenarioDefault('coder');
  $('#set-debug').value = s.debug || scenarioDefault('debug');
  $('#set-general').value = s.general || scenarioDefault('general');
  $('#set-vision').value = s.vision || scenarioDefault('vision');
  settingsModal.classList.remove('hidden');
};

settingsClose.onclick = () => settingsModal.classList.add('hidden');

settingsSave.onclick = async () => {
  const rootVal = $('#set-root').value.trim();
  const s = {
    ollama: $('#set-ollama').value,
    root: rootVal,
    mdEngine: $('#set-md-engine').value,
    coder: $('#set-coder').value,
    debug: $('#set-debug').value,
    general: $('#set-general').value,
    vision: $('#set-vision').value,
  };
  saveSettings(s);
  // 模型下拉由 Ollama 已安装列表驱动，不随设置页的模型覆盖变动，这里仅刷新状态栏
  if (typeof renderSessionState === 'function') renderSessionState();
  // 服务端持久化 + 校验项目根目录
  let serverMsg = '';
  try {
    const r = await fetch('/api/root', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: rootVal }) });
    const d = await r.json();
    if (!d.ok) serverMsg = ' · ' + (d.error || '项目目录无效');
  } catch (e) { serverMsg = ' · 服务端保存失败'; }
  $('#settings-msg').textContent = '已保存（浏览器本地）' + serverMsg;
  setTimeout(() => {
    settingsModal.classList.add('hidden');
    $('#settings-msg').textContent = '';
    preflight(); // 地址/模型变更后刷新状态栏（以服务端就绪状态为准）
  }, 600);
};
