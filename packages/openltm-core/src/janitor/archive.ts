/**
 * archive.ts — Evict fully-decayed deprecated memories into memory_archive.
 *
 * Eviction criteria (all must match):
 *   status = 'deprecated'  AND
 *   importance <= 2        AND  (high-importance memories only deprecate, never evict)
 *   recall_count <= 1      AND  (recalled even once → second chance next cycle)
 *   decay_score < 0.10         (well below the 0.25 deprecation threshold)
 *
 * Full memory JSON is preserved in memory_archive before deletion.
 * Max 100 evictions per run to bound transaction duration.
 */
import { getDb } from "../shared-db.js";
import type { Memory } from "../db.js";
import { insertAudit, snapshotMemory } from "../dao/provenanceAudit.js";

const BATCH_SIZE = 100;

export interface ArchiveResult {
  /** Memories moved to memory_archive and deleted from memories. */
  archived: number;
}

export function runArchive(): ArchiveResult {
  const db = getDb();

  const candidates = db.query<Memory, []>(
    `SELECT id, content, category, importance, confidence, source, project_scope, dedup_key,
            created_at, last_confirmed_at, last_used_at, confirm_count, status,
            first_recalled_at, last_recalled_at, recall_count, superseded_by, superseded_at,
            workspace_id, agent_id, decay_score
     FROM memories
     WHERE status = 'deprecated'
       AND importance <= 2
       AND COALESCE(recall_count, 0) <= 1
       AND COALESCE(decay_score, 0) < 0.10
     LIMIT ${BATCH_SIZE}`,
  ).all();

  if (candidates.length === 0) return { archived: 0 };

  const ids = candidates.map(m => m.id);
  const placeholders = ids.map(() => "?").join(",");

  const archive = db.transaction((mems: Memory[]) => {
    for (const mem of mems) {
      const beforeSnap = snapshotMemory(db, mem.id);
      db.run(
        `INSERT OR IGNORE INTO memory_archive (id, memory_json, reason, decay_score, project_scope)
         VALUES (?, ?, 'decay', ?, ?)`,
        [mem.id, JSON.stringify(mem), mem.decay_score ?? null, mem.project_scope ?? null],
      );
      insertAudit(db, {
        memory_id: mem.id,
        op: "archive",
        actor: "janitor:archive",
        before_json: beforeSnap ? JSON.stringify(beforeSnap) : null,
        after_json: null,
      });
    }
    db.run(`DELETE FROM memories WHERE id IN (${placeholders})`, ids);
    return db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n;
  });

  return { archived: archive(candidates) };
}
