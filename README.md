<p align="center">
  <img src="assets/logo.png" alt="Evolver" width="96" height="96" />
</p>

<h1 align="center">Evolver — Cursor plugin</h1>

Evolver for Cursor, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and
[EvoMap](https://evomap.ai): before each prompt it recalls one proven strategy, grades how the turn reused it on
evidence (the checks the turn ran, whether its edits were kept, your next reply), reports that back to the EvoMap
network, and distills the chat's verified work into a new Gene when the chat closes.

The plugin runs entirely from Cursor hooks. It ships **no MCP server, no skill and no rule**, so nothing of
Evolver enters the model's context but the recalled steps, which end with `Apply them where they fit.` — no
instruction to search, report or distill. Reports and distillation run on hook events; the `/evolver-*` commands
are answered by the plugin itself, before any model sees them.

## What runs when

| Cursor hook | What the plugin does |
| --- | --- |
| `sessionStart` (a new chat) | Reports the previous chat's kept or reverted edits (retention) and the open strategies of a chat whose Cursor process is gone (aborted), starts Evolver if it is missing or too old, and distills leftover candidates — all in a detached background worker. Adds no context, except a one-off notice when it installed, upgraded or could not start Evolver. |
| `beforeSubmitPrompt` | Answers a typed `/evolver-*` command itself (see [Commands](#commands)). Otherwise recalls by the prompt text (`POST /asset/fetch {text}` on the local Proxy) and adds the best strategy as `additional_context`, which Cursor sends with that same request; labels the previous turn's reuse from this prompt (correction or praise) and drops its candidate on a correction. Inline edits (Cmd-K), which carry no `composer_mode` and drop added context, are left alone. |
| `preToolUse` (`Write`, `Delete`) | Hashes the file an edit is about to change, for the retention report. |
| `postToolUse`, `postToolUseFailure` | Notes the turn's commands, checks (test, build, lint, type check) with pass or fail, and touched paths. |
| `afterFileEdit` | Notes the text each edit wrote in. |
| `afterAgentResponse` | Notes the turn's final answer. |
| `stop` | Reports every strategy injected into the turn, with the turn's end as Cursor gives it (`completed`, `aborted`, `error`); makes the turn the chat's distillation candidate when it completed verified. Cursor sends the next prompt without waiting for this hook, so that prompt waits up to 3 s for the turn to settle before it labels the reuses or drops the candidate; a turn whose stop never comes is closed then as an error. |
| `sessionEnd` (chat or window closed) | Reports a turn still running as aborted, and anything left unreported too; closes the candidate and starts its distillation in the background. Keeps the chat's turn counter, so a reopened chat never repeats a task id. |

Each hook does nothing when it runs inside the plugin's own headless distillation (`EVOLVER_HEADLESS=1`), which
loads this plugin too.

## Install

### From the Cursor Marketplace

Search for **Evolver** in the Cursor plugin marketplace and install, then reload Cursor. **Local memory works
with zero config** — no account, no key, no node id.

### Local development

```bash
git clone https://github.com/EvoMap/evolver-cursor-plugin
ln -s "$(pwd)/evolver-cursor-plugin" ~/.cursor/plugins/local/evolver
```

Reload the window; Settings → Hooks lists the plugin's hooks.

## Prerequisites

- Cursor with hooks (3.x). `beforeSubmitPrompt`'s `additional_context`, which carries the recalled strategy, is
  read by Cursor 3.27 but not yet in Cursor's hook docs.
- Node.js 20 or newer on the `PATH` Cursor's hooks see.
- Evolver 2.0.44 or newer. The plugin installs it under `~/.evolver/state/cursor-engine` and starts its Proxy in
  the background when it is missing; `npm install -g @evomap/evolver@latest` works too.
- For session-end distillation: the Cursor agent CLI (`cursor-agent`, installed by
  `curl https://cursor.com/install -fsS | bash`), signed in with `cursor-agent login` or `CURSOR_API_KEY`.
  Without it the candidate stays on disk and nothing else changes.

The plugin reads the live Proxy URL and token from `~/.evolver/settings.json` (written by the Proxy), else
`http://127.0.0.1:19820` (`EVOMAP_PROXY_PORT` changes the port).

### Connecting to the EvoMap network (optional)

1. **Leave any node id blank.** The first run registers a fresh node for you and prints a **claim link**.
2. Open that link while signed in to [evomap.ai](https://evomap.ai). `/evolver-status` shows a pending link.

## Commands

Cursor commands are prompts for the model, so the plugin answers its commands itself: when a prompt starts with
one, the `beforeSubmitPrompt` hook runs it and stops the prompt with the answer (`continue: false`,
`user_message`), and no model sees either. The command files in `commands/` exist for the slash menu.

| Command | What it does |
| --- | --- |
| `/evolver-status` | The Proxy, engine setup, the latest recall, recent reuse reports with the Hub's verdict, waiting candidates, claim link. |
| `/evolver-search <text>` | Searches the EvoMap network (`POST /asset/search`). |
| `/evolver-distill [focus]` | Distills this chat's latest verified turn now, through the Cursor agent CLI. |
| `/evolver-evolve [focus]` | An evolution checkpoint for the agent, dsh's text as is (Cursor appends the focus): the only command that is a prompt. It is recalled for like any prompt, and is no verdict on the turn before it, whose reuses wait for the next prompt. |
| `/evolver-sync`, `/evolver-review`, `/evolver-run`, `/evolver-solidify` | Run the `evolver` CLI (`npx -y @evomap/evolver@^2.0.44` when it is not installed) with the arguments quoted as a shell would, ten minutes at most. |

Cursor shows a command's answer in the chat as a message the hook blocked the prompt with.

## Session-end distillation

A turn that ended `completed`, used tools, passed its last check and reused no injected strategy leaves a
candidate in `~/.evolver/state/cursor-distill-pending.json`; a later verified turn replaces it, and a next prompt
that reads as a correction drops it (a distillation already running sees that and stops). When the chat closes,
a detached worker runs the Cursor agent CLI headless on the chat's model —
`cursor-agent -p --output-format json --mode ask --trust --workspace <empty scratch dir> --model <model> <prompt>`,
read-only, without `--force` so nothing is applied — to write a Gene from a digest of that turn (task, commands,
touched paths, checks, final answer — never the whole history), and sends it to the Proxy's
`POST /conversation/distill` with `platform: 'cursor'`, `trigger: 'session_end'`, `persist: true` and
`publish: false`. The CLI reports no token usage, so no `distill_usage` is sent. Keys and tokens are stripped from
the candidate first, paths and a manual focus included.

A candidate stays on disk until it is distilled; three failed tries (no `cursor-agent`, not signed in, an
unparsed answer, a Proxy error) give it up. One whose chat is over — closed, or left by a Cursor process that is
gone — is claimed by the next session start, one process at a time, while an idle chat keeps its own.

**Owner.** Cursor starts hooks from its extension host (the editor) or its own process (the CLI), sometimes through
a shell. The owner recorded with a candidate or an injection is the nearest ancestor process whose executable path
(from `ps`, or `/proc/<pid>/exe` on Linux) names Cursor; it goes away with the window or CLI that runs the chat (a
window reload counts). Where no process table can be read (Windows) no owner is recorded, and such entries are only
reported or distilled once their chat closes.

**Windows.** Only a `cursor-agent.exe` (or an `agent.exe` inside the CLI's install) is run, without a shell: a
`.cmd` shim would need `cmd.exe`, whose 8191-character command line the prompt argument overruns. With neither, the
candidate is kept and given up after three tries.

## Reuse reports

Every strategy injected into a turn is reported through the Proxy's `POST /asset/reuse-result` as
`{asset_id, outcome, task_id, reason, evidence}`:

| Report | When | `task_id` | `evidence` |
|---|---|---|---|
| Turn end | `stop`, or the next prompt after a turn whose `stop` never came | `cursor:<conversation>:<turn>` | `tier` `L1` when the turn ran a test, build, lint or type check, else `none`; `applied`; `check` `{kind, passed, fail_then_pass}` of the last check; `aborted`; `stage: immediate` |
| Correction | the next prompt says the answer did not hold, or approves it | `…:correction` | `tier: L3`, `applied`, `stage: correction` |
| Retention | the next chat in the same project finds the turn's edits kept or reverted | `…:retention` | `tier: L2`, `applied`, `stage: retention` |
| Aborted | the chat closes, or its Cursor process goes away, before the turn ends (those of a process that is gone go out at the next session start) | `cursor:<conversation>:<turn>` | `tier: none`, `applied: partial`, `aborted: true`, `stage: immediate` |

- **`applied`** compares the strategy's numbered steps with the turn's shell commands, touched paths, the text its
  edits wrote in (200,000 characters a turn) and the final answer: `used` when half the steps show up, `partial`
  when fewer do, `unused` when none do. A turn that left nothing to compare is sent as tier `none` with
  `applied: partial`, and its reason says `applied: unknown`.
- **Checks** are `Shell` commands that run tests, builds, linters or type checkers. A non-zero exit code
  (`postToolUse`'s `exitCode`, or a `postToolUseFailure` for an error or a timeout) fails one; with exit code 0 the
  output is read too, since a failing suite piped through `tail` exits zero. A command the person interrupted has no
  verdict, and one that was denied never ran. A command moved to the background before it finished has no verdict
  either where Cursor fails it with `Unknown error`; its streaming Shell executor instead reports such a command as
  exit code 0 with the output so far and nothing to tell it apart, so there the output alone decides.
- **Delivery.** Reports wait in `~/.evolver/state/cursor-reports-outbox.json` and are retried by the background
  worker at every turn end, follow-up prompt and session start for 8 days. One the Hub refuses as invalid is
  settled as rejected and never resent. Reports with evidence are also written once to the local root event log.
- Reasons name the turn, the applied verdict and the check kind, never the prompt, a command or code, and the
  prompt loses keys and tokens before recall sends it.

Every state file is prefixed `cursor-`, so another host's Evolver plugin never claims or reports this one's.

## Develop

```bash
npm test
```

## Uninstall

Remove the plugin from Cursor's plugin settings. Local Evolver memory under `~/.evolver/` is left intact.

## License

MIT © EvoMap. Installing `@evomap/evolver` (GPL) is a separate step the plugin performs as a package install; its
code is not part of this repository. See `LICENSE`.
