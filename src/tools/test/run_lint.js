'use strict';

const { execSync } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const { truncate } = require('../utils');

// 按项目类型自动探测 lint 命令
async function detectCommand(root) {
  try {
    const files = await fsp.readdir(root);
    if (files.includes('package.json')) {
      const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.lint) return 'npm run lint';
      if (files.includes('eslint.config.js') || files.includes('.eslintrc') || files.includes('.eslintrc.js')) {
        return 'npx eslint .';
      }
    }
    if (files.includes('Cargo.toml')) return 'cargo clippy --all-targets';
    if (files.includes('go.mod')) return 'go vet ./...';
    if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('setup.py')) {
      return 'flake8 .';
    }
  } catch (e) { /* 探测失败回退默认 */ }
  return 'npx eslint .';
}

function run(command, root) {
  try {
    return execSync(command, {
      cwd: root,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }) || '(lint 通过，无告警)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return `退出码: ${e.status}\n${out}`;
    return 'lint 执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'run_lint',
  desc: '按项目类型自动运行 lint（eslint / clippy / go vet / flake8）。也可 command 手动指定',
  params: {
    command: '可选，手动指定 lint 命令，覆盖自动探测',
  },
  needConfirm: true,

  async run({ command }, ctx = {}) {
    const root = ctx.root;
    const cmd = (command && command.trim()) ? command.trim() : await detectCommand(root);
    return truncate(run(cmd, root));
  },
};
