---
name: add-function
title: 新增函数
keywords: 新增,增加,加,实现,添加,add,implement,function,函数,方法,接口
---

# 任务路径：新增函数（建议，非强制）

1. 调研：用 `grep` / `read_file` 找同文件中风格相近的现有函数
2. 确认：用 `read_lines` 看调用约定与命名风格，确定入参/返回值
3. 实现：用 `edit_file` 把新函数加在合适位置（改前先 read 过该文件）
4. 验证：用 `run_tests` + `run_lint` 确认通过

每步检查点：
- 调研步：已知类似函数的实现方式
- 确认步：签名与风格已对齐现有代码
- 实现步：函数已落盘且可被调用
- 验证步：测试/ lint 全绿
