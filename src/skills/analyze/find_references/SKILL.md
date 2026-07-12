---
name: find_references
description: 查找某个符号的所有使用位置（引用），帮助评估改动影响范围
type: skill
kind: skill
needConfirm: false
---

# find_references

查找某个符号的所有使用位置（引用），帮助评估改动该符号的影响范围。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `symbol` | 是 | 要查找引用的符号名 |
| `path` | 否 | 限定搜索的目录或文件，缩小范围 |

## 执行逻辑

由 `src/skills/analyze/find_references/find_references.js` 实现，使用 `grep -rEn '<symbol>'` 在沙箱根目录递归搜索所有引用位置，`symbol` 为空时返回错误，结果经 `utils.truncate` 截断后返回。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
