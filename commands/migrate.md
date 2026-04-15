---
description: "Manage versioned LTM schema migrations and legacy DB path migration."
argument-hint: "[status|up|down|reset|--legacy]"
allowed-tools: ["Bash"]
---

| Arg | Action |
|-----|--------|
| `status` (default) | Show applied and pending migrations + check for legacy DB |
| `up` | Apply next pending migration |
| `down` | Rollback last applied migration |
| `reset` | Rollback ALL (requires confirmation) |
| `--legacy` | Explicitly trigger legacy `~/.claude/memory/ltm.db` → plugin data migration |

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/src/migrations.ts" --<arg>
```

For `reset`: ask user to confirm with "yes" before running.

After running schema migrations (or for `status`), also check for a legacy DB:

```bash
[ -f "$HOME/.claude/memory/ltm.db" ] && [ ! -f "$CLAUDE_PLUGIN_DATA/ltm.db" ] && echo "⚠ Legacy DB found at ~/.claude/memory/ltm.db. Run /ltm:migrate --legacy to migrate it."
```

When `--legacy` is the argument, run the legacy path migration instead:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-db.ts"
```
