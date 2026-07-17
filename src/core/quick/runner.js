'use strict';

// runQuick：Toolbox 单命令执行器。
// 流程：prepare → prompt → chatStream（单轮）→ postProcess → 返回
// 不经过 runAgent，不触发验证器/自愈，保持单轮确定性。
// postProcess 可返回字符串，或 { output, apply }：apply 为写操作载荷（供前端「应用修改」）。

const { chatStream } = require('../ollama');
const { findCommand } = require('./registry');

// 归一化 postProcess 返回值：字符串 → { output, apply:null }
function normalizePost(out) {
  if (typeof out === 'string') return { output: out, apply: null };
  if (out && typeof out === 'object') {
    return {
      output: out.output != null ? out.output : '',
      apply: out.apply || null,
    };
  }
  return { output: '', apply: null };
}

async function runQuick(cmdName, args, opts, emit) {
  const { model, ollamaHost, projectRoot, signal } = opts;
  const cmd = findCommand(cmdName);
  if (!cmd) {
    emit({ type: 'error', msg: `未知命令：${cmdName}` });
    return;
  }

  // 元信息（前端据此渲染标题/模型名）
  emit({ type: 'meta', command: cmdName, model, projectRoot });

  // 1. 预处理（读文件/grep/bash 等，可能失败）
  emit({ type: 'quick_step', step: 'prepare', status: 'running' });
  let prep;
  try {
    prep = await cmd.prepare(args || {}, { projectRoot });
  } catch (e) {
    emit({ type: 'quick_step', step: 'prepare', status: 'error', msg: e.message });
    return;
  }
  if (!prep || !prep.ok) {
    emit({ type: 'quick_step', step: 'prepare', status: 'error', msg: (prep && prep.error) || '预处理失败' });
    return;
  }
  emit({ type: 'quick_step', step: 'prepare', status: 'done' });

  // 2. 生成 prompt
  const { system, user } = cmd.prompt(args || {}, prep.context || '');

  // 3. 单轮流式 chat（token 透传前端，呈现打字机）
  emit({ type: 'quick_step', step: 'model', status: 'running' });
  let raw = '';
  try {
    raw = await chatStream(model, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], {
      signal,
      ollamaHost,
      onToken: (t) => emit({ type: 'quick_token', content: t }),
    });
  } catch (e) {
    if (e.code === 'ABORTED') return;
    emit({ type: 'quick_step', step: 'model', status: 'error', msg: e.message });
    return;
  }
  emit({ type: 'quick_step', step: 'model', status: 'done' });

  // 4. 后处理（可选）：提取代码块 / 构造写操作载荷
  let final = raw;
  let apply = null;
  if (cmd.postProcess) {
    emit({ type: 'quick_step', step: 'postprocess', status: 'running' });
    try {
      const r = await cmd.postProcess(raw, args || {}, { projectRoot });
      const n = normalizePost(r);
      final = n.output;
      apply = n.apply;
    } catch (e) {
      emit({ type: 'quick_step', step: 'postprocess', status: 'error', msg: e.message });
      // 后处理失败仍返回原始输出
    }
    emit({ type: 'quick_step', step: 'postprocess', status: 'done' });
  }

  emit({ type: 'quick_done', output: final, apply: apply || undefined });
}

module.exports = { runQuick, normalizePost };
