# Troubleshooting

Start here: `/openltm:health` checks versions, runtime, DB connectivity, hook registration, and decay in one pass. For first-time setup problems, `/openltm:onboard` runs the doctor wizard. Most issues below are covered by one of those two.

---

## "Update now" shows no new version

The marketplace reads the version from `.claude-plugin/plugin.json`, **not** from `package.json` or GitHub releases. If you bumped one file but not the other, the update never surfaces.

**Fix:** every release must bump all of `package.json`, `.claude-plugin/plugin.json`, and both version fields in `.claude-plugin/marketplace.json`. See [Contributing](../CONTRIBUTING.md).

---

## Context isn't injected at session start

Symptoms: a new session opens with no memory block above your first message.

1. Run `/openltm:health` — confirm hook registration is green.
2. Confirm Bun is on `PATH` (`which bun`). The hooks run on Bun; if it's missing they fail silently.
3. Confirm the project is seeded: `/openltm:project init`. With no goal and no memories, there is nothing to inject.
4. Confirm the database exists at `~/.claude/plugins/data/OpenLtm-openltm/openltm.db`.

---

## MCP tools are unavailable

The MCP tools are exposed as `mcp__plugin_openltm_memory__<tool>` (e.g. `recall`, `learn`). If they don't appear:

1. Restart the agent — the MCP server connects at startup.
2. Run `/openltm:health` to confirm the server is registered.
3. In Claude Code specifically, MCP servers are wired by the plugin manifest; a stale install can leave the old `ltm` server key behind. Reinstall the plugin if the prefix still reads `mcp__plugin_ltm_memory__`.

---

## "Database is locked"

SQLite allows one writer at a time. A lock usually means a previous process didn't release the WAL.

1. Close other agent sessions touching the same database.
2. Check for an orphaned graph server: `/openltm:admin server status`, then `/openltm:admin server stop`.
3. Background processes can hold the lock invisibly. If you launched one, kill it before retrying.

---

## Schema drift / migration errors

```
/openltm:admin migrate status     # see current schema version and pending migrations
/openltm:admin migrate up         # apply pending migrations
/openltm:admin migrate --legacy   # detect and migrate a legacy ~/.claude/memory database
```

`/openltm:admin migrate reset` drops and recreates the schema. It is **destructive** and requires explicit confirmation — only use it on a database you are willing to lose.

---

## A hook error appears in the UI but everything works

Claude Code labels `additionalContext` injections from `PreToolUse` hooks as errors in its display line even when the hook exits 0 with valid output. If the hook produced the expected result, this message is cosmetic — ignore it.

---

## The graph visualizer won't open

The graph server runs on port **7332**.

1. `/openltm:admin server start`, then open the printed URL.
2. If the port is taken, stop the stale instance: `/openltm:admin server stop`.

---

## sqlite-vec or Honker won't load

The plugin degrades gracefully — the absence of either extension is not an error. But if you expected them to be active:

1. **No system extension-enabled libsqlite3.** Run `bun -e "const { Database } = require('bun:sqlite'); new Database(':memory:').loadExtension('/nonexistent')" 2>&1 | grep -q 'does not support' && echo "Bun bundled sqlite — extensions need system lib"`. If this prints, install a Homebrew sqlite on macOS: `brew install sqlite`. The plugin searches `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` (Apple Silicon) and `/usr/local/opt/sqlite/lib/libsqlite3.dylib` (Intel).
2. **No Honker binary for this platform.** Honker is currently vendored for darwin-arm64 only. Other platforms fall back to inline embedding, file-watch polling, and in-process janitor — no action needed.
3. **`LTM_DISABLE_VEC` or `LTM_DISABLE_HONKER` is set.** Unset the env var or remove `=1`/`=true` from your shell profile.
4. **`LTM_SQLITE_LIB` points to the wrong path.** Set it to the absolute path of a system libsqlite3 that supports extension loading: `export LTM_SQLITE_LIB=/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`.

Verification: capabilities are resolved once at process start. To check what is available, confirm the system library exists — `ls /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` (macOS) — and that a honker binary is vendored for your platform under `packages/openltm-core/vendor/honker/<platform>/`. There is no dedicated status command yet.

## Secrets may have been captured

If you suspect a memory captured an API key or token:

```
/openltm:admin scan --dry-run     # preview what would be redacted — safe
/openltm:admin scan               # redact in place
```

Then rotate the exposed credential. `scan` redacts API keys, tokens, and passwords.

---

## See also

- [Installation](01-installation.md) — clean-install paths
- [Configuration](04-configuration.md) — what each setting does
- [Commands](05-commands.md) — full command + flag reference
- [How It Works](02-how-it-works.md) — what the hooks actually do
