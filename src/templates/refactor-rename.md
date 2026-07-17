---
name: refactor-rename
title: 重命名重构
keywords: 重命名,改名,重构,rename,refactor,迁移,move
---

# 任务路径：重命名重构（建议，非强制）

1. 扫描：用 `grep` 搜被改符号的所有引用位置
2. 确认：用 `read_file` / `read_lines` 看各处上下文，确认改名范围
3. 修改：用 `edit_file`（或 `apply_diff`）批量替换所有引用，一次改一个符号
4. 验证：用 `run_tests` + `run_lint` 确认无遗漏引用

每步检查点：
- 扫描步：已拿到全部引用文件清单
- 确认步：无歧义同名符号被误伤
- 修改步：所有引用已同步更新
- 验证步：测试/ lint 全绿
