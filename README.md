# Evolver — Self-Evolving Agent Memory (Cursor Plugin)

Give the Cursor agent a **persistent, auditable evolution memory**. Instead of
re-solving the same problem every session, the agent recalls what worked
before, notices improvement signals as it edits, and records how each task
turned out — so the next session starts smarter.

Powered by the [Genome Evolution Protocol (GEP)](https://evomap.ai) and the
[`@evomap/evolver`](https://github.com/EvoMap/evolver) engine.

> **Status:** v0.2.0 — hooks + skill + commands + MCP bridge. Works standalone
> (local memory) and, when the Proxy is running, exposes the EvoMap mailbox
> (genes/capsules) as MCP tools.

## What it does

Three hooks run automatically — you don't invoke them:

| Hook | Event | Effect |
|---|---|---|
| `session-start.js` | `sessionStart` | Injects a summary of recent **successful** outcomes (score ≥ 0.5, < 7 days, max 3) as context. |
| `signal-detect.js` | `afterFileEdit` | Detects improvement signals (`log_error`, `perf_bottleneck`, `capability_gap`, …) in edits. |
| `session-end.js` | `stop` | Classifies the task's git diff and appends the outcome to the evolution memory graph. |

It also ships:

- A **`capability-evolver` skill** describing the recall → work → record loop.
- An **MCP bridge** (`evolver-proxy`) exposing the local Proxy mailbox as tools:
  `evolver_search_assets`, `evolver_status`, `evolver_fetch_asset`,
  `evolver_publish_asset`, `evolver_distill_conversation`, `evolver_poll`.
- Slash commands: **`/evolve`** (checkpoint), **`/search`** (find network assets),
  **`/status`** (health), and engine wrappers **`/run`**, **`/solidify`**,
  **`/review`**, **`/sync`**, **`/distill`** (use the `@evomap/evolver` CLI when
  installed, else `npx -y @evomap/evolver`).
- A **rule** that reminds the agent to use evolution memory on substantive work.

## Install

### From the Cursor Marketplace

Search for **Evolver** in the Cursor plugin marketplace and install.

### Local development

```bash
git clone https://github.com/EvoMap/evolver-cursor-plugin
ln -s "$(pwd)/evolver-cursor-plugin" ~/.cursor/plugins/local/evolver
```

Reload Cursor. The hooks activate on the next session.

## Requirements

- **Node.js** (the hooks are Node scripts; Cursor invokes them via `node`).
- Nothing else for local memory.

## Modes

### Local mode (default, zero config)

Out of the box the hooks write outcomes to
`~/.evolver/memory/evolution/memory_graph.jsonl` (or, inside an evolver-managed
project, that project's `memory/evolution/`). Recall and record work
immediately. **No account, no key, no network.**

### Full engine

```bash
npm install -g @evomap/evolver
```

The bundled hooks always do lightweight **local** recall/record — local git
diff + JSONL append, plus optional Hub sync. Installing `@evomap/evolver` does
**not** change what the hooks do and they do not auto-detect or invoke it.
What it adds is the engine's **CLI** — e.g. `evolver run` (the full automated
review-and-solidify pipeline that analyzes logs and proposes/applies code
improvements) and `evolver review` — which you run separately. The memory the
hooks record feeds that pipeline, so the two compose without the hooks ever
shelling out to the engine.

### EvoMap Hub (community strategies)

To sync outcomes and search strategies published by other agents, register an
EvoMap node and set the Hub credentials in your environment:

```bash
export EVOMAP_HUB_URL="https://evomap.ai"
export EVOMAP_API_KEY="…"     # from your EvoMap node
export EVOMAP_NODE_ID="…"
```

The `stop` hook will then record outcomes to the Hub (with a local fallback if
the Hub is unreachable). See the [evolver docs](https://evomap.ai) for node
registration.

## Architecture (the MCP bridge vs. gep-mcp-server)

- **This plugin's `evolver-proxy` bridge** is a thin, MIT, zero-dependency glue
  that exposes the *local* Proxy mailbox (the genes/capsules already synced to
  your machine) as MCP tools, reading the live url + auth token from
  `~/.evolver/settings.json`. It degrades gracefully when the Proxy is down.
- **`@evomap/gep-mcp-server`** is the standalone, Apache-licensed **full GEP
  protocol layer** — the complete `gep_*` tool surface for any MCP client. Add it
  to your MCP config directly if you want that richer surface; the two compose.
- **`@evomap/evolver`** is the GPL-licensed engine (daemon + CLI). The plugin's
  hooks are an independent MIT clean-room implementation that records memory in
  the same format the engine reads, so they interoperate when you install it.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MEMORY_GRAPH_PATH` | (auto) | Override the memory graph file location. |
| `EVOMAP_PROXY_PORT` | `19820` | Proxy port the MCP bridge falls back to (live url read from `~/.evolver/settings.json`). |
| `EVOMAP_HUB_URL` / `EVOMAP_API_KEY` / `EVOMAP_NODE_ID` | (unset) | Enable Hub recording. |
| `EVOLVER_HOOK_VERBOSE` | `0` | Set `1` to surface the session-end receipt inline (suppressed on Cursor by default). |

## License

MIT © EvoMap. The bundled hook scripts are an original, clean-room
implementation written against the hook behavior spec — they are not derived
from the GPL-licensed `@evomap/evolver` source. Installing `@evomap/evolver`
(itself GPL) to unlock the full pipeline is an independent, optional step. See
`LICENSE`.
