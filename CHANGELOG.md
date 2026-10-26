# Changelog

All notable changes to the Evolver Cursor plugin are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.2.0] — 2026-10-26

Aligned with the DeepSeek Harness plugin (dsh-evolver 0.3.0): Evolver stays out of the model context.

### Added
- `beforeSubmitPrompt` recalls one strategy by the prompt text and adds it as `additional_context`, ending with
  `Apply them where they fit.`; inline edits (no `composer_mode`) are left alone.
- `preToolUse` / `postToolUse` / `postToolUseFailure` / `afterFileEdit` / `afterAgentResponse` record the turn's
  commands, checks (non-zero exit code, else failure output), paths, edits and answer; `stop` reports every
  injected strategy with that evidence and the turn's own end (`completed` / `aborted` / `error`) as
  `cursor:<conversation>:<turn>`.
- Aborted reports when a chat closes mid-turn, and at the next session start for a chat whose Cursor process is
  gone; correction/praise follow-ups, retention reports, a report outbox with retries, and local root-event records.
- Every reuse report says `applied: used` (dsh-evolver #55): the model follows what is injected; the outcome,
  the next prompt and kept edits judge whether it helped. `tier` is `L1` whenever a check ran.
- Session-end distillation: a verified turn becomes the chat's candidate (one that reused a strategy too)
  (`~/.evolver/state/cursor-distill-pending.json`), dropped by a correction, and is distilled once in a detached
  worker by the Cursor agent CLI, headless (`cursor-agent -p --output-format json --mode ask`, empty workspace,
  on the chat's model), then sent to `POST /conversation/distill` with `platform: 'cursor'`. Three tries;
  leftovers are claimed by the next session start. State writes go through a shared lock; every state file is
  prefixed `cursor-`.
- `/evolver-status`, `/evolver-search`, `/evolver-distill`, `/evolver-sync`, `/evolver-review`, `/evolver-run`
  and `/evolver-solidify` are answered by the `beforeSubmitPrompt` hook itself, which stops the prompt before any
  model sees it; `/evolver-evolve` is the one command left as a prompt.
- `/evolver-status` opens with the tokens reused strategies saved in this chat and in all chats, then lists this
  chat's reused assets (turn, name and id, last check, saving) (the savingsCore
  reference-reuse estimate, counted only after a passing check and capped at the turn's own tokens from `stop`).
- Everything the plugin keeps in `~/.evolver/state` lives at most 3 days (undelivered reports, unreported
  injections, retention checks, chat files, per-chat savings, distillation candidates).
- Evolver is installed and its Proxy started in the background when missing or older than 2.0.44.

### Removed
- The `evolver-proxy` MCP server and its tools, the `evolver` skill, the `evolution-memory` rule and the
  commands that told the model to call tools.
- The session-start memory-graph summary and claim nudge, the `afterFileEdit` `[Evolution Signal]` notice, and
  the `stop`/`sessionEnd` git-diff outcome written to the local memory graph and posted to the Hub's
  `/a2a/evolution/record` (dsh keeps no equivalent; reuse reports and distillation replace it). The hooks no
  longer run `git`.
- The **Plugins → Configure** variables, which only fed the MCP server.

## [2.1.0] — 2026-08-18

### Fixed
- Hooks no longer spawn Apple's `/usr/bin/git` stub on macOS without Xcode
  Command Line Tools. That stub prints `No developer tools were found` and was
  the failure behind Cursor's **Error loading plugin** banner
  (`git ... init` / `xcode-select`). Repo detection is filesystem-only; git is
  resolved without executing the stub; `git init` / `git clone` are refused.
- Session-start no longer tells the agent to run `git init` (a string Cursor or
  the agent could treat as an actionable command). Missing-repo and unusable-git
  notices are separate, throttled, and name the CLT / Homebrew fix.
- `evolver_fetch_asset` now puts the reuse nudge on the returned **data** so
  the model actually sees it.
- MCP bridge ignores unexpanded `${EVOMAP_PROXY_PORT}` placeholders from
  Cursor Configure (empty/placeholder falls back to 19820).

### Added
- Cursor **Plugins → Configure** variables: Node ID (leave blank), Hub URL,
  proxy port, evolution strategy — wired into the MCP bridge env.
- MCP: free-text `query` on `evolver_search_assets` (query and/or signals).
- MCP: `evolver_report_reuse` so reused genes/capsules credit their authors.
- `sessionEnd` hook alias (same recorder as `stop`, deduped).
- Command frontmatter `name` fields; `/search` prefers a natural-language query.

### Notes
- Local memory still needs a working git to *record* diffs. The plugin itself
  loads and the MCP bridge still runs when git is missing.

## [2.0.0] — 2026-08-16

### Changed
- Manifest version 2.0.0; bundled skill renamed from `capability-evolver` to
  `evolver`; CLI fallbacks pin to `@evomap/evolver@2`.
