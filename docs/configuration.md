# Configuration

Configure via `~/.claude/config.json`.

## LTM options

```json
{
  "ltm": {
    "dbPath": "$CLAUDE_PLUGIN_DATA/ltm.db",
    "decayEnabled": true,
    "injectTopN": 15,
    "autoRelate": true,
    "graphReasoning": false,
    "evaluateSessionLlm": false,
    "semanticFallback": true
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | auto-resolved | Override db location (prefer `LTM_DB_PATH` env var) |
| `decayEnabled` | `true` | Enable memory relevance decay over time |
| `injectTopN` | `15` | Max memories to inject at SessionStart |
| `autoRelate` | `true` | Automatically link related memories |
| `graphReasoning` | `false` | Enable graph-based reasoning during recall |
| `evaluateSessionLlm` | `false` | Use LLM to evaluate sessions (costs tokens) |
| `semanticFallback` | `true` | Fall back to embedding search when FTS returns no results |

## DB path

Three ways to set it (priority order):

1. **`LTM_DB_PATH` env var** — set in your shell profile for a permanent override
2. **`CLAUDE_PLUGIN_DATA`** — set automatically by the plugin system on marketplace installs
3. **Default fallback** — `$CLAUDE_PLUGIN_DATA/ltm.db`

```bash
# Shell override example
export LTM_DB_PATH=/custom/path/ltm.db
```

## Server options

```json
{
  "server": {
    "apiPort": 7331,
    "uiPort": 7332
  }
}
```

The graph API runs on `apiPort`, the Next.js UI on `uiPort`.

## Sync (experimental)

```json
{
  "sync": {
    "enabled": false,
    "provider": "s3"
  }
}
```

Providers: `s3` | `r2` | `null`

## Per-project settings (optional)

Create `.claude/ltm.local.md` in your project for per-project LTM overrides:

```markdown
---
enabled: true
injectTopN: 10
autoRecall: false
---

# Project-specific notes

This project uses stricter memory injection.
```

**Fields:**
- `enabled` — Enable/disable LTM for this project (default: true)
- `injectTopN` — Override max memories to inject
- `autoRecall` — Override auto-recall at session start

**Note:** Changes require restarting Claude Code.
