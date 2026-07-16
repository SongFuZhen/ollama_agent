<p align="right">
  <strong>English</strong> | <a href="./README.md">中文</a>
</p>

# Local Agent Client

> A local AI assistant for air-gapped intranets. Weak model + strong constraints + real data = no hallucination.

A local agent that runs entirely on your own machine: models infer locally via Ollama, tool calls are confined to a single project directory, and every answer is grounded in real data returned by tools. Built with plain Node built-in modules — no `npm install` needed; copy onto a USB stick and run.

---

## Features

- **Local Agent**: reads real data through tools before answering — no guessing.
- **Single-directory sandbox**: tools can only read/write one project directory; out-of-bounds paths are blocked automatically.
- **Context compaction**: automatically summarizes long conversations to stay within the model's context window.
- **Memory recall**: three-tier memory based on semantic similarity (L1 recent / L2 semantic recall / L3 associative).
- **Plan mode**: read-only exploration phase — only read tools allowed, outputs a plan for approval before any changes.
- **Verification loop**: automatically runs tests/lint after write operations to validate changes.
- **Zero dependencies**: pure Node built-in modules + sql.js/WASM — no install step, works out of the box.
- **Transparent process**: thinking chains, tool calls, and verification results displayed live and collapsible.
- **Cross-platform**: unified entry point for Windows / macOS / Linux — copy and run from a USB stick.

## Model

Select a model from the settings dropdown (populated from your Ollama installed list), or set the `MODEL` environment variable for a default (falls back to `deepseek-r1:8b`). You can switch models mid-conversation.

## Quick Start

```bash
# 1. Make sure Ollama is running and models are pulled
ollama pull deepseek-r1:8b

# 2. Start (no npm install needed)
npm start
# Equivalent to: node src/server.js
# Windows: double-click start.ps1 or start.bat; macOS/Linux: ./start.sh

# 3. Open in browser
http://localhost:3000
```

> Unified entry point: `npm start` (= `node src/server.js`). Zero native compilation dependencies — copy the folder to any Windows/macOS/Linux machine and run `npm start`.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address; can point to another machine on LAN |
| `MODEL` | `deepseek-r1:8b` | Default chat model |
| `PROJECT_ROOT` | `./workspace` | Sandbox root directory |
| `NUM_CTX` | `16384` | Model context window size |
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

## Directory Structure

```
ollama_agent/
├── src/                              Backend source
│   ├── server.js                     HTTP server + SSE chat
│   ├── config.js                     Global configuration
│   ├── core/                         Agent engine
│   │   ├── agent.js                  Agent main loop (tool calls, reasoning)
│   │   ├── ollama.js                 Ollama client (with timeout)
│   │   ├── ollama-tools.js           Ollama native tools API
│   │   └── compact.js                Context compaction (summarization)
│   ├── tools/                        Action tools
│   │   ├── index.js                  Tool registry & entry
│   │   ├── test/                     run_tests / run_lint
│   │   └── *.js                      Individual tool implementations
│   ├── skills/                       Skills (analysis / inspection)
│   │   ├── index.js                  Skill registry
│   │   ├── git/                      Git-related skills
│   │   └── analyze/                  Code analysis skills
│   ├── storage/                      Persistence
│   │   ├── db.js                     SQLite conversation store (sql.js/WASM)
│   │   └── rootstore.js              Project root persistence
│   ├── memory/
│   │   └── recall.js                 Semantic memory recall
│   └── device/
│       └── device.js                 Device info
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
├── data/                             Database files
├── docs/                             Documentation
│   ├── agent-design.md               Agent engine architecture
│   ├── discussions/                  Discussions & comparisons
│   └── superpowers/plans/            Implementation plans
├── start.sh / start.bat / start.ps1  Cross-platform startup scripts
├── package.json                      No external dependencies
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
| [docs/agent-design.md](./docs/agent-design.md) | Agent engine architecture design |
| [docs/discussions/](./docs/discussions/) | Discussions & comparative analysis |
| [docs/superpowers/plans/](./docs/superpowers/plans/) | Implementation plans |
