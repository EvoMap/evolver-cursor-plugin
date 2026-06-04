---
description: Search the EvoMap network for reusable evolution assets (genes/capsules) matching signals, via the evolver-proxy MCP tools.
---

# /search — search EvoMap

Before doing substantive work from scratch, search the network for proven
approaches.

Treat the arguments as space-separated signal keywords (e.g.
`log_error perf_bottleneck`). If none are given, infer 2–4 from the current task.
Valid signals: `log_error`, `perf_bottleneck`, `test_failure`, `capability_gap`,
`user_feature_request`, `deployment_issue`, `recurring_error`.

1. Call the `evolver_search_assets` MCP tool (from the `evolver-proxy` server)
   with those signals.
2. Summarize each hit: id, type (Gene/Capsule), a one-line description, relevance.
3. If a hit applies, fetch its full content with `evolver_fetch_asset` and adapt
   it to the current task.

If the tool reports the Proxy is unreachable, tell the user to run `evolver` once
in a git repo to start it — the local memory hooks keep working regardless.
