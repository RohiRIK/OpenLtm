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
- `SessionStart` now emits a portable Prior Knowledge prefill directly from `openltm-core`; the other two are safe no-ops unless the full Claude plugin checkout is installed

### OpenCode (`opencode.json`)

- Adds `@rohirik/opencode-ltm@latest` to the `plugin` array

### Pi (`~/.pi/config.toml` or `~/pi.toml`)

- Appends an `[[extensions]]` block with `package = "@rohirik/pi-ltm"`

## Shared database

Claude Code's plugin keeps its database here, and the other hosts share it by default (the installer's Claude Code wiring, Pi, OpenCode, OpenClaw and the `ltm` CLI):

```
~/.claude/plugins/data/openltm-OpenLtm/openltm.db
```

`LTM_DB_PATH` overrides it. A database the core package already created for itself in an earlier version stays in use until you point `LTM_DB_PATH` at the shared one.

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

## Maintenance commands

| Command | What it does |
|---------|-------------|
| `openltm-core doctor [--deep] [--fix] [--json]` | Check SQLite, FTS and vector-index integrity; `--fix` backs up, then repairs |
| `openltm-core export --project <p> [--out f] [--encrypt]` | Write a project's memory as one checksummed capsule file (passphrase from `LTM_CAPSULE_PASSPHRASE`) |
| `openltm-core import <file> [--project p] [--dry-run]` | Import a capsule through normal dedup, labelled `external-source` |
| `openltm-core facts extract [--apply]` | Extract entity / slot / value facts from memories into a `facts` collection |

Full reference: [Commands](https://github.com/RohiRIK/OpenLtm/blob/main/docs/05-commands.md#terminal-cli-integrity-capsules-facts-2230).

## Programmatic API

Installers are registry-driven under `INSTALL_TARGETS`, so adding a new host now means defining one target entry (detect + install) instead of editing the CLI orchestrator in multiple places.

```typescript
import { installClaude, installOpenCode, installPi, detectAgents } from "@rohirik/openltm-core/cli";

const detected = detectAgents(); // { claude: true, opencode: false, pi: false }
const result = await installClaude({ dryRun: true });
// result: { target: "claude", status: "installed" | "skipped" | "error", detail?: string }
```

## License

MIT
