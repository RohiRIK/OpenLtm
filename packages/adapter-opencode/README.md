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

When the Claude Code plugin is installed, OpenCode uses its database:

```
~/.claude/plugins/data/openltm-OpenLtm/openltm.db
```

A memory learned in OpenCode then appears in the next Claude Code session, and vice versa. If OpenCode already has a database of its own from an earlier version, that one stays in use; set `LTM_DB_PATH` (below) to the path above to switch to the shared one.

## Custom DB path

```json
{ "env": { "LTM_DB_PATH": "/custom/path/openltm.db" } }
```

Or set `LTM_DB_PATH` in your shell environment.
