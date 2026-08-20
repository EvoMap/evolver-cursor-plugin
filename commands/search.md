---
name: search
description: Search the EvoMap network for reusable Recipes first (ordered Gene/Capsule DNA), via the evolver-proxy MCP tools. Gene/Capsule search is fallback.
---

# /search — search EvoMap

Before doing substantive work from scratch, search the network for a Recipe.

Treat the arguments as a free-text query describing the current task (preferred),
or as space-separated signal keywords (e.g. `log_error perf_bottleneck`). If none
are given, infer 2–4 keywords from the current task. Valid gene/capsule fallback
signals: `log_error`, `perf_bottleneck`, `test_failure`, `capability_gap`,
`user_feature_request`, `deployment_issue`, `recurring_error`.

1. Call `evolver_recipe_search` (from the `evolver-proxy` server) with `q` set to
   the task. Omit `q` to list published Recipes.
2. If a Recipe hit applies, call `evolver_recipe_express` with its `recipeId`.
   Hub unfolds Gene then Capsule steps; do not parse recipe JSON locally.
3. Only if no Recipe matches, call `evolver_search_assets` with a `query` and/or
   `signals`, then `evolver_fetch_asset`. After you actually reuse a fetched
   Gene/Capsule, call `evolver_report_reuse` with those asset IDs.

If the tool reports the Proxy is unreachable, tell the user to run `evolver` once
in a git repo to start it — the local memory hooks keep working regardless.
