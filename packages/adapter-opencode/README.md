# @rohirik/opencode-ltm

Long-Term Memory (LTM) plugin for [OpenCode](https://opencode.ai) — shares the same memory database as Claude Code and Pi for persistent context across all your AI coding tools.

## Install

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@rohirik/opencode-ltm@latest"]
}
```

OpenCode automatically installs and updates the plugin on startup.

## What it does

- **Session start**: injects a `## Prior Knowledge` block into the system prompt with relevant memories for the current project
- **Pre-compaction**: saves session context before conversation compaction
- **5 tools**: `ltm_recall`, `ltm_learn`, `ltm_forget`, `ltm_relate`, `ltm_context`

## Shared memory

All three tools read from and write to the same database:

```
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

A memory learned in OpenCode appears in the next Claude Code session, and vice versa.

## Custom DB path

```json
{ "env": { "LTM_DB_PATH": "/custom/path/openltm.db" } }
```

Or set `LTM_DB_PATH` in your shell environment.
