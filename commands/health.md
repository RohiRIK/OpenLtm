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

Prefer `ltm.jsonl` (structured JSONL log) when available; fall back to `hooks.log`.

```bash
bun --eval "
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude', 'plugins', 'data', 'ltm-ltm');
const JSONL_LOG = join(PLUGIN_DATA, 'logs', 'ltm.jsonl');
const HOOKS_LOG = join(homedir(), '.claude', 'logs', 'hooks.log');

const LABELS = {
  'session.start':     'Sessions started',
  'session.evaluated': 'Sessions evaluated',
  'context.updated':   'Context updates',
  'compact.pre':       'Compactions',
  'recall.hit':        'Recall hits',
  'learn.write':       'Memories learned',
  'wizard.complete':   'Wizard completions',
  'git.commit':        'Git commits tracked',
  'server.notify':     'Server notifies',
};

const cutoff = Date.now() - 24 * 60 * 60 * 1000;
const counts = {};
const hookCounts = {};
const errors = [];

if (existsSync(JSONL_LOG)) {
  // Primary: ltm.jsonl — structured LtmEvent lines
  readFileSync(JSONL_LOG, 'utf-8').trim().split('\n').slice(-100).forEach(line => {
    try {
      const e = JSON.parse(line);
      if (!e.event || !e.ts) return;
      if (new Date(e.ts).getTime() < cutoff) return;
      counts[e.event] = (counts[e.event] ?? 0) + 1;
      if (e.hook) hookCounts[e.hook] = (hookCounts[e.hook] ?? 0) + 1;
      if (e.level === 'error') errors.push(e);
    } catch {}
  });
} else if (existsSync(HOOKS_LOG)) {
  // Fallback: hooks.log — event-level entries only
  readFileSync(HOOKS_LOG, 'utf-8').trim().split('\n').forEach(line => {
    try {
      const e = JSON.parse(line);
      if (e.level !== 'event' || !e.event) return;
      if (new Date(e.ts).getTime() < cutoff) return;
      counts[e.event] = (counts[e.event] ?? 0) + 1;
      if (e.hook) hookCounts[e.hook] = (hookCounts[e.hook] ?? 0) + 1;
    } catch {}
  });
} else {
  console.log('No log files yet — hooks have not fired.');
  process.exit(0);
}

console.log('Activity (last 24 h)');
console.log('────────────────────');
const eventKeys = Object.keys(LABELS);
const anyEvent = eventKeys.some(k => counts[k]);
if (!anyEvent) { console.log('  No hook events yet.'); }
else { eventKeys.forEach(k => { if (counts[k]) console.log('  ' + (LABELS[k] ?? k).padEnd(26) + counts[k]); }); }

if (Object.keys(hookCounts).length) {
  console.log('');
  console.log('Per-hook counts');
  console.log('───────────────');
  Object.entries(hookCounts).sort((a,b) => b[1]-a[1]).forEach(([h,n]) => console.log('  ' + h.padEnd(22) + n));
}

if (errors.length) {
  console.log('');
  console.log('Last errors (up to 5)');
  console.log('─────────────────────');
  errors.slice(-5).forEach(e => console.log('  [' + e.ts + '] ' + e.hook + ': ' + (e.detail ?? e.event)));
}
"
```

---

## Log Health

```bash
bun --eval "
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude', 'plugins', 'data', 'ltm-ltm');
const JSONL_LOG = join(PLUGIN_DATA, 'logs', 'ltm.jsonl');
const HOOKS_LOG = join(homedir(), '.claude', 'logs', 'hooks.log');

function fileInfo(label, path) {
  if (!existsSync(path)) { console.log('  ' + label.padEnd(14) + 'not found'); return; }
  const s = statSync(path);
  const kb = (s.size / 1024).toFixed(1);
  const ago = Math.round((Date.now() - s.mtimeMs) / 60000);
  console.log('  ' + label.padEnd(14) + kb + ' KB  (modified ' + (ago < 2 ? 'just now' : ago + ' min ago') + ')');
  console.log('  ' + ' '.repeat(14) + path);
}

console.log('Log Health');
console.log('──────────');
fileInfo('ltm.jsonl', JSONL_LOG);
fileInfo('hooks.log', HOOKS_LOG);

// Last event timestamp from JSONL
if (existsSync(JSONL_LOG)) {
  try {
    const { readFileSync } = await import('fs');
    const lines = readFileSync(JSONL_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    console.log('  Last event:   ' + last.ts + '  (' + last.hook + ' / ' + last.event + ')');
  } catch {}
}
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
