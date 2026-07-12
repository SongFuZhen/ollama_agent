'use strict';

const { chat, chatStream } = require('./ollama');
const { TOOLS, specsFor, isAllowed, runTool } = require('../tools/index');
const { MAX_STEPS, JSON_RETRY } = require('../config');

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
    '7. 回答时使用 markdown 格式，包括标题、列表、代码块等。',
  ].join('\n');
}

// 运行 Agent 循环，通过 emit(event) 实时推送过程
// opts: { model, confirm, images }
async function runAgent(userInput, { model, confirm, images, ollamaHost, projectRoot } = {}, emitInput) {
  const emit = emitInput || (() => {});
  const specs = specsFor();
  const hasTools = specs.length > 0;
  const chatOpts = ollamaHost ? { ollamaHost } : {};
  // 沙箱根：用户「选择目录」下发的目录，否则默认 PROJECT_ROOT
  const toolCtx = { root: projectRoot || PROJECT_ROOT };

  // 整体墙钟超时：即使模型在 Agent 循环里反复调工具不收敛，也强制收尾，
  // 避免前端一直 setBusy(true) 卡死、输入框停用。默认 90s，可用 AGENT_TIMEOUT_MS 覆盖。
  const WALL_MS = Number(process.env.AGENT_TIMEOUT_MS) || 90000;
  const deadline = Date.now() + WALL_MS;

  // 构造首条 user 消息：有图片时改用 Ollama 多模态格式（content + images 数组）
  const userMessage = (images && images.length)
    ? { role: 'user', content: userInput, images: images.slice() }
    : { role: 'user', content: userInput };

  const messages = [
    { role: 'system', content: systemPrompt(specs) },
    userMessage,
  ];

  let lastAnswer = '';
  let lastCallKey = '';
  let repeatCount = 0;
  for (let step = 1; step <= MAX_STEPS; step++) {
    if (Date.now() > deadline) {
      emit({ type: 'error', step, msg: `已达整体超时（${WALL_MS / 1000}s），强制收尾` });
      break;
    }
    let raw = '';
    let inThinkBlock = false;
    let thinkBuffer = '';
    let answerBuffer = '';
    let thinkEmitted = false;

    for (let r = 0; r <= JSON_RETRY; r++) {
      try {
        raw = await chatStream(model, messages, {
          ...chatOpts,
          onToken: (token) => {
            // 检测 think 块的开始和结束
            if (!inThinkBlock) {
              // 检查是否进入 think 块
              if (token.includes('<think>')) {
                inThinkBlock = true;
                thinkBuffer = token;
                emit({ type: 'thinking_start', step });
              } else {
                answerBuffer += token;
                emit({ type: 'token', step, content: token });
              }
            } else {
              thinkBuffer += token;
              // 检查是否离开 think 块
              if (token.includes('</think>')) {
                inThinkBlock = false;
                const { think } = stripThink(thinkBuffer);
                if (think) {
                  emit({ type: 'thought', step, think: true, content: think });
                  thinkEmitted = true;
                }
                thinkBuffer = '';
              }
            }
          },
          onStats: (stats) => {
            emit({ type: 'stats', step, ttft: stats.ttft, total: stats.total, promptTokens: stats.promptTokens, completionTokens: stats.completionTokens });
          }
        });

        // 流结束时 think 块仍未闭合（部分模型省略 </think>）：
        // 把已缓冲的思考内容作为思考过程吐出，避免整段被吞掉
        if (inThinkBlock && thinkBuffer) {
          const { think } = stripThink(thinkBuffer);
          if (think) {
            emit({ type: 'thought', step, think: true, content: think });
            thinkEmitted = true;
          }
          inThinkBlock = false;
          thinkBuffer = '';
        }
        break;
      } catch (e) {
        if (r === JSON_RETRY) throw e;
        emit({ type: 'error', step, msg: '模型调用失败，重试: ' + e.message });
      }
    }

    // 组装最终答案：
    // 1) 优先用 think 块之外的内容（answerBuffer）
    // 2) 若 answerBuffer 为空（模型把回答整段放在 think 内，或仅 reasoning_content 有输出），
    //    回退用「去掉 think 块后的 raw」；若整段都在 think 内，则用 think 内容本身作为答案，
    //    保证气泡永不为空，且不残留 <think> 字面标签
    let text = answerBuffer;
    if (!text.trim() && raw) {
      const { think, rest } = stripThink(raw);
      text = rest.trim() || (think && think.trim()) || raw.trim();
    }

    // 无工具的场景（如 vision 纯多模态）直接回答，不解析工具调用
    if (!hasTools) {
      emit({ type: 'answer', content: text.trim() });
      return text.trim();
    }

    // 优先从 rest 解析工具调用；若模型把 JSON 包在 <think> 内，则回退用 raw 解析一次
    let call = parseToolCall(text);
    if (!call || !call.action) {
      const { think } = stripThink(raw);
      if (think) {
        call = parseToolCall(raw);
      }
    }
    if (!call || !call.action) {
      lastAnswer = text.trim();
      emit({ type: 'answer', content: lastAnswer });
      return lastAnswer;
    }

    emit({ type: 'thought', step, content: text.trim() });

    // 白名单校验：未知工具直接拒绝
    if (!isAllowed(call.action)) {
      emit({ type: 'error', step, msg: '工具不存在，已拒绝: ' + call.action });
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `工具 ${call.action} 不可用，请改用可用工具或回答。` });
      continue;
    }

    const tool = TOOLS[call.action];

    // 重复调用检测：同一工具连续出现时，模型多半陷入循环（如反复 tree 逐级下钻）。
    // 第 2 次重复即提示收尾，第 3 次强制用已有结果回答，避免无谓的多轮工具调用。
    // 探索类工具（tree/list_dir）即使换了 depth/path 参数也属于重复下钻，按 action 维度计。
    const REPEAT_PRONE = new Set(['tree', 'list_dir']);
    const callKey = REPEAT_PRONE.has(call.action)
      ? call.action
      : call.action + ':' + JSON.stringify(call.params || {});
    if (callKey === lastCallKey) {
      repeatCount += 1;
    } else {
      lastCallKey = callKey;
      repeatCount = 1;
    }
    if (repeatCount >= 3) {
      const final = lastAnswer || `（已连续 ${repeatCount} 次调用 ${call.action}，强制收尾）请基于已获取的数据回答。`;
      emit({ type: 'answer', content: final });
      return final;
    }
    if (repeatCount === 2) {
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `你已连续多次调用 ${call.action}，请停止重复下钻，直接基于已有数据回答，不要再调用该工具。`,
      });
      continue;
    }

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

    emit({ type: 'tool', step, action: call.action, params: call.params, root: toolCtx.root });
    let result;
    try {
      result = await tool.run(call.params, toolCtx);
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

  // 循环结束（达最大步数或整体超时）：若过程中模型曾给出过纯文本回答则回显，否则提示收尾
  if (lastAnswer) {
    emit({ type: 'answer', content: lastAnswer });
    return lastAnswer;
  }
  const reason = Date.now() > deadline ? '超时' : '最大步数 ' + MAX_STEPS;
  emit({ type: 'answer', content: `（已达${reason}，强制收尾）请参考上述工具调用过程，或换用更擅长工具调用的模型。` });
  return lastAnswer || '（强制收尾）';
}

module.exports = { runAgent, systemPrompt };
