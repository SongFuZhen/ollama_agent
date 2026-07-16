# Skills 与 Tools 使用指南

本指南讲清 Ason Agent 里几套看似相似、实则不同的「技能 / 工具 / 命令」机制，以及 `@命令` 与 `!命令` 两种强制直接调用语法。

---

## 一、三套机制对比

本项目里 "skill" 一词出现在三个互不相通的地方，不要把它们混为一谈：

| 机制 | 位置 | 本质 | 如何触发 | 是否进 Agent 执行循环 |
|------|------|------|----------|----------------------|
| **可执行 skill** | `src/skills/`（git / analyze） | 真正的 JS 函数模块 | `@skillName` 强制调用，或模型在循环中自主调用 | 是 |
| **指令型 skill** | `.agents/skills/`（symlink → `.claude/skills/`） | 纯 Markdown 提示词（frontend-design / ui-ux-pro-max） | 模型读取 `description` 后**自动匹配**任务意图，无显式触发符 | 否（仅作为系统提示注入） |
| **前端 slash 命令** | `public/frontend/js/modules/commands.js` | 输入框 UI 快捷键 | 输入 `/命令名` 唤起弹窗 / 动作 | 否（纯前端交互） |

### 关键澄清
- **`@` 不是引用符号，而是调用触发器**。输入 `@git_status`、`@read_file ...` 等会**绕过模型、直接执行**对应工具/技能并把真实结果喂给模型作答（`/plan` 的优先级低于 `@`：带 `@` 时走强制调用）。`@` 可调用全部已注册工具与技能。
- **指令型 skill 没有 `@` 通道**。它们靠模型识别任务类型自动启用（例如"做个有设计感的页面"会触发 frontend-design）。想强制走设计 skill，用自然语言描述设计意图即可。
- **slash 命令不执行任何 skill**。`/skills` 只是弹出"可用技能列表"，`/tools` 同理，它们用于查看而非调用。

---

## 二、`@<命令>` 强制调用语法

格式：

```
@<工具或技能名> [参数...]
```

`@` 可调用**任意已注册的工具或技能**（`src/skills/` 的 6 个 skill + `src/tools/` 的全部工具），**直接运行、不经过模型推理**，结果作为首轮上下文注入，模型据此作答。

- **参数写法**：`key=value` 形式（如 `path=src/x.js`、`max=5`）；位置参数会自动填入该命令的主参数（如 `@read_file src/x.js` 等价于 `@read_file path=src/x.js`）。
- **写操作确认**：写类命令（`write_file` / `edit_file` / `apply_diff` / `bash` 等）执行前会弹一次二次确认，被拒绝则不执行——与模型自主调用路径一致。
- **未知命令**：`@` 后不是已知工具/技能时，回退为普通对话并提示可用命令列表。

### 可用命令（节选常用）

**技能（src/skills）**

| 命令 | 参数写法 | 说明 |
|------|----------|------|
| `git_status` | 无参 | 查看工作区状态 |
| `git_diff` | `[path=文件] [staged]` | 查看差异 |
| `git_log` | `[max=N] [path=文件]` | 查看提交历史 |
| `git_show` | `<ref>`（必填） | 查看某次提交/版本文件 |
| `explain_symbol` | `<symbol> [path=目录/文件]` | 解释符号定义 |
| `find_references` | `<symbol> [path=目录/文件]` | 查找符号引用 |

**工具（src/tools，可用 `@` 直接调）**

| 命令 | 参数写法 | 说明 |
|------|----------|------|
| `read_file` | `<path>` | 读取文件内容 |
| `read_lines` | `<path> [start=] [end=]` | 读取文件指定行范围 |
| `list_dir` | `[path=目录]` | 列出目录内容（树状） |
| `tree` | `[path=] [depth=]` | 树状展示目录层级 |
| `glob` | `<pattern>` | 按 glob 模式找文件 |
| `search_files` | `<pattern>` | 按文件名关键字递归搜索 |
| `grep` | `<pattern> [path=]` | 搜索文件内容（支持正则） |
| `semantic_grep` | `<query> [path=]` | 模糊语义检索 |
| `count_loc` | `[path=]` | 统计代码行数/文件数 |
| `repo_map` | `[path=] [max=]` | 仓库重要源文件速览 |
| `run_tests` | `[command=]` | 运行测试（需确认） |
| `run_lint` | `[command=]` | 运行 lint（需确认） |
| `write_file` | `<path> <content>` | 写入文件（需确认） |
| `edit_file` | `<path> <old_string> <new_string>` | 局部替换（需确认） |
| `apply_diff` | `<diff>` | 应用 diff 补丁（需确认） |
| `notes` / `todos` | `action=...` | 笔记 / 任务清单管理 |

> 完整列表可在前端输入 `/skills`、`/tools` 查看，或见 `src/tools/index.js` 与 `src/skills/index.js`。

### 示例

```
@git_status
```
→ 直接返回当前 git 工作区状态。

```
@git_log max=5
```
→ 返回最近 5 条提交。

```
@git_diff path=src/core/agent.js
```
→ 只显示 `src/core/agent.js` 的未暂存改动。

```
@explain_symbol runAgent
```
→ 直接在项目里定位 `runAgent` 的定义并解释。

```
@read_file src/core/workflow.js
```
→ 直接读取该文件内容（位置参数 `src/core/workflow.js` 自动填入 `path`）。

```
@grep pattern=resolveDirectCall path=src/core
```
→ 直接在 `src/core` 下搜索 `resolveDirectCall`。

```
@write_file path=/tmp/note.txt content=hello
```
→ 弹出二次确认后写入（被拒绝则不写）。

```
@git_show HEAD~1
```
→ 显示上一次提交的详情。

```
@tree path=src/core
```
→ 树状展示 `src/core` 目录层级（默认完整展开，可加 `depth=2` 限深）。

```
@list_dir path=src
```
→ 列出 `src` 目录下的文件与子目录。

```
@glob pattern=src/**/*.js
```
→ 按 glob 模式列出所有 JS 文件。

```
@search_files pattern=workflow
```
→ 按文件名关键字递归搜索含 `workflow` 的文件。

```
@grep pattern=resolveDirectCall path=src/core
```
→ 在 `src/core` 下搜索 `resolveDirectCall` 的所有出现（支持正则）。

```
@read_lines path=src/core/agent.js start=1 end=50
```
→ 只读 `agent.js` 前 50 行（大文件省上下文）。

```
@count_loc path=src
```
→ 统计 `src` 下各语言代码行数/文件数。

```
@explain_symbol runAgent
```
→ 直接在项目里定位 `runAgent` 的定义并解释。

```
@find_references buildSkillParams
```
→ 查找 `buildSkillParams` 的所有引用位置，评估改动影响。

```
@git_status 顺便用中文总结一下哪些文件需要提交
```
→ `@git_status` 先强制执行，后面的自然语言作为附加指令，模型基于真实结果作答。

```
@unknown_cmd foo
```
→ `@` 后不是已知命令时，回退为普通对话并提示完整可用命令列表。

---

## 三、`!命令` 直接执行 shell

格式：

```
!<shell 命令>
```

以 `!` 开头的输入会**直接调用 `bash` 工具执行 shell 命令**，绕过模型推理，结果作为首轮上下文注入。调用沿用 `bash` 工具的确认流程（其 `needConfirm` 为 true，因此执行前会弹一次二次确认，包括只读命令——这与普通对话中模型调用 bash 的行为一致）。危险命令（如 `rm -rf /`）仍会被 `bash` 的安全策略直接拦截。

> 优先级：`!` > `@` > `/plan`。输入以哪个前缀开头就用哪个，互不共存。

### 示例

```
!ls -la src/core
```
→ 直接列出 `src/core` 目录内容。

```
!git log --oneline -3
```
→ 直接执行 git 命令并返回最近 3 条提交。

```
!npm test
```
→ 直接运行测试（写操作会弹确认）。

---

## 四、前端 slash 命令

在输入框键入 `/` 唤起命令面板，可用命令（按功能分组排列）：

**查看类**
| 命令 | 作用 |
|------|------|
| `/skills` | 弹出可用技能列表（来自 `specsFor()`，标注 kind=skill） |
| `/tools` | 弹出可用工具列表 |
| `/help` | 显示所有命令 |

**切换类**
| 命令 | 作用 |
|------|------|
| `/models` | 弹出模型选择，实时切换当前模型 |

**上下文操作类**
| 命令 | 作用 |
|------|------|
| `/clear` | 清空当前对话上下文（已显示消息保留，历史不再作为上下文） |
| `/compress` | 把中间旧历史摘要化，降低后续 token 占用 |
| `/recall` | 打开语义召回面板，从跨会话记忆中检索相关片段 |

**模式类**
| 命令 | 作用 |
|------|------|
| `/plan` | 前缀语法：把后续内容作为规划任务，进入只读调研模式，最终返回可确认的执行计划 |

> `commands.js` 中的命令均为前端交互；真正进入 Agent 执行循环的只有 `/plan`（在 `src/core/workflow.js` 解析）。

---

## 五、项目结构相关说明

### `skills-lock.json`
锁定两个**指令型 skill**（frontend-design、ui-ux-pro-max）的 GitHub 来源与内容 SHA-256 哈希，用于版本/完整性校验。当前仓库没有对应的 installer/sync 工具消费它，仅作为锁版本清单保留。

### `.claude/skills` 是镜像
`.claude/skills/frontend-design` 与 `.claude/skills/ui-ux-pro-max` 是指向 `.agents/skills/` 的**符号链接**。单一事实源是 `.agents/skills/`——修改 skill 提示词请改 `.agents/skills/` 下的 `SKILL.md`。

### `.superpowers/sdd` 悬空引用提醒
`docs/superpowers/plans/*` 里引用了 `superpowers:subagent-driven-development`、`superpowers:executing-plans` 等子技能，但本仓库**并未安装** superpowers 技能集，这些引用当前无法解析，仅作规划文档留存。

---

## 六、给开发者的实现要点

- 可执行 skill 在 `src/skills/index.js` 注册，经 `src/tools/index.js` 合并进 `ALL` 工具集（导出 `SKILL_TOOLS` 仅含 skill 子集）。
- `@` / `!` 解析逻辑在 `src/core/workflow.js` 的 `resolveDirectCall()`（匹配范围 = `specsFor()` 全部工具/技能，`!` 单独走 bash）；强制 dispatch 在 `src/core/agent.js` 的 `runAgent()` 入口。
- 新增一个可执行 skill：在 `src/skills/<分类>/` 下按现有结构加 `SKILL.md` + `<name>.js`（导出 `{name, desc, params, run}`），并在 `src/skills/index.js` 注册即可，无需改 agent 主循环。新工具/技能只要进入 `specsFor()`，就能立刻用 `@` 直接调用。
