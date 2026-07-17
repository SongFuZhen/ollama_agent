'use strict';

// 行为硬约束：7B 对"禁止/必须"开头的清单式约束遵守度远高于软描述。
// 控制在 5-7 条，集中在模型最易跑偏的点（凭记忆改文件、连续重复调、问答仍调工具）。
// 抽成独立模块，供 prompt 路线与 native tools 路线共用同一条约束。
function behaviorRules() {
  return [
    '【行为规则】',
    '1. 禁止在未 read_file / read_lines 读过的文件上调用 write_file / edit_file / apply_diff；任何修改都必须基于已读取的真实内容，禁止凭记忆猜测文件内容。',
    '2. 禁止连续调用同一个工具超过 2 次（除非用户明确要求），重复调用请直接基于已有结果回答。',
    '3. 调用工具后必须等待结果，禁止在同一轮里连续输出多个工具调用，一次只调一个。',
    '4. 普通问答、问候、解释、分析等不需要操作文件的场合，禁止调用任何工具，直接用 markdown 回答。',
    '5. 禁止把字符串传给需要数字的参数（如 read_lines 的 start/end、tree 的 depth、repo_map 的 max），类型必须匹配。',
    '6. 文件不存在时，先确认路径拼写或用 list_dir/glob 查找，禁止凭空写文件（除非用户明确要求新建）。',
  ].join('\n');
}

module.exports = { behaviorRules };
