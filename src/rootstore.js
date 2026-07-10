'use strict';

// 项目根目录持久化 + 校验
// 设置页填写的「项目目录（绝对路径）」持久化到服务端本地文件，
// 并在每次使用前用 realpath 校验：必须是真实存在的目录，且不得越界（目前仅做存在性 + 目录校验）。
// 校验失败则回退默认沙箱 PROJECT_ROOT，避免 Agent 工具/文件浏览访问非法路径。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT } = require('./config');

const STORE_FILE = path.resolve(__dirname, '..', 'data', 'project-root.json');

let _cached = null; // 进程内缓存：{ root, valid }

async function readStore() {
  try {
    const raw = await fsp.readFile(STORE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj.root === 'string' ? obj.root : '';
  } catch (e) {
    return ''; // 文件不存在或解析失败 => 用默认
  }
}

// 校验 root：必须能 realpath 且为目录。返回绝对规范化路径或 null（无效）
async function validateRoot(root) {
  if (!root || !root.trim()) return null;
  try {
    const real = await fsp.realpath(path.resolve(root.trim()));
    const stat = await fsp.stat(real);
    if (!stat.isDirectory()) return null;
    return real;
  } catch (e) {
    return null;
  }
}

// 取生效的根目录：优先持久化的有效 root，否则默认沙箱
async function getProjectRoot() {
  if (_cached && _cached.valid) return _cached.root;
  const stored = await readStore();
  if (stored) {
    const valid = await validateRoot(stored);
    if (valid) {
      _cached = { root: valid, valid: true };
      return valid;
    }
  }
  _cached = { root: PROJECT_ROOT, valid: false };
  return PROJECT_ROOT;
}

// 保存并校验 root；返回 { ok, root, error }
async function saveProjectRoot(root) {
  const valid = await validateRoot(root || '');
  if (!valid) {
    // 无效：清空持久化，回退默认
    _cached = { root: PROJECT_ROOT, valid: false };
    try { await fsp.mkdir(path.dirname(STORE_FILE), { recursive: true }); await fsp.writeFile(STORE_FILE, JSON.stringify({ root: '' })); } catch (e) {}
    return { ok: false, root: PROJECT_ROOT, error: '目录不存在或不是文件夹，已回退默认沙箱' };
  }
  try {
    await fsp.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fsp.writeFile(STORE_FILE, JSON.stringify({ root: valid }));
  } catch (e) {
    return { ok: false, root: PROJECT_ROOT, error: '保存失败: ' + e.message };
  }
  _cached = { root: valid, valid: true };
  return { ok: true, root: valid, error: '' };
}

// 判断某 root 是否为「持久化且校验有效」
async function isRootPersisted(root) {
  if (_cached && _cached.valid && _cached.root === root) return true;
  const stored = await readStore();
  if (stored && stored === root) {
    const valid = await validateRoot(root);
    if (valid) return true;
  }
  return false;
}

module.exports = { getProjectRoot, saveProjectRoot, validateRoot, isRootPersisted };
