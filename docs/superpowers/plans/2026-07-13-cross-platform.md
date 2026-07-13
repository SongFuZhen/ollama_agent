# P0 跨平台兼容（Windows / macOS / Linux）

> 前置：所有其他功能块（memory / 工作流 / 上下文 / 工具）的前提。
> 硬约束：零原生编译依赖；完全离线；三端可跑。

## 问题清单（按阻断度）

### 阻断性（Windows 完全跑不起来）
1. **`src/tools/bash.js` 无 `shell:true` + 假设 Unix 命令**
   - 现状 `execSync(command, { cwd, timeout })` 在 Windows 上 Node 用 `cmd.exe /d /s /c` 执行，但 `command` 可能含 Unix 管道/`&&`/`>` 且白名单含 `cat/ls/grep/tree` 等 Windows 默认没有的命令 → 全失败。
   - 修复（已与用户确认「按平台选 shell」）：
     - 新增 `src/tools/shell.js`：`detectShell()` 返回 `{ shell, flag, isWin }`（`process.platform==='win32'` → `['cmd.exe','/d','/c']` 或 PowerShell；否则 `['/bin/sh','-c']`）。
     - `bash.js` 改用 `execSync(command, { shell:true, ... })`（让 Node 自己选平台 shell），并：
       - 白名单 `SAFE_READONLY` 在 Windows 上映射到等价内置或拒绝（`ls`→拒绝建议用 `list_dir` 工具；`cat`→`read_file` 工具；`grep`→`grep` 工具）；
       - 危险正则已大小写不敏感，Windows 路径 `C:\` 与 `\` 分隔需在 `DESTRUCTIVE_PATTERNS` 增加 `rm -rf C:\` / `del /s` / `format C:` 等。
2. **`src/skills/analyze/explain_symbol.js` 与 `find_references.js` 直接 `execSync('grep -rEn ...')`**
   - Windows 无 `grep` 二进制 → 整技能失效。
   - 修复：改为复用项目自带纯 JS 的 `src/tools/grep.js` 的递归逻辑（抽出一个 `grepFiles(root, pattern, opts)` 纯函数供两者共用），不再 spawn 外部进程。
3. **`start.sh` 是 bash 脚本**
   - Windows 无 bash。修复：提供 `start.ps1`（PowerShell）与 `start.bat`，或统一改用 `npm start`（`package.json` 的 `"start":"node src/server.js"` 已存在）。README 注明三端统一入口是 `npm start`。

### 重要
4. **`src/server.js` 热重载 `fs.watch(watchDir,{recursive:true})` 在 Linux 不被支持**
   - `recursive:true` 仅 macOS/Windows 支持，Linux 上被忽略（只监听顶层，深层 public 改动不刷新）。
   - 修复：封装 `src/server.js` 内的 `startHotwatch()`——递归 `fs.watch` 每个子目录（Linux 兜底），或引入纯 JS 的 `chokidar`（需确认纯 JS 无原生；若不想加依赖，手写递归 watch）。优先手写递归 watch，保持零依赖。
5. **`src/storage/db.js` 的 `fs.renameSync` 在 Windows 上可能 `EBUSY`**
   - 若 `conversations.db` 被防病毒/其他进程打开，rename 覆盖失败。
   - 修复：`flushSync()` 里 `try{ renameSync } catch { unlinkSync(DB_PATH); renameSync(tmp, DB_PATH) }`；`flush()` 异步版同理用 `fs.promises` 的 try/catch 回退。

### 次要（路径分隔符）
6. **`src/tools/glob.js` 正则硬编码 `/`**
   - `replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]')` 在 Windows 上 `path.relative` 返回 `\` 分隔，导致 `src\*.js` 不匹配。
   - 修复：用 `path.sep` 转义（`replace(/\*/g, '[^' + esc(path.sep) + ']*')`）；`grep.js` 的展示路径同理（仅展示问题，可顺手改）。
7. 其他文件读写/沙箱（`safeResolve`、`rootstore.js`）已普遍用 `path`，良好，无需改。

## 改动文件清单
- 新增 `src/tools/shell.js` —— 平台 shell 探测。
- 改 `src/tools/bash.js` —— `shell:true` + 平台命令映射 + Windows 危险模式。
- 改 `src/skills/analyze/explain_symbol.js`、`find_references.js` —— 复用纯 JS grep。
- 新增 `start.ps1`、`start.bat`；README 改为 `npm start` 为主入口。
- 改 `src/server.js` 的 `startHotwatch()` —— 跨平台递归 watch。
- 改 `src/storage/db.js` 的 `flush/flushSync` —— Windows rename 回退。
- 改 `src/tools/glob.js` —— `path.sep` 分隔符。

## 验证
- **三端各跑一次**：`npm start` 起服务、`curl /api/preflight`（Ollama 不可达应优雅返回）、`/api/fs/list`、`/api/conversations` 正常。
- Windows 上实测 `bash` 工具执行 `echo`/`dir` 等价命令、git skills、`explain_symbol` 不报 "grep not found"。
- Linux 上改 `public/` 深层文件触发热重载。

## 实现状态（2026-07-13 已完成）
- ✅ 新增 `src/tools/shell.js`（`detectShell` / `adaptReadonlyCommand`）。
- ✅ `bash.js` 改用 `shell:true`；Windows 上 `ls→dir`/`cat→type`/`pwd→cd` 等价替换，无安全等价的 `grep/awk/sed/tree` 等拒绝并建议用内置工具；新增 `del /s`、`rd /s`、`format C:`、`cipher /w`、`> C:\` 等 Windows 破坏性模式。
- ✅ `grep.js` 抽出可复用纯函数 `grepFiles(root, pattern, opts)`（返回 `{file,line,text}`），`explain_symbol`/`find_references` 改用之，不再 spawn 外部 grep。
- ✅ 新增 `start.ps1` / `start.bat`（已存在），README 主入口统一为 `npm start`。
- ✅ `server.js` 的 `startHotwatch` 改为跨平台：递归 `fs.watch` 每个子目录（Linux 兜底），macOS/Windows 仍走 `recursive:true`。
- ✅ `db.js` 的 `flush`/`flushSync` 加 Windows `EBUSY` 重命名回退（先 unlink 再 rename，仍失败则直写）。
- ✅ `glob.js` 已用 `path.sep`，无需改动。
- ✅ 验证：63 单元测试全绿；`npm start` 起服务、`/api/preflight`、`/api/fs/list`、`/api/conversations` 均正常。
