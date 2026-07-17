---
name: fix-bug
title: 修复 Bug
keywords: 修复,修,fix,bug,报错,错误,异常,失败,报错,问题,crash,panic
---

# 任务路径：修复 Bug（建议，非强制）

1. 定位：用 `grep` 搜报错关键词，或 `read_file` 打开报错指向的文件
2. 确认：用 `read_lines` 看出错行附近上下文，明确根因（不要凭猜）
3. 修改：用 `edit_file` 做最小改动（一次只改一处，改前先 read 过该文件）
4. 验证：用 `run_tests` + `run_lint` 确认通过

每步检查点：
- 定位步：已拿到出错文件与行号
- 确认步：能说清"为什么错"
- 修改步：改动已落盘且符合原风格
- 验证步：测试/ lint 全绿
