---
description: "Show project health scores and memory decay summary. Graph server data is additive — decay always shown."
allowed-tools: ["Bash"]
---

## Project Health Scores

```bash
curl -s http://localhost:7331/api/health/projects
```

If the server responds: parse JSON and render ranked table (highest score first):

```
SCORE  STATUS           PROJECT              MEMORIES  STALE  CTX
  85   🟢 healthy        claude-config            142      3   4/4
  62   🟡 needs_attention my-app                   38     12   2/4
  31   🔴 neglected       old-project               9      9   0/4
```

Status: 🟢 ≥70 · 🟡 40–69 · 🔴 <40

| Metric | Weight |
|--------|--------|
| Memory freshness (accessed ≤30 days) | 35% |
| Avg confidence | 25% |
| Context coverage (goal/decision/gotcha/progress) | 20% |
| Session activity (any access ≤14 days) | 20% |

If the server is NOT running, show: `(graph server offline — start with /ltm:admin server)`

---

## Activity (last 24 h)

Aggregate structured events from `~/.claude/logs/hooks.log`:

```bash
bun --eval "
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const LOG = join(homedir(), '.claude', 'logs', 'hooks.log');
if (!existsSync(LOG)) { console.log('No hooks.log yet — hooks have not fired.'); process.exit(0); }
const cutoff = Date.now() - 24 * 60 * 60 * 1000;
const counts = {};
readFileSync(LOG, 'utf-8').trim().split('\n').forEach(line => {
  try {
    const e = JSON.parse(line);
    if (e.level !== 'event' || !e.event) return;
    if (new Date(e.ts).getTime() < cutoff) return;
    counts[e.event] = (counts[e.event] ?? 0) + 1;
  } catch {}
});
const LABELS = {
  'session.start':     'Sessions started',
  'session.evaluated': 'Sessions evaluated',
  'context.updated':   'Context updates',
  'compact.pre':       'Compactions',
  'recall.hit':        'Recall hits',
  'learn.write':       'Memories learned',
  'wizard.complete':   'Wizard completions',
};
console.log('Activity (last 24 h)');
console.log('────────────────────');
const keys = Object.keys(LABELS);
const any = keys.some(k => counts[k]);
if (!any) { console.log('  No hook events yet.'); }
else { keys.forEach(k => { if (counts[k]) console.log('  ' + (LABELS[k] ?? k).padEnd(22) + counts[k]); }); }
"
```

---

## Janitor Status

Always run, regardless of graph server status:

```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
const get = k => db.query('SELECT value FROM settings WHERE key=?').get(k)?.value ?? '';
const lastRunAt  = get('ltm.janitor.lastRunAt');
const refreshed  = get('ltm.janitor.lastDecayRefreshed');
const deprecated = get('ltm.janitor.lastDeprecated');
const archived   = get('ltm.janitor.lastArchived');
const intervalM  = get('ltm.janitor.intervalMinutes') || '0';
const active     = db.query(\"SELECT COUNT(*) as n FROM memories WHERE status='active'\").get()?.n ?? 0;
const dep        = db.query(\"SELECT COUNT(*) as n FROM memories WHERE status='deprecated'\").get()?.n ?? 0;
const archTotal  = db.query(\"SELECT COUNT(*) as n FROM memory_archive\").get()?.n ?? 0;
const atRisk     = db.query(\"SELECT COUNT(*) as n FROM memories WHERE status='active' AND decay_score < 0.25\").get()?.n ?? 0;
let ago = 'never run';
let nextRun = '--';
if (lastRunAt) {
  const diffMs = Date.now() - new Date(lastRunAt).getTime();
  const h = Math.floor(diffMs / 3600000);
  ago = h < 1 ? 'just now' : h + ' h ago';
  if (Number(intervalM) > 0) {
    const nextMs = new Date(lastRunAt).getTime() + Number(intervalM) * 60000;
    const inH = Math.round((nextMs - Date.now()) / 3600000);
    nextRun = 'in ~' + inH + ' h';
  }
}
console.log('Janitor Status');
console.log('──────────────');
console.log('Last run:    ' + (lastRunAt || 'never') + '  (' + ago + ')');
console.log('Refreshed:   ' + refreshed + ' memories  |  Deprecated: ' + deprecated + '  |  Archived: ' + archived);
console.log('Next run:    ' + nextRun);
console.log('');
console.log('Memory totals');
console.log('─────────────');
console.log('Active: ' + active + '  |  Deprecated: ' + dep + '  |  Archived (all-time): ' + archTotal);
console.log('At-risk (decay_score < 0.25): ' + atRisk + ' memories');
"
```
