'use strict';

// 持久化层：使用 sql.js（SQLite 编译为 WASM，纯 JS，零原生编译依赖）。
// 相比 better-sqlite3：无需 node-gyp 编译，连同 node_modules 一起 U 盘拷贝即可跨机运行。
// 数据存为标准 SQLite 单文件 data/conversations.db。
// 对外 API（initDB / createConversation / addMessage / getConversationStats 等）与原 better-sqlite3 版保持一致。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'conversations.db');

let SQL = null;   // sql.js 模块
let db = null;    // sql.js Database 实例
let saveTimer = null;
let saving = false;
let initPromise = null;  // initDB 防重入锁：并发调用共享同一次初始化

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    hostname TEXT,
    username TEXT,
    platform TEXT,
    arch TEXT,
    mac TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    title TEXT DEFAULT '',
    project_root TEXT DEFAULT '',
    context_cleared_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    tools TEXT,
    thinks TEXT,
    images TEXT,
    stats TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_device ON conversations(device_id);

  CREATE TABLE IF NOT EXISTS memory_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT,
    role TEXT,
    content TEXT NOT NULL,
    embedding BLOB,
    summary TEXT DEFAULT '',
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memory_conv ON memory_chunks(conv_id);

  DROP TABLE IF EXISTS notes;
  DROP TABLE IF EXISTS todos;

  CREATE TABLE IF NOT EXISTS todos (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title   TEXT NOT NULL DEFAULT '',                 -- 标题
    body    TEXT NOT NULL DEFAULT '',                 -- markdown 备注/说明
    status  TEXT NOT NULL DEFAULT 'todo',             -- todo | doing | done
    priority TEXT NOT NULL DEFAULT 'medium',          -- high | medium | low
    due     TEXT,                                      -- ISO date 'YYYY-MM-DD' 或 NULL
    done    INTEGER NOT NULL DEFAULT 0,               -- 冗余完成标记（1=done），便于排序/筛选
    ts      INTEGER NOT NULL                          -- 创建时间
  );

  CREATE TABLE IF NOT EXISTS notes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title   TEXT NOT NULL DEFAULT '',                 -- 标题（可选）
    content TEXT NOT NULL DEFAULT '',                 -- markdown 正文
    ts      INTEGER NOT NULL                          -- 创建/更新时间
  );
`;

// ---------- sql.js 薄封装 ----------
// 每次调用重新 prepare（简单且避免复用已 free 语句的坑）。
// 返回单行对象或 undefined。
function getRow(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row; // undefined 表示无结果
}

// 返回所有行（对象数组）
function getRows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 执行写操作（INSERT/UPDATE/DELETE）
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step(); // 对 INSERT/UPDATE 也需 step 以执行
  stmt.free();
}

// ---------- 持久化（落盘） ----------
// 跨平台落盘：先写临时文件再原子 rename 覆盖。
// Windows 上若 DB_PATH 被防病毒/其他进程占用，rename 会抛 EBUSY/EPERM，
// 此时回退为「先 unlink 目标再 rename」。
function commitFile(tmp, target) {
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(target);
      fs.renameSync(tmp, target);
    } catch (e2) {
      // 仍失败：直接覆盖写（牺牲原子性保数据）
      const data = fs.readFileSync(tmp);
      fs.writeFileSync(target, data);
    }
  }
}

async function commitFileAsync(tmp, target) {
  try {
    await fsp.rename(tmp, target);
  } catch (e) {
    try {
      await fsp.unlink(target);
      await fsp.rename(tmp, target);
    } catch (e2) {
      const data = await fsp.readFile(tmp);
      await fsp.writeFile(target, data);
    }
  }
}

function flush() {
  return new Promise((resolve, reject) => {
    try {
      const data = Buffer.from(db.export());
      const tmp = DB_PATH + '.tmp';
      fs.writeFile(tmp, data, async (err) => {
        if (err) return reject(err);
        try {
          await commitFileAsync(tmp, DB_PATH);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (saving) return;
    saving = true;
    try { await flush(); } catch (e) { /* 落盘失败仅记录，不中断服务 */ }
    saving = false;
  }, 200);
}

// 同步落盘：用于进程退出前保证不丢数据（绕过异步定时器）
function flushSync() {
  if (!db) return;
  const data = Buffer.from(db.export());
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, data);
  commitFile(tmp, DB_PATH);
}

function closeDB() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { flushSync(); } catch (e) {}
}

async function initDB() {
  // 防重入：首个调用开始初始化后，后续并发调用复用同一个 promise，
  // 避免 notes/todos 与 server 启动同时触发 initDB 时重复初始化、相互覆盖。
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    SQL = await initSqlJs();
    try {
      const buf = await fsp.readFile(DB_PATH);
      db = new SQL.Database(new Uint8Array(buf));
    } catch (e) {
      // 文件缺失或损坏：从空库开始
      db = new SQL.Database();
    }
    // 每次启动都执行 SCHEMA（IF NOT EXISTS，幂等且开销极小），
    // 保证旧库升级时也能补齐新增表（如 memory_chunks）。
    db.run(SCHEMA);
    // 兼容旧库：为已有表补充新增列
    try { db.run('ALTER TABLE messages ADD COLUMN model TEXT'); } catch (_) {}
    try { db.run('ALTER TABLE conversations ADD COLUMN context_cleared_at INTEGER'); } catch (_) {}
    try { db.run('ALTER TABLE messages ADD COLUMN mid TEXT'); } catch (_) {}
    try { db.run('ALTER TABLE conversations ADD COLUMN excluded_mids TEXT'); } catch (_) {}
    try { db.run('ALTER TABLE conversations ADD COLUMN history TEXT'); } catch (_) {}
    try { db.run('ALTER TABLE conversations ADD COLUMN compact_divider INTEGER'); } catch (_) {}
    try { db.run('ALTER TABLE conversations ADD COLUMN cleared_divider INTEGER'); } catch (_) {}
    await flush();
    return db;
  })();
  return initPromise;
}

function getDB() {
  if (!db) throw new Error('Database not initialized (call initDB first)');
  return db;
}

// 数据库是否已初始化（initDB 完成）。工具（notes/todos）在调用前据此判断，
// 避免在未 initDB 的环境（如独立脚本、initDB 尚未 resolve 的早期请求）直接崩 null。
function isReady() {
  return db !== null;
}

// ---------- 对话 ----------

function createConversation(id, title = '', projectRoot = '', contextClearedAt = null, excludedMids = null, history = null, compactDivider = null, clearedDivider = null) {
  const now = Date.now();
  run(
    'INSERT INTO conversations (id, title, project_root, context_cleared_at, excluded_mids, history, compact_divider, cleared_divider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id, title || '', projectRoot || '', contextClearedAt || null,
      excludedMids ? JSON.stringify(excludedMids) : null,
      history ? JSON.stringify(history) : null,
      compactDivider == null ? null : Number(compactDivider),
      clearedDivider == null ? null : Number(clearedDivider),
      now, now,
    ]
  );
  scheduleSave();
}

function updateConversationTitle(id, title) {
  run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [title || '', Date.now(), id]);
  scheduleSave();
}

function updateConversationRoot(id, projectRoot) {
  run('UPDATE conversations SET project_root = ?, updated_at = ? WHERE id = ?', [projectRoot || '', Date.now(), id]);
  scheduleSave();
}

// 持久化「清除上下文」时间戳：下次加载对话时用于提示「曾清除上下文」
function updateConversationContextCleared(id, ts) {
  run('UPDATE conversations SET context_cleared_at = ?, updated_at = updated_at WHERE id = ?', [ts || null, id]);
  scheduleSave();
}

// 持久化「单条移出上下文」与「压缩/清除」状态：排除集合、当前结构化历史、分隔线位置
function updateConversationState(id, { excludedMids, history, compactDivider, clearedDivider } = {}) {
  const sets = [];
  const params = [];
  if (excludedMids !== undefined) { sets.push('excluded_mids = ?'); params.push(JSON.stringify(excludedMids)); }
  if (history !== undefined) { sets.push('history = ?'); params.push(JSON.stringify(history)); }
  if (compactDivider !== undefined) { sets.push('compact_divider = ?'); params.push(compactDivider == null ? null : Number(compactDivider)); }
  if (clearedDivider !== undefined) { sets.push('cleared_divider = ?'); params.push(clearedDivider == null ? null : Number(clearedDivider)); }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE conversations SET ${sets.join(', ')}, updated_at = updated_at WHERE id = ?`, params);
  scheduleSave();
}

function getConversation(id) {
  return getRow('SELECT id, title, project_root, context_cleared_at, excluded_mids, history, compact_divider, cleared_divider, created_at, updated_at FROM conversations WHERE id = ?', [id]) || null;
}

function getConversations() {
  return getRows('SELECT id, title, project_root, created_at, updated_at FROM conversations ORDER BY updated_at DESC');
}

function deleteConversation(id) {
  run('DELETE FROM messages WHERE conversation_id = ?', [id]);
  run('DELETE FROM conversations WHERE id = ?', [id]);
  scheduleSave();
}

// ---------- 消息 ----------

function addMessage(conversationId, role, content, model = null, tools = null, thinks = null, images = null, stats = null, mid = null) {
  run(
    'INSERT INTO messages (conversation_id, role, content, model, tools, thinks, images, stats, mid, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      conversationId, role, content,
      model || null,
      tools ? JSON.stringify(tools) : null,
      thinks ? JSON.stringify(thinks) : null,
      images ? JSON.stringify(images) : null,
      stats ? JSON.stringify(stats) : null,
      mid || null,
      Date.now(),
    ]
  );
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), conversationId]);
  scheduleSave();
}

function deleteMessages(conversationId) {
  run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
  scheduleSave();
}

function getMessages(conversationId) {
  const rows = getRows(
    'SELECT role, content, model, tools, thinks, images, stats, mid, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
    [conversationId]
  );
  return rows.map(r => ({
    ...r,
    mid: r.mid || null,
    model: r.model || null,
    tools: r.tools ? JSON.parse(r.tools) : null,
    thinks: r.thinks ? JSON.parse(r.thinks) : null,
    images: r.images ? JSON.parse(r.images) : null,
    stats: r.stats ? JSON.parse(r.stats) : null,
  }));
}

// ---------- 会话统计 ----------

function getConversationStats(conversationId) {
  const rows = getRows(
    "SELECT stats, tools FROM messages WHERE conversation_id = ? AND role = 'assistant' AND (stats IS NOT NULL OR tools IS NOT NULL)",
    [conversationId]
  );

  let ttftSum = 0, ttftCount = 0, totalTimeSum = 0;
  const toolCounts = {};

  for (const r of rows) {
    if (r.stats) {
      const s = JSON.parse(r.stats);
      if (!isNaN(Number(s.ttft))) { ttftSum += Number(s.ttft); ttftCount++; }
      if (!isNaN(Number(s.total))) { totalTimeSum += Number(s.total); }
    }
    if (r.tools) {
      const tools = JSON.parse(r.tools);
      if (Array.isArray(tools)) {
        for (const t of tools) {
          if (t && t.name) toolCounts[t.name] = (toolCounts[t.name] || 0) + 1;
        }
      }
    }
  }

  return {
    ttftSum,
    ttftCount,
    totalTimeSum,
    avgTtft: ttftCount > 0 ? Math.round(ttftSum / ttftCount) : 0,
    toolCounts,
  };
}

// ---------- 设备 ----------

function upsertDevice(id, info) {
  const existing = getRow('SELECT id FROM devices WHERE id = ?', [id]);
  const now = Date.now();
  if (existing) {
    run(
      'UPDATE devices SET last_seen = ?, hostname = ?, username = ?, platform = ?, arch = ?, mac = ? WHERE id = ?',
      [now, info.hostname, info.username, info.platform, info.arch, info.mac, id]
    );
  } else {
    run(
      'INSERT INTO devices (id, hostname, username, platform, arch, mac, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, info.hostname, info.username, info.platform, info.arch, info.mac, now, now]
    );
  }
  scheduleSave();
}

function getDevice(id) {
  return getRow('SELECT * FROM devices WHERE id = ?', [id]) || null;
}

function getAllDevices() {
  return getRows('SELECT * FROM devices ORDER BY last_seen DESC');
}

// ---------- 三级记忆：memory_chunks ----------

// 写入一段记忆。embedding 为 number[] 或 Float32Array，可为 null（降级关键词）。
function addMemory(convId, role, content, embedding = null, summary = '') {
  let blob = null;
  if (embedding) {
    const f32 = Float32Array.from(embedding);
    blob = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  }
  run(
    'INSERT INTO memory_chunks (conv_id, role, content, embedding, summary, ts) VALUES (?, ?, ?, ?, ?, ?)',
    [convId || null, role || null, content, blob, summary || '', Date.now()]
  );
  scheduleSave();
}

// 返回全部记忆行（embedding 还原为 Float32Array；无 embedding 时 embedding=null）。
function getAllMemory() {
  const rows = getRows('SELECT id, conv_id, role, content, embedding, summary, ts FROM memory_chunks ORDER BY ts ASC');
  return rows.map(r => {
    let emb = null;
    if (r.embedding) {
      const u8 = Buffer.isBuffer(r.embedding) ? r.embedding : Buffer.from(r.embedding);
      emb = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
    }
    return { ...r, embedding: emb };
  });
}

// 关键词降级检索：LIKE 匹配 content（忽略 embedding）。
function searchMemoryKeyword(query, k = 5) {
  const like = '%' + (query || '').replace(/[%\s]+/g, '%') + '%';
  return getRows(
    'SELECT id, conv_id, role, content, summary, ts FROM memory_chunks WHERE content LIKE ? ORDER BY ts DESC LIMIT ?',
    [like, k]
  );
}

function deleteMemory(id) {
  run('DELETE FROM memory_chunks WHERE id = ?', [id]);
  scheduleSave();
}

function clearMemory() {
  run('DELETE FROM memory_chunks');
  scheduleSave();
}

// ---------- 笔记 / 待办（本地、离线，重建表） ----------

function addTodo({ title = '', body = '', priority = 'medium', due = null } = {}) {
  const status = 'todo';
  const done = 0;
  run(
    'INSERT INTO todos (title, body, status, priority, due, done, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title || '', body || '', status, priority || 'medium', due || null, done, Date.now()]
  );
  scheduleSave();
}

// 局部更新：fields 为 { title?, body?, status?, priority?, due? } 的子集
function updateTodo(id, fields = {}) {
  const allowed = ['title', 'body', 'status', 'priority', 'due'];
  const cols = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      cols.push(`${k} = ?`);
      vals.push(fields[k]);
    }
  }
  // 若改了 status，同步 done 冗余列
  if (fields.status !== undefined) {
    cols.push('done = ?');
    vals.push(fields.status === 'done' ? 1 : 0);
  }
  if (!cols.length) return;
  vals.push(Number(id));
  run('UPDATE todos SET ' + cols.join(', ') + ' WHERE id = ?', vals);
  scheduleSave();
}

function getTodos() {
  // 未完成在前（doing > todo），已完成在底；同组按 ts 倒序
  return getRows(
    `SELECT id, title, body, status, priority, due, done, ts FROM todos
     ORDER BY done ASC,
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
       ts DESC`
  );
}

function setTodoStatus(id, status) {
  const done = status === 'done' ? 1 : 0;
  run('UPDATE todos SET status = ?, done = ? WHERE id = ?', [status, done, Number(id)]);
  scheduleSave();
}

function deleteTodo(id) {
  run('DELETE FROM todos WHERE id = ?', [Number(id)]);
  scheduleSave();
}

function addNote({ title = '', content = '' } = {}) {
  run('INSERT INTO notes (title, content, ts) VALUES (?, ?, ?)', [title || '', content || '', Date.now()]);
  scheduleSave();
}

// 局部更新：fields 为 { title?, content? } 的子集
function updateNote(id, fields = {}) {
  const allowed = ['title', 'content'];
  const cols = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { cols.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!cols.length) return;
  vals.push(Number(id));
  run('UPDATE notes SET ' + cols.join(', ') + ' WHERE id = ?', vals);
  scheduleSave();
}

function getNotes() {
  return getRows('SELECT id, title, content, ts FROM notes ORDER BY ts DESC');
}

function deleteNote(id) {
  run('DELETE FROM notes WHERE id = ?', [Number(id)]);
  scheduleSave();
}

module.exports = {
  initDB,
  getDB,
  isReady,
  closeDB,
  createConversation,
  updateConversationTitle,
  updateConversationRoot,
  updateConversationContextCleared,
  updateConversationState,
  addMessage,
  deleteMessages,
  getMessages,
  getConversations,
  getConversation,
  getConversationStats,
  deleteConversation,
  upsertDevice,
  getDevice,
  getAllDevices,
  addMemory,
  getAllMemory,
  searchMemoryKeyword,
  deleteMemory,
  clearMemory,
  addNote,
  updateNote,
  getNotes,
  deleteNote,
  addTodo,
  updateTodo,
  getTodos,
  setTodoStatus,
  deleteTodo,
};
