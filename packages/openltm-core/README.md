# @rohirik/openltm-core

Shared LTM storage engine and CLI installer for Claude Code, OpenCode, and Pi.

## Install

```bash
bunx @rohirik/openltm-core          # auto-detect Claude Code, OpenCode, Pi
bunx @rohirik/openltm-core --claude # Claude Code only
bunx @rohirik/openltm-core --opencode
bunx @rohirik/openltm-core --pi
bunx @rohirik/openltm-core --dry-run --claude  # preview without writing
```

The installer auto-detects which agents are installed on your machine and
patches their config files to register the LTM plugin. All installs are
idempotent — safe to run multiple times.

## What it configures

### Claude Code (`~/.claude/settings.json`)

- Adds the `ltm` MCP server entry (`bunx @rohirik/openltm-core mcp-serve`)
- Wires three lifecycle hooks: `SessionStart`, `PreCompact`, `PostEditCheck`

### OpenCode (`opencode.json`)

- Adds `@rohirik/opencode-ltm@latest` to the `plugin` array

### Pi (`~/.pi/config.toml` or `~/pi.toml`)

- Appends an `[[extensions]]` block with `package = "@rohirik/pi-ltm"`

## Shared database

All agents share a single SQLite database:

```
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

## CLI flags

| Flag | Description |
|------|-------------|
| `--claude` | Install into Claude Code only |
| `--opencode` | Install into OpenCode only |
| `--pi` | Install into Pi only |
| `--dry-run` | Preview what would be written without making changes |
| `--help`, `-h` | Show help |

If no target flags are given, agents are auto-detected by probing well-known
config directories.

## Programmatic API

```typescript
import { installClaude, installOpenCode, installPi, detectAgents } from "@rohirik/openltm-core/cli";

const detected = detectAgents(); // { claude: true, opencode: false, pi: false }
const result = await installClaude({ dryRun: true });
// result: { target: "claude", status: "installed" | "skipped" | "error", detail?: string }
```

## License

MIT
