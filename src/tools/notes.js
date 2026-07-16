'use strict';

// 本地笔记（离线、纯本地，不碰任何云）。
// 适合模型在会话中记下用户偏好、待查事项、临时结论。

const db = require('../storage/db');
const { truncate } = require('./utils');

// 确保数据库已初始化：server 启动时已调 initDB，但独立脚本/早期请求可能尚未就绪。
// 未就绪时 lazy 初始化一次；若仍失败（如 WASM 加载异常）则给出友好提示而非崩 null。
async function ensureDB() {
  if (db.isReady()) return true;
  try {
    await db.initDB();
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  name: 'notes',
  desc: '管理本地笔记：add 新增、list 查看、delete 删除（内容仅存于本地数据库，离线可用）；跨步骤记住用户偏好或临时结论时用',
  params: {
    action: '操作：add | list | delete',
    content: 'add 时的笔记内容',
    id: 'delete 时的笔记 id',
  },
  needConfirm: false,

  async run({ action, content, id }, ctx = {}) {
    if (!(await ensureDB())) return '错误：本地数据库不可用，笔记功能暂不可用。';
    switch ((action || 'list').toLowerCase()) {
      case 'add': {
        if (!content || !content.trim()) return '错误：content 不能为空';
        db.addNote({ content: content.trim() });
        return '已保存笔记。';
      }
      case 'list': {
        const notes = db.getNotes();
        if (!notes.length) return '（暂无笔记）';
        return notes.map((n) => `#${n.id} [${new Date(n.ts).toLocaleString()}] ${n.content}`).join('\n');
      }
      case 'delete': {
        if (!id) return '错误：delete 需要 id';
        db.deleteNote(Number(id));
        return `已删除笔记 #${id}。`;
      }
      default:
        return '错误：action 仅支持 add / list / delete';
    }
  },
};
