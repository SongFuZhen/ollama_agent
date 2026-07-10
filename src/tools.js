'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PROJECT_ROOT } = require('./config');

// 路径沙箱：所有工具调用必须落在指定 root 内（含符号链接解析）
// 用 realpath 跟随软链到真实落点，防止 root 内的软链指向外部造成逃逸。
// 目标文件可能尚不存在（如写文件），此时仅对「已存在的父目录」做 realpath 校验。
// 注意：root 自身也需 realpath，否则 macOS 上 /tmp -> /private/tmp 会导致全部误判越界。
// root 默认 PROJECT_ROOT；用户用「选择目录」挑的目录会经请求下发，作为新的沙箱根。
const _rootRealCache = new Map();
async function rootReal(root) {
  if (!_rootRealCache.has(root)) _rootRealCache.set(root, await fsp.realpath(root));
  return _rootRealCache.get(root);
}

// root: 沙箱根目录（绝对路径）。p: 相对或绝对路径。
async function safeResolve(p, root = PROJECT_ROOT) {
  const realRoot = await rootReal(root);
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(realRoot, p);

  let realBase;
  try {
    realBase = await fsp.realpath(path.dirname(abs));
  } catch (e) {
    // 父目录也不存在：退化为字面量校验（写操作的最终父目录将在运行时被 mkdir 创建）
    const rel = path.relative(realRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('路径越界，已阻止：' + p);
    }
    return abs;
  }

  const realTarget = path.join(realBase, path.basename(abs));
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界（含符号链接），已阻止：' + p);
  }
  return realTarget;
}

// 截断长文件，避免 7B 被长上下文淹没
function truncate(text, max = 8000) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[已截断，共 ${text.length} 字符]`;
}

const TOOLS = {
  read_file: {
    desc: '读取项目内文件内容',
    params: { path: '相对项目根的文件路径' },
    needConfirm: false,
    async run({ path: p }, ctx = {}) {
      const abs = await safeResolve(p, ctx.root);
      const content = await fsp.readFile(abs, 'utf8');
      return truncate(content);
    },
  },
  list_dir: {
    desc: '列出目录下的文件和子目录',
    params: { path: '相对项目根的路径，默认根目录' },
    needConfirm: false,
    async run({ path: p }, ctx = {}) {
      const abs = await safeResolve(p || '.', ctx.root);
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? '[DIR] ' : '[FILE] ') + e.name)
        .join('\n');
    },
  },
  search_files: {
    desc: '按文件名模式递归搜索',
    params: { pattern: '文件名包含的关键字' },
    needConfirm: false,
    async run({ pattern }, ctx = {}) {
      const root = ctx.root || PROJECT_ROOT;
      const hits = [];
      async function walk(dir) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          if (e.isDirectory()) await walk(full);
          else if (e.name.includes(pattern)) hits.push(path.relative(root, full));
        }
      }
      await walk(root);
      return hits.length ? hits.join('\n') : '未找到匹配文件';
    },
  },
  write_file: {
    desc: '写入/覆盖项目内文件（需确认）',
    params: { path: '相对项目根的文件路径', content: '要写入的内容' },
    needConfirm: true,
    async run({ path: p, content }, ctx = {}) {
      const abs = await safeResolve(p, ctx.root);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const root = ctx.root || PROJECT_ROOT;
      await fsp.writeFile(abs, content, 'utf8');
      return '已写入：' + path.relative(root, abs);
    },
  },
};

// 工具白名单：V1 场景仅开放只读工具，write_file 不在白名单
const READONLY_TOOLS = ['read_file', 'list_dir', 'search_files'];

// 各场景可用工具集（共享实现，运行时按白名单开放）
// vision 为纯多模态看图，不挂任何文件工具
const SCENARIO_TOOLS = {
  coder: READONLY_TOOLS,
  debug: READONLY_TOOLS,
  general: READONLY_TOOLS,
  vision: [],
};

// 按场景裁剪可用工具集（共享实现，运行时按白名单开放）
function allowedFor(scenarioKey) {
  // V2 可在白名单中加入 write_file（仅专属场景）
  return (SCENARIO_TOOLS[scenarioKey] || []).slice();
}

function specsFor(scenarioKey) {
  return allowedFor(scenarioKey)
    .map((name) => ({ name, desc: TOOLS[name].desc, params: TOOLS[name].params, needConfirm: TOOLS[name].needConfirm }));
}

function isAllowed(scenarioKey, name) {
  return allowedFor(scenarioKey).includes(name);
}

module.exports = { TOOLS, allowedFor, specsFor, isAllowed, safeResolve, PROJECT_ROOT };
