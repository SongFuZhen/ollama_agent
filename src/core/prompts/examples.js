'use strict';

// Few-Shot 示例库：为 7B 小模型提供"标准答案"式的工具调用示例。
// 7B 对"看例子"的依赖远大于"读规则"，给每个高频工具附 1 个正确示例，
// 能显著提升 JSON 解析成功率、降低单轮收敛步数。
// 控制总长度在 ~800 token 内（避免挤占 16K 上下文）。

// 高频工具示例（键名需与工具名一致）。每个示例为一个完整可用调用。
const EXAMPLES = {
  read_file: {
    action: 'read_file',
    params: { path: 'src/config.js' },
  },
  read_lines: {
    action: 'read_lines',
    params: { path: 'src/core/agent.js', start: 130, end: 145 },
  },
  list_dir: {
    action: 'list_dir',
    params: { path: 'src/tools' },
  },
  grep: {
    action: 'grep',
    params: { pattern: 'MAX_STEPS', path: 'src' },
  },
  glob: {
    action: 'glob',
    params: { pattern: 'src/**/*.js' },
  },
  bash: {
    action: 'bash',
    params: { command: 'npm run lint' },
  },
  write_file: {
    action: 'write_file',
    params: { path: 'src/tools/hello.js', content: "module.exports = { hello: 'world' };\n" },
  },
  edit_file: {
    action: 'edit_file',
    params: { path: 'src/config.js', old_string: 'const MAX_STEPS = 6;', new_string: 'const MAX_STEPS = 8;' },
  },
  apply_diff: {
    action: 'apply_diff',
    params: {
      diff: [
        '--- a/src/config.js',
        '+++ b/src/config.js',
        '@@ -15,1 +15,1 @@',
        '-const MAX_STEPS = 6;',
        '+const MAX_STEPS = 8;',
      ].join('\n'),
    },
  },
};

// 只挑 specs 里实际存在的高频工具，避免把不可用工具的示例喂给模型。
// 也避免对低频/确认类工具（ask_user/notes/todos/delegate/技能等）给示例，减少噪声。
function fewShotExamples(specs) {
  const available = new Set(specs.map((s) => s.name));
  const lines = [];
  for (const name of Object.keys(EXAMPLES)) {
    if (!available.has(name)) continue;
    const ex = EXAMPLES[name];
    lines.push(
      `- ${name} 示例：\n` +
      '  ```json\n' +
      '  ' + JSON.stringify({ action: ex.action, params: ex.params }) + '\n' +
      '  ```'
    );
  }
  if (!lines.length) return '';
  return ['### 示例（照此格式输出，不要加额外字段）', ...lines].join('\n');
}

module.exports = { fewShotExamples, EXAMPLES };
