---
name: git_show
description: 查看某次提交或某版本文件内容。ref 可为提交哈希、分支名、标签，或 "哈希:文件路径"
type: skill
kind: skill
needConfirm: false
---

# git_show

查看某次提交或某版本文件内容。`ref` 可为提交哈希、分支名、标签，或形如 `哈希:文件路径` 指定某次提交里的某个文件。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `ref` | 是 | 提交引用：如 `HEAD`、`abc123`、`HEAD~1`，或 `abc123:src/app.js` |

## 执行逻辑

由 `src/skills/git/git_show/git_show.js` 实现，在沙箱根目录执行 `git show <ref>`，`ref` 为空时返回错误，结果经 `utils.truncate` 截断后返回。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
