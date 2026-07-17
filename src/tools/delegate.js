'use strict';

// delegate：子代理委派工具。
// 主代理在长任务/大任务时调用它，把其中「一步」拆给一个聚焦的、上下文独立的子代理去跑，
// 子代理只返回精简结论字符串，主代理负责汇总。
//
// 为什么对 7B 小模型有效：每个子代理都是一次全新的、上下文极短的 runAgent 调用，
// 不继承主循环的冗长历史，避免小模型在长链里跑偏、重复、爆上下文。
// 实现上复用 runAgent，不新增进程/线程，契合内网单机部署。

// 注意：本模块被 tools/index.js 在加载期 require，而 index 又会被 core/agent 加载，
// 形成循环依赖。若在此处顶层解构 isAllowed / TOOL_NAMES，可能拿到 undefined。
// 故改为在 run() 内部惰性 require，届时循环已完全解析。
const { TOOL_RESULT_MAX } = require('../config');

// 子代理返回结果的最大长度（比常规工具结果更短，主上下文只关心结论）
const SUBAGENT_MAX = Math.floor((TOOL_RESULT_MAX || 6000) / 3);

module.exports = {
  name: 'delegate',
  desc: '委派一个聚焦的子任务给子代理（独立上下文，工具受限）；适合把长任务拆成小而独立的步骤时用，子代理返回精简结论，主代理负责汇总',
  params: {
    task: '给子代理的清晰任务描述（要产出什么、约束是什么）',
    tools: '子代理允许使用的工具名数组，如 ["read_file","grep","glob"]（只读调研）或含 write_file/edit_file/bash（允许改动）。不填则给全部工具',
    mode: '子任务模式：execute（可改动）或 plan（仅调研），默认 execute',
  },
  needConfirm: false,

  async run({ task, tools, mode }, ctx = {}) {
    if (!task || !String(task).trim()) return '错误：delegate 的 task 不能为空';

    // 工具白名单裁剪：仅保留主代理真实存在的工具；非法名剔除（防御小模型幻觉工具名）
    let allowed = null;
    if (Array.isArray(tools) && tools.length) {
      const { isAllowed, TOOL_NAMES } = require('./index');
      allowed = tools.filter((t) => typeof t === 'string' && isAllowed(t));
      if (allowed.length === 0) {
        return '错误：tools 中没有任何合法工具名（可用：' + TOOL_NAMES.join(', ') + '）';
      }
    }

    // 子代理运行环境：复用主代理的 model / ollamaHost / 项目根，保证同源。
    const subModel = ctx.model;
    const subHost = ctx.ollamaHost;
    const subRoot = ctx.root || ctx.projectRoot;
    const subMode = mode === 'plan' ? 'plan' : 'execute';
    // 透传 confirm / askUser：子代理若调用需确认的工具（bash / 写操作）时，
    // 复用主代理的确认通道，避免 runAgent 内 confirm(...) 因 undefined 而抛错。
    const subConfirm = typeof ctx.confirm === 'function' ? ctx.confirm : () => ({ ok: true });
    const subAskUser = typeof ctx.askUser === 'function' ? ctx.askUser : () => '';
    const subSignal = ctx.signal || null;

    // 用静默 emit：子代理过程不向前端流式推送（避免主回答里穿插子代理 token），
    // 只取最终返回值。子代理使用空 history + runAgent 内部全新 messages，天然隔离上下文。
    const silent = () => {};
    let final;
    try {
      // 惰性取 runAgent（避免与 core/agent 的循环依赖在加载期拿到 undefined）
      const { runAgent } = require('../core/agent');
      final = await runAgent(
        String(task),
        {
          model: subModel,
          ollamaHost: subHost,
          projectRoot: subRoot,
          history: [],
          mode: subMode,
          // 限定子代理可用工具：通过 specsFor 过滤后注入 system prompt。
          allowedTools: allowed || undefined,
          confirm: subConfirm,
          askUser: subAskUser,
          signal: subSignal,
        },
        silent
      );
    } catch (e) {
      return '子代理执行失败：' + e.message;
    }

    const text = String(final || '').trim();
    if (!text) return '子代理未返回任何结论。';
    const clipped = text.length > SUBAGENT_MAX ? text.slice(0, SUBAGENT_MAX) + '\n\n[子代理结论过长，已截断...]' : text;
    return '子代理结论：\n' + clipped;
  },
};
