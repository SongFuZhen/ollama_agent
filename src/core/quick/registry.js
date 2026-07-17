'use strict';

// Toolbox 命令注册表：每个命令是一个窄管道，单轮 chat + 固定 prompt。
// 与 Agent 循环完全隔离，不经过 runAgent，避免 7B 在多步推理中跑偏。
// 扫描 commands/ 目录下所有 .js 模块，每个导出一个命令定义。

const path = require('path');
const fs = require('fs');

const COMMANDS_DIR = path.resolve(__dirname, 'commands');

let _cache = null;

// 加载所有命令模块（每个文件导出一个命令定义）
function allCommands() {
  if (_cache) return _cache;
  const list = [];
  if (!fs.existsSync(COMMANDS_DIR)) return list;
  for (const f of fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'))) {
    try {
      const mod = require(path.join(COMMANDS_DIR, f));
      if (mod && mod.name) list.push(mod);
    } catch (e) {
      console.error('[quick] 加载命令失败:', f, e.message);
    }
  }
  _cache = list;
  return list;
}

function findCommand(name) {
  return allCommands().find((c) => c.name === name) || null;
}

module.exports = { allCommands, findCommand };
