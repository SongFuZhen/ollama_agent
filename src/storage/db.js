'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fsp = require('fs/promises');

const DB_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'conversations.db');

let db = null;

async function initDB() {
  await fsp.mkdir(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_device ON conversations(device_id);
  `);

  // 迁移：添加 project_root 字段（如果不存在）
  const columns = db.prepare("PRAGMA table_info(conversations)").all();
  const hasProjectRoot = columns.some(c => c.name === 'project_root');
  if (!hasProjectRoot) {
    db.exec("ALTER TABLE conversations ADD COLUMN project_root TEXT DEFAULT ''");
  }

  // 迁移：移除已废弃的 scenario 字段（若尚未清理）
  if (columns.some(c => c.name === 'scenario')) {
    db.exec("DROP INDEX IF EXISTS idx_conversations_scenario");
    db.exec("ALTER TABLE conversations DROP COLUMN scenario");
  }

  // 迁移：添加 tools 字段到 messages 表（如果不存在）
  const msgColumns = db.prepare("PRAGMA table_info(messages)").all();
  const hasTools = msgColumns.some(c => c.name === 'tools');
  if (!hasTools) {
    db.exec("ALTER TABLE messages ADD COLUMN tools TEXT DEFAULT NULL");
  }

  // 迁移：添加 thinks 字段到 messages 表（如果不存在）
  const hasThinks = msgColumns.some(c => c.name === 'thinks');
  if (!hasThinks) {
    db.exec("ALTER TABLE messages ADD COLUMN thinks TEXT DEFAULT NULL");
  }

  // 迁移：添加 images 字段到 messages 表（如果不存在）
  const hasImages = msgColumns.some(c => c.name === 'images');
  if (!hasImages) {
    db.exec("ALTER TABLE messages ADD COLUMN images TEXT DEFAULT NULL");
  }

  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// 创建对话
function createConversation(id, title = '', projectRoot = '') {
  const now = Date.now();
  return getDB().prepare(`
    INSERT INTO conversations (id, title, project_root, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title, projectRoot, now, now);
}

// 更新对话标题
function updateConversationTitle(id, title) {
  return getDB().prepare(`
    UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
  `).run(title, Date.now(), id);
}

// 添加消息
function addMessage(conversationId, role, content, tools = null, thinks = null, images = null) {
  return getDB().prepare(`
    INSERT INTO messages (conversation_id, role, content, tools, thinks, images, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversationId, role, content,
    tools ? JSON.stringify(tools) : null,
    thinks ? JSON.stringify(thinks) : null,
    images ? JSON.stringify(images) : null,
    Date.now()
  );
}

// 清空对话下的所有消息（用于整体覆盖保存）
function deleteMessages(conversationId) {
  return getDB().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
}

// 获取对话的所有消息
function getMessages(conversationId) {
  const rows = getDB().prepare(`
    SELECT role, content, tools, thinks, images, timestamp FROM messages
    WHERE conversation_id = ?
    ORDER BY timestamp ASC
  `).all(conversationId);
  // 解析 tools / thinks / images JSON
  return rows.map(r => ({
    ...r,
    tools: r.tools ? JSON.parse(r.tools) : null,
    thinks: r.thinks ? JSON.parse(r.thinks) : null,
    images: r.images ? JSON.parse(r.images) : null
  }));
}

// 获取全部对话
function getConversations() {
  return getDB().prepare(`
    SELECT id, title, project_root, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
  `).all();
}

// 删除对话
function deleteConversation(id) {
  getDB().prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
  return getDB().prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

// 获取单个对话
function getConversation(id) {
  return getDB().prepare(`
    SELECT id, title, project_root, created_at, updated_at
    FROM conversations WHERE id = ?
  `).get(id);
}

// ---------- 设备管理 ----------
function upsertDevice(id, info) {
  const now = Date.now();
  const existing = getDB().prepare('SELECT id FROM devices WHERE id = ?').get(id);
  
  if (existing) {
    getDB().prepare(`
      UPDATE devices SET last_seen = ?, hostname = ?, username = ?, platform = ?, arch = ?, mac = ?
      WHERE id = ?
    `).run(now, info.hostname, info.username, info.platform, info.arch, info.mac, id);
  } else {
    getDB().prepare(`
      INSERT INTO devices (id, hostname, username, platform, arch, mac, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, info.hostname, info.username, info.platform, info.arch, info.mac, now, now);
  }
}

function getDevice(id) {
  return getDB().prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function getAllDevices() {
  return getDB().prepare('SELECT * FROM devices ORDER BY last_seen DESC').all();
}

module.exports = {
  initDB,
  getDB,
  createConversation,
  updateConversationTitle,
  addMessage,
  deleteMessages,
  getMessages,
  getConversations,
  getConversation,
  deleteConversation,
  upsertDevice,
  getDevice,
  getAllDevices,
};
