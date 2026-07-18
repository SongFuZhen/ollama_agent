'use strict';

// /push — 列出即将推送到远程的提交，确认后推送

const bash = require('../../../tools/bash');

module.exports = {
  name: 'push',
  desc: '查看即将推送的提交并推送',
  category: 'readonly',
  usage: 'push',
  params: {},
  examples: [
    '/push',
  ],
  async prepare(args, { projectRoot }) {
    let log;
    try {
      log = await bash.run({
        command: 'git log @{upstream}..HEAD --oneline 2>/dev/null || git log origin/HEAD..HEAD --oneline 2>/dev/null || git log --oneline -n 20',
      }, { root: projectRoot });
    } catch (e) {
      return { ok: false, error: '获取待推送提交失败：' + e.message };
    }
    if (!log || !String(log).trim()) {
      return { ok: false, error: '没有可推送的提交（或尚未设置上游分支）' };
    }
    return { ok: true, context: String(log) };
  },
  prompt(args, context) {
    return {
      system: '你是 git 助手。简要说明以下将要推送到远程的提交包含哪些改动，并提醒用户确认推送。',
      user: `以下是将要推送到远程的提交：\n\n${context}`,
    };
  },
};
