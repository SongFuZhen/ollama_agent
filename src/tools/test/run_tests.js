'use strict';

const { execSync } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const { truncate } = require('../utils');

// 按项目类型自动探测测试命令
async function detectCommand(root) {
  try {
    const files = await fsp.readdir(root);
    if (files.includes('package.json')) {
      const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return 'npm test';
    }
    if (files.includes('Cargo.toml')) return 'cargo test';
    if (files.includes('go.mod')) return 'go test ./...';
    if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('setup.py')) {
      return 'pytest';
    }
    if (files.includes('Makefile')) {
      const mk = await fsp.readFile(path.join(root, 'Makefile'), 'utf8');
      if (/^test\s*:/m.test(mk)) return 'make test';
    }
  } catch (e) { /* 探测失败回退默认 */ }
  return 'npm test';
}

function run(command, root) {
  try {
    return execSync(command, {
      cwd: root,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }) || '(测试执行成功，无输出)';
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (out) return `退出码: ${e.status}\n${out}`;
    return '测试执行失败: ' + (e.message || '');
  }
}

module.exports = {
  name: 'run_tests',
  desc: '按项目类型自动运行测试（npm test / cargo test / go test / pytest / make test）。也可 command 手动指定',
  params: {
    command: '可选，手动指定测试命令，覆盖自动探测',
  },
  needConfirm: true,

  async run({ command }, ctx = {}) {
    const root = ctx.root;
    const cmd = (command && command.trim()) ? command.trim() : await detectCommand(root);
    return truncate(run(cmd, root));
  },
};
