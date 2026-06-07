# Migration Guide — v2.0.0

## Why v2.0.0?

v2.0.0 extracts the storage engine into a standalone `@rohirik/openltm-core` npm package and introduces two new adapter packages (`@rohirik/opencode-ltm`, `@rohirik/pi-ltm`). This is a **semver-major** change because the internal module structure changed, but existing Claude Code users see **no breaking changes** — the plugin.json manifest, hooks, MCP tools, and database schema are all unchanged.

---

## Who needs to read this?

| You are… | Action needed |
|----------|---------------|
| **Claude Code plugin user** | None — update via plugin UI as usual |
| **OpenCode user** | New: add one line to your config (see below) |
| **Pi user** | New: install one package (see below) |
| **Library/SDK consumer** (building on top of ltm internals) | Read the breaking changes section |

---

## For Claude Code users — no action needed

Update the plugin normally:

1. Open Claude Code settings (or `/openltm:doctor` to check health)
2. The plugin marketplace shows "Update now" when v2.0.0 is available
3. Click update — done

Your database, memories, and context files are unchanged.

---

## For OpenCode users — new in v2.0.0

Add one line to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@rohirik/opencode-ltm@latest"]
}
```

OpenCode auto-installs the plugin on next startup. Your memories will be shared with Claude Code automatically — they both read from the same database:

```
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

**Custom DB path:** Set `LTM_DB_PATH` in your environment or in the config `env` block.

---

## For Pi users — new in v2.0.0

```bash
pi install npm:@rohirik/pi-ltm
```

Or add to `pi.toml`:

```toml
[[extensions]]
package = "@rohirik/pi-ltm"
```

Pi will inject `## Prior Knowledge` into every session automatically, and save session context before compaction. Same shared database as Claude Code and OpenCode.

---

## Shared database — how it works

All three tools read from and write to the same SQLite database. No sync daemon, no API calls — just a file:

```
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

- Memory learned in Claude Code → visible in next OpenCode/Pi session
- Memory learned in OpenCode → visible in next Claude Code/Pi session
- No conflicts — all writes go through the same schema with `created_at` timestamps

Override the path with `LTM_DB_PATH` environment variable if you use a non-default location.

---

## For library consumers — breaking internal changes

If you were importing directly from the internal modules of this repo (not via the plugin marketplace), note:

- `src/db.ts`, `src/shared-db.ts`, `src/dao/*`, `src/janitor/*`, etc. have been **moved** to `packages/openltm-core/`
- The public npm package is now `@rohirik/openltm-core` — use that instead of path imports
- The public API surface is identical; only the import path changed

```typescript
// Before (internal — never officially supported)
import { learn, recall } from "./src/db.js";

// After (stable public API)
import { learn, recall } from "@rohirik/openltm-core";
```

---

## Package versions in v2.0.0

| Package | npm name | Version |
|---------|----------|---------|
| Claude Code plugin | marketplace only | 2.0.0 |
| Storage engine | `@rohirik/openltm-core` | 2.0.0 |
| OpenCode adapter | `@rohirik/opencode-ltm` | 2.0.0 |
| Pi extension | `@rohirik/pi-ltm` | 2.0.0 |
