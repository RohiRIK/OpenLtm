# @rohirik/pi-ltm

Long-Term Memory (LTM) native extension for [Pi](https://pi.ai) coding agent — shares the same memory database as Claude Code and OpenCode.

## Install

```bash
pi install npm:@rohirik/pi-ltm
```

Or add to `pi.toml`:

```toml
[[extensions]]
package = "@rohirik/pi-ltm"
```

## What it does

- **Session start** (`session:start`): injects a `## Prior Knowledge` block into the system prompt
- **Compaction** (`compact`): saves session summary to LTM before conversation compaction
- **3 tools**: `ltm_recall`, `ltm_learn`, `ltm_forget`

## Shared memory

All three tools read from and write to the same database:

```
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

A memory learned in Pi appears in the next Claude Code session, and vice versa.

## Custom DB path

```bash
export LTM_DB_PATH="/custom/path/openltm.db"
```
