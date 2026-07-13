'use strict';

// 将工具 specs 转为 Ollama 原生 tools JSON Schema 格式
// 类型推断：根据参数描述中的关键词，把明显是数字/数组的参数从默认 string 提升为
// number / array，帮助原生 tools 模型生成更合规的参数（prompt 路线不受影响）。
function inferType(desc) {
  const d = (desc || '').toLowerCase();
  if (/行号|层数|数量|第.*个|数字|number|depth|行数|步数/.test(d)) return 'number';
  if (/数组|列表|多个|可多选|list|array/.test(d)) return 'array';
  return 'string';
}

function buildOllamaTools(specs) {
  return specs.map((t) => {
    const keys = Object.keys(t.params);
    const required = keys.filter((k) => {
      const d = t.params[k];
      return !d.includes('可选') && !d.includes('默认');
    });
    const properties = {};
    for (const k of keys) {
      const type = inferType(t.params[k]);
      properties[k] = { type, description: t.params[k] };
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
