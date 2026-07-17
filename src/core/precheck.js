'use strict';

// 工具调用预检查（Pre-flight Check）：在 tool.run 之前做一层轻量确定性校验，
// 把"文件不存在 / 参数类型错"这类本要等工具执行才暴露的错误提前拦截，
// 直接返回引导性提示（不真正执行工具、不消耗一步模型推理去纠错），
// 减少无效工具调用，把 MAX_STEPS 留给真正需要的步骤。
// 保守策略：只拦"确定性错误"，对合法调用一律放行；可用 skip(action) 跳过。

const fs = require('fs');
const { safeResolve } = require('../tools/utils');

// 需要数字类型的参数（7B 常把字符串传给数字参数，导致工具内部 parseInt 失败或行为异常）。
const NUMERIC_PARAMS = {
  read_lines: ['start', 'end'],
  tree: ['depth'],
  repo_map: ['max'],
};

// 必须先存在文件才能执行的工具（读/改类）。文件不存在是确定性错误，直接拦截。
const EXISTENCE_REQUIRED = new Set(['read_file', 'read_lines', 'edit_file']);

// 跳过预检的工具白名单（如对路径做动态拼接的工具），避免误拦。
const SKIP = new Set();

async function precheck(action, params = {}, ctx = {}) {
  if (SKIP.has(action)) return { ok: true };

  // 1) 参数类型校验：数字参数必须是合法数字
  const numericKeys = NUMERIC_PARAMS[action];
  if (numericKeys) {
    for (const k of numericKeys) {
      const v = params[k];
      if (v === undefined || v === null || v === '') continue; // 可选，缺省由工具处理
      const n = Number(v);
      if (!Number.isFinite(n)) {
        return { ok: false, message: `参数 ${k} 应为数字类型，但收到「${String(v)}」。请传数字（如 ${k}: 10），不要加引号。` };
      }
    }
  }

  // 2) 文件存在性预检（仅对读/改类工具）
  if (EXISTENCE_REQUIRED.has(action)) {
    const p = params.path;
    if (typeof p !== 'string' || !p.trim()) {
      return { ok: false, message: `参数 path 不能为空，请传入相对项目根的文件路径（如 src/config.js）。` };
    }
    let abs;
    try {
      abs = await safeResolve(p, ctx.root);
    } catch (e) {
      // 越界/无法解析：直接把安全层的错误信息回给模型，让其换路径
      return { ok: false, message: `路径无法解析：${e.message}` };
    }
    if (!fs.existsSync(abs)) {
      const dir = require('path').dirname(abs);
      const siblings = (() => {
        try { return fs.readdirSync(dir).slice(0, 8); } catch (e) { return []; }
      })();
      const hint = siblings.length
        ? `该目录下存在的文件/目录（前 8 个）：${siblings.join(', ')}`
        : `目录 ${dir} 不存在或无法读取。`;
      return {
        ok: false,
        message: `文件不存在：${p}\n请确认路径拼写，或用 list_dir / glob 查找正确位置。\n${hint}`,
      };
    }
  }

  return { ok: true };
}

module.exports = { precheck, NUMERIC_PARAMS, EXISTENCE_REQUIRED };
