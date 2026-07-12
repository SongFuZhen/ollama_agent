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
    }) || '(无提交历史)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return out;
    return 'git 执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'git_log',
  desc: '查看提交历史。max 控制条数（默认 20），path 只看某文件的提交',
  params: {
    max: '可选，返回最近多少条提交，默认 20',
    path: '可选，相对仓库根的文件路径，只看该文件的提交历史',
  },
  needConfirm: false,

  async run({ max, path }, ctx = {}) {
    const n = Math.min(parseInt(max, 10) || 20, 100);
    const fmt = '--pretty=format:%h %ad %an %s --date=short';
    const target = path ? `-- ${path}` : '';
    return truncate(git(`log -n ${n} ${fmt} ${target}`, ctx.root));
  },
};
