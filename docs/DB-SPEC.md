# DB-SPEC — Claude LTM Plugin Database Specification

**Version:** 1.0
**Owner:** database-admin (dev-team)
**Status:** Baseline spec against plugin v1.4.20 schema; forward spec to v2.2.x
**Last updated:** 2026-05-02
**Companion documents:** `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/ROADMAP.md`

This document is the authoritative reference for the LTM plugin data tier. It covers
the current schema (annotated), index strategy, FTS5 configuration, the decay model,
the migration system, concurrency safety, the full "magnificent" DDL target, performance
at scale, and the per-phase schema evolution plan aligned to `ROADMAP.md §3`.

`ROADMAP.md §6` (Schema Evolution) references this document. Once sections land, that
doc's phase tables should be updated to reference the exact migration filenames defined
in §9 below.

---

## Table of Contents

1. Current Schema — Annotated
2. Index Strategy Analysis
3. FTS5 Configuration and Recall
4. Memory Decay Model
5. Migration System
6. Concurrency and Safety
7. The Magnificent Schema — Full DDL
8. Performance at Scale
9. Migration Path — Schema Evolution

---

## 1. Current Schema — Annotated

The entire data store is one SQLite file: `${CLAUDE_PLUGIN_DATA}/ltm-ltm/ltm.db`.
Accessed exclusively through `src/shared-db.ts:getDb()`. WAL mode, foreign keys on,
busy_timeout 5 000 ms set on every connection.

Schema source of truth: `src/schema.sql` (initial tables + FTS + triggers).
Migration overlay: `src/shared-db.ts:runMigrations()` (idempotent column adds).

### 1.1 `memories`

The core table. Every durable insight the plugin has stored, whether from `ltm_learn`,
GitLearn backfill, EvaluateSession, or bundle import.

```sql
CREATE TABLE memories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Content and classification
  content           TEXT    NOT NULL,
  category          TEXT    NOT NULL CHECK(category IN (
                      'preference','architecture','gotcha','pattern','workflow','constraint')),
  importance        INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  confidence        REAL    NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0.0 AND 1.0),
  source            TEXT,                       -- free-text provenance hint (pre-Phase 2)
  project_scope     TEXT,                       -- NULL = global; else project_name
  dedup_key         TEXT    UNIQUE,             -- normalised hash; prevents repeat learns

  -- Timestamps
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_confirmed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  confirm_count     INTEGER NOT NULL DEFAULT 1,

  -- Lifecycle (Phase 2 migration, now in schema.sql)
  status            TEXT    NOT NULL DEFAULT 'active' CHECK(status IN (
                      'active','pending','deprecated','superseded')),

  -- Embedding (Phase 1 split candidate)
  embedding         BLOB,                       -- float32 vector; stripped from MCP responses

  -- Recall telemetry (Phase 3 migration)
  last_used_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  first_recalled_at TEXT,
  last_recalled_at  TEXT,
  recall_count      INTEGER NOT NULL DEFAULT 0,

  -- Supersession chain (Phase 2 migration)
  superseded_by     INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  superseded_at     TEXT,

  -- Multi-agent metadata (T16 migration)
  workspace_id      TEXT,
  agent_id          TEXT
);
```

**Column rationale**

| Column | Rationale |
|--------|-----------|
| `category` | Six-value enum enforced by CHECK; drives the SessionStart injection filter (importance-5 + category) |
| `importance` | 1–5 ordinal; 5 = immortal (no decay); drives every-session injection threshold |
| `confidence` | Reserved for EvaluateSession and the future janitor's auto-demotion logic; not yet surfaced to users |
| `dedup_key` | UNIQUE; prevents a session that keeps re-learning the same fact from polluting the table; computed by the Learn Engine as a normalised content hash |
| `project_scope` | NULL = global (injected in all sessions); non-null = scoped to one project (joined against the `registry.json` project_name) |
| `status` | Soft-delete / workflow state; recall queries filter to `status = 'active'` |
| `embedding` | Stored as a raw BLOB (float32 array). At 1536 dimensions = ~6 KB per row; serialised to JSON over MCP it becomes ~260 KB. The compact formatter strips it before every MCP response. Phase 1 moves it to a separate table. |
| `last_used_at`, `last_recalled_at`, `recall_count` | Inputs to the recall-time decay calculation. `last_used_at` covers both learn-time touch and recall-time touch; `last_recalled_at` covers recall only. |
| `superseded_by` | Self-referential FK; forms the supersession chain for time-travel (Phase 7) |
| `workspace_id`, `agent_id` | Multi-agent isolation (ROADMAP Phase 5 / T16); both indexed |

### 1.2 `context_items`

Per-project short-term context. Replaces the four Markdown files that existed before v1.0.

```sql
CREATE TABLE context_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK(type IN ('goal','decision','progress','gotcha')),
  content      TEXT    NOT NULL,
  session_id   TEXT,                          -- for progress dedup across same session
  permanent    INTEGER NOT NULL DEFAULT 0,    -- 1 = never auto-trim (decision, gotcha)
  memory_id    INTEGER REFERENCES memories(id) ON DELETE SET NULL,  -- Phase 1 migration
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN (
                 'active','pending_promotion','promoted')),          -- Phase 2 migration
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  workspace_id TEXT,                          -- T16 multi-agent isolation
  agent_id     TEXT                           -- T16
);
```

**Lifecycle by type**

| Type | `permanent` | Trim rule |
|------|-------------|-----------|
| `goal` | 0 | Replaced when a new goal is written |
| `decision` | 1 | Never auto-trimmed; manual removal only |
| `progress` | 0 | Trimmed to last 20 per project by UpdateContext hook |
| `gotcha` | 1 | Never auto-trimmed |

**`status` flow**

```
active -> pending_promotion -> promoted
                           (memory_id set once promoted to memories table)
```

### 1.3 `tags` and `memory_tags`

Many-to-many tagging for memories. Tags are auto-created on use; the dictionary is normalised to avoid duplication.

```sql
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE memory_tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (memory_id, tag_id)
);
```

No additional indexes needed: the composite PK covers `(memory_id, tag_id)` lookup; `ON DELETE CASCADE` keeps the join table clean without a separate job.

### 1.4 `memory_relations`

Knowledge graph edges. Six typed relationship directions. Used by `ltm_relate` and traversed by `ltm_graph` (BFS via `src/graph.ts`).

```sql
CREATE TABLE memory_relations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
                      'supports','contradicts','refines','depends_on','related_to','supersedes')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_memory_id, target_memory_id, relationship_type)
);
```

The UNIQUE constraint on the triple prevents duplicate edges for the same relationship type. Cascade on both FKs means deleting a memory automatically prunes all edges.

### 1.5 `memories_fts`

FTS5 external-content virtual table. Shadows `memories.content`. Maintained by three triggers.

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='id'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
```

See §3 for full FTS5 configuration analysis.

### 1.6 `settings`

Key-value store for janitor configuration, provider selection, decay parameters, and
feature flags.

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Known keys (as of v1.4.20):

| Key | Expected type | Purpose |
|-----|--------------|---------|
| `decay.half_life_days` | integer | Days before a non-recalled memory halves its rank boost |
| `decay.immortal_importance` | integer | Importance threshold above which decay is skipped |
| `embedding.provider` | string | `null` / `local-hash` / `claude-tool` / `onnx` |
| `janitor.enabled` | boolean | Master switch for Phase 4 janitor |
| `janitor.last_run_at` | ISO8601 | Timestamp of last janitor pass |

---

## 2. Index Strategy Analysis

### 2.1 Existing indexes

| Index | Table | Columns | Rationale |
|-------|-------|---------|-----------|
| `idx_ctx_project` | `context_items` | `project_name` | SessionStart: `WHERE project_name = ?` |
| `idx_ctx_type` | `context_items` | `(project_name, type)` | SessionStart per-type fetch; composite covers both equality predicates |
| `idx_memories_category` | `memories` | `category` | Filter by category in recall and health commands |
| `idx_memories_project` | `memories` | `project_scope` | Scoped recall: `WHERE project_scope = ? OR project_scope IS NULL` |
| `idx_memories_importance` | `memories` | `importance DESC` | SessionStart global injection (`importance = 5`); importance ordering |
| `idx_memories_confidence` | `memories` | `confidence DESC` | Future janitor demotion; currently unused on hot path |
| `idx_memories_status` | `memories` | `status` | All read paths filter `status = 'active'` |
| `idx_memories_last_used` | `memories` | `last_used_at` | Decay input; janitor staleness scan |
| `idx_memories_superseded` | `memories` | `superseded_by` | Supersession chain traversal |
| `idx_memories_recall_count` | `memories` | `recall_count DESC` | Health reporting: top-recalled memories |
| `idx_memories_workspace` | `memories` | `workspace_id` | T16 multi-agent isolation |
| `idx_memories_agent` | `memories` | `agent_id` | T16 |
| `idx_relations_source` | `memory_relations` | `source_memory_id` | BFS forward traversal |
| `idx_relations_target` | `memory_relations` | `target_memory_id` | BFS reverse traversal |

### 2.2 Hot-path scan analysis

**Hot path 1: `ltm_recall` (most frequent)**

Query skeleton:
```sql
SELECT m.id, m.content, m.importance, m.last_recalled_at, m.recall_count
FROM memories_fts
JOIN memories m ON memories_fts.rowid = m.id
WHERE memories_fts MATCH ?
  AND m.status = 'active'
  AND (m.project_scope = ? OR m.project_scope IS NULL)
ORDER BY memories_fts.rank, m.importance DESC
LIMIT 10;
```

Hits: `memories_fts` (FTS5 own index), `idx_memories_status`, `idx_memories_project`.
Gap: the `ORDER BY` applies FTS5 BM25 rank then falls back to a table scan for `importance DESC`. A covering index on `(status, project_scope, importance DESC)` would eliminate the table scan for the secondary sort. This is a low-priority improvement since FTS5 already constrains the result set to a small rowid list.

**Hot path 2: SessionStart context injection**

Query skeleton:
```sql
SELECT * FROM context_items
WHERE project_name = ? AND status = 'active'
ORDER BY type, created_at;

SELECT * FROM memories
WHERE status = 'active' AND importance = 5 AND project_scope IS NULL
ORDER BY importance DESC, last_recalled_at DESC
LIMIT 15;
```

Hits: `idx_ctx_type` (covers both predicates), `idx_memories_importance` + `idx_memories_status`.
Gap: the memories query uses a range scan on importance filtered by status. A compound index `(status, importance DESC)` would be a covering scan. Add in Phase 0.

**Hot path 3: UpdateContext progress trim**

```sql
DELETE FROM context_items
WHERE project_name = ? AND type = 'progress'
  AND id NOT IN (
    SELECT id FROM context_items
    WHERE project_name = ? AND type = 'progress'
    ORDER BY created_at DESC LIMIT 20
  );
```

Hits: `idx_ctx_type`. Sub-select is a sequential scan of the progress partition per project. At <= 20 rows per project this is fine; the outer DELETE hit count is always near zero.

### 2.3 Missing indexes (to add in migrations)

| Index to add | Table | Columns | Why |
|---|---|---|---|
| `idx_memories_status_importance` | `memories` | `(status, importance DESC)` | Hot path 2: eliminates filter + sort split |
| `idx_memories_created_at` | `memories` | `created_at` | Decay calculation, janitor oldest-first scan |
| `idx_memories_last_recalled_at` | `memories` | `last_recalled_at` | Decay input; janitor stale scan |
| `idx_ctx_project_type_created` | `context_items` | `(project_name, type, created_at DESC)` | UpdateContext trim sub-select; also SessionStart per-type ordered fetch |

Phase 0 migration file: `0002_add_hot_path_indexes.sql`.

---

## 3. FTS5 Configuration and Recall

### 3.1 Current configuration

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='id'
);
```

- **Tokenizer:** SQLite default (`unicode61`). Handles Unicode casing and stemming at the Unicode 6.1 level. Adequate for English natural-language memories; does not do language-specific stemming.
- **Content mode:** External-content (`content='memories'`). The FTS index does not store original text; it defers to the base table for snippets. This halves FTS storage cost at the price of a join on every snippet request.
- **`content_rowid='id'`:** Maps FTS rowids directly to `memories.id`. The JOIN in recall queries is a rowid lookup — O(log N) on the B-tree.
- **Triggers:** Three triggers keep the index in sync (insert, delete, update). These are synchronous — no async lag. They run inside the same transaction as the base table write.

### 3.2 BM25 ranking

FTS5's built-in `rank` function is BM25. Default parameters: `b=0.75, k1=1.2`. No column weights configured (single-column index).

The Recall Engine applies a post-BM25 multiplier in TypeScript:

```
final_score = bm25_rank * importance_weight * decay_factor * recency_boost
```

Where:
- `importance_weight` = 1.0 + (importance - 1) * 0.25 (range 1.0–2.0)
- `decay_factor` = computed per §4
- `recency_boost` = 1.0 + clamp(30 - days_since_recalled, 0, 30) / 30 * 0.5

### 3.3 Query patterns

**Primary (keyword):**
```sql
SELECT memories_fts.rowid, memories_fts.rank
FROM memories_fts
WHERE memories_fts MATCH ?
ORDER BY rank;
```

FTS5 MATCH operators in use: phrase search (`"exact phrase"`), prefix (`word*`), implicit AND for multi-word queries.

**Semantic fallback (triggered when FTS5 returns < 3 results):**

The semantic path reads all active memories with an `embedding` BLOB, computes cosine similarity in TypeScript against the query embedding, and merges with the FTS5 results. This is an O(N) scan — see §4.2 for the scale problem and §7 for the Phase 1 `memory_embeddings` split that isolates this cost.

**Merge and dedup:**

Results from both paths are merged by `id`. Duplicates are resolved by taking the higher score. The combined list is re-ranked by `final_score` before top-N truncation.

### 3.4 FTS5 integrity

External-content tables are not self-healing: if the base table is modified outside the trigger path (e.g., a direct `UPDATE` via `sqlite3` CLI), the FTS index will drift. Detection:

```sql
INSERT INTO memories_fts(memories_fts) VALUES ('integrity-check');
```

Returns OK if the shadow tables are consistent. A Phase 0 `ltm:admin` sub-command should run this check on demand.

### 3.5 Planned improvements

- **Phase 0:** Add a `PRAGMA integrity_check` wrapper and an FTS integrity check to `/ltm:admin`.
- **Phase 3:** Add a `category` column to `memories_fts` so category filtering can be pushed into the FTS query rather than applied as a post-filter join:
  ```sql
  CREATE VIRTUAL TABLE memories_fts USING fts5(
    content, category,
    content='memories', content_rowid='id'
  );
  ```
  This doubles the trigger complexity (both columns must be maintained) but enables:
  ```sql
  WHERE memories_fts MATCH 'category:gotcha AND <query>'
  ```

---

## 4. Memory Decay Model

### 4.1 Current implementation

Decay is computed **at recall time** in TypeScript. No stored score. The inputs are columns already on `memories`:

| Input | Column | Role |
|-------|---------|------|
| Age | `created_at` | Base staleness |
| Last touched | `last_recalled_at` | Freshness signal |
| Frequency | `recall_count` | Utility signal |
| Weight | `importance` | Override signal |

**Current rules (approximate, inferred from Recall Engine source):**

1. If `importance == 5`, skip decay entirely. Score = BM25 * importance_weight.
2. Else compute `days_stale = (now - last_recalled_at) in days`.
3. If `days_stale > 90 AND importance < 3`:
   ```
   decay_factor = max(0.1, 1 - (days_stale - 90) / 365)
   ```
   Linear decay from 1.0 at day 90 to ~0.1 at day 455.
4. If `days_stale <= 30`: apply recency boost (`+0 to +50%`).
5. Else: `decay_factor = 1.0` (no decay for mid-range memories).

**Decay function shape:** piecewise linear. The exact shape remains OQ3 (open question in ROADMAP §5) to be resolved in Phase 4 with real recall telemetry.

### 4.2 The O(N) problem (Architecture W4)

The current implementation fetches the full FTS5 result set (typically up to 50 rows from a BM25 scan), then applies the decay multiplier in JavaScript for each row. At 10k memories the FTS5 result set is well-bounded; the JS multiplication is negligible.

At 100k+ memories, the semantic fallback path scans all rows with an embedding BLOB, computing cosine similarity for each. This is O(N) and breaks the 200 ms recall budget.

The problem has two distinct components:

| Component | Current | At 100k |
|-----------|---------|---------|
| FTS5 BM25 scan | O(log N + k) rowids | Bounded; fast |
| JavaScript decay multiply | O(k) where k = result set | Bounded; fast |
| Semantic fallback (embedding scan) | O(N) across all rows | **Slow: ~500ms estimated** |
| Final merge and sort | O(k log k) | Bounded |

### 4.3 Fix spec: materialised `decay_score` (Phase 4)

Add a `decay_score REAL` column to `memories`. A low-frequency janitor process refreshes it on a schedule (nightly by default, configurable via `settings`).

**Migration:** `0012_add_decay_score.sql`
```sql
ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0;
CREATE INDEX idx_memories_decay_score ON memories(decay_score DESC);
```

**Janitor refresh logic (pseudo-SQL):**
```sql
UPDATE memories
SET decay_score = CASE
  WHEN importance = 5 THEN 1.0
  WHEN julianday('now') - julianday(last_recalled_at) > 90
    AND importance < 3
    THEN MAX(0.1,
      1.0 - (julianday('now') - julianday(last_recalled_at) - 90.0) / 365.0
    )
  WHEN julianday('now') - julianday(last_recalled_at) <= 30
    THEN MIN(1.5,
      1.0 + (30.0 - (julianday('now') - julianday(last_recalled_at))) / 30.0 * 0.5
    )
  ELSE 1.0
END
WHERE status = 'active';
```

**Recall query after Phase 4:**
```sql
SELECT m.id, m.content, m.importance, m.decay_score,
       (memories_fts.rank * (1.0 + (m.importance - 1) * 0.25) * m.decay_score) AS final_score
FROM memories_fts
JOIN memories m ON memories_fts.rowid = m.id
WHERE memories_fts MATCH ?
  AND m.status = 'active'
  AND (m.project_scope = ? OR m.project_scope IS NULL)
ORDER BY final_score DESC
LIMIT 10;
```

The decay multiply moves into SQL, uses the pre-materialised `decay_score`, and the query becomes O(log N + k). The semantic fallback becomes the only O(N) path, resolved by the `memory_embeddings` split (Phase 1) and an ANN index (Phase 3 stretch goal).

**Trade-off:** Write amplification. Every `ltm_learn` does not update `decay_score` — the janitor does. There is a staleness window of up to 24 hours. This is acceptable: decay is a rank modifier, not a hard filter. A freshly-learned memory has `decay_score = 1.0` (default) which is correct.

**Janitor run record:** stored in `settings` as `janitor.last_run_at`. The `/ltm:health` command surfaces it.

---

## 5. Migration System

### 5.1 Current risks (Architecture W3)

`src/shared-db.ts:runMigrations()` is an imperative list of `hasColumn` guards followed by `ALTER TABLE` statements. Problems:

1. **No migration history.** There is no record of which migrations have run against a given DB. If a migration is renamed or reordered, it may re-run or be skipped silently.
2. **No version table.** Impossible to answer "what schema version is this DB?" from outside the code.
3. **No rollback path.** Each migration is a one-way `ALTER TABLE`. There is no down-migration.
4. **Order coupling.** Migrations are ordered by their position in a single function. Adding a migration in the middle risks breaking callers that depend on run order.
5. **No checksum.** A migration can be silently edited after it has run; there is no detection.
6. **Testing gap.** The migration function is tested only indirectly via integration tests on the full DB. No isolated migration unit test.

### 5.2 Spec: `schema_migrations` table (Phase 0)

Add a `schema_migrations` table that is the source of truth for migration state.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,             -- monotonic integer, e.g. 1, 2, 3
  name        TEXT    NOT NULL,                -- human-readable slug, e.g. 'add_hot_path_indexes'
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  checksum    TEXT    NOT NULL                 -- SHA-256 hex of the migration SQL file content
);
```

**Migration file naming convention:**
```
db/migrations/NNNN_<slug>.sql
```

Where `NNNN` is a zero-padded four-digit integer. Example:
```
db/migrations/0001_initial_schema.sql
db/migrations/0002_add_hot_path_indexes.sql
db/migrations/0003_schema_migrations_table.sql
```

The migration runner (`src/migrator.ts`, Phase 0):

1. Ensure `schema_migrations` table exists (self-bootstrapping DDL).
2. Read all `db/migrations/*.sql` files, sorted by version number.
3. For each file: check if `version` exists in `schema_migrations`. If not:
   - Compute SHA-256 of file content.
   - Execute the SQL inside a transaction.
   - INSERT into `schema_migrations(version, name, checksum)`.
4. If `version` exists: compare stored checksum vs. current file checksum. If mismatch, log a warning (do not fail; the file may have been legitimately patched post-apply with a comment).
5. Replace `runMigrations()` in `shared-db.ts` with a call to `runMigrator(db)`.

**Backfill migration (0001):** represents the state after all current `hasColumn` guards have run. No SQL needed; just insert a sentinel row:
```sql
INSERT OR IGNORE INTO schema_migrations(version, name, checksum)
VALUES (1, 'initial_schema_backfill', 'backfilled');
```

**Rollback posture.** SQLite does not support `DROP COLUMN` before version 3.35.0 and many embeddings use older versions. Rollback migrations are therefore not always possible. The policy:

- Additive migrations (ADD COLUMN, CREATE TABLE, CREATE INDEX): always rollback-possible with a companion `_down.sql` file (not executed automatically; manual emergency only).
- Destructive migrations (DROP TABLE, DROP COLUMN): must include an explicit "data loss acknowledged" comment in the migration file and must be gated on a major version bump.

### 5.3 Migration runner location

`src/migrator.ts` — called from `shared-db.ts:getDb()` after WAL mode and foreign keys are set, before `schema.sql` is executed. Sequence:

```
getDb()
  -> PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000;
  -> runMigrator(db)           // versioned migrations first
  -> exec(schema.sql)          // idempotent CREATE TABLE IF NOT EXISTS (no-ops after first run)
```

The `schema.sql` file must remain idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) so it is safe to re-execute after migrations.

---

## 6. Concurrency and Safety

### 6.1 WAL mode

Set at connection open:
```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

WAL mode permits concurrent readers with a single writer. Multiple readers never block each other. A writer blocks only other writers. The 5 000 ms busy timeout provides graceful retry for the second writer rather than an immediate `SQLITE_BUSY` error.

### 6.2 Current race conditions

**Race 1: Two Claude Code sessions starting simultaneously.**

Both spawn a `SessionStart` hook. Both call `runMigrations()` concurrently against the same DB. `ALTER TABLE` statements inside migrations are not atomic across processes.

Risk: one process runs `ALTER TABLE memories ADD COLUMN workspace_id TEXT` while the other is mid-read. With WAL, the ALTER acquires an EXCLUSIVE lock momentarily; the reader retries. The busy_timeout absorbs this for 5 s. Actual risk of corruption: low. Actual risk of a 5 s stall on session start: real.

**Fix (Phase 0):** Wrap `runMigrations()` (replaced by `runMigrator()`) in an advisory lock:
```sql
BEGIN IMMEDIATE;
-- migration DDL here
COMMIT;
```

`BEGIN IMMEDIATE` acquires a RESERVED lock, blocking other writers without blocking readers. If a second migrator tries `BEGIN IMMEDIATE` concurrently, it waits up to `busy_timeout` (5 s). After Phase 0, migration runs are idempotent checks (row existence) so the critical section is tiny.

**Race 2: Concurrent writes to `registry.json` (Architecture W2).**

Two sessions auto-registering different cwds simultaneously use a read-modify-write pattern with no file lock. Last writer wins; the other registration is silently lost.

Fix (Phase 0): Replace `fs.writeFileSync` with an atomic rename pattern:
```typescript
const tmp = `${registryPath}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
fs.renameSync(tmp, registryPath);  // atomic on POSIX
```

`rename()` is atomic on POSIX for files on the same filesystem. On Windows, `fs.renameSync` is not atomic; the fix there is to use a platform-specific file lock. Note: the long-term fix (Phase 1) moves the registry into the DB as a `projects` table, making this moot.

**Race 3: Multiple MCP server instances (Architecture W12).**

Two Claude Code windows against the same project each start an MCP server. Each holds a connection. Both have WAL readers; writes are serialised by WAL automatically. Risk of data corruption: none (SQLite guarantees this). Risk of stale reads: possible if one writer commits while the other is mid-query. WAL snapshot isolation per transaction means neither session sees a partial write.

Accepted posture (Phase 0): document WAL semantics; no application-level coordinator. Phase 1 DAO introduction is the natural place to add optional write queuing if metrics show contention.

### 6.3 `withRetry` helper (already implemented)

`src/shared-db.ts:withRetry<T>(fn, maxRetries=3)` wraps any DB operation with exponential backoff on `SQLITE_BUSY`. Spin-wait between retries: 50 ms, 100 ms, 200 ms. Sufficient for the single-developer concurrency model. Not sufficient for a team sharing a DB file over a network filesystem (that scenario is out of scope; cloud sync uses CRDT, not shared filesystem).

### 6.4 Foreign key enforcement

`PRAGMA foreign_keys=ON` is set on every connection. SQLite does not enforce FKs by default; this pragma must be set per-connection, not per-database. All cascade rules (`ON DELETE CASCADE`, `ON DELETE SET NULL`) depend on this being set before any write.

Risk: a third-party tool (e.g., `sqlite3` CLI) that omits the pragma can silently break FK invariants. The Phase 2 audit table catches this after the fact; there is no pre-connection enforcement short of triggers.

---

## 7. The Magnificent Schema — Full DDL

This section specifies the target DDL for all new tables introduced across Phases 0–7.
These are not yet in `schema.sql`; they are introduced via numbered migrations (§9).

### 7.1 `schema_migrations` (Phase 0)

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  checksum    TEXT    NOT NULL
);
```

### 7.2 `projects` (Phase 1 — registry in DB)

Replaces `registry.json`. Enables atomic CAS updates and FK references.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT    NOT NULL UNIQUE,
  cwd          TEXT    NOT NULL UNIQUE,
  registered_at TEXT   NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT   NOT NULL DEFAULT (datetime('now')),
  workspace_id  TEXT,
  metadata      TEXT                                  -- JSON blob for extensible fields
);

CREATE INDEX IF NOT EXISTS idx_projects_cwd ON projects(cwd);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
```

### 7.3 `memory_embeddings` (Phase 1 — split from `memories`)

Isolates the BLOB from the hot row. MCP queries never join this table. Embedding provider writes here; recall only touches it during the semantic fallback path.

```sql
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id   INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL,                  -- e.g. 'local-hash', 'claude-tool', 'onnx'
  model       TEXT,                              -- model id or version used to generate
  dimensions  INTEGER NOT NULL,
  vec         BLOB    NOT NULL,                  -- float32 array, length = dimensions
  generated_at TEXT   NOT NULL DEFAULT (datetime('now'))
);
```

Migration: `0006_split_embeddings.sql` — copies `memories.embedding` into this table for all rows where it is not null, then drops the `embedding` column from `memories`.

After this migration, the MCP compact formatter no longer needs to strip embeddings — they are unreachable via the standard recall join.

### 7.4 `hook_events` (Phase 1 — structured observability)

Append-only log of hook and MCP tool invocations. Solves Architecture W1 and W5.

```sql
CREATE TABLE IF NOT EXISTS hook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL CHECK(event_type IN (
                'session_start','pre_compact','evaluate_session','update_context',
                'ltm_recall','ltm_learn','ltm_forget','ltm_relate',
                'ltm_context','ltm_context_items','ltm_graph','janitor_run')),
  project_name TEXT,
  session_id  TEXT,
  status      TEXT    NOT NULL CHECK(status IN ('ok','error','warn')),
  latency_ms  INTEGER,
  result_count INTEGER,                          -- rows returned (for recall)
  error_msg   TEXT,                              -- populated on status='error'
  payload     TEXT,                              -- JSON, optional; truncated to 1 KB
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hook_events_type ON hook_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hook_events_project ON hook_events(project_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hook_events_status ON hook_events(status, created_at DESC);
```

Retention: rows older than 90 days are pruned by the janitor. `/ltm:health` aggregates from this table for latency p50/p95, error rates, and recall hit rates.

### 7.5 `memory_provenance` (Phase 2 — C5)

One-to-many: a memory may have multiple provenance entries (e.g., originally from a git commit, later confirmed by EvaluateSession).

```sql
CREATE TABLE IF NOT EXISTS memory_provenance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_type TEXT    NOT NULL CHECK(source_type IN (
                'learn','git-backfill','evaluate-session','import-bundle',
                'user-promotion','janitor-rollup','legacy')),
  source_ref  TEXT,                              -- session_id, git SHA, bundle_id, etc.
  actor       TEXT,                              -- 'mcp:ltm_learn', 'hook:evaluate_session', etc.
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  metadata    TEXT                               -- JSON; e.g. {"turn": 7, "score": 0.92}
);

CREATE INDEX IF NOT EXISTS idx_provenance_memory ON memory_provenance(memory_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source_type ON memory_provenance(source_type, created_at DESC);
```

Backfill: all existing memories get a single `legacy` provenance row at migration time.

### 7.6 `memory_audit` (Phase 2 — W11, C5, C9)

Append-only audit log. Every write to the `memories` table (insert, update, forget/deprecate, redact) produces an audit row. Powers time-travel (Phase 7) and `/ltm:admin audit`.

```sql
CREATE TABLE IF NOT EXISTS memory_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL,                 -- NOT FK: must survive memory deletion
  op          TEXT    NOT NULL CHECK(op IN (
                'insert','update','forget','deprecate','supersede','redact','restore')),
  actor       TEXT    NOT NULL,                 -- 'mcp:ltm_learn', 'hook:evaluate_session', etc.
  session_id  TEXT,
  before_json TEXT,                             -- JSON snapshot of row before op (null for insert)
  after_json  TEXT,                             -- JSON snapshot of row after op (null for delete)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_memory ON memory_audit(memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_op ON memory_audit(op, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_session ON memory_audit(session_id, created_at DESC);
```

Note: `memory_id` is intentionally **not** a foreign key. A forgotten memory must still have an audit trail. The audit row survives `DELETE FROM memories`.

`before_json` and `after_json` store a JSON snapshot of the relevant columns (excluding `embedding` BLOB to avoid bloat). The Phase 7 replay engine uses these to reconstruct past states.

### 7.7 `team_bundles` (Phase 6 — C3)

Tracks imported and exported memory bundles.

```sql
CREATE TABLE IF NOT EXISTS team_bundles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id     TEXT    NOT NULL UNIQUE,         -- UUID, assigned at export time
  direction     TEXT    NOT NULL CHECK(direction IN ('export','import')),
  status        TEXT    NOT NULL CHECK(status IN ('pending','accepted','rejected','partial')),
  signer_key_id TEXT,                            -- fingerprint of the signing keypair
  signature     TEXT,                            -- base64-encoded Ed25519 signature
  memory_count  INTEGER NOT NULL DEFAULT 0,
  source_peer   TEXT,                            -- optional: who sent the bundle
  bundle_path   TEXT,                            -- local path to the .ltm-bundle file
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at   TEXT,
  metadata      TEXT                             -- JSON: schema_version, export_format, etc.
);

CREATE INDEX IF NOT EXISTS idx_bundles_status ON team_bundles(status, created_at DESC);
```

### 7.8 `bundle_memories` (Phase 6 — C3)

Join table linking an imported bundle to the memories it created or attempted to create.

```sql
CREATE TABLE IF NOT EXISTS bundle_memories (
  bundle_id TEXT    NOT NULL REFERENCES team_bundles(bundle_id) ON DELETE CASCADE,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  import_status TEXT NOT NULL CHECK(import_status IN ('accepted','rejected','merged')),
  merge_target_id INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  PRIMARY KEY (bundle_id, memory_id)
);
```

### 7.9 `signing_keys` (Phase 6 — C3)

Trusted public keys for bundle verification.

```sql
CREATE TABLE IF NOT EXISTS signing_keys (
  key_id      TEXT PRIMARY KEY,                 -- fingerprint (SHA-256 of public key)
  public_key  TEXT NOT NULL,                    -- base64-encoded Ed25519 public key
  label       TEXT,                             -- human name, e.g. "Tara's MacBook"
  trusted     INTEGER NOT NULL DEFAULT 1,       -- 0 = revoked
  added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);
```

### 7.10 `memory_conflicts` (Phase 6 — C4)

Staged conflicts detected by the Learn Engine's similarity check. User resolves at next SessionStart.

```sql
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  incoming_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  conflicting_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE SET NULL,
  similarity_score REAL    NOT NULL,
  conflict_type   TEXT    NOT NULL CHECK(conflict_type IN ('duplicate','contradiction','overlap')),
  resolution      TEXT    CHECK(resolution IN ('accepted','rejected','superseded','coexist')),
  resolved_at     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conflicts_incoming ON memory_conflicts(incoming_memory_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolution ON memory_conflicts(resolution, created_at DESC);
```

### 7.11 `sync_state` (Phase 6 — C2)

CRDT sync bookkeeping for multi-device sync.

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  device_id   TEXT    NOT NULL,                 -- UUID assigned at first sync setup
  seq         INTEGER NOT NULL,                 -- monotonic sequence per device
  last_push_at TEXT,
  last_pull_at TEXT,
  relay_url   TEXT    NOT NULL,                 -- E2E relay endpoint
  PRIMARY KEY (device_id)
);

CREATE TABLE IF NOT EXISTS sync_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  op_type     TEXT    NOT NULL CHECK(op_type IN ('insert','forget','relate','tag')),
  target_id   TEXT    NOT NULL,                 -- memory_id or relation_id
  payload_enc TEXT    NOT NULL,                 -- base64(AES-GCM(JSON op payload))
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  applied_at  TEXT,
  UNIQUE(device_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_sync_ops_device ON sync_ops(device_id, seq);
CREATE INDEX IF NOT EXISTS idx_sync_ops_applied ON sync_ops(applied_at);
```

### 7.12 Versioning tables (Phase 7 — C9, C10)

The `memory_audit` table (§7.6) is the primary source for time-travel. Phase 7 adds a
snapshot mechanism for efficient point-in-time reconstruction.

```sql
-- Named snapshots (created by /ltm:memory snapshot or by janitor nightly)
CREATE TABLE IF NOT EXISTS memory_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT,                           -- human-readable, e.g. "before Phase 4 migration"
  snapshot_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  memory_count  INTEGER NOT NULL,
  created_by    TEXT    NOT NULL CHECK(created_by IN ('janitor','user','migration'))
);

-- Memory state at snapshot time (for replay without replaying all audit ops)
CREATE TABLE IF NOT EXISTS snapshot_memories (
  snapshot_id INTEGER NOT NULL REFERENCES memory_snapshots(id) ON DELETE CASCADE,
  memory_id   INTEGER NOT NULL,                 -- not FK; memory may be deleted
  state_json  TEXT    NOT NULL,                 -- JSON of memories row at snapshot time
  PRIMARY KEY (snapshot_id, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_at ON memory_snapshots(snapshot_at DESC);
```

---

## 8. Performance at Scale

### 8.1 Scale tiers

| Tier | Memory count | Expected user | Risk |
|------|-------------|--------------|------|
| Small | 0–1 000 | Most users | None |
| Medium | 1 000–10 000 | Power users, 1–2 years of dogfooding | Low |
| Large | 10 000–100 000 | Enterprise devs, GitLearn backfill over large repos | W4 semantic fallback |
| Extreme | 100 000–1 000 000 | Theoretical; team bundle accumulation | FTS5 limits |

### 8.2 Storage estimates

| Component | Per-row cost | At 10k | At 100k |
|-----------|-------------|--------|---------|
| `memories` (text only, no embedding) | ~500 bytes avg | 5 MB | 50 MB |
| `memories.embedding` (1536 float32) | ~6 KB | 60 MB | 600 MB |
| `memories_fts` shadow tables | ~30% of content size | 1.5 MB | 15 MB |
| `memory_audit` (2 JSON snapshots per op) | ~1 KB avg | 10 MB (if all ops logged) | 100 MB |
| `hook_events` (90-day retention) | ~200 bytes | ~2 MB/90d | ~2 MB/90d |

**Key insight:** the `embedding` BLOB dominates. After the Phase 1 split into `memory_embeddings`, the base `memories` table stays lean (5–50 MB range), and `memory_embeddings` is accessed only on the semantic fallback path.

### 8.3 Query plan at scale

**FTS5 recall at 100k memories:**

FTS5 uses an inverted index. A MATCH query on a common two-word phrase returns a sorted list of matching rowids in O(log T + k) where T is the total token count and k is the result count. At 100k memories the inverted index is ~15 MB (loaded pages). First query may incur page faults; subsequent queries benefit from OS page cache.

Expected latency: 5–20 ms at 100k for the FTS5 phase. This is well within budget.

**Semantic fallback at 100k memories (current):**

Reads all `embedding` BLOBs: 600 MB of BLOB data. Typical SQLite read throughput: 200–500 MB/s from SSD. Estimate: 1.2–3 s for a full scan. Catastrophically slow.

**Mitigation strategies:**

1. **Phase 1 (immediate):** Move embeddings to `memory_embeddings`. The fallback now requires an explicit join. Recall queries that do not trigger fallback never touch the table.
2. **Phase 3 (ANN index, stretch):** Integrate `sqlite-vss` or a comparable SQLite extension for approximate nearest-neighbour search over the embedding table. Reduces semantic search from O(N) to O(log N). This requires bundling a native extension — evaluate feasibility against the zero-dependency goal (ADR-001).
3. **Phase 4 (materialised decay_score):** Eliminates JS-side rank multiplication; the recall query is a single indexed SQL ORDER BY.

**Fallback threshold tuning:**

The semantic fallback triggers at < 3 FTS5 results. At 100k memories, queries that hit this threshold typically involve rare or paraphrased terms. Adding a configurable `settings.recall.fts_min_results` (default 3) allows users to disable semantic fallback entirely until Phase 3 ANN is ready.

### 8.4 Mitigation strategies summary

| Problem | Phase | Mitigation |
|---------|-------|-----------|
| Embedding BLOB in hot row | 1 | Split to `memory_embeddings` |
| O(N) semantic fallback scan | 3 | ANN index (stretch) or disable fallback |
| O(N) JS decay multiply | 4 | Materialised `decay_score` |
| FTS5 index growth | 4 | Janitor archival of deprecated memories |
| `memory_audit` unbounded growth | 4 | Janitor prunes rows > 1 year; snapshots consolidate |
| `hook_events` growth | 1 | 90-day retention enforced by janitor |

### 8.5 VACUUM and ANALYZE schedule

SQLite auto-analyzes when a table changes significantly (controlled by `PRAGMA analysis_limit`). Manual schedule:

- `PRAGMA ANALYZE;` — run by janitor weekly; updates query planner statistics.
- `PRAGMA VACUUM;` — **not** scheduled automatically; recommended after large deletions (e.g., after a bulk `ltm_forget` or deprecated memory archival). Document in `/ltm:admin` as a manual command.
- `PRAGMA wal_checkpoint(TRUNCATE);` — run by janitor after each pass to truncate the WAL file and reclaim disk space.

---

## 9. Migration Path — Schema Evolution

This section maps each ROADMAP phase to its concrete DDL changes. Migration files live in `db/migrations/`. The Phase 0 `schema_migrations` table is the runner; subsequent migrations are executed by `src/migrator.ts`.

### Phase 0 — Foundation Hardening (v1.5.x)

Goal: replace hand-rolled migrations, add hot-path indexes, advisory locking.

| File | DDL summary |
|------|-------------|
| `0001_initial_schema_backfill.sql` | INSERT sentinel row into `schema_migrations`; records all existing hasColumn guards as applied |
| `0002_add_hot_path_indexes.sql` | `CREATE INDEX idx_memories_status_importance ON memories(status, importance DESC);` `CREATE INDEX idx_memories_created_at ON memories(created_at);` `CREATE INDEX idx_memories_last_recalled_at ON memories(last_recalled_at);` `CREATE INDEX idx_ctx_project_type_created ON context_items(project_name, type, created_at DESC);` |
| `0003_schema_migrations_table.sql` | `CREATE TABLE schema_migrations (version, name, applied_at, checksum)` (self-bootstrapping) |

Breaking: none. Backwards-compatible.

Rollback: indexes can be dropped; `schema_migrations` can be dropped without data loss.

### Phase 1 — DAO + Observability (v1.6.x)

Goal: split embeddings, add projects table, add hook_events log.

| File | DDL summary |
|------|-------------|
| `0004_add_projects_table.sql` | `CREATE TABLE projects (id, project_name UNIQUE, cwd UNIQUE, ...)` with indexes; backfill from `registry.json` content |
| `0005_add_hook_events.sql` | `CREATE TABLE hook_events (id, event_type, project_name, session_id, status, latency_ms, result_count, error_msg, payload, created_at)` with indexes |
| `0006_split_embeddings.sql` | `CREATE TABLE memory_embeddings (memory_id PK, provider, model, dimensions, vec, generated_at);` `INSERT INTO memory_embeddings SELECT id, 'legacy', NULL, 0, embedding, datetime('now') FROM memories WHERE embedding IS NOT NULL;` `ALTER TABLE memories DROP COLUMN embedding;` (SQLite >= 3.35.0 required) |

Note on `DROP COLUMN`: Bun ships SQLite 3.45+; this is safe. Add a version guard in the migration runner.

Breaking: none at MCP contract level. Internal: the `embedding` column disappears from `memories`; any code reading it directly must be updated (DAO refactor happens in Phase 1 code work).

Rollback: `0006` has a down migration that re-adds the column and copies data back from `memory_embeddings`.

### Phase 2 — Provenance + Audit (v1.7.x)

Goal: every write auditable, every memory traceable.

| File | DDL summary |
|------|-------------|
| `0007_add_memory_provenance.sql` | `CREATE TABLE memory_provenance (id, memory_id FK, source_type, source_ref, actor, created_at, metadata)` with indexes; backfill all existing memories with `source_type='legacy'` |
| `0008_add_memory_audit.sql` | `CREATE TABLE memory_audit (id, memory_id, op, actor, session_id, before_json, after_json, created_at)` with indexes; no backfill (audit is forward-only) |

Breaking: none. Optional fields added to recall results.

### Phase 3 — Embedding Provider Abstraction (v1.8.x)

Goal: FTS5 gains category column; `memory_embeddings.provider` enables multi-provider.

| File | DDL summary |
|------|-------------|
| `0009_fts_add_category.sql` | `DROP TABLE memories_fts;` Rebuild with `content, category` columns; rebuild triggers; full re-index via `INSERT INTO memories_fts(rowid, content, category) SELECT id, content, category FROM memories WHERE status='active';` |

Note: `DROP TABLE memories_fts` and rebuild requires exclusive access. The migrator wraps this in `BEGIN EXCLUSIVE; ...; COMMIT;`.

Breaking: FTS trigger DDL changes; any code constructing raw FTS queries must update.

### Phase 4 — Janitor (v1.9.x)

Goal: materialise decay_score; janitor archival.

| File | DDL summary |
|------|-------------|
| `0010_add_decay_score.sql` | `ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0;` `CREATE INDEX idx_memories_decay_score ON memories(decay_score DESC);` Initial backfill: `UPDATE memories SET decay_score = 1.0;` (janitor will compute real values on first run) |
| `0011_add_janitor_settings.sql` | `INSERT OR IGNORE INTO settings VALUES ('janitor.enabled', 'true', datetime('now'));` `INSERT OR IGNORE INTO settings VALUES ('janitor.last_run_at', '', datetime('now'));` `INSERT OR IGNORE INTO settings VALUES ('decay.half_life_days', '90', datetime('now'));` `INSERT OR IGNORE INTO settings VALUES ('decay.immortal_importance', '5', datetime('now'));` |

Breaking: none. `decay_score` defaults to 1.0 until janitor first runs.

### Phase 5 — Cross-Plugin Contract (v2.0.0, semver-major)

Goal: stable versioned MCP write surface; registry fully in DB.

| File | DDL summary |
|------|-------------|
| `0012_finalize_projects_table.sql` | Add `contract_version TEXT NOT NULL DEFAULT '1'` to `projects`; add index on `workspace_id`; make `cwd` the primary lookup for all hook code |
| `0013_drop_deprecated_columns.sql` | Drop any columns marked deprecated in earlier phases (post major-version gate only) |

Breaking: major version. MIGRATION.md documents removed columns and renamed tools.

### Phase 6 — Sync + Bundles (v2.1.x)

Goal: team bundles, signing, conflict detection, sync state.

| File | DDL summary |
|------|-------------|
| `0014_add_team_bundles.sql` | `CREATE TABLE team_bundles (...)` as specified in §7.7; `CREATE TABLE bundle_memories (...)` as §7.8 |
| `0015_add_signing_keys.sql` | `CREATE TABLE signing_keys (...)` as §7.9 |
| `0016_add_memory_conflicts.sql` | `CREATE TABLE memory_conflicts (...)` as §7.10 |
| `0017_add_sync_tables.sql` | `CREATE TABLE sync_state (...)` as §7.11; `CREATE TABLE sync_ops (...)` |

Breaking: none at contract level. New opt-in tables; existing users unaffected.

### Phase 7 — Time-Travel + Diffing (v2.2.x)

Goal: snapshot mechanism for efficient replay and diff.

| File | DDL summary |
|------|-------------|
| `0018_add_snapshots.sql` | `CREATE TABLE memory_snapshots (...)` as §7.12; `CREATE TABLE snapshot_memories (...)` |
| `0019_seed_initial_snapshot.sql` | Insert a snapshot row for the current DB state at migration time so that `/ltm:memory replay` has a baseline |

Breaking: none.

### Backwards-compatibility ledger

| Phase | Schema breaking | MCP contract breaking | Data loss risk |
|-------|----------------|-----------------------|---------------|
| 0 | No | No | None |
| 1 | Idempotent migration; `embedding` column dropped (DAO abstracts it) | No | None if `memory_embeddings` backfill runs first |
| 2 | Adds columns/tables | Adds optional recall fields | None |
| 3 | FTS rebuild required (downtime ~1s per 10k memories) | Adds optional FTS fields | None |
| 4 | Adds column; janitor controlled | No | None |
| 5 | Removes deprecated columns | **Yes — semver major** | Columns removed; data in superseding columns |
| 6 | Adds tables | Adds optional tools | None |
| 7 | Adds tables | Adds optional tools | None |

---

## Appendix A — Entity-Relationship Diagram (Target State)

```
memories ||--o{ memory_tags : tagged
tags ||--o{ memory_tags : labels
memories ||--o{ memory_relations : "source"
memories ||--o{ memory_relations : "target"
memories ||--o| memories : superseded_by
memories ||--o| memory_embeddings : embedding
memories ||--o{ memory_provenance : provenance
memories ||--o{ memory_audit : audit_trail (no FK)
memories ||--|| memories_fts : "FTS5 mirror"
memories ||--o{ context_items : promoted_from
memories ||--o{ memory_conflicts : incoming
memories ||--o{ memory_conflicts : conflicting
memory_snapshots ||--o{ snapshot_memories : contains
team_bundles ||--o{ bundle_memories : contains
bundle_memories }o--|| memories : creates
projects ||--o{ context_items : owns
sync_state ||--o{ sync_ops : tracks
```

## Appendix B — Settings Key Registry (Phase 0 baseline)

All settings keys should be documented here and updated as phases add keys.

| Key | Type | Default | Phase | Purpose |
|-----|------|---------|-------|---------|
| `decay.half_life_days` | integer | 90 | 0 | Days to half-rank for unrecalled low-importance memories |
| `decay.immortal_importance` | integer | 5 | 0 | Importance level exempt from decay |
| `decay.function` | string | `linear` | 4 | `linear` or `exponential` |
| `embedding.provider` | string | `null` | 3 | Embedding provider identifier |
| `embedding.model` | string | null | 3 | Model ID for the selected provider |
| `janitor.enabled` | boolean | `true` | 4 | Master switch for janitor |
| `janitor.last_run_at` | ISO8601 | `` | 4 | Timestamp of last successful janitor pass |
| `janitor.run_interval_hours` | integer | 24 | 4 | How often janitor runs |
| `janitor.retention_days_events` | integer | 90 | 1 | hook_events retention window |
| `recall.fts_min_results` | integer | 3 | 0 | Threshold below which semantic fallback triggers |
| `recall.top_n` | integer | 10 | 0 | Default result count for ltm_recall |
| `sync.enabled` | boolean | `false` | 6 | Master switch for multi-device sync |
| `sync.relay_url` | string | null | 6 | Relay endpoint URL |
| `sync.device_id` | UUID | null | 6 | Assigned at first sync setup |
