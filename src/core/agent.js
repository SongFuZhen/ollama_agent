'use strict';

const { chat, chatStream, makeAbortError } = require('./ollama');
const { chatStreamWithTools } = require('./ollama-tools');
const { TOOLS, specsFor, isAllowed, runTool } = require('../tools/index');
const { resolveDirectCall, buildSkillParams } = require('./workflow');
const SKILL_TOOLS = specsFor().filter((s) => s.kind === 'skill').map((s) => s.name);
const { buildOllamaTools } = require('../tools/schema');
const { buildRecallPrompt } = require('../memory/recall');
const { addMemory } = require('../storage/db');
const { compactMessages } = require('./compact');
const { MAX_STEPS, JSON_RETRY, NUM_CTX, CTX_RESERVE, TOOL_RESULT_MAX, TRUNCATE_MIN, NATIVE_TOOLS_MODELS, VERIFY_EVERY, SELF_HEAL, MAX_HEAL_STEPS, COMPACT_THRESHOLD, PROJECT_ROOT } = require('../config');

// 规划/执行模式下的工具分类（Plan Mode 仅允许只读工具）
const READONLY = new Set(['read_file', 'list_dir', 'grep', 'glob', 'tree', 'read_lines', 'search_files', 'count_loc']);
const WRITE = new Set(['write_file', 'edit_file', 'bash']);

// 粗略 token 估算：中文约 1.5 字符/token，英文约 4 字符/token，取偏保守 2.5
// 多模态消息（content 为字符串 + images 数组）按文本长度估算，图片不计入
function estimateTokens(msg) {
  const text = typeof msg === 'string' ? msg : (msg && msg.content) || '';
  if (!text) return 0;
  return Math.ceil(String(text).length / 2.5);
}

// 截断消息列表，保证动态预算（非 system 消息）总 token 不超过 NUM_CTX - reserve
// system 消息固定保留且不计入动态预算，避免被后续消息挤掉首条 user 问题
// knownPromptTokens：若已拿到 Ollama 真实 prompt_eval_count，直接用其值做预算（不再逐条粗估累加）
function truncateMessages(messages, reserve = CTX_RESERVE, knownPromptTokens = null) {
  const limit = NUM_CTX - reserve;
  const kept = [];
  let total = 0;
  if (knownPromptTokens != null) total = knownPromptTokens; // 真实数优先
  for (const m of messages) {
    if (m.role === 'system') {
      kept.push(m); // system 永远保留，不计入动态预算
      continue;
    }
    const t = estimateTokens(m);
    if (total + t <= limit) {
      kept.push(m);
      total += t;
    } else if (m.role === 'user' && kept.length > 0) {
      // 当前消息太大：截断 content 并加提示
      const maxChars = Math.floor((limit - total) * 2.5);
      if (maxChars > TRUNCATE_MIN) {
        m.content = m.content.slice(0, maxChars) + '\n\n[输入过长，已截断...]';
        kept.push(m);
      }
      break;
    } else {
      break; // 非 user 的旧消息超限，直接丢弃后续（从旧到新遍历）
    }
  }
  // 兜底：仅当「未拿到真实 token 数」时，若 system 把非 system 消息全挤掉，
  // 至少保留一条截断后的 user，避免模型完全无输入。
  // 若 knownPromptTokens 已知且确已超限，则不再强塞（上下文确实超出预算）。
  const hasNonSystem = kept.some((m) => m.role !== 'system');
  if (knownPromptTokens == null && !hasNonSystem && messages.length > 1) {
    const sys = messages.find((m) => m.role === 'system');
    const user = [...messages].reverse().find((m) => m.role === 'user');
    if (sys && user) {
      const maxUserChars = Math.floor(limit * 2.5);
      const truncated = [
        sys,
        { role: 'user', content: user.content.slice(0, maxUserChars) + '\n\n[输入过长，已截断...]' },
      ];
      return truncated;
    }
  }
  return kept;
}

// 剥离 deepseek-r1 的 <think:6124c78e>...</think:6124c78e> 推理块，返回 { think, rest }
function stripThink(text) {
  const m = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (!m) return { think: '', rest: text };
  const think = m[1].trim();
  const rest = text.replace(m[0], '').trim();
  return { think, rest };
}

// 移除 JSON 中的 JS 风格注释（小模型经常在 JSON 里加注释导致解析失败）
// 关键点：先抽离字符串字面量再做注释剥离，避免误伤字符串内的 //（如 https://...）
function stripJSONComments(json) {
  const strings = [];
  // 抽离 '...'、"..." 和反引号 `...`，用占位符替换，剥离后再还原
  const withPlaceholders = json.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, (m) => {
    strings.push(m);
    return `\u0000${strings.length - 1}\u0000`;
  });
  const stripped = withPlaceholders
    .replace(/\/\*[\s\S]*?\*\//g, '')  // 移除块注释 /* ... */
    .replace(/\/\/[^\n]*/g, '')         // 移除行注释 // ...
    .replace(/,\s*}/g, '}')             // 移除尾部逗号 { "a": 1, }
    .replace(/,\s*]/g, ']');            // 移除尾部逗号 [1, 2, ]
  // 还原字符串字面量
  return stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[Number(i)]);
}

// 宽松 JSON 解析：容忍模型输出里的代码块、多余文本、注释
// 兼容两种格式：{action,params} 和 {name,parameters}（MFDoom/社区模型）
function parseToolCall(text) {
  // 收集所有 ``` 代码块，优先匹配含 action/name 的块，避免模型示例块干扰
  const blocks = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let fm;
  while ((fm = fenceRe.exec(text)) !== null) blocks.push(fm[1]);
  if (blocks.length === 0) blocks.push(text);

  for (const candidate of blocks) {
    const s = candidate.indexOf('{');
    const e = candidate.lastIndexOf('}');
    if (s === -1 || e === -1) continue;
    let json = candidate.slice(s, e + 1);
    json = stripJSONComments(json);
    try {
      const obj = JSON.parse(json);
      if (obj.action) return obj;
      // MFDoom/社区模型格式：{name, parameters} → {action, params}
      if (obj.name) return { action: obj.name, params: obj.parameters || obj.arguments || obj.args || {} };
    } catch (err) {
      // 继续尝试下一个候选块
    }
  }
  return null;
}

function systemPrompt(specs) {
  const specStr = specs
    .map((t) => `- ${t.name}(${Object.keys(t.params).join(', ')}) : ${t.desc}`)
    .join('\n');
  if (!specs.length) return '';
  return [
    '可用工具：',
    specStr,
    '',
    '只有在需要查看文件、搜索代码或执行命令时，才输出JSON调用工具：{"action":"工具名","params":{}}',
    '普通对话、问候、解释、分析等不需要操作文件的场合，直接用markdown回答，不要调用工具。一次只调一个工具。',
    '遇到需要多步、跨文件的大任务时，可调用 delegate 把其中「一步」委派给子代理独立完成（用 tools 参数限定其工具范围），再汇总子代理返回的精简结论；不要试图在主循环里一口气做完所有步骤。',
  ].join('\n');
}

// 检测模型是否支持 Ollama 原生 tools API
function supportsNativeTools(model) {
  return model && NATIVE_TOOLS_MODELS.some((p) => model.includes(p));
}

// 消息格式辅助：原生 tools 路线用 role:"tool"，prompt 路线用 role:"user"
function addStepMessages(messages, useNative, text, nativeToolCalls, feedback) {
  if (useNative && nativeToolCalls) {
    messages.push({ role: 'assistant', content: text, tool_calls: nativeToolCalls });
    messages.push({ role: 'tool', content: feedback });
  } else {
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: feedback });
  }
}

// 原生 tools 模型的 system prompt（不含工具列表，工具通过 tools 字段传递）
function nativeSystemPrompt() {
  return [
    '你是 Ason Agent，一个 AI 编程助手。',
    '需要读取或操作文件时，使用提供的工具函数。',
    '能直接回答时，用 markdown 格式输出答案。一次只调一个工具。',
    '遇到需要多步、跨文件的大任务时，可调用 delegate 把其中一步委派给子代理独立完成，再汇总其结论。',
  ].join('\n');
}

// 延迟工具：返回在 ms 毫秒后 resolve 的 promise；signal 已 abort 时立即 reject（ABORTED），
// 使自愈重试间的等待可被用户取消立即打断，而非干等。
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(makeAbortError());
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      reject(makeAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// 指数退避延迟：第 n 次重试（从 1 起）等待 base * 2^(n-1) ms，封顶 maxMs。
// 用于自愈重试之间，避免弱模型连续硬撞同一报错时瞬间打满 Ollama；
// 同时尊重 signal，取消即中止等待。
async function backoffDelay(attempt, { base = 1000, maxMs = 8000, signal } = {}) {
  const ms = Math.min(base * Math.pow(2, attempt - 1), maxMs);
  await sleep(ms, signal);
}

// 验证器与自愈逻辑在 runAgent 内部以闭包形式定义（需访问 emit/messages/signal 等局部状态）。


// 运行 Agent 循环，通过 emit(event) 实时推送过程
// opts: { model, confirm, images, mode: 'execute'|'plan', conversationId }
async function runAgent(userInput, { model, confirm, askUser, images, ollamaHost, projectRoot, history, mode = 'execute', conversationId, allowedTools, signal } = {}, emitInput) {
  const emit = emitInput || (() => {});
  // 取消错误：signal 中断时由 Ollama 层抛出的 ABORTED 错误，用于区分「用户中止」与真实错误
  const isAbort = (e) => e && e.code === 'ABORTED';
  const isPlan = mode === 'plan';
  // 工具集过滤优先级：allowedTools（委派时主代理显式限定）> plan 只读约束 > 全部
  let specs = specsFor();
  if (Array.isArray(allowedTools) && allowedTools.length) {
    const allowSet = new Set(allowedTools);
    specs = specs.filter((s) => allowSet.has(s.name));
  }
  if (isPlan) {
    // Plan Mode：仅暴露只读工具（与 allowedTools 取交集），避免任何写操作
    specs = specs.filter((s) => READONLY.has(s.name));
  }
  const hasTools = specs.length > 0;
  const useNativeTools = hasTools && supportsNativeTools(model);
  const ollamaTools = useNativeTools ? buildOllamaTools(specs) : null;
  const chatOpts = ollamaHost ? { ollamaHost } : {};
  // 沙箱根：用户「选择目录」下发的目录，否则默认 PROJECT_ROOT
  const toolCtx = { root: projectRoot || PROJECT_ROOT, model, ollamaHost, projectRoot: projectRoot || PROJECT_ROOT, askUser, confirm };

  // 整体墙钟超时：即使模型在 Agent 循环里反复调工具不收敛，也强制收尾，
  // 避免前端一直 setBusy(true) 卡死、输入框停用。默认 90s，可用 AGENT_TIMEOUT_MS 覆盖。
  const WALL_MS = Number(process.env.AGENT_TIMEOUT_MS) || 90000;
  const deadline = Date.now() + WALL_MS;

  // ---------- 验证器 + 自愈闭环（闭包，访问上述局部状态） ----------

  // 跑验证器：真跑 run_tests / run_lint，返回 { failed, merged }。
  // 失败判定以确定性退出码为准（工具约定失败报「退出码: N」），绝不采信模型自述。
  async function runVerifier(step) {
    let tOut = '';
    let lOut = '';
    try {
      tOut = String(await runTool('run_tests', {}, toolCtx) || '');
    } catch (e) {
      tOut = 'run_tests 执行异常: ' + e.message;
    }
    try {
      lOut = String(await runTool('run_lint', {}, toolCtx) || '');
    } catch (e) {
      lOut = 'run_lint 执行异常: ' + e.message;
    }
    const failed = /退出码/.test(tOut) || /退出码/.test(lOut);
    const merged = `【验证结果 ${failed ? '失败' : '通过'}】\n--- run_tests ---\n${tOut.slice(0, TOOL_RESULT_MAX / 2)}\n--- run_lint ---\n${lOut.slice(0, TOOL_RESULT_MAX / 2)}`;
    return { failed, merged };
  }

  // 单轮自愈：让模型基于现有 messages 走一次工具调用回合完成修复。
  // 直接调用 chatStream + 执行工具，复刻主循环单步，而非递归 runAgent（会重置上下文、丢失报错）。
  async function runHealRound() {
    let raw = '';
    try {
      if (signal && signal.aborted) throw makeAbortError();
      raw = await chatStream(model, messages, { signal });
    } catch (e) {
      if (isAbort(e)) throw e;
      emit({ type: 'verify', step: 0, status: 'heal_error', output: '自愈模型调用失败: ' + e.message });
      return;
    }
    const parsed = parseToolCall(raw);
    if (parsed && parsed.action && isAllowed(parsed.action)) {
      const tool = TOOLS[parsed.action];
      try {
        const r = await tool.run(parsed.params || {}, toolCtx);
        addStepMessages(messages, useNativeTools, raw, null,
          useNativeTools ? String(r).slice(0, TOOL_RESULT_MAX) : `工具 ${parsed.action} 返回:\n${String(r).slice(0, TOOL_RESULT_MAX)}`);
      } catch (e) {
        addStepMessages(messages, useNativeTools, raw, null, `工具 ${parsed.action} 执行错误: ${e.message}`);
      }
    }
  }

  // 自愈重试：验证失败后注入「请修复」指令，给模型 MAX_HEAL_STEPS 轮独立修复，
  // 每轮后重新验证；通过即收尾，耗尽则上报最后失败输出交由用户人工处理。
  // 轮次间用指数退避（backoffDelay）避免弱模型连续硬撞同一报错时瞬间打满 Ollama。
  async function selfHeal(fromStep, verdict) {
    emit({ type: 'verify', step: fromStep, status: 'heal_start', attempt: 0, max: MAX_HEAL_STEPS, output: `验证失败，启动自愈：最多重试 ${MAX_HEAL_STEPS} 次` });
    let v = verdict;
    for (let attempt = 1; attempt <= MAX_HEAL_STEPS; attempt++) {
      if (Date.now() > deadline) {
        emit({ type: 'verify', step: fromStep, status: 'heal_exhausted', attempt, max: MAX_HEAL_STEPS, output: '自愈超时，停止重试。最后失败：\n' + v.merged.slice(0, TOOL_RESULT_MAX) });
        return;
      }
      // 指数退避：首轮前稍等，避免与上一轮验证紧挨着瞬间重发
      try {
        await backoffDelay(attempt, { base: 1000, maxMs: 8000, signal });
      } catch (e) {
        if (isAbort(e)) throw e;
      }
      const healPrompt = [
        '你上一步的修改导致验证失败。请根据下方真实报错修复代码，不要改动无关逻辑，修复后我会重新运行验证。',
        '',
        v.merged.slice(0, TOOL_RESULT_MAX),
        '',
        `[自愈第 ${attempt}/${MAX_HEAL_STEPS} 次] 请直接修改代码文件修复上述失败，不要输出计划或空谈。`,
      ].join('\n');
      emit({ type: 'verify', step: fromStep, status: 'heal_attempt', attempt, max: MAX_HEAL_STEPS, output: `第 ${attempt} 次自愈尝试` });
      addStepMessages(messages, useNativeTools, '', null,
        useNativeTools ? healPrompt : `工具 验证 返回:\n${healPrompt}`);
      await runHealRound();
      v = await runVerifier(fromStep);
      emit({ type: 'verify', step: fromStep, status: v.failed ? 'fail' : 'pass', attempt, max: MAX_HEAL_STEPS, output: v.merged.slice(0, TOOL_RESULT_MAX) });
      if (!v.failed) {
        emit({ type: 'verify', step: fromStep, status: 'heal_pass', attempt, max: MAX_HEAL_STEPS, output: `第 ${attempt} 次自愈成功，验证通过` });
        return;
      }
    }
    emit({ type: 'verify', step: fromStep, status: 'heal_exhausted', attempt: MAX_HEAL_STEPS, max: MAX_HEAL_STEPS, output: '自愈重试耗尽，仍未通过。最后失败：\n' + v.merged.slice(0, TOOL_RESULT_MAX) });
  }

  // 直接调用通道：解析 !（bash）/ @（skill）前缀，绕过模型推理直接执行，
  // 把真实结果作为首轮上下文注入，模型据此作答。优先级 ! > @（在 workflow.resolveDirectCall 内定）。
  const directCall = resolveDirectCall(userInput);
  let directResult = null; // 注入用的「工具结果」文本
  let userInstruction = userInput; // 剥离前缀后留给模型的真实用户指令

  if (directCall.type === 'bash') {
    const tool = TOOLS.bash;
    // 沿用 bash 的写操作确认：needConfirm 时先向用户确认
    if (tool.needConfirm) {
      const cr = await confirm({ action: 'bash', params: { command: directCall.command } });
      if (!cr || !cr.ok) {
        emit({ type: 'answer', content: '（已取消执行命令）' });
        return '（已取消执行命令）';
      }
    }
    try {
      directResult = String(await tool.run({ command: directCall.command }, toolCtx));
    } catch (e) {
      directResult = '命令执行错误: ' + e.message;
    }
    emit({ type: 'tool', step: 0, action: 'bash', params: { command: directCall.command }, root: toolCtx.root });
    emit({ type: 'tool_result', step: 0, action: 'bash', result: directResult.slice(0, TOOL_RESULT_MAX) });
    userInstruction = directCall.restMessage || '请基于上面的命令输出回答。';
  } else if (directCall.type === 'skill') {
    if (directCall.unknown) {
      // 未知 skill：回退普通对话并提示可用 skill，不阻断
      emit({ type: 'error', step: 0, msg: `未知技能 @${directCall.skill}，可用技能：${SKILL_TOOLS.join(', ')}` });
    } else {
      const params = buildSkillParams(directCall.skill, directCall.rawArgs);
      try {
        directResult = String(await runTool(directCall.skill, params, toolCtx));
      } catch (e) {
        directResult = '技能执行错误: ' + e.message;
      }
      emit({ type: 'tool', step: 0, action: directCall.skill, params, root: toolCtx.root });
      emit({ type: 'tool_result', step: 0, action: directCall.skill, result: directResult.slice(0, TOOL_RESULT_MAX) });
      userInstruction = directCall.restMessage || '请基于上面的技能输出回答。';
    }
  }

  // 构造首条 user 消息：有图片时改用 Ollama 多模态格式（content + images 数组）
  const userMessage = (images && images.length)
    ? { role: 'user', content: userInstruction, images: images.slice() }
    : { role: 'user', content: userInstruction };

  if (images && images.length) {
    console.log('[image] 收到 ' + images.length + ' 张图片');
    images.forEach((img, i) => {
      const len = typeof img === 'string' ? img.length : 0;
      let head = '';
      try {
        const buf = Buffer.from(img.slice(0, 100), 'base64');
        const hex = buf.slice(0, 8).toString('hex');
        // 常见图片魔术字节: PNG=89504e47, JPEG=ffd8ffe0, GIF=47494638, WebP=52494646
        const types = { '89504e47': 'PNG', 'ffd8ffe0': 'JPEG', 'ffd8ff': 'JPEG', '47494638': 'GIF', '52494646': 'WEBP' };
        const t = Object.entries(types).find(([k]) => hex.startsWith(k));
        head = t ? t[1] : ('未知(' + hex + ')');
      } catch (e) { head = '解析失败'; }
      console.log('[image] 第' + (i + 1) + '张: base64长度=' + len + ' 格式=' + head);
    });
  }

  // 筛选有效历史：只保留 user/assistant 角色且有内容的消息，最多 20 条
  const validHistory = Array.isArray(history)
    ? history.filter(h => h && (h.role === 'user' || h.role === 'assistant') && h.content && h.content.trim())
    : [];
  let lastPromptTokens = 0; // 真实 prompt token（Ollama prompt_eval_count），用于压缩/预算判断
  const directResultMsg = directResult != null
    ? { role: 'user', content: `工具执行结果：\n${directResult.slice(0, TOOL_RESULT_MAX)}` }
    : null;
  let messages = [
    { role: 'system', content: useNativeTools ? nativeSystemPrompt() : systemPrompt(specs) },
    ...validHistory,
    ...(directResultMsg ? [directResultMsg] : []),
    userMessage,
  ];
  messages = truncateMessages(messages, CTX_RESERVE, lastPromptTokens || null);

  // Plan Mode：追加约束"只调研、不改动"，并限制为只读工具（specs 已过滤）
  if (isPlan) {
    const sys = messages.find((m) => m.role === 'system');
    if (sys) {
      sys.content += '\n\n[规划模式] 你当前处于只读规划阶段：只能使用只读调研工具（read_file/list_dir/grep/glob/tree/read_lines/search_files/count_loc），严禁调用任何写操作（write_file/edit_file/bash）。请充分调研后，输出一份清晰、可确认的执行计划（分步骤、说明每步意图与预期结果），不要修改任何文件。';
    }
  }

  // 三级记忆注入（L2/L3）：首轮根据用户输入语义召回历史片段，拼进 system。
  // 异步进行，不阻塞首 token；若 Ollama 不可用则静默跳过。
  if (conversationId && /[\u4e00-\u9fa5a-zA-Z]{4,}/.test(userInput)) {
    buildRecallPrompt(userInput, { ollamaHost })
      .then((recallText) => {
        if (recallText) {
          const sys = messages.find((m) => m.role === 'system');
          if (sys) sys.content += '\n\n' + recallText;
        }
      })
      .catch(() => {});
  }

  let lastAnswer = '';
  let lastCallKey = '';
  let repeatCount = 0;
  for (let step = 1; step <= MAX_STEPS; step++) {
    if (Date.now() > deadline) {
      emit({ type: 'error', step, msg: `已达整体超时（${WALL_MS / 1000}s），强制收尾` });
      break;
    }
    // 上下文压缩：真实 prompt token 越过阈值时，把中间历史压成摘要，
    // 保住早期上下文（而非 truncateMessages 直接硬丢）。
    if (lastPromptTokens > NUM_CTX * COMPACT_THRESHOLD) {
      try {
        messages = await compactMessages(messages, { model, ollamaHost });
        emit({ type: 'compact', step, msg: '上下文已压缩（中间历史摘要化）' });
      } catch (e) { /* 压缩失败不阻断 */ }
    }
    let raw = '';
    let inThinkBlock = false;
    let thinkBuffer = '';
    let answerBuffer = '';
    let thinkEmitted = false;
    let nativeToolCalls = null;
    // 本步实际使用的消息格式：仅当走原生 tool_calls 时为 true，
    // 回退到文本解析时降级为 prompt-based，保证同一步内 assistant/tool 消息格式一致
    let stepUsedNative = useNativeTools;

    for (let r = 0; r <= JSON_RETRY; r++) {
      try {
        const streamOpts = {
          ...chatOpts,
          onToken: (token) => {
            if (!inThinkBlock) {
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
            if (stats.promptTokens) lastPromptTokens = stats.promptTokens; // 真实 token 预算（替代粗估）
            emit({ type: 'stats', step, ttft: stats.ttft, total: stats.total, promptTokens: stats.promptTokens, completionTokens: stats.completionTokens });
          }
        };

        // 取消优先：signal 已 abort 时不再调用模型，直接抛出取消错误退出主循环
        if (signal && signal.aborted) throw makeAbortError();

        if (useNativeTools) {
          const response = await chatStreamWithTools(model, messages, ollamaTools, Object.assign({}, streamOpts, { signal }));
          raw = response.content;
          nativeToolCalls = response.tool_calls;
        } else {
          raw = await chatStream(model, messages, Object.assign({}, streamOpts, { signal }));
        }

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
        if (isAbort(e)) throw e; // 用户中止：不重试，直接上抛退出
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

    // 提取工具调用：原生 tools 路线从 tool_calls 取，失败则回退到文本解析
    let action, params;
    if (useNativeTools) {
      if (nativeToolCalls && nativeToolCalls.length > 0) {
        emit({ type: 'thought', step, content: text.trim() });
        const tc = nativeToolCalls[0];
        action = tc.function.name;
        params = tc.function.arguments;
        if (typeof params === 'string') {
          try { params = JSON.parse(params); } catch (e) { params = {}; }
        }
      } else {
        // 回退：模型可能把工具调用写在 content 文本里
        let call = parseToolCall(text);
        if (!call || !call.action) {
          const { think } = stripThink(raw);
          if (think) call = parseToolCall(raw);
        }
        if (!call || !call.action) {
          lastAnswer = text.trim();
          // Plan Mode：最终回答作为可确认的执行计划返回，不进入 execute
          emit({ type: isPlan ? 'plan' : 'answer', content: lastAnswer });
          return lastAnswer;
        }
        emit({ type: 'thought', step, content: text.trim() });
        action = call.action;
        params = call.params;
        // 回退到文本解析：本步降级为 prompt-based 格式，避免混用 role:'tool' 与无 tool_calls 的 assistant
        nativeToolCalls = null;
        stepUsedNative = false;
      }
    } else {
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
      action = call.action;
      params = call.params;
    }

    // 白名单校验：未知工具直接拒绝
    if (!isAllowed(action)) {
      const msgField = params && (params.message || params.content || params.reply || params.text || params.response);
      if (msgField && typeof msgField === 'string' && msgField.trim()) {
        emit({ type: 'answer', content: msgField.trim() });
        return msgField.trim();
      }
      emit({ type: 'error', step, msg: '工具不存在，已拒绝: ' + action });
      addStepMessages(messages, stepUsedNative, text, nativeToolCalls, `工具 ${action} 不可用，请改用可用工具或回答。`);
      continue;
    }

    const tool = TOOLS[action];

    // 重复调用检测
    const REPEAT_PRONE = new Set(['tree', 'list_dir']);
    const callKey = REPEAT_PRONE.has(action)
      ? action
      : action + ':' + JSON.stringify(params || {});
    if (callKey === lastCallKey) {
      repeatCount += 1;
    } else {
      lastCallKey = callKey;
      repeatCount = 1;
    }
    if (repeatCount >= 3) {
      const final = lastAnswer || `（已连续 ${repeatCount} 次调用 ${action}，强制收尾）请基于已获取的数据回答。`;
      emit({ type: 'answer', content: final });
      return final;
    }
    if (repeatCount === 2) {
      addStepMessages(messages, stepUsedNative, text, nativeToolCalls, `你已连续多次调用 ${action}，请停止重复下钻，直接基于已有数据回答，不要再调用该工具。`);
      continue;
    }

    // 写操作确认（confirm 解析为 {ok, answer}：写工具只看 ok；ask_user 用 answer）
    let confirmResp = null;
    if (tool.needConfirm) {
      confirmResp = await confirm({ action, params });
      const ok = confirmResp && confirmResp.ok;
      if (!ok) {
        emit({ type: 'confirm_result', step, ok: false });
        addStepMessages(messages, stepUsedNative, text, nativeToolCalls, '用户拒绝了该写操作，请改用其他方法或说明。');
        continue;
      }
      emit({ type: 'confirm_result', step, ok: true });
    }

    emit({ type: 'tool', step, action, params, root: toolCtx.root });
    let result;
    if (action === 'ask_user' && confirmResp && confirmResp.answer != null) {
      // ask_user：工具结果即用户回答（而非原样回显问题）
      result = `用户回答：「${String(confirmResp.answer)}」`;
    } else {
      try {
        result = await tool.run(params, toolCtx);
      } catch (e) {
        result = '工具执行错误: ' + e.message;
      }
    }
    const resultStr = String(result);
    emit({ type: 'tool_result', step, action, result: resultStr.slice(0, TOOL_RESULT_MAX) });

    addStepMessages(messages, stepUsedNative, text, nativeToolCalls,
      useNativeTools ? resultStr.slice(0, TOOL_RESULT_MAX) : `工具 ${action} 返回:\n${resultStr.slice(0, TOOL_RESULT_MAX)}`);

    // Verifier（验证器闭环）：执行模式下，每 VERIFY_EVERY 步且刚做了写操作，
    // 自动真跑 run_tests / run_lint，把结果作为反馈喂回主循环，模型据此再修。
    // 失败判定：输出含"退出码"（工具约定失败报"退出码: N"）。
    // 若 SELF_HEAL 开启且验证失败，进入自愈重试：注入「请修复」指令，给模型
    // 独立的 MAX_HEAL_STEPS 步修复，每步后再重新验证，直至通过或重试耗尽。
    // 这是为 7B/8B 弱模型设计的核心闭环——确定性测试当裁判，模型只负责改。
    if (!isPlan && WRITE.has(action) && step % VERIFY_EVERY === 0) {
      const verdict = await runVerifier(step);
      if (verdict.failed && SELF_HEAL && (MAX_STEPS - step) > 0) {
        await selfHeal(step, verdict);
      }
    }
  }

  // 循环结束（达最大步数或整体超时）：若过程中模型曾给出过纯文本回答则回显，否则提示收尾
  let finalAnswer = lastAnswer;
  if (!finalAnswer) {
    const reason = Date.now() > deadline ? '超时' : '最大步数 ' + MAX_STEPS;
    finalAnswer = `（已达${reason}，强制收尾）请参考上述工具调用过程，或换用更擅长工具调用的模型。`;
  }
  emit({ type: 'answer', content: finalAnswer });

  // 三级记忆写入（异步，不阻塞返回）：把本轮 user 提问 + 最终回答存为记忆片段，
  // 供后续会话语义召回。仅在有 conversationId 时生效；embedding 失败不影响落库（降级关键词）。
  if (conversationId) {
    recordMemory(conversationId, userInput, finalAnswer, ollamaHost);
  }

  return finalAnswer;
}

// 异步把一轮对话写入 memory_chunks（用户提问 + 助手回答各一段；embedding 可选）
function recordMemory(convId, userInput, answer, ollamaHost) {
  const { embed } = require('./ollama');
  const chatOpts = ollamaHost ? { ollamaHost } : {};
  // 用户提问片段
  const uText = (userInput || '').trim();
  if (uText.length > 0) {
    embed(uText, chatOpts).then((e) => addMemory(convId, 'user', uText, e)).catch(() => addMemory(convId, 'user', uText, null));
  }
  // 助手回答片段（去 think 标记、截断过长）
  const aText = (answer || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 2000);
  if (aText.length > 0) {
    embed(aText, chatOpts).then((e) => addMemory(convId, 'assistant', aText, e)).catch(() => addMemory(convId, 'assistant', aText, null));
  }
}

module.exports = { runAgent, systemPrompt, READONLY, WRITE, truncateMessages, sleep, backoffDelay };
