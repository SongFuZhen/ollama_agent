# 新手使用教程

本教程面向第一次使用 Ason Agent 的同学，按「装好 → 跑起来 → 开口对话 → 进阶玩法」的顺序，带你从零用起来。全文以**中文界面**为基础。

> 一句话定位：这是一个跑在你自己电脑上的本地 AI 助手。模型在本地用 Ollama 推理，工具只能读写一个项目目录，所有回答都基于工具拿到的真实数据——所以它不会凭空编答案。

---

## 第 0 步：你需要准备什么

| 东西 | 说明 |
|------|------|
| **Node.js 16+** | 运行后端服务。命令行输入 `node -v` 能看到版本即可。 |
| **Ollama** | 本地模型运行器。到 [ollama.com](https://ollama.com) 下载安装，装好后命令行能跑 `ollama` 命令。 |
| **至少一个模型** | 默认用 `qwen2.5-coder:7b`（编码首选）。记忆召回还需 embedding 模型 `nomic-embed-text`。 |
| **本仓库代码** | 已经克隆/解压到本地即可。 |

> 内网断网环境？见文末「离线部署」一节，可打包成 U 盘直拷的离线包。

---

## 第 1 步：拉模型

打开终端，把需要的模型拉到本地（只需第一次）：

```bash
# 编码主模型（必装，默认就会用它）
ollama pull qwen2.5-coder:7b

# 记忆召回（语义）用的 embedding 模型（想要 /recall 跨会话记忆就装）
ollama pull nomic-embed-text
```

> 想用其他模型也行，比如 `deepseek-r1:8b`、`llama3.1:8b`。拉好后可在设置页随时切换。

确认 Ollama 在后台运行：`ollama list` 能看到刚拉好的模型即说明服务正常。

---

## 第 2 步：启动服务

回到本仓库目录，三选一启动（效果完全一样）：

```bash
# 方式 A：npm（推荐，三端通用）
npm start
# 等价于： node src/server.js

# 方式 B：脚本
./start.sh            # macOS / Linux
start.bat             # Windows（双击或 cmd 里运行）
start.ps1             # Windows（PowerShell）

# 方式 C：直接跑
node src/server.js
```

看到终端打印类似下面内容就成功了：

```
项目根目录: /xxx/ollama_agent/workspace
Ollama 地址: http://localhost:11434
启动中... 浏览器打开 http://localhost:3000
```

然后**用浏览器打开** http://localhost:3000

> 首次启动会建好 `workspace/`（沙箱目录）、`data/`（数据库/日志/指标）。默认端口是 `3000`，被占用可在启动前设置 `PORT=8080 npm start`。

---

## 第 3 步：做两件基础设置

打开页面后，先点右上角菜单进入**设置页**，确认两件事：

1. **Ollama 地址**：默认 `http://localhost:11434`。如果 Ollama 在别的机器上，改成它的地址（如 `http://192.168.1.100:11434`）。
2. **项目目录（PROJECT_ROOT）**：工具只能读写这个目录。默认是仓库里的 `./workspace`。要让 Agent 帮你改你自己的项目，把它改成你项目的**绝对路径**（如 `/Users/你/我的项目`）。

> 不想在界面设，也可以在启动前用环境变量固定：
> ```bash
> export PROJECT_ROOT=/Users/你/我的项目
> export OLLAMA_HOST=http://localhost:11434
> npm start
> ```

设置好之后，就可以在底部输入框聊天了。

---

## 第 4 步：第一次对话

直接在输入框用**大白话**说明你要做什么，Agent 会先调工具读真数据，再回答。例如：

- "帮我看一下 workspace 目录下有哪些文件"
- "读一下 src/core/agent.js，用一句话解释它在干什么"
- "在 workspace 里新建一个 hello.txt，内容是你好"

对于**写操作**（新建/修改文件、跑命令等），Agent 会弹出**二次确认**，你点「允许」才执行——这是安全机制，放心确认。

### 切换模型

对话中途也能换模型：点状态栏的模型下拉，或在输入框输入 `/models` 选择。编码用 `qwen2.5-coder:7b`，复杂推理可切 `deepseek-r1:8b`。

---

## 第 5 步：三套命令语法（@ / ! / /）

除了自然语言，还有三套前缀/斜杠语法，适合"我不想等模型猜，直接干活"的场景。

### `@命令` —— 强制直接调用（绕过模型推理）

输入 `@工具名` 或 `@技能名`，直接执行并把结果喂给模型作答。支持 `key=value` 参数，也支持位置参数。

```
@git_status                              # 直接看 git 工作区状态
@git_log max=5                           # 最近 5 条提交
@read_file src/core/agent.js             # 读一个文件（等价于 path=...）
@grep pattern=foo path=src              # 在 src 里搜 foo
@write_file path=workspace/n.txt content=hi   # 写文件（会二次确认）
```

> 输入框打 `@` 会弹出工具/技能选择面板，免记忆。写操作同样要二次确认。

### `!命令` —— 直接执行 shell

以 `!` 开头，整行作为 shell 命令直接跑（沿用 bash 的确认流程，危险命令会被拦截）：

```
!ls -la src/core
!git log --oneline -3
!npm test
```

### `/命令` —— 前端 slash 命令

输入 `/` 唤起命令面板。常用：

| 命令 | 作用 |
|------|------|
| `/skills` `/tools` | 查看可用技能 / 工具列表 |
| `/models` | 切换模型 |
| `/compress` | 对话太长了压缩历史，省 token |
| `/recall` | 语义召回以前会话的记忆 |
| `/plan` | 只读规划模式：先只调研、输出计划等你确认，再动手改 |
| `/template` | 套用任务模板（把高频任务的步骤固化下来） |
| `/metrics` | 查看运行指标（步数、重复调用、压缩次数等） |
| `/clear` | 清空当前对话 |
| `/help` | 显示所有命令 |

> 优先级：`!` > `@` > `/plan`。

---

## 第 6 步：Toolbox 工具箱（单轮命令）

有一组**固定 prompt、单轮执行、不经过多步 Agent 循环**的命令，弱模型也能稳定产出，带「工具箱」标签动态出现在 `/` 菜单里：

| 命令 | 作用 |
|------|------|
| `/explain <path>` | 解释某个文件的代码 |
| `/review <path>` | 代码审查，列出潜在问题 |
| `/comment <path>` | 给代码加中文注释（写操作，产出可应用文件） |
| `/fix <path> <报错>` | 根据报错尝试修复代码（写操作） |
| `/test <path> [函数名]` | 为代码生成单元测试 |
| `/commit` | 根据改动生成 commit message |
| `/error <报错文本>` | 解读一段报错 |
| `/regex <需求>` | 按需求写正则表达式 |

示例：`/explain src/core/agent.js` 会单轮返回这份文件的讲解，比让 Agent 多步推理更快更稳。

---

## 第 7 步：规划模式（改代码前先看计划）

要做较大改动时，先用 `/plan`：

1. 输入 `/plan 把登录接口的超时改成 5 秒`；
2. Agent 进入**只读**调研，只查不改，最后给你一份执行计划；
3. 你确认后，它才按计划动手；每一步写操作仍要你二次确认。

好处：先对齐思路，避免模型一上来就乱改。

---

## 第 8 步：验证闭环

Agent 做完写操作后，会**自动跑测试 / lint** 验证效果（取决于项目配置）。如果验证失败，默认开启的**自愈（SELF_HEAL）**会尝试自动修几下。你也可以在状态栏看到「上下文用量」「当前模型」「git 分支」等信息。

---

## 常见问题（FAQ）

**Q：页面打不开 / 一直转圈？**
- 确认终端服务已启动，且浏览器地址是 `http://localhost:3000`（端口被占用就改 `PORT`）。
- 确认 Ollama 在运行：`ollama list` 能列出模型。

**Q：Agent 说"没有可用模型"？**
- 设置页的 Ollama 地址填对了吗？本机就是 `http://localhost:11434`。
- 模型真的拉下来了吗？`ollama pull qwen2.5-coder:7b`。

**Q：Agent 改错了文件 / 改到了别的地方？**
- 工具被限制在 `PROJECT_ROOT` 单目录内，越界会自动拦截。确认设置页里的项目目录是你期望的路径。
- 所有写操作都有二次确认，不确定就点「拒绝」。

**Q：想让 Agent 改我自己的项目，而不是 workspace？**
- 设置页把「项目目录」改成你项目的绝对路径，或在启动前 `export PROJECT_ROOT=...`。

**Q：对话变慢 / 答非所问？**
- 长对话输入 `/compress` 压缩历史；或 `/clear` 开新对话。
- 编码任务确保模型是 `qwen2.5-coder:7b` 这类编码模型。

---

## 离线部署（内网断网环境）

仓库已内置打包脚本，可把「源码 + Ollama 二进制 + 已拉取模型 + 安装脚本」打成离线包，U 盘拷到目标机直接跑，无需联网安装：

```bash
# 在能联网的机器上，先拉好要打包的编码模型
ollama pull qwen2.5-coder:7b

# 构建离线包（输出 dist/ollama_agent-offline.tar.gz）
bash scripts/build-offline-pack.sh

# 把 tar.gz 拷到内网机，解压后：
cd ollama_agent-offline
# 把对应平台的 ollama 二进制放进 bin/，然后：
./install.sh
MODEL=qwen2.5-coder:7b node src/server.js
```

> 运行时依赖除随仓库 vendored 的 `sql.js` 外均为 Node 内置模块，离线即用。

---

## 下一步

- 想深入了解三套命令机制与 `@`/`!` 完整参数：见 [docs/skills-and-tools.md](skills-and-tools.md)
- 想看 Agent 引擎怎么工作：见 [docs/agent-design.md](../docs/agent-design.md)
- 项目总览与配置项：见 [README.md](../README.md)
