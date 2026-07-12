'use strict';

// 技能注册表（分析 / 查看类，区别于 src/tools 下的动作类工具）
const git_status = require('./git/git_status');
const git_diff = require('./git/git_diff');
const git_log = require('./git/git_log');
const git_show = require('./git/git_show');

const explain_symbol = require('./analyze/explain_symbol');
const find_references = require('./analyze/find_references');

const SKILLS = {
  git_status,
  git_diff,
  git_log,
  git_show,
  explain_symbol,
  find_references,
};

module.exports = { SKILLS };
