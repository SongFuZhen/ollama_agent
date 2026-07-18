# Beginner Usage Tutorial

This tutorial is for first-time Ason Agent users. It walks you from scratch to a working setup in order: *install → run → first chat → advanced usage*. The UI described below is the **English interface**.

> In one sentence: this is a local AI assistant that runs entirely on your own machine. Models infer locally via Ollama, tool calls are confined to a single project directory, and every answer is grounded in real data returned by tools — so it never makes things up.

---

## Step 0: What you need

| Thing | Notes |
|-------|-------|
| **Node.js 16+** | Runs the backend service. `node -v` in a terminal should print a version. |
| **Ollama** | Local model runner. Download from [ollama.com](https://ollama.com). After install, the `ollama` command works in your terminal. |
| **At least one model** | Default is `qwen2.5-coder:7b` (coding-first). Memory recall also needs the embedding model `nomic-embed-text`. |
| **This repo** | Already cloned/unzipped locally. |

> Air-gapped intranet? See the "Offline Deployment" section at the end — it can be packaged as a USB-ready offline bundle.

---

## Step 1: Pull models

Open a terminal and pull the models locally (only needed once):

```bash
# Coding main model (required; used by default)
ollama pull qwen2.5-coder:7b

# Embedding model for semantic memory recall (install if you want /recall across sessions)
ollama pull nomic-embed-text
```

> Other models work too, e.g. `deepseek-r1:8b`, `llama3.1:8b`. After pulling, you can switch anytime in settings.

Confirm Ollama is running in the background: `ollama list` should show the models you just pulled.

---

## Step 2: Start the service

From the repo directory, pick one of these (all equivalent):

```bash
# Option A: npm (recommended, all platforms)
npm start
# Equivalent to: node src/server.js

# Option B: scripts
./start.sh            # macOS / Linux
start.bat             # Windows (double-click or run in cmd)
start.ps1             # Windows (PowerShell)

# Option C: run directly
node src/server.js
```

You'll see output like this when it works:

```
项目根目录: /xxx/ollama_agent/workspace
Ollama 地址: http://localhost:11434
启动中... 浏览器打开 http://localhost:3000
```

Then **open in your browser**: http://localhost:3000

> On first start it creates `workspace/` (the tool sandbox) and `data/` (database/logs/metrics). Default port is `3000`; if taken, set `PORT=8080 npm start` before starting.

---

## Step 3: Two basic settings

After the page opens, click the top-right menu and open the **Settings** page. Confirm two things:

1. **Ollama address**: default `http://localhost:11434`. If Ollama runs on another machine, change it to that address (e.g. `http://192.168.1.100:11434`).
2. **Project directory (PROJECT_ROOT)**: tools can only read/write this directory. Default is `./workspace` inside the repo. To let the Agent edit your own project, set this to your project's **absolute path** (e.g. `/Users/you/my-project`).

> Prefer not to use the UI? Fix them with env vars before starting:
> ```bash
> export PROJECT_ROOT=/Users/you/my-project
> export OLLAMA_HOST=http://localhost:11434
> npm start
> ```

Once set, you can chat in the input box at the bottom.

---

## Step 4: Your first conversation

Just describe in **plain language** what you want. The Agent calls tools to read real data first, then answers. For example:

- "Show me what files are in the workspace directory"
- "Read src/core/agent.js and explain in one sentence what it does"
- "Create hello.txt in workspace with the content 'hi'"

For **write operations** (creating/editing files, running commands), the Agent pops a **second confirmation** — it only executes after you click "Allow". This is a safety mechanism; confirm with confidence.

### Switching models

You can switch mid-conversation: click the model dropdown in the status bar, or type `/models` in the input. Use `qwen2.5-coder:7b` for coding; switch to `deepseek-r1:8b` for heavier reasoning.

---

## Step 5: Three command syntaxes

Besides natural language, there are three prefix/slash syntaxes for when you don't want to wait for the model to guess — you just want it done.

### `@command` — force a direct call (bypasses model reasoning)

Type `@toolname` or `@skillname` to run it directly and feed the result to the model to answer. Supports `key=value` args and positional args.

```
@git_status                              # directly show git working tree status
@git_log max=5                           # last 5 commits
@read_file src/core/agent.js             # read a file (positional = path=...)
@grep pattern=foo path=src              # search foo in src
@write_file path=workspace/n.txt content=hi   # write a file (asks for confirmation)
```

> Typing `@` in the input pops a tool/skill picker so you don't have to memorize names. Write ops still ask for confirmation.

### `!command` — run shell directly

Start a line with `!` and the whole line runs as a shell command (uses bash's confirmation flow; dangerous commands are blocked):

```
!ls -la src/core
!git log --oneline -3
!npm test
```

### `/command` — frontend slash commands

Type `/` to open the command palette. Common ones:

| Command | Action |
|---------|--------|
| `/skills` `/tools` | List available skills / tools |
| `/models` | Switch model |
| `/compress` | Compact history when the chat is long, to save tokens |
| `/recall` | Semantically recall memories from past sessions |
| `/plan` | Read-only plan mode: research only, output a plan for your approval, then make changes |
| `/template` | Use a task template (bakes frequent task steps) |
| `/metrics` | Show runtime metrics (steps, repeat calls, compactions, etc.) |
| `/clear` | Clear current conversation |
| `/help` | Show all commands |

> Priority: `!` > `@` > `/plan`.

---

## Step 6: Toolbox commands (single-turn)

A set of commands with **fixed prompts, single-turn execution, and no multi-step Agent loop** — a weak model still produces stable output. They appear dynamically in the `/` menu tagged "toolbox":

| Command | Action |
|---------|--------|
| `/explain <path>` | Explain the code in a file |
| `/review <path>` | Code review, list potential issues |
| `/comment <path>` | Add Chinese comments to code (write op, produces applicable file) |
| `/fix <path> <error>` | Attempt to fix code from an error (write op) |
| `/test <path> [fn]` | Generate unit tests for code |
| `/commit` | Generate a commit message from changes |
| `/error <error text>` | Interpret an error message |
| `/regex <need>` | Write a regex from a requirement |

Example: `/explain src/core/agent.js` returns a single-turn explanation of that file — faster and more stable than letting the Agent reason through multiple steps.

---

## Step 7: Plan mode (see the plan before changing code)

For bigger changes, use `/plan` first:

1. Type `/plan change the login endpoint timeout to 5 seconds`;
2. The Agent enters **read-only** research — it only inspects, never edits — and finally gives you an execution plan;
3. After you approve, it executes the plan; every write op still asks for your confirmation.

Benefit: align on the approach first, so the model doesn't start editing blindly.

---

## Step 8: Verification loop

After a write operation, the Agent **automatically runs tests / lint** to validate the result (depends on project config). If validation fails, **SELF_HEAL** (on by default) tries to auto-fix a few times. The status bar also shows context usage, current model, and git branch.

---

## FAQ

**Q: Page won't open / keeps spinning?**
- Confirm the terminal service started and the browser address is `http://localhost:3000` (if the port is taken, change `PORT`).
- Confirm Ollama is running: `ollama list` lists your models.

**Q: Agent says "no model available"?**
- Is the Ollama address in settings correct? On the same machine it's `http://localhost:11434`.
- Did you actually pull the model? `ollama pull qwen2.5-coder:7b`.

**Q: Agent edited the wrong file / somewhere else?**
- Tools are confined to the single `PROJECT_ROOT` directory; out-of-bounds paths are blocked automatically. Check that the project directory in settings is the path you intended.
- All write ops require a second confirmation — click "Reject" if unsure.

**Q: I want the Agent to edit my own project, not workspace?**
- In settings, change "Project directory" to your project's absolute path, or `export PROJECT_ROOT=...` before starting.

**Q: Responses slow / off-topic?**
- In a long chat, run `/compress` to compact history; or `/clear` to start fresh.
- For coding tasks, make sure the model is a coding model like `qwen2.5-coder:7b`.

---

## Offline Deployment (intranet / air-gapped)

The repo ships a packaging script that bundles *source + Ollama binary + pulled models + installer* into an offline pack you can copy via USB and run on the target machine with no network install:

```bash
# On a networked machine, first pull the model you want to bundle
ollama pull qwen2.5-coder:7b

# Build the offline pack (outputs dist/ollama_agent-offline.tar.gz)
bash scripts/build-offline-pack.sh

# Copy the tar.gz to the intranet machine, then after unzipping:
cd ollama_agent-offline
# Put the platform's ollama binary into bin/, then:
./install.sh
MODEL=qwen2.5-coder:7b node src/server.js
```

> At runtime, everything is Node built-in modules except the vendored `sql.js`, so it works offline.

---

## Next steps

- Want the full three-mechanism breakdown and complete `@`/`!` parameter docs? See [docs/skills-and-tools.md](skills-and-tools.md)
- Want to know how the Agent engine works? See [docs/agent-design.md](../docs/agent-design.md)
- Project overview and config reference: see [README.md](../README.md)
