---
name: git_status
description: 查看仓库工作区状态：哪些文件被修改/新增/删除，以及当前分支
type: skill
kind: skill
needConfirm: false
---

# git_status

查看仓库工作区状态：哪些文件被修改/新增/删除，以及当前分支。

## 用途

快速了解当前 git 工作区的整体改动概况，等价于 `git status --short --branch`。

## 参数

无参数。

## 执行逻辑

由 `src/skills/git/git_status/git_status.js` 实现，在沙箱根目录执行 `git status --short --branch`，返回简短状态与当前分支名。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
