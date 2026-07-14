'use strict';

// 任务清单（离线、纯本地，不碰任何云）。
// 适合模型在复杂任务里拆步骤、跟踪进度（todo → doing → done）。

const db = require('../storage/db');

const VALID = new Set(['todo', 'doing', 'done']);

module.exports = {
  name: 'todos',
  desc: '管理本地任务清单：add 新增、list 查看、done/doing 改状态、delete 删除（离线可用）；复杂多步任务拆解为可跟踪清单时用',
  params: {
    action: '操作：add | list | done | doing | delete',
    text: 'add 时的任务描述',
    id: 'done/doing/delete 时的任务 id',
  },
  needConfirm: false,

  async run({ action, text, id }, ctx = {}) {
    switch ((action || 'list').toLowerCase()) {
      case 'add': {
        if (!text || !text.trim()) return '错误：text 不能为空';
        db.addTodo(text.trim());
        return '已添加到任务清单。';
      }
      case 'list': {
        const todos = db.getTodos();
        if (!todos.length) return '（任务清单为空）';
        const icon = { todo: '⬜', doing: '🔄', done: '✅' };
        return todos.map((t) => `${icon[t.status] || '⬜'} #${t.id} ${t.text}`).join('\n');
      }
      case 'doing': {
        if (!id) return '错误：doing 需要 id';
        db.setTodoStatus(Number(id), 'doing');
        return `任务 #${id} → 进行中。`;
      }
      case 'done': {
        if (!id) return '错误：done 需要 id';
        db.setTodoStatus(Number(id), 'done');
        return `任务 #${id} → 已完成 ✅`;
      }
      case 'delete': {
        if (!id) return '错误：delete 需要 id';
        db.deleteTodo(Number(id));
        return `已删除任务 #${id}。`;
      }
      default:
        return '错误：action 仅支持 add / list / done / doing / delete';
    }
  },
};
