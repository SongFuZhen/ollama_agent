---
name: git_diff
description: 查看代码差异。默认未暂存改动；staged=true 看已暂存；path 指定只看某文件
type: skill
kind: skill
needConfirm: false
---

# git_diff

查看代码差异。默认显示未暂存的改动；`staged=true` 查看已暂存（git add 后）的差异；`path` 限定只看某文件。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 否 | 相对仓库根的文件路径，只看该文件差异 |
| `staged` | 否 | `true` 表示查看已暂存（git add 后）的差异 |

## 执行逻辑

由 `src/skills/git/git_diff/git_diff.js` 实现，在沙箱根目录执行 `git diff [--cached] [-- path]`，结果经 `utils.truncate` 截断后返回。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
