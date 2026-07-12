'use strict';

// 将工具 specs 转为 Ollama 原生 tools JSON Schema 格式
function buildOllamaTools(specs) {
  return specs.map((t) => {
    const keys = Object.keys(t.params);
    const required = keys.filter((k) => {
      const d = t.params[k];
      return !d.includes('可选') && !d.includes('默认');
    });
    const properties = {};
    for (const k of keys) {
      properties[k] = { type: 'string', description: t.params[k] };
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.desc,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  });
}

module.exports = { buildOllamaTools };
