---
description: "Manage versioned LTM schema migrations."
argument-hint: "[status|up|down|reset]"
allowed-tools: ["Bash"]
---

| Arg | Action |
|-----|--------|
| `status` (default) | Show applied and pending migrations |
| `up` | Apply next pending migration |
| `down` | Rollback last applied migration |
| `reset` | Rollback ALL (requires confirmation) |

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/src/migrations.ts" --<arg>
```

For `reset`: ask user to confirm with "yes" before running.
