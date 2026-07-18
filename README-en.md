<p align="right">
  <strong>English</strong> | <a href="./README.md">中文</a>
</p>

# Local Agent Client

> A local AI assistant for air-gapped intranets. Weak model + strong constraints + real data = no hallucination.

A local agent that runs entirely on your own machine: models infer locally via Ollama, tool calls are confined to a single project directory, and every answer is grounded in real data returned by tools. Everything is Node built-in modules except `sql.js` (vendored into `public/lib`, works offline). After a normal clone, `npm start` runs it; or package it as a USB-ready offline deploy pack via `scripts/build-offline-pack.sh`.

---

## Features

- **Local Agent**: reads real data through tools before answering — no guessing.
- **Single-directory sandbox**: tools can only read/write one project directory; out-of-bounds paths are blocked automatically.
- **Context compaction**: automatically summarizes long conversations to stay within the model's context window.
- **Memory recall**: three-tier memory based on semantic similarity (L1 recent / L2 semantic recall / L3 associative).
- **Plan mode**: read-only exploration phase — only read tools allowed, outputs a plan for approval before any changes.
- **Verification loop**: automatically runs tests/lint after write operations to validate changes.
- **Toolbox**: single-turn commands like `/explain` `/review` `/commit` `/fix` run through an isolated channel (not the multi-step Agent loop) so even a weak model produces stable output.
- **Zero install**: everything is Node built-in modules except the vendored `sql.js`; clone and run, or package as an offline deploy pack.
- **Transparent process**: thinking chains, tool calls, and verification results displayed live and collapsible.
- **Cross-platform**: unified entry point for Windows / macOS / Linux — copy and run from a USB stick.

## Model

Select a model from the settings dropdown (populated from your Ollama installed list), or set the `MODEL` environment variable for a default (falls back to `qwen2.5-coder:7b`). You can switch models mid-conversation.

## Quick Start

```bash
# 1. Make sure Ollama is running and models are pulled
ollama pull qwen2.5-coder:7b

# 2. Start (no npm install needed)
npm start
# Equivalent to: node src/server.js
# Windows: double-click start.ps1 or start.bat; macOS/Linux: ./start.sh

# 3. Open in browser
http://localhost:3000
```

> Unified entry point: `npm start` (= `node src/server.js`). No native compilation dependencies except the vendored `sql.js` — copy the folder to any Windows/macOS/Linux machine and run `npm start`. For a full offline deploy pack, see `scripts/build-offline-pack.sh`.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address; can point to another machine on LAN |
| `MODEL` | `qwen2.5-coder:7b` | Default chat model (coding-first; override per scenario via `MODEL_CODER`/`MODEL_DEBUG`/`MODEL_GENERAL`) |
| `PROJECT_ROOT` | `./workspace` | Sandbox root directory |
| `NUM_CTX` | `8192` | Model context window size (set `16384` for more VRAM) |
| `AGENT_TIMEOUT_MS` | `90000` | Agent overall timeout (ms) |
| `OLLAMA_TIMEOUT_MS` | `90000` | Single Ollama call timeout (ms) |
| `PORT` | `3000` | Server port |

### Frontend Settings

After startup, configure in the settings page (top-right menu):

- Ollama address
- Project directory (absolute path)
- Model selection (from Ollama installed list)
- Markdown rendering engine (markdown-it / marked)

## Tools & Skills

### Tools

| Tool | Description | Confirm |
|------|-------------|---------|
| `read_file` | Read file contents | - |
| `read_lines` | Read specific line range | - |
| `list_dir` | List directory contents | - |
| `tree` | Display directory tree | - |
| `search_files` | Search files by name | - |
| `glob` | Glob pattern file matching | - |
| `grep` | Search file contents (regex) | - |
| `count_loc` | Count lines of code | - |
| `semantic_grep` | Semantic code search | - |
| `repo_map` | Generate repository structure map | - |
| `write_file` | Write / overwrite file | ✓ |
| `edit_file` | Precise edit (find & replace) | ✓ |
| `apply_diff` | Apply diff patch | ✓ |
| `bash` | Execute shell command | ✓ |
| `run_tests` | Auto-run tests | ✓ |
| `run_lint` | Auto-run lint | ✓ |
| `todos` | Task list management | ✓ |
| `notes` | Note management | ✓ |
| `ask_user` | Ask the user a question | - |

### Skills

| Skill | Description |
|-------|-------------|
| `git_status` | Show working tree status |
| `git_diff` | Show file diffs |
| `git_log` | Show commit history |
| `git_show` | Show a specific commit |
| `explain_symbol` | Explain a symbol definition |
| `find_references` | Find symbol references |

### Command Syntax

Besides natural-language chat, three prefix/slash syntaxes drive tools and skills directly:

**`@command` — force a direct call** (bypasses model reasoning; result is fed to the model to answer)

```
@<tool or skill name> [args...]
```

- Args use `key=value` (e.g. `path=src/x.js`, `max=5`); positional args auto-fill the primary param (e.g. `@read_file src/x.js`).
- Any registered tool or skill can be called; write ops (`write_file`/`edit_file`/`bash` etc.) prompt a second confirmation before running.
- Examples: `@git_status`, `@git_log max=5`, `@read_file src/core/agent.js`, `@grep pattern=foo path=src`, `@write_file path=/tmp/n.txt content=hi`

**`!command` — run shell directly**

```
!<shell command>
```

- Calls the `bash` tool directly, using its confirmation flow (including read-only commands); dangerous commands are blocked by the safety policy.
- Examples: `!ls -la src/core`, `!git log --oneline -3`, `!npm test`
- Priority: `!` > `@` > `/plan`.

**`/commands` — Frontend slash commands**

General commands:

| Command | Action |
|---------|--------|
| `/skills` | Show list of available skills |
| `/tools` | Show list of available tools |
| `/models` | Switch model |
| `/help` | Show all commands |
| `/clear` | Clear current conversation context |
| `/compress` | Compact intermediate history to save tokens |
| `/recall` | Semantic recall of cross-session memory |
| `/template` | Use a task template (bakes frequent task steps) |
| `/quick` | Browse the toolbox (usage/params/examples); click "Use" to fill the command into the input |
| `/metrics` | Show optimization metrics (runtime instrumentation) |
| `/plan` | Enter read-only plan mode, return a confirmable execution plan |

**Toolbox commands** (single-turn, fixed prompt — they do **not** go through the multi-step Agent loop, ideal for tasks a weak model completes reliably; browse them via the `/quick` toolbox panel for usage/params/examples, then click "Use" to fill the command into the input):

| Command | Action | Category |
|---------|--------|----------|
| `/explain <path>` | Explain the code in a file | readonly |
| `/review <path>` | Code review, list potential issues | readonly |
| `/comment <path>` | Add Chinese comments to code | write (produces applicable file) |
| `/fix <path> <error>` | Attempt to fix code from an error | write (produces applicable file) |
| `/test <path> [fn]` | Generate unit tests for code | readonly |
| `/commit` | Generate a commit message from changes | readonly |
| `/error <error text>` | Interpret an error message | readonly |
| `/regex <need>` | Write a regex from a requirement | readonly |

> For a comparison of the three mechanisms and full `@`/`!` parameter docs and examples, see [docs/skills-and-tools.md](docs/skills-and-tools.md).

## Directory Structure

```
ollama_agent/
├── src/                              Backend source
│   ├── server.js                     HTTP server entry + SSE chat
│   ├── config.js                     Global configuration
│   ├── core/                         Agent engine
│   │   ├── agent.js                  Agent main loop (tool calls, reasoning)
│   │   ├── ollama.js                 Ollama client (with timeout, backoff)
│   │   ├── ollama-tools.js           Ollama native tools API
│   │   ├── compact.js                Context compaction (summarization)
│   │   ├── workflow.js               Workflow mode inference (plan-then-execute)
│   │   ├── precheck.js               Tool-call pre-flight check (early deterministic error catch)
│   │   ├── metrics.js                Runtime metrics (data/metrics.jsonl)
│   │   ├── template-loader.js        Task-template loader (bake frequent task paths)
│   │   ├── prompts/                  System prompts & examples
│   │   └── quick/                    Toolbox single-turn commands (isolated from Agent loop)
│   │       ├── runner.js             Command runner
│   │       ├── registry.js           Command registry (scans commands/)
│   │       └── commands/             comment/commit/error/explain/fix/regex/review/test
│   ├── tools/                        Action tools
│   │   ├── index.js                  Tool registry & entry
│   │   ├── utils.js                  Sandbox path resolution & shared helpers
│   │   ├── test/                     run_tests / run_lint
│   │   └── *.js                      Individual tool implementations
│   ├── skills/                       Skills (analysis / inspection)
│   │   ├── index.js                  Skill registry
│   │   ├── utils.js                  Shared skill helpers
│   │   ├── git/                      Git-related skills
│   │   └── analyze/                  Code analysis skills
│   ├── storage/                      Persistence
│   │   ├── db.js                     SQLite conversation store (sql.js/WASM)
│   │   └── rootstore.js              Project root persistence
│   ├── memory/
│   │   └── recall.js                 Semantic memory recall
│   ├── server/                       Server-side helpers
│   │   ├── hotreload.js              Frontend hot reload (SSE reload notify)
│   │   └── logger.js                 File logger + rotation (data/agent.log)
│   ├── device/
│   │   └── device.js                 Device info
│   └── templates/                    Task templates (.md, injected into system prompt)
│
├── public/                           Frontend static files
│   ├── index.html                    Main page
│   ├── frontend/js/modules/          Frontend JS modules (global-script, split by feature)
│   │   ├── refs.js                    Shared DOM refs + status bar / user menu wiring (loaded first)
│   │   ├── app.js                    Main entry: boot & event wiring only
│   │   ├── chat.js                   Message rendering / SSE dispatch / thinking / images / send·abort
│   │   ├── sidebar.js                Sidebar tabs / todos·notes / log drawer / add modals
│   │   ├── history.js                History drawer / list / conversation replay / delete confirm
│   │   ├── statusbar.js              Status bar / context usage / model dropdown / git branch / detail modal
│   │   ├── composer.js               Input autosize / send hotkeys / conv name / URL persistence / new chat
│   │   ├── state.js                  State management
│   │   ├── api.js                    API calls
│   │   ├── render.js                 Message rendering (Markdown)
│   │   ├── settings.js               Settings management
│   │   ├── theme.js                  Theme switching
│   │   ├── commands.js               Command palette
│   │   ├── file-browser.js           File browser
│   │   └── utils.js                  Utility functions
│   ├── frontend/css/modules/         Modular stylesheets
│   ├── components/                   Reusable UI components
│   └── lib/                          Third-party libs (do not modify)
│       ├── simpui/                   UI framework
│       ├── lucide/                   Icon library
│       ├── markdown-it/              Markdown renderer
│       ├── marked/                   Markdown renderer (fallback)
│       ├── highlight/                Code highlighting
│       ├── purify/                   XSS sanitization
│       └── mermaid/                  Diagram rendering
│
├── workspace/                        Sandbox working directory
├── data/                             Database / logs / metrics files
├── docs/                             Documentation
│   ├── agent-design.md               Agent engine architecture
│   ├── skills-and-tools.md           @/!/slash command mechanics explained
│   ├── discussions/                  Discussions & comparisons
│   ├── optimization-plan.md          Optimization metrics baseline
│   └── superpowers/plans/            Implementation plans
├── scripts/
│   └── build-offline-pack.sh         Build air-gapped offline deploy pack (source+models+installer)
├── start.sh / start.bat / start.ps1  Cross-platform startup scripts
├── package.json                      Depends on sql.js (bundled into public/lib, runs offline)
└── README.md                         This document
```

## Security

- Tool calls are confined to the `PROJECT_ROOT` directory (path sandbox).
- Write operations require explicit per-call human confirmation.
- Ollama address and model are configurable, never hardcoded.
- XSS protection: all Markdown output is sanitized via DOMPurify.

## Documentation

| Doc | Description |
|---|---|
| [README.md](./README.md) | Project overview and quick start (Chinese) |
| [CLAUDE.md](./CLAUDE.md) | Development conventions and coding standards |
| [docs/usage-guide.md](./docs/usage-guide.md) | Beginner usage tutorial (Chinese) |
| [docs/usage-guide-en.md](./docs/usage-guide-en.md) | Beginner usage tutorial (English) |
| [docs/agent-design.md](./docs/agent-design.md) | Agent engine architecture design |
| [docs/skills-and-tools.md](./docs/skills-and-tools.md) | `@`/`!`/slash command mechanics explained |
| [docs/optimization-plan.md](./docs/optimization-plan.md) | Optimization metrics baseline |
| [docs/discussions/](./docs/discussions/) | Discussions & comparative analysis |
| [docs/superpowers/plans/](./docs/superpowers/plans/) | Implementation plans |
