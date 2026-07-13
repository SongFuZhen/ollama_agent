<p align="right">
  <strong>English</strong> | <a href="./README.md">中文</a>
</p>

# Local Agent Client

> A local AI assistant for air-gapped intranets. Weak model + strong constraints + real data = no hallucination.

A local agent that runs entirely on your own machine: models infer locally via Ollama, tool calls are confined to a single project directory, and every answer is grounded in real data returned by tools—no making things up. Built with plain Node built-in modules, so there is no `npm install`; just copy it onto a USB stick and run.

---

## Features

- **Scenario tabs**: Code completion, logic debugging, general chat, and image recognition—each bound to the most suitable local model.
- **Agent mode**: reads real data through tools before answering, instead of guessing.
- **Single-directory sandbox**: tools can only read/write one project directory; out-of-bounds paths are blocked automatically.
- **Zero dependencies**: pure Node built-in modules—no install step, works out of the box.
- **Transparent**: thinking chains and tool calls are shown live and can be collapsed.

## Scenarios & Models

| Tab | Model | Use |
|---|---|---|
| Code completion / explain | `qwen2.5-coder:7b` | read code, explain functions and modules |
| Logic debugging / find bugs | `deepseek-r1:8b` | read logs, trace call stacks, locate exceptions |
| General chat | `llama3.1:8b` | doc summarization, report drafting, small talk |
| Image recognition | `gemma3:4b` | paste/drag images, multimodal Q&A |

> Model names can be overridden in the settings page or via environment variables.

## Quick Start

```bash
# 1. Make sure Ollama is running and the models are pulled
ollama pull qwen2.5-coder:7b
ollama pull deepseek-r1:8b
ollama pull llama3.1:8b
ollama pull gemma3:4b

# 2. Start (no npm install needed)
./start.sh
# or directly: node src/server.js

# 3. Open in the browser
http://localhost:3000
```

## Configuration

### Environment Variables

| Var | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address; can point to another machine on the LAN |
| `PROJECT_ROOT` | `./workspace` | Sandbox root directory (single directory) |
| `MODEL_CODER` | `qwen2.5-coder:7b` | Code scenario model |
| `MODEL_DEBUG` | `deepseek-r1:8b` | Debug scenario model |
| `MODEL_GENERAL` | `llama3.1:8b` | General scenario model |
| `MODEL_VISION` | `gemma3:4b` | Image scenario model |
| `OLLAMA_TIMEOUT_MS` | `120000` | Ollama call timeout (ms) |
| `PORT` | `3000` | Server port |

### Frontend Settings

After startup, configure in the settings page (top-right menu):

- Ollama address
- Project directory (absolute path)
- Per-scenario model names

## Directory Structure

```
ollama_agent/
├── src/                          Backend source
│   ├── server.js                HTTP server + SSE chat
│   ├── agent.js                 Agent main loop
│   ├── tools/                   Tool registry and implementations
│   │   ├── index.js             Tool entry
│   │   ├── read_file.js         Read file
│   │   ├── list_dir.js          List directory
│   │   ├── read_lines.js        Read a line range
│   │   ├── edit_file.js         Precise edit (find & replace)
│   │   ├── write_file.js        Write file
│   │   ├── tree.js              Directory tree
│   │   ├── search_files.js      Search files
│   │   ├── glob.js              Glob match
│   │   ├── grep.js              Content search
│   │   └── count_loc.js         Line count
│   ├── ollama.js                Ollama client
│   ├── config.js                Scenario & model config
│   ├── db.js                    SQLite persistence (sql.js/WASM, zero native build)
│   ├── rootstore.js             Project directory management
│   └── device.js                Device info
│
├── public/                       Frontend static files
│   ├── index.html                Main page
│   ├── frontend/                 Frontend assets
│   │   ├── css/modules/          Modular styles
│   │   └── js/modules/           Modular logic
│   └── lib/                      Third-party libs (do not modify)
│
├── workspace/                    Sandbox working directory
├── data/                         Database files
├── start.sh                      Startup script
├── package.json                  No dependencies
└── README.md                     This document
```

## Security

- Tool calls are confined to the `PROJECT_ROOT` single directory (path sandbox).
- Write operations require explicit per-call human confirmation.
- Ollama address and models are configurable, never hardcoded.

## Documentation

| Doc | Description |
|---|---|
| [README.md](./README.md) | Project overview and quick start (Chinese) |
| [README-en.md](./README-en.md) | Project overview and quick start (English) |
| [docs/CLAUDE.md](./docs/CLAUDE.md) | Development conventions and coding standards |
| [docs/产品设计书.md](./docs/产品设计书.md) | Detailed product design doc |
| [docs/UI-SPEC.md](./docs/UI-SPEC.md) | UI design spec |
| [docs/1-UI-REVIEW.md](./docs/1-UI-REVIEW.md) | UI audit report |
