---
name: fix-bug
title: 修复 Bug
keywords: 修复,修,fix,bug,报错,错误,异常,失败,报错,问题,crash,panic,报错了,出错了,不工作,不能用,失败了,出问题
---

# 任务：修复 Bug

硬性规则：
- 禁止反问用户"更多信息"，直接根据已有信息执行
- 禁止只给计划不执行，必须完成修改并验证
- 步数上限 6 步，3 步后必须输出结果

执行步骤：
1. **定位**：用 `grep` 搜报错关键词，或用 `read_file` 打开报错指向的文件
2. **确认**：用 `read_lines` 看出错行附近上下文，明确根因（不要凭猜）
3. **修改**：用 `edit_file` 做最小改动（一次只改一处，改前先 read 过该文件）
4. **验证**：用 `run_tests` 或 `run_lint` 确认通过（如果项目有测试/lint）

输出格式：
```
问题：[一句话描述 bug 表现]
原因：[根因分析，要具体到哪行代码为什么错]
改动：
- [文件路径]:[行号] [改了什么]
验证：[测试/lint 结果，或"项目无测试/lint，已人工确认"]
```

示例：
```
问题：read_file 工具读取中文路径时返回 404
原因：src/tools/read_file.js:15 未对路径做 decodeURIComponent，中文文件名被 URL 编码后无法匹配
改动：
- src/tools/read_file.js:15 添加 decodeURIComponent(p) 解码路径
验证：npm run lint 通过
```
