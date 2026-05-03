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

## Memory Decay Summary

Always run, regardless of graph server status:

```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
const all = db.query(\"SELECT importance, confidence, confirm_count, last_used_at, created_at FROM memories WHERE status='active'\").all();
const dep = db.query(\"SELECT COUNT(*) as n FROM memories WHERE status='deprecated'\").get();
const lastRun = db.query(\"SELECT value FROM settings WHERE key='decay_last_run'\").get()?.value ?? 'never';
const now = Date.now();
const atRisk = all.filter(m => {
  const ageDays = (now - new Date(m.last_used_at ?? m.created_at).getTime()) / 86400000;
  const score = (m.importance ?? 1) * (m.confidence ?? 1) * Math.exp(-ageDays / 30) * (1 + (m.confirm_count ?? 0) * 0.1);
  return score < 0.25;
}).length;
console.log('Memory Decay Summary');
console.log('────────────────────');
console.log('Active: ' + all.length + '  |  Deprecated: ' + (dep?.n ?? 0) + '  |  Last decay run: ' + lastRun);
console.log('At-risk (score < 0.25): ' + atRisk + ' memories');
"
```
