---
name: git_log
description: 查看提交历史。max 控制条数（默认 20），path 只看某文件的提交
type: skill
kind: skill
needConfirm: false
---

# git_log

查看提交历史。`max` 控制返回条数（默认 20，上限 100）；`path` 只看某文件的提交历史。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `max` | 否 | 返回最近多少条提交，默认 20 |
| `path` | 否 | 相对仓库根的文件路径，只看该文件的提交历史 |

## 执行逻辑

由 `src/skills/git/git_log/git_log.js` 实现，在沙箱根目录执行 `git log -n <max> --pretty=format:%h %ad %an %s --date=short [-- path]`，结果经 `utils.truncate` 截断后返回。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
