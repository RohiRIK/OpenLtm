---
description: "DEPRECATED — use /ltm:admin scan instead. Scan all active LTM memories for secrets and redact them in-place."
argument-hint: "[--project X] [--dry-run]"
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:admin scan` instead. This alias will be removed in v1.6.0.

```
/secrets-scan              → scan all active memories
/secrets-scan --project X  → scan memories scoped to project X
/secrets-scan --dry-run    → show what would be redacted, no writes
```

> ⚠ Note: new memories are auto-scrubbed on write (via `db.ts`). This command scans **existing** memories only.

Run:

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

`--dry-run` is safe to run anytime. Logs pattern types only, never secret values.
