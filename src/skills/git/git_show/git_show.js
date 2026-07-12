'use strict';

const { execSync } = require('child_process');
const { truncate } = require('../../utils');

function git(args, root) {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }) || '(无输出)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return out;
    return 'git 执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'git_show',
  desc: '查看某次提交或某版本文件内容。ref 可为提交哈希、分支名、标签，或 "哈希:文件路径"',
  params: {
    ref: '必填，提交引用：如 HEAD、abc123、HEAD~1、或 abc123:src/app.js',
  },
  needConfirm: false,

  async run({ ref }, ctx = {}) {
    if (!ref || !ref.trim()) return '错误：ref 不能为空';
    return truncate(git(`show ${ref.trim()}`, ctx.root));
  },
};
