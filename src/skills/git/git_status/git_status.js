'use strict';

const { execSync } = require('child_process');

function git(args, root) {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    }) || '(无输出)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return out;
    return 'git 执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'git_status',
  desc: '查看仓库工作区状态：哪些文件被修改/新增/删除，以及当前分支',
  params: {},
  needConfirm: false,

  async run(_params, ctx = {}) {
    return git('status --short --branch', ctx.root);
  },
};
