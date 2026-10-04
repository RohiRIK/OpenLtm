# @rohirik/openclaw-ltm

OpenLTM — long-term memory for [OpenClaw](https://openclaw.ai) agents.

Stores memories in a **local SQLite database** and shares it with the Claude
Code, OpenCode, and Pi plugins, so a fact learned in one agent is recalled in
the others. No cloud, no telemetry, no account.

## Install

```bash
openclaw plugins install clawhub:@rohirik/openclaw-ltm --accept-capabilities   # from ClawHub
openclaw plugins install @rohirik/openclaw-ltm --force --accept-capabilities   # or straight from npm
```

- `--accept-capabilities` consents to the plugin registering its eight memory
  tools. Without it OpenClaw stops with "requires capability consent".
- `--force` is only for the npm route: OpenClaw refuses npm installs that are
  outside ClawHub review until you acknowledge it.

Verified end to end on OpenClaw 2026.9.8 (Node 24): install, runtime load with
all eight tools, learn → recall on a brand-new database, and the Prior
Knowledge block.

npm gets every release tag; ClawHub gets a release once it is published there (see the repo's `docs/11-publishing.md`). A new ClawHub version becomes
installable once ClawHub's security scan finishes.

Requires **OpenClaw `>= 2026.9.6`** and the **Bun** runtime on `PATH`
(OpenClaw runs on Node; the memory engine is Bun code, so the plugin spawns it as
a child process — see [Runtime model](#runtime-model)).

## What it adds

### Tools

| Tool | Use |
|---|---|
| `openltm_recall` | Search memory by meaning. Call before any non-trivial task. |
| `openltm_learn` | Store or reinforce a durable fact. Skip anything derivable from code or git history. |
| `openltm_forget` | Delete a memory that is wrong, outdated, or unwanted. |
| `openltm_context` | Restore project goals, decisions, and gotchas. |
| `openltm_relate` | Link two memories with a typed relationship. |
| `openltm_graph` | Traverse the memory graph to trace decision chains. |
| `openltm_brain_stats` | Totals, category spread, and importance distribution. |
| `openltm_stale` | List memories invalidated by code changes, or clear the flag after review. |

### Auto-recall

Each turn gets a compact `## Prior Knowledge (LTM)` block containing the highest
-ranked global and project memories, capped by a line budget. Disable it with
`autoRecall: false`.

## Configuration

```jsonc
{
  "plugins": {
    "openltm": {
      "autoRecall": true,   // inject Prior Knowledge each turn
      "prefillLines": 18,   // line budget for that block
      "dbPath": "~/.openclaw/openltm.db"  // override the shared database
    }
  }
}
```

## Runtime model

OpenClaw's host is Node, but OpenLTM's engine is Bun and imports `bun:sqlite`.
A direct import fails at load time with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, so this
plugin **never imports the engine**. It spawns the engine as a Bun child running
the MCP stdio server and speaks newline-delimited JSON-RPC to it — the same
approach as the Pi adapter.

Consequences:

- **Bun must be installed.** If it is missing, tools return an explanatory error
  instead of the plugin failing to load.
- Memory is shared, not copied, so the Claude Code, OpenCode, and Pi plugins see
  the same rows.

## Relationship to OpenClaw's own memory

This is a **tool plugin**, not a memory-slot plugin. It declares
`categories: ["memory"]` for discoverability but does **not** claim OpenClaw's
exclusive memory slot, so it composes with OpenClaw's built-in memory rather
than displacing it. Claiming the slot would mean faking file paths, since
OpenClaw's memory contract is file/line oriented while OpenLTM stores rows.

## License

MIT
