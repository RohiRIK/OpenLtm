---
description: "DEPRECATED — use /ltm:migrate --legacy or /ltm:admin migrate --legacy instead. Check and migrate ltm.db from legacy path."
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:migrate --legacy` or `/ltm:admin migrate --legacy` instead. This alias will be removed in v1.6.0.

Run and display output verbatim:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-db.ts"
```

If `CLAUDE_PLUGIN_ROOT` is unset, find plugin root: `claude plugin info ltm 2>/dev/null | grep -i path | head -1`.

## What it checks

| Scenario | Result |
|----------|--------|
| `LTM_DB_PATH` env set | Shows override path, no migration needed |
| Marketplace install, DB already migrated | Confirms target path and size |
| Marketplace install, legacy DB exists | Copies `~/.claude/memory/ltm.db` → `$CLAUDE_PLUGIN_DATA/ltm.db` |
| Marketplace install, fresh | Confirms where DB will be created |
| Dev/git-clone install | Shows `$CLAUDE_PLUGIN_DATA/ltm.db`, no migration needed |

## After migration

The legacy DB at `$CLAUDE_PLUGIN_DATA/ltm.db` is kept intact — delete it manually if desired.
All hooks and MCP tools automatically use the new path via `getDbPath()`.
