'use strict';

const { execSync } = require('child_process');
const { truncate } = require('../utils');

function git(args, root) {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }) || '(无差异)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return out;
    return 'git 执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'git_diff',
  desc: '查看代码差异。默认未暂存改动；staged=true 看已暂存；path 指定只看某文件',
  params: {
    path: '可选，相对仓库根的文件路径，只看该文件差异',
    staged: '可选，true 表示查看已暂存（git add 后）的差异',
  },
  needConfirm: false,

  async run({ path, staged }, ctx = {}) {
    const opt = staged === true || staged === 'true' ? '--cached' : '';
    const target = path ? `-- ${path}` : '';
    return truncate(git(`diff ${opt} ${target}`, ctx.root));
  },
};
