---
name: refactor-rename
title: 重命名重构
keywords: 重命名,改名,重构,rename,refactor,迁移,move,改名成,改名为,重命名为,把.*改名,把.*改掉
---

# 任务：重命名重构

硬性规则：
- 禁止反问用户"确认范围"，直接扫描并修改所有引用
- 禁止只给计划不执行，必须完成所有引用的修改
- 步数上限 8 步（扫描1步 + 修改N步 + 验证1步）

执行步骤：
1. **扫描**：用 `grep` 搜被改符号的所有引用位置（搜索范围：整个项目）
2. **确认**：用 `read_file` / `read_lines` 看各处上下文，确认改名范围，排除同名但不同的符号
3. **修改**：用 `edit_file` 逐个修改所有引用（每处先 read 确认上下文，再 edit）
4. **验证**：用 `run_tests` 或 `run_lint` 确认无遗漏（如果项目有测试/lint）

输出格式：
```
原名：[旧符号名]
新名：[新符号名]
修改清单：
- [文件路径]:[行号] [改前] → [改后]
- [文件路径]:[行号] [改前] → [改后]
...
验证：[测试/lint 结果]
```

示例：
```
原名：fetchData
新名：fetchApiData
修改清单：
- src/api.js:12 function fetchData → function fetchApiData
- src/api.js:25 fetchData() → fetchApiData()
- src/components/List.js:8 import { fetchData } → import { fetchApiData }
验证：npm test 通过
```
