'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./utils');

// 危险命令黑名单
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
];

function isCommandBlocked(cmd) {
  const lower = cmd.toLowerCase().trim();
  return BLOCKED_COMMANDS.some(blocked => lower.includes(blocked));
}

module.exports = {
  name: 'bash',
  desc: '执行 shell 命令（受限，禁止危险操作）',
  params: { command: '要执行的 shell 命令' },
  needConfirm: true,
  
  async run({ command }, ctx = {}) {
    if (!command || !command.trim()) {
      return '错误：命令不能为空';
    }
    
    // 检查危险命令
    if (isCommandBlocked(command)) {
      return '错误：该命令被安全策略阻止';
    }
    
    const cwd = ctx.root || PROJECT_ROOT;
    
    try {
      const output = execSync(command, {
        cwd,
        timeout: 30000, // 30秒超时
        maxBuffer: 1024 * 1024, // 1MB 输出限制
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      return output || '(命令执行成功，无输出)';
    } catch (e) {
      const stdout = e.stdout || '';
      const stderr = e.stderr || '';
      const error = e.message || '';
      
      if (stdout || stderr) {
        return `退出码: ${e.status}\n${stdout}${stderr}`;
      }
      return `命令执行失败: ${error}`;
    }
  },
};
