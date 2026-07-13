'use strict';

// 三级记忆的检索/注入层（L2 事实偏好 + L3 语义片段）。
// 完全离线：embedding 走本地 Ollama（nomic-embed-text）；
// 模型缺失时降级为关键词（LIKE）检索，不阻断。

const { embed } = require('../core/ollama');
const db = require('../storage/db');

let EMBED_AVAILABLE = null; // 惰性探测：null=未探测, true/false

async function probeEmbed(ollamaHost) {
  if (EMBED_AVAILABLE !== null) return EMBED_AVAILABLE;
  try {
    await embed('__probe__', { ollamaHost });
    EMBED_AVAILABLE = true;
  } catch (e) {
    EMBED_AVAILABLE = false;
  }
  return EMBED_AVAILABLE;
}

function setEmbedAvailable(v) { EMBED_AVAILABLE = v; }

// 余弦相似度（nomic 已归一化，等价于点积，但保留完整公式更稳）
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 对全部记忆做余弦 Top-K（纯 JS 全扫，几千条 <10ms）
function cosineTopK(rows, q, k = 5) {
  const scored = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    scored.push({ row: r, score: cosine(q, r.embedding) });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k).map(s => s.row);
}

// 把命中片段格式化为可注入 system prompt 的文本块
function formatChunks(chunks) {
  if (!chunks.length) return '';
  const lines = ['## 相关历史记忆（来自过往会话，仅供参考）'];
  for (const c of chunks) {
    const tag = c.role ? `[${c.role}] ` : '';
    lines.push(`- ${tag}${c.content.trim()}`);
  }
  return lines.join('\n');
}

/**
 * 构建召回提示块。
 * @param {string} query 可选；省略则做「与新会话无显式 query」的全量轻召回（取最近片段）。
 * @param {object} opts { ollamaHost }
 * @returns {Promise<string>} 注入文本（空串表示无记忆）
 */
async function buildRecallPrompt(query, opts = {}) {
  const all = db.getAllMemory();
  if (!all.length) return '';

  if (!query) {
    // 无 query：取最近 5 条片段作为轻量上下文
    const recent = all.slice(-5);
    return formatChunks(recent);
  }

  const ok = await probeEmbed(opts.ollamaHost);
  if (ok) {
    try {
      const q = await embed(query, opts);
      const top = cosineTopK(all, Float32Array.from(q), 5);
      return formatChunks(top);
    } catch (e) {
      // embedding 中途失败也降级
    }
  }
  // 降级：关键词检索
  const kw = db.searchMemoryKeyword(query, 5);
  return formatChunks(kw);
}

module.exports = { buildRecallPrompt, cosineTopK, probeEmbed, setEmbedAvailable, cosine };
