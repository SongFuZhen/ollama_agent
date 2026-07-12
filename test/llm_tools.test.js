'use strict';

// LLM 驱动工具测试 — 用 deepseek-r1:8b 实际调用每个工具，验证模型能否正确选择工具并生成合法参数
// 用法: OLLAMA_HOST=http://192.168.0.101:11434 MODEL=deepseek-r1:8b node test/llm_tools.test.js

const path = require('path');
const fsp = require('fs/promises');
const { runAgent } = require('../src/core/agent');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MODEL = process.env.MODEL || 'deepseek-r1:8b';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://192.168.0.101:11434';
const ROUNDS = 3;
const TIMEOUT_PER_TEST = 120000;

const autoConfirm = async () => true;

function collectEmit() {
  const events = [];
  const handler = (e) => { events.push(e); };
  handler.events = events;
  return handler;
}

function toolCalled(events, expectedAction) {
  return events.some(e => e.type === 'tool' && e.action === expectedAction);
}

function getAnswer(events) {
  const a = events.filter(e => e.type === 'answer');
  return a.length ? a[a.length - 1].content : '';
}

const TEST_CASES = [
  {
    name: 'read_file',
    prompts: [
      '请读取 src/config.js 文件的内容并告诉我',
      '帮我看看 src/core/ollama.js 这个文件里有什么',
      '读取 package.json 文件内容',
    ],
    expect: 'read_file',
  },
  {
    name: 'list_dir',
    prompts: [
      '列出 src/tools 目录下的所有文件',
      '看看 src/core 目录里有哪些文件',
      '显示 src/skills 目录的内容',
    ],
    expect: 'list_dir',
  },
  {
    name: 'search_files',
    prompts: [
      '搜索项目中所有文件名包含 agent 的文件',
      '找一下文件名里有 ollama 的文件',
      '搜索文件名包含 config 的文件',
    ],
    expect: 'search_files',
  },
  {
    name: 'write_file',
    prompts: [
      '创建一个文件 test_llm_output.txt，内容写 hello-from-llm',
      '请写入 test_llm_output2.txt 文件，内容是 test123',
      '新建 test_llm_output3.txt，里面写 testing 123',
    ],
    expect: 'write_file',
  },
  {
    name: 'bash',
    prompts: [
      '执行命令 echo hello_world',
      '运行 ls src/tools 命令看看有什么文件',
      '用 echo 打印 test_bash_ok',
    ],
    expect: 'bash',
  },
  {
    name: 'glob',
    prompts: [
      '用 glob 模式 *.js 在 src/tools 目录查找文件',
      '在 src/core 目录用 glob 查找所有 .js 文件',
      'glob 搜索 src/ 下面的 *.json 文件',
    ],
    expect: 'glob',
  },
  {
    name: 'grep',
    prompts: [
      '在 src/core/ 目录搜索 require 这个关键词',
      '帮我在 src/ 下搜索 module.exports',
      '搜索 src/tools/ 下包含 async 的行',
    ],
    expect: 'grep',
  },
  {
    name: 'edit_file',
    prompts: [
      '把 test_llm_output.txt 文件中的 hello-from-llm 替换为 replaced-by-llm',
      '将 test_llm_output2.txt 里的 test123 改成 modified456',
      '编辑 test_llm_output3.txt，把 testing 123 替换成 done',
    ],
    expect: 'edit_file',
  },
  {
    name: 'read_lines',
    prompts: [
      '读取 src/config.js 的第 1 到第 3 行',
      '显示 src/core/agent.js 前10行内容',
      '读 package.json 的第1到5行',
    ],
    expect: 'read_lines',
  },
  {
    name: 'tree',
    prompts: [
      '用树状结构展示 src/tools 目录，深度2层',
      '以 tree 形式显示 src/core 目录结构',
      '树状列出 src/skills 目录，depth=2',
    ],
    expect: 'tree',
  },
  {
    name: 'count_loc',
    prompts: [
      '统计 src/tools 目录的代码行数',
      '帮我统计 src/core 的代码量',
      '统计 src/ 下有多少行代码',
    ],
    expect: 'count_loc',
  },
  {
    name: 'run_tests',
    prompts: [
      '运行测试命令 echo test_pass',
      '请执行测试，命令是 echo run_test_ok',
      '用 echo test_success 作为测试命令运行',
    ],
    expect: 'run_tests',
  },
  {
    name: 'run_lint',
    prompts: [
      '运行 lint 检查，命令用 echo lint_pass',
      '执行 lint，命令为 echo lint_check_ok',
      '跑一下 lint，命令 echo lint_done',
    ],
    expect: 'run_lint',
  },
  {
    name: 'git_status',
    prompts: [
      '查看当前 git 状态',
      '显示 git 工作区状态',
      'git status 看一下',
    ],
    expect: 'git_status',
  },
  {
    name: 'git_diff',
    prompts: [
      '查看 git 差异',
      '显示 git diff 未暂存的改动',
      '看看有什么改动还没 stage',
    ],
    expect: 'git_diff',
  },
  {
    name: 'git_log',
    prompts: [
      '显示最近 3 条 git 提交记录',
      '查看 git 提交历史，最近5条',
      'git log 最近10条记录',
    ],
    expect: 'git_log',
  },
  {
    name: 'git_show',
    prompts: [
      '查看 HEAD 这次提交的详细信息',
      'git show HEAD 看看最近提交',
      '显示 HEAD~1 那次提交的内容',
    ],
    expect: 'git_show',
  },
];

async function runOneTest(tc, round, prompt) {
  const emit = collectEmit();
  try {
    await runAgent(
      prompt,
      { model: MODEL, confirm: autoConfirm, ollamaHost: OLLAMA_HOST, projectRoot: PROJECT_ROOT },
      emit
    );
    const called = toolCalled(emit.events, tc.expect);
    const toolEvents = emit.events.filter(e => e.type === 'tool');
    const actualActions = toolEvents.map(e => e.action).join(',');
    const answer = getAnswer(emit.events);

    return {
      ok: called,
      expected: tc.expect,
      actual: actualActions || '(直接回答)',
      answer: answer.slice(0, 200),
      error: null,
    };
  } catch (e) {
    return { ok: false, expected: tc.expect, actual: '异常', answer: '', error: e.message };
  }
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超时 ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  LLM 驱动工具调用测试');
  console.log(`  MODEL: ${MODEL}`);
  console.log(`  OLLAMA_HOST: ${OLLAMA_HOST}`);
  console.log(`  每工具 ${ROUNDS} 轮, 共 ${TEST_CASES.length * ROUNDS} 次调用`);
  console.log('═══════════════════════════════════════════\n');

  // 准备 write/edit 测试用的 fixture 文件
  await fsp.writeFile(path.join(PROJECT_ROOT, 'test_llm_output.txt'), 'hello-from-llm\n', 'utf8');
  await fsp.writeFile(path.join(PROJECT_ROOT, 'test_llm_output2.txt'), 'test123\n', 'utf8');
  await fsp.writeFile(path.join(PROJECT_ROOT, 'test_llm_output3.txt'), 'testing 123\n', 'utf8');

  let totalOk = 0;
  let totalFail = 0;
  const results = [];

  for (const tc of TEST_CASES) {
    console.log(`\n── ${tc.name} ──`);
    let toolOk = 0;

    for (let r = 0; r < ROUNDS; r++) {
      const prompt = tc.prompts[r] || tc.prompts[0];
      const label = `#${r + 1}`;
      process.stdout.write(`  ${label} "${prompt.slice(0, 60)}..." `);

      let res;
      try {
        res = await withTimeout(runOneTest(tc, r, prompt), TIMEOUT_PER_TEST);
      } catch (e) {
        res = { ok: false, expected: tc.expect, actual: '超时/异常', answer: '', error: e.message };
      }

      if (res.ok) {
        totalOk++;
        toolOk++;
        console.log('✓');
      } else {
        totalFail++;
        console.log(`✗ (期望: ${res.expected}, 实际: ${res.actual})`);
        if (res.error) console.log(`    错误: ${res.error}`);
        if (res.answer) console.log(`    回答: ${res.answer}`);
      }
    }

    results.push({ name: tc.name, rounds: ROUNDS, ok: toolOk });
  }

  // 清理
  try { await fsp.unlink(path.join(PROJECT_ROOT, 'test_llm_output.txt')); } catch (e) {}
  try { await fsp.unlink(path.join(PROJECT_ROOT, 'test_llm_output2.txt')); } catch (e) {}
  try { await fsp.unlink(path.join(PROJECT_ROOT, 'test_llm_output3.txt')); } catch (e) {}

  console.log('\n═══════════════════════════════════════════');
  console.log('  汇总:');
  for (const r of results) {
    const icon = r.ok === r.rounds ? '✓' : r.ok > 0 ? '△' : '✗';
    console.log(`  ${icon} ${r.name}: ${r.ok}/${r.rounds}`);
  }
  console.log(`\n  总计: ${totalOk}/${totalOk + totalFail} 通过`);
  console.log('═══════════════════════════════════════════');
  process.exit(totalFail > 0 ? 1 : 0);
})();
