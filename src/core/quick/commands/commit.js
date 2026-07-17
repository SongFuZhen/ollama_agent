'use strict';

// /commit — 根据改动生成 commit message（只读，调用 git diff）

const bash = require('../../../tools/bash');

module.exports = {
  name: 'commit',
  desc: '根据改动生成 commit message',
  category: 'readonly',
  usage: 'commit',
  params: {},
  async prepare(args, { projectRoot }) {
    let diff;
    try {
      const staged = await bash.run({ command: 'git diff --cached' }, { root: projectRoot });
      diff = (staged && String(staged).trim()) ? staged : await bash.run({ command: 'git diff' }, { root: projectRoot });
    } catch (e) {
      return { ok: false, error: '获取 git diff 失败：' + e.message };
    }
    if (!diff || !String(diff).trim()) {
      return { ok: false, error: '没有检测到改动（git diff 为空），请先 git add 或做出修改' };
    }
    if (diff.length > 4000) diff = diff.slice(0, 4000) + '\n...[已截断]';
    return { ok: true, context: diff };
  },
  prompt(args, context) {
    return {
      system: '你是 git 提交信息助手。根据 diff 生成简洁的中文 commit message。格式：第一行一句话概述（祈使句，≤50 字），空一行，再写 2-4 条要点说明改了什么、为什么。不要解释未改动的内容。',
      user: `请为以下改动生成 commit message：\n\n\`\`\`diff\n${context}\n\`\`\``,
    };
  },
};
