'use strict';

const { chat } = require('./ollama');
const { TOOLS, specsFor, isAllowed } = require('./tools');
const { MAX_STEPS, JSON_RETRY } = require('./config');

// 剥离 deepseek-r1 的 <think:6124c78e>...</think:6124c78e> 推理块，返回 { think, rest }
function stripThink(text) {
  const m = text.match(/[\s\S]*?(<think>[\s\S]*?<\/think>)[\s\S]*/i);
  if (!m) return { think: '', rest: text };
  const think = m[1].replace(/<\/?think>/gi, '').trim();
  const rest = text.replace(m[1], '').trim();
  return { think, rest };
}

// 宽松 JSON 解析：容忍模型输出里的代码块、多余文本
function parseToolCall(text) {
  let m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let candidate = m ? m[1] : text;
  const s = candidate.indexOf('{');
  const e = candidate.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    return JSON.parse(candidate.slice(s, e + 1));
  } catch (err) {
    return null;
  }
}

function systemPrompt(specs) {
  const specStr = specs
    .map((t) => `- ${t.name}(${Object.keys(t.params).join(', ')}) : ${t.desc}`)
    .join('\n');
  if (!specs.length) {
    // 无工具场景（如 vision 纯多模态）：用中性系统提示
    return '你是一个本地多模态助手，请基于用户提供的图片和文字如实回答，不要编造。';
  }
  return [
    '你是一个受约束的本地助手。规则：',
    '1. 不要凭空编造，所有结论必须基于工具返回的真实数据。',
    '2. 需要文件内容时，必须先调用可用工具获取真实数据。',
    '3. 可用工具（只能用以下这些）：',
    specStr,
    '4. 如需读数据，输出 JSON：{"action":"工具名","params":{...}}。',
    '5. 若已掌握足够信息可回答，直接输出最终答案（不要 JSON）。',
    '6. 一次只调用一个工具。',
  ].join('\n');
}

// 运行 Agent 循环，通过 emit(event) 实时推送过程
// opts: { model, scenarioKey, confirm, images }
async function runAgent(userInput, { model, scenarioKey, confirm, images, ollamaHost } = {}, emitInput) {
  const emit = emitInput || (() => {});
  const specs = specsFor(scenarioKey);
  const hasTools = specs.length > 0;
  const chatOpts = ollamaHost ? { ollamaHost } : {};

  // 构造首条 user 消息：有图片时改用 Ollama 多模态格式（content + images 数组）
  const userMessage = (images && images.length)
    ? { role: 'user', content: userInput, images: images.slice() }
    : { role: 'user', content: userInput };

  const messages = [
    { role: 'system', content: systemPrompt(specs) },
    userMessage,
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    let raw = '';
    for (let r = 0; r <= JSON_RETRY; r++) {
      try {
        raw = await chat(model, messages, chatOpts);
        break;
      } catch (e) {
        if (r === JSON_RETRY) throw e;
        emit({ type: 'error', step, msg: '模型调用失败，重试: ' + e.message });
      }
    }

    // R1 推理模型：剥离 think 块，思考内容单独推送（前端默认折叠）
    const { think, rest } = stripThink(raw);
    if (think) emit({ type: 'thought', step, think: true, content: think });
    const text = rest || raw;

    // 无工具的场景（如 vision 纯多模态）直接回答，不解析工具调用
    if (!hasTools) {
      emit({ type: 'answer', content: text.trim() });
      return text.trim();
    }

    // 优先从 rest 解析工具调用；若模型把 JSON 包在 <think:6124c78e> 内，则回退用 raw 解析一次
    let call = parseToolCall(text);
    if ((!call || !call.action) && think) {
      call = parseToolCall(raw);
    }
    if (!call || !call.action) {
      emit({ type: 'answer', content: text.trim() });
      return text.trim();
    }

    emit({ type: 'thought', step, content: text.trim() });

    // 白名单校验：越权工具直接拒绝
    if (!isAllowed(scenarioKey, call.action)) {
      emit({ type: 'error', step, msg: '工具不在本场景白名单，已拒绝: ' + call.action });
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `工具 ${call.action} 不可用，请改用可用工具或回答。` });
      continue;
    }

    const tool = TOOLS[call.action];

    // 写操作：每次单独弹确认（V1 白名单不含写工具，此处为 V2 预留）
    if (tool.needConfirm) {
      const ok = await confirm({ action: call.action, params: call.params });
      if (!ok) {
        emit({ type: 'confirm_result', step, ok: false });
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: '用户拒绝了该写操作，请改用其他方法或说明。' });
        continue;
      }
      emit({ type: 'confirm_result', step, ok: true });
    }

    emit({ type: 'tool', step, action: call.action, params: call.params });
    let result;
    try {
      result = await tool.run(call.params);
    } catch (e) {
      result = '工具执行错误: ' + e.message;
    }
    const resultStr = String(result);
    // 工具结果预览与回灌模型使用同一上限，避免不一致地静默丢信息
    const RESULT_MAX = 6000;
    emit({ type: 'tool_result', step, action: call.action, result: resultStr.slice(0, RESULT_MAX) });

    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: `工具 ${call.action} 返回:\n${resultStr.slice(0, RESULT_MAX)}` });
  }

  emit({ type: 'answer', content: `（已达最大步数 ${MAX_STEPS}，强制收尾）请参考上述过程。` });
  return '（已达最大步数）';
}

module.exports = { runAgent, systemPrompt };
