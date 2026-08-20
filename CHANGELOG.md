# Changelog

All notable changes to the Evolver Cursor plugin are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- MCP bridge is Recipe-first: `evolver_recipe_search` then `evolver_recipe_express`
  against Proxy `/recipe/search` and `/recipe/express`. `evolver_search_assets`
  remains as Gene/Capsule fallback when no Recipe hits.

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
