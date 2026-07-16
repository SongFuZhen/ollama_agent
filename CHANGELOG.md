# Changelog

本文件记录本仓库各版本的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [未发布] - 2026-07-16

### Added
- **`@命令` 强制直接调用**：输入框使用 `@<工具或技能名> [参数]` 可绕过模型推理，直接执行任意已注册工具/技能（`src/skills/` 的 6 个 skill + `src/tools/` 的全部工具），结果注入上下文供模型作答。
  - 参数支持 `key=value` 与位置参数（位置参数自动填入命令主参数，如 `@read_file src/x.js`）。
  - 写操作（`write_file` / `edit_file` / `apply_diff` / `bash` 等）执行前弹二次确认，被拒则取消。
  - 未知命令回退为普通对话并提示可用列表。
- **`!命令` 直接执行 shell**：输入框以 `!` 开头直接调用 `bash` 工具执行 shell 命令，沿用其确认流程，危险命令被安全策略拦截。
- **前端 `@` 选择面板**：输入 `@` 弹出技能/工具混合选择面板（来自 `state.tools`），按名筛选，键盘/点击选中后补全为 `@命令名 `，方便续写参数。
- **前端 `!` BASH 模式**：输入 `!` 开头进入 bash 模式，输入框左侧 accent 色条高亮并显示「BASH 模式 · 回车直接执行」徽章。
- **复制按钮显示文字**：对话气泡与流式输出的复制按钮在图标后增加「复制」文字标签，点击成功后短暂变为「已复制」。
- **使用文档** `docs/skills-and-tools.md`：讲清三套机制（可执行 skill / 指令型 skill / 前端 slash 命令）对比、`@`/`!` 语法与示例、slash 命令列表、项目结构相关说明。
- **README 命令语法章节**：补充 `@` / `!` / `/` 三种用法与示例。

### Changed
- `resolveDirectCall` 匹配范围由仅 skill 扩大到 `specsFor()` 全部工具/技能；`buildSkillParams` 新增通用参数映射。
- 前端 `onInputKeydown` 改用 capture 阶段注册，面板可见时拦截 Enter/Tab，避免把未完成的 `@xxx` 误发送。
- 输入框 placeholder 更新为提示三种语法（`@` 调用工具、`!` 执行命令、`/` 查看命令）。

### Fixed
- 修正文档第六节点过时描述（`resolveSkillCall` → `resolveDirectCall`，匹配范围更正为全部工具/技能）。
- 理顺文档章节编号（`!` 命令独立成第三章，修正原「二之二」怪异编号）。

### Tests
- `test/workflow.test.js` 新增 `resolveDirectCall` / `buildSkillParams` 单测与 `@write_file` 写操作 confirm 拦截的 agent 集成测试。
- 全量测试 124 项通过。

### Commits
- `326416b` feat: 新增 @skill 与 !命令 直接调用通道及使用文档
- `e0d794d` feat: 扩展 @ 直接调用至全部工具与技能
- `273c73e` docs: 更新命令使用示例并理顺文档章节
- `1234efb` docs: README 补充命令语法章节（@/!/slash）
- `79252ae` feat: 输入框 @ 选择面板与 ! bash 模式交互
- `25555c8` docs: 新增 CHANGELOG 记录本次 @/! 直接调用与前端交互改动
- `xxxxxxx` ui: 复制按钮图标后增加「复制」文字标签
