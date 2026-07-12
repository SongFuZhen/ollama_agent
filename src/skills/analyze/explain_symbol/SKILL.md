---
name: explain_symbol
description: 解释某个函数/类/变量：在项目中查找其定义位置并附带上下文，帮助理解签名与用途
type: skill
kind: skill
needConfirm: false
---

# explain_symbol

解释某个函数/类/变量：在项目中递归查找其定义位置（含上下文行），帮助理解签名与用途。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `symbol` | 是 | 要解释的符号名（函数名、类名、变量名） |
| `path` | 否 | 限定搜索的目录或文件，缩小范围 |

## 执行逻辑

由 `src/skills/analyze/explain_symbol/explain_symbol.js` 实现，使用 `grep -rEn -C 3 '<symbol>\s*[=(:]'` 在沙箱根目录递归搜索定义处并附前后 3 行上下文，`symbol` 为空时返回错误，结果经 `utils.truncate` 截断后返回。

> 说明：本目录 `src/skills/` 下的「技能」是可执行的 JS 函数模块（被 Agent 运行时调用），
> 而非 opencode 的 SKILL.md 指令文档。此 `SKILL.md` 仅作为该技能的人类可读说明。
