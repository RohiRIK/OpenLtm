---
description: "DEPRECATED — use /ltm:health instead (now includes inline decay summary). Run a memory decay diagnostic."
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:health` instead — it now includes the decay summary inline. This alias will be removed in v1.6.0.

```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
const all = db.query(\"SELECT * FROM memories WHERE status='active'\").all();
const dep = db.query(\"SELECT COUNT(*) as n FROM memories WHERE status='deprecated'\").get();
const lastRun = db.query(\"SELECT value FROM settings WHERE key='decay_last_run'\").get()?.value ?? 'never';

const now = Date.now();
const scored = all.map(m => {
  const ageDays = (now - new Date(m.last_used_at ?? m.created_at).getTime()) / 86400000;
  const recency = Math.exp(-ageDays / 30);
  return { ...m, score: (m.importance ?? 1) * (m.confidence ?? 1) * recency * (1 + (m.confirm_count ?? 0) * 0.1) };
});

const buckets = [
  ['0–0.25 (at-risk)',   scored.filter(m => m.score < 0.25)],
  ['0.25–1 (low)',       scored.filter(m => m.score >= 0.25 && m.score < 1)],
  ['1–2 (medium)',       scored.filter(m => m.score >= 1 && m.score < 2)],
  ['2–3 (high)',         scored.filter(m => m.score >= 2 && m.score < 3)],
  ['3+ (critical)',      scored.filter(m => m.score >= 3)],
];

console.log('Active: ' + all.length + ' | Deprecated: ' + (dep?.n ?? 0));
console.log('Last decay run: ' + lastRun);
console.log('');
console.log('Score Distribution:');
for (const [label, mems] of buckets) console.log('  ' + label + ': ' + mems.length);
console.log('');
console.log('Top 5 At-Risk (score 0.25–0.5):');
const atRisk = scored.filter(m => m.score >= 0.25 && m.score < 0.5).sort((a,b) => a.score - b.score).slice(0, 5);
if (!atRisk.length) { console.log('  (none)'); }
else atRisk.forEach(m => console.log('  [' + m.id + '] score=' + m.score.toFixed(3) + ' imp=' + m.importance + '  ' + m.content.substring(0, 80)));
"
```

To trigger decay now (marks stale memories as deprecated):
```bash
bun run "${CLAUDE_PLUGIN_ROOT}/src/migrations.ts" --decay
```
