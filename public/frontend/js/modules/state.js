'use strict';

/* state.js - 全局状态管理 */

const state = {
  session: null,            // 当前会话的消息 DOM 容器
  conversationId: null,     // 当前对话 ID
  conversationTitle: '',    // 当前对话标题（可编辑）
  busy: false,              // 是否有请求进行中
  streamingAnswer: null,    // 当前流式输出的答案元素（气泡）
  streamingSteps: null,     // 思考/工具/步骤容器（独立于气泡，避免被答案覆盖）
  streamingText: '',        // 当前流式输出的完整文本
  streamingThink: null,     // 当前流式输出的思考元素
  streamingThinkText: '',   // 当前流式输出的思考文本
  streamingHead: null,      // 当前流式输出的答案头部元素
  currentProjectRoot: null, // 当前对话绑定的项目目录（绝对路径）
  serverDefaultRoot: null,  // 服务端默认沙箱根（兜底显示）
  defaultModel: null,       // 后端默认模型
  numCtx: null,             // 后端配置的活跃推理窗口（NUM_CTX，如 8192）
  gitBranch: '',            // 当前沙箱目录的 git 分支（无则为空）
  sessionStats: {           // 会话状态栏统计
    startTs: null,          // 会话起始时间（毫秒）
    toolCounts: {},         // { 工具名: 次数 }
    msgCount: 0,            // 消息数
    ttftSum: 0,             // TTFT 累计毫秒
    ttftCount: 0,           // TTFT 样本数
    totalTimeSum: 0,        // 总耗时累计毫秒
    contextTokens: 0,       // 最近一次 prompt_eval_count（上下文用量）
    contextLimit: 0,        // 活跃上下文上限（优先用 numCtx，未知时回退模型原生上限）
    modelContextMax: 0,     // 模型原生 context window 上限（如 32768），仅作副标题/tooltip
  },
  bootDone: false,          // 启动序列完成
  conversationCleared: false, // 标记用户已点击「清除上下文」
  contextClearedAt: null,     // 上下文清除时间戳（用于持久化提示）
  excludedMids: new Set(),   // 被「移出上下文」的单个消息 mid 集合（持久排除，直到再次点击）
  compactDivider: null,      // 压缩分隔线在对话中的插入位置（DOM 消息序号），null 表示未压缩
  clearedDivider: null,      // 清除分隔线（/clear）的插入位置（DOM 消息序号），null 表示未清除
  history: [],               // 结构化对话历史（用户/助手轮次），作为发后端上下文的权威来源，
                             // 不再依赖从 DOM .msg 节点文本收集（消除渲染结构耦合，U3）
  activeModel: null,         // 当前下拉选中的模型（来自 Ollama 已安装列表）
  currentStreamModel: null,  // 当前流式会话实际使用的模型（来自 meta 事件）
  installedModels: [],       // Ollama 已安装模型列表（来自 preflight）
  tools: [],                // 后端工具规格（来自 meta 事件，用于 /skills）
  quickCommands: null,       // Toolbox 命令列表（来自 /api/quick/commands，缓存）
};
