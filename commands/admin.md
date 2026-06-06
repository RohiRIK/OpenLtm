---
description: "USE WHEN running schema migrations, scanning memories for secrets, or managing the LTM graph visualization server. Groups migrate | scan | server."
argument-hint: "<migrate|scan|server> [args]"
allowed-tools: ["Bash", "Skill"]
---

Parse the first word of the arguments as `<subcommand>`. Pass remaining words as `<args>`.

If no subcommand given, show:

```
Usage: /ltm:admin <subcommand>

  migrate [status|up|down|reset|--legacy]   — schema migrations + legacy DB detection
  scan    [--project X] [--dry-run]         — scan memories for secrets and redact
  server  [start|stop|status]               — LTM graph visualization server (port 7332)
  audit   [--memory-id N] [--op <op>] [--session <id>] [--since <iso>] [--limit N]
                                            — query the memory write audit log
```

---

## migrate

Manage versioned LTM schema migrations and legacy DB path migration.

| Arg | Action |
|-----|--------|
| `status` (default) | Show applied and pending migrations + check for legacy DB |
| `up` | Apply next pending migration |
| `down` | Rollback last applied migration |
| `reset` | Rollback ALL (requires confirmation) |
| `--legacy` | Trigger legacy `~/.claude/memory/ltm.db` → plugin data migration |

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/src/migrations.ts" --<arg>
```

For `reset`: ask user to confirm with "yes" before running.

After schema migration check, also detect legacy DB:

```bash
[ -f "$HOME/.claude/memory/ltm.db" ] && [ ! -f "$CLAUDE_PLUGIN_DATA/ltm.db" ] && echo "⚠ Legacy DB found at ~/.claude/memory/ltm.db. Run /ltm:admin migrate --legacy to migrate it."
```

When `--legacy` is the argument:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-db.ts"
```

---

## scan

> ⚠ Note: new memories are auto-scrubbed on write (via `db.ts`). This scans **existing** memories only.

```bash
bun --eval "
import { Database } from 'bun:sqlite';
await (async () => {
  const { scrubSecrets } = await import(process.env.CLAUDE_PLUGIN_ROOT + '/src/secretsScrubber.ts');
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const project = args[args.indexOf('--project') + 1] ?? null;
  const db = new Database(process.env.LTM_DB_PATH);
  const where = project ? \"WHERE status='active' AND project_scope=?\" : \"WHERE status='active'\";
  const rows = db.query('SELECT id, content FROM memories ' + where).all(...(project ? [project] : []));
  let scanned = 0, redacted = 0;
  const typeCounts = {};
  for (const row of rows) {
    scanned++;
    const { scrubbed, redactions } = scrubSecrets(row.content);
    if (redactions.length) {
      redacted++;
      redactions.forEach(r => typeCounts[r] = (typeCounts[r] ?? 0) + 1);
      if (!dryRun) db.run('UPDATE memories SET content=? WHERE id=?', [scrubbed, row.id]);
      else console.log('[dry-run] Memory ' + row.id + ' would redact: ' + redactions.join(', '));
    }
  }
  const typeStr = Object.entries(typeCounts).map(([k,v]) => k+'('+v+')').join(', ');
  console.log('Scanned ' + scanned + ', redacted ' + redacted + (typeStr ? ' ('+typeStr+')' : '') + (dryRun ? ' [dry-run]' : ''));
})();
" -- $@
```

`--dry-run` is safe to run anytime.

---

## audit

Query the append-only memory audit log (`memory_audit` table). Every write to `memories` (insert, update, forget, redact, etc.) produces a row.

| Flag | Description |
|------|-------------|
| `--memory-id N` | Filter to a specific memory ID |
| `--op <op>` | One of: `insert`, `update`, `forget`, `deprecate`, `supersede`, `redact`, `restore`, `archive` |
| `--session <id>` | Filter by session that triggered the write |
| `--since <iso>` | Only events after this ISO date (e.g. `2026-05-01`) |
| `--limit N` | Max rows to return (default 50) |

Call `mcp__plugin_ltm_memory__admin_audit` with the provided filters and display the result as a table:

```
ID | Memory | Op     | Actor            | Session   | When
---|--------|--------|------------------|-----------|---------------------
42 | 7      | insert | mcp:ltm_learn    | sess_abc  | 2026-05-03 14:22:01
43 | 7      | update | mcp:ltm_learn    | sess_def  | 2026-05-03 15:01:44
44 | 7      | forget | mcp:ltm_forget   | sess_ghi  | 2026-05-03 16:00:00
```

For before/after snapshots, add `--verbose` (maps to `verbose: true` in the MCP call).

---

## server

Route to the **LtmServer** skill:

| Arg | Workflow |
|-----|----------|
| `start` or no args | `skills/LtmServer/Workflows/Start.md` |
| `stop` | `skills/LtmServer/Workflows/Stop.md` |
| `status` | inline PID check from `skills/LtmServer/SKILL.md` |

UI runs on port **7332** (Next.js frontend). API runs on port **7331** (Bun backend). PID at `~/.claude/tmp/ltm-server.pid`.
