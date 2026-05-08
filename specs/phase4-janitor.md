# Phase 4 — Janitor (v1.9.0)

**Goal:** The plugin curates itself. Decay, compression, and cleanup happen as background work, not O(N) JS loops.

---

## Prior Art (from LTM + codebase)

- `computeDecayScore(memory)` in `src/db.ts:190` — formula: `importance × confidence × 0.5^(days/halfLife)`. Half-lives: imp5=∞, imp4=180d, imp3=90d, imp2=30d, imp1=14d. Already correct — just not materialised.
- `runDecay()` in `src/janitor/decay.ts:27` — **O(N) JS loop**: loads all active memories, computes score per row in JS, issues N individual UPDATE statements. This is what Phase 4 replaces.
- `recall()` default sort in `src/db.ts:497` — **O(N) JS sort**: maps over fetched rows calling `computeDecayScore(m)` per row. Phase 4 replaces this with `ORDER BY decay_score DESC` in SQL.
- `runJanitor()` in `src/janitor/index.ts:49` — orchestrates embed → decay → promote → dedup. No archive step, no settings write after run, no `PRAGMA ANALYZE`.
- `/ltm:health` in `commands/health.md` — reads `decay_last_run` from settings (key name mismatch with what janitor writes). Phase 4 fixes alignment and adds janitor stats section.
- Last migration: `010_memory_embeddings_split.sql`. Next slots: **011**, **012**.

---

## Acceptance Criteria

### AC-1 — Migration 011: `decay_score` column + `memory_archive` table

File: `migrations/011_add_decay_score_and_archive.sql`

```sql
-- decay_score on memories
ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0;
CREATE INDEX IF NOT EXISTS idx_memories_decay_score ON memories (decay_score DESC);

-- archive table for compressed/evicted memories
CREATE TABLE IF NOT EXISTS memory_archive (
  id           INTEGER PRIMARY KEY,
  memory_json  TEXT    NOT NULL,
  archived_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  reason       TEXT    NOT NULL CHECK(reason IN ('decay','rollup','manual')),
  decay_score  REAL,
  project_scope TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_project ON memory_archive (project_scope);
CREATE INDEX IF NOT EXISTS idx_archive_reason  ON memory_archive (reason, archived_at DESC);
```

**Constraints:**
- `decay_score` defaults to `1.0` — freshly-learned memories are correct until janitor first runs.
- `memory_archive` uses the same `id` as the source memory (natural PK).
- Cascade FK on `memories` is unchanged — deleting from `memories` does NOT auto-delete from `memory_archive` (archive is a snapshot, not a live FK).

**Verified by:** `PRAGMA table_info(memories)` includes `decay_score`; `PRAGMA table_info(memory_archive)` returns correct columns.

---

### AC-2 — Migration 012: janitor settings seed

File: `migrations/012_seed_janitor_settings.sql`

```sql
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('janitor.enabled',            'true',   datetime('now')),
  ('janitor.last_run_at',        '',       datetime('now')),
  ('janitor.run_interval_hours', '24',     datetime('now')),
  ('janitor.last_archived',      '0',      datetime('now')),
  ('janitor.last_deprecated',    '0',      datetime('now')),
  ('janitor.last_decay_refreshed','0',     datetime('now'));
```

**Constraints:**
- `INSERT OR IGNORE` — safe to run on existing DBs with pre-existing keys.
- No breaking change to existing `SETTING_KEYS` in `src/janitor/providers/types.ts` — add new keys there.

---

### AC-3 — Batch decay refresh replaces JS O(N) loop

`src/janitor/decay.ts` — `runDecay()` becomes a **two-statement SQL batch**:

```sql
-- Statement 1: refresh decay_score for all active memories
UPDATE memories
SET decay_score = CASE
  WHEN importance = 5                THEN CAST(importance AS REAL) * confidence
  WHEN confirm_count >= 10           THEN CAST(importance AS REAL) * confidence
  WHEN importance = 4 THEN CAST(importance AS REAL) * confidence * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 180.0)
  WHEN importance = 3 THEN CAST(importance AS REAL) * confidence * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 90.0)
  WHEN importance = 2 THEN CAST(importance AS REAL) * confidence * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 30.0)
  ELSE                     CAST(importance AS REAL) * confidence * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 14.0)
END
WHERE status = 'active';

-- Statement 2: mark low-score memories deprecated
UPDATE memories
SET status = 'deprecated'
WHERE status = 'active'
  AND importance < 5
  AND confirm_count < 10
  AND decay_score < 0.25;
```

**Return type change:**
```typescript
export interface DecayResult {
  refreshed: number;   // rows touched by statement 1
  deprecated: number;  // rows touched by statement 2
  scanned: number;     // same as refreshed (kept for API compat)
}
```

**Constraints:**
- `power()` is available in SQLite 3.35+ (Bun bundles 3.46+). No JS fallback needed.
- Both statements run inside a single `BEGIN IMMEDIATE … COMMIT` transaction.
- The JS-loop variant is deleted entirely — no dead code.
- `computeDecayScore()` in `src/db.ts` is retained (used by `buildExplainer()` in Phase 3) but no longer called in the recall sort path.

---

### AC-4 — `recall()` default sort uses materialised `decay_score`

`src/db.ts` — the default sort branch:

**Before (O(N) JS):**
```typescript
sorted = rows.map(m => ({ m, score: computeDecayScore(m) })).sort((a, b) => b.score - a.score).map(({ m }) => m);
```

**After (O(log N) SQL):**

Add `decay_score` to the SELECT list in the `recall()` query, and use it in ORDER BY:

```sql
SELECT m.*, m.decay_score, ...
FROM memories m
WHERE ...
ORDER BY m.decay_score DESC
LIMIT ?
```

When no FTS or semantic query: sort is fully SQL-side. When FTS: keep FTS rank as primary, decay_score as secondary tiebreak.

**Constraints:**
- `decay_score` must be included in `Memory` type (already via the new column — migrations add it).
- `buildExplainer()` continues to call `computeDecayScore()` for the explainer breakdown — that is fine (it's post-fetch, not on the sort-hot-path).
- The `sort_by === "relevance"` default now means "ORDER BY decay_score DESC" when no query is given.

---

### AC-5 — Memory archive: `runArchive()` in `src/janitor/archive.ts`

New file. Archives deprecated memories that meet the eviction criteria:

**Eviction criteria:** `status = 'deprecated' AND importance <= 2 AND recall_count <= 1 AND decay_score < 0.10`

**Eviction is NOT deletion:** the full memory JSON is preserved in `memory_archive` before removal.

```typescript
export interface ArchiveResult {
  archived: number;
  skipped: number;  // deprecated but above threshold or protected
}

export function runArchive(): ArchiveResult
```

Algorithm:
1. `SELECT` all memories matching eviction criteria.
2. For each: `INSERT INTO memory_archive (id, memory_json, reason, decay_score, project_scope)`.
3. `DELETE FROM memories WHERE id = ?` (cascades to `memory_embeddings`, `memory_tags` via FK).
4. Both steps inside a single transaction per batch.

**Constraints:**
- Memories with `importance >= 3` are never evicted by archive — only deprecated.
- `recall_count <= 1` guard: a memory recalled even once gets a second chance (via decay refresh on next run).
- Archived memories are recoverable via `memory_archive` (no tooling needed in Phase 4 — Phase 7 adds replay).
- Batch size ≤ 100 per run to bound transaction duration.

---

### AC-6 — Janitor orchestrator: settings write + PRAGMA after each run

`src/janitor/index.ts` — `runJanitor()` additions:

1. **Add archive step** (after decay, before promote):
   ```typescript
   import { runArchive, type ArchiveResult } from "./archive.js";
   ```
   Step 2.5: `archiveResult = runArchive()`

2. **Write settings after successful run:**
   ```typescript
   setSetting('janitor.last_run_at',         new Date().toISOString());
   setSetting('janitor.last_deprecated',      String(decayResult.deprecated));
   setSetting('janitor.last_archived',        String(archiveResult.archived));
   setSetting('janitor.last_decay_refreshed', String(decayResult.refreshed));
   ```

3. **PRAGMA maintenance after each pass:**
   ```typescript
   db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
   db.exec('PRAGMA analysis_limit=400; ANALYZE;');
   ```

4. **`JanitorRunResult` extended:**
   ```typescript
   archive: ArchiveResult;    // new
   decayRefreshed: number;    // new (from DecayResult.refreshed)
   ```

**Constraints:**
- Settings writes happen only in the `finally` block — always written even if sub-tasks error.
- `PRAGMA ANALYZE` uses `analysis_limit=400` to bound its runtime on large DBs.
- WAL checkpoint is fire-and-forget (`TRUNCATE` mode, not `RESTART`).

---

### AC-7 — `SETTING_KEYS` extended

`src/janitor/providers/types.ts` — add to the `SETTING_KEYS` constant:

```typescript
JANITOR_ENABLED:             'janitor.enabled',
JANITOR_LAST_RUN_AT:         'janitor.last_run_at',
JANITOR_RUN_INTERVAL_HOURS:  'janitor.run_interval_hours',
JANITOR_LAST_ARCHIVED:       'janitor.last_archived',
JANITOR_LAST_DEPRECATED:     'janitor.last_deprecated',
JANITOR_LAST_DECAY_REFRESHED:'janitor.last_decay_refreshed',
```

`getDefault()` returns `'true'` for `enabled`, `'24'` for interval hours.

---

### AC-8 — `/ltm:health` janitor section

`commands/health.md` — add a **Janitor Status** section (always shown, no graph server dependency):

```
Janitor Status
──────────────
Last run:   2026-05-04T03:00:00Z  (14 h ago)
Refreshed:  347 memories  |  Deprecated: 2  |  Archived: 0
Next run:   2026-05-05T03:00:00Z  (in ~10 h)
```

The section reads from `settings` via the same `bun --eval` pattern the health command already uses:
```
keys: janitor.last_run_at, janitor.run_interval_hours,
      janitor.last_decay_refreshed, janitor.last_deprecated, janitor.last_archived
```

**Fix the key name mismatch**: the existing `health.md` reads `decay_last_run` — update it to `janitor.last_run_at`.

---

### AC-9 — Tests

#### Unit: `src/__tests__/janitor/decay.test.ts` (new)

- Decay SQL batch refreshes `decay_score` correctly for each importance level.
- `importance=5` always yields `decay_score >= importance * confidence` (no time decay).
- `confirm_count >= 10` always yields max score (protected).
- Memory 60 days old, importance=1 → score ≈ `1 × 1 × 0.5^(60/14)` ≈ 0.050 → `decay_score < 0.25` → deprecated.
- Protected memory (importance=5) never gets `status='deprecated'` regardless of age.

#### Unit: `src/__tests__/janitor/archive.test.ts` (new)

- `runArchive()` moves deprecated+eviction-criteria memories into `memory_archive`.
- Source row deleted from `memories` after archive.
- `memory_embeddings` row cascade-deleted (FK).
- Memory with `recall_count=2` is skipped by archive.
- Memory with `importance=3` is skipped even if deprecated.
- `memory_archive.memory_json` round-trips to valid JSON with original content.

#### Integration: extend `src/__tests__/integration/phase4.test.ts` (new)

- Full round-trip: `learn()` → age via SQL time-travel → `runJanitor()` → verify `decay_score` updated + deprecated count + `janitor.last_run_at` set in settings.
- `recall()` default sort order matches `decay_score DESC` from DB.
- Archive: deprecated memory below threshold → archived after `runArchive()` → gone from `memories`, present in `memory_archive`.

---

## Out of Scope for Phase 4

- LLM-assisted rollup summarisation (Phase 6 G-L stretch)
- `hook_events` 90-day retention pruning (requires `hook_events` table — Phase 1 artifact, not yet in schema)
- Replay/restore from archive (Phase 7)
- Graph-app janitor UI (Phase 6 G-N)

---

## File Inventory

| File | Change |
|------|--------|
| `migrations/011_add_decay_score_and_archive.sql` | NEW |
| `migrations/012_seed_janitor_settings.sql` | NEW |
| `src/janitor/decay.ts` | MODIFY — replace JS loop with SQL batch |
| `src/janitor/archive.ts` | NEW |
| `src/janitor/index.ts` | MODIFY — add archive step, settings write, PRAGMA |
| `src/janitor/providers/types.ts` | MODIFY — add SETTING_KEYS entries |
| `src/db.ts` | MODIFY — recall() default sort uses decay_score |
| `commands/health.md` | MODIFY — add Janitor Status section, fix key name |
| `src/__tests__/janitor/decay.test.ts` | NEW |
| `src/__tests__/janitor/archive.test.ts` | NEW |
| `src/__tests__/integration/phase4.test.ts` | NEW |
| `package.json` + `.claude-plugin/plugin.json` | MODIFY — bump to 1.9.0 |

---

## Performance Budget

| Path | Before Phase 4 | After Phase 4 | Budget |
|------|---------------|---------------|--------|
| `recall()` default sort (10k memories) | O(N) JS sort ~40ms | O(log N) SQL ~3ms | < 50ms p95 |
| `runDecay()` janitor pass (10k memories) | N×UPDATE ~2s | 2×SQL ~30ms | < 1s |
| `runArchive()` (batch 100) | — | ~5ms | < 100ms |
