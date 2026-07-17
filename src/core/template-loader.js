'use strict';

// 任务模板加载器：把高频任务固化为"建议路径"注入 system prompt，
// 把"模型自由规划"降级为"模型按图索骥"，减少 7B 跑偏和步数浪费。
// 模板为 .md 文件：顶部 --- 包裹的 YAML 前置块（name/title/keywords），
// 其下正文为注入模型的"推荐任务路径"。

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates');

// 极简 YAML 前置块解析：仅支持 `key: value` 与 `key: [a, b, c]` 两种行式，
// 以及 `key: 字符串`；足够覆盖模板的 name/title/keywords 需求，避免引入 yaml 依赖。
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const metaText = m[1];
  const body = m[2];
  const meta = {};
  for (const line of metaText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (key === 'keywords' && val.includes(',')) {
      // 模板正文用 `keywords: a, b, c` 逗号分隔写法，直接按逗号拆成数组
      meta[key] = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: body.trim() };
}

let _cache = null;

// 加载全部模板（带内存缓存，进程级只需解析一次）。
function allTemplates() {
  if (_cache) return _cache;
  let files = [];
  try {
    files = fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.md'));
  } catch (e) {
    return [];
  }
  const list = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.name) continue;
    list.push({
      name: meta.name,
      title: meta.title || meta.name,
      keywords: Array.isArray(meta.keywords) ? meta.keywords : (meta.keywords ? [meta.keywords] : []),
      body,
    });
  }
  _cache = list;
  return list;
}

// 按用户输入匹配最相关的模板：关键词命中数最多者胜出；无命中返回 null。
function matchTemplate(userInput) {
  if (typeof userInput !== 'string' || !userInput.trim()) return null;
  const text = userInput.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const t of allTemplates()) {
    let score = 0;
    for (const kw of t.keywords) {
      if (text.includes(String(kw).toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best && bestScore > 0 ? best : null;
}

// 按名称取单个模板（供前端 /template 命令显式调用）。
function loadTemplate(name) {
  return allTemplates().find((t) => t.name === name) || null;
}

module.exports = { allTemplates, matchTemplate, loadTemplate, parseFrontmatter, TEMPLATE_DIR };
