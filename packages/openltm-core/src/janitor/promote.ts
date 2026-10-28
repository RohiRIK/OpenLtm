/**
 * promote.ts — Auto-promote context_items (decisions/gotchas) to pending memories.
 * Unlike the existing context.ts promote() which creates active memories immediately,
 * this creates them as 'pending' for review in the approval UI.
 */
import { getDb, getSetting } from "../shared-db.js";
import { normalizeKey } from "../dedup.js";
import { scrubOrRefuse } from "../secretsScrubber.js";
import { SETTING_KEYS, getDefault } from "./providers/types.js";
import { deriveTitle } from "../db.js";
import { DEFAULT_ORIGIN } from "../origin.js";
import { insertAudit, snapshotMemory } from "../dao/provenanceAudit.js";

/** Pending auto-promoted memories nobody reviewed within this many days are accepted. */
export const AUTO_ACCEPT_DAYS = 7;
/** Audit actor of janitor auto-accepts; SessionStart counts these rows. */
export const AUTO_ACCEPT_ACTOR = "janitor:auto-accept";

export interface PromoteResult {
  /** Number of context_items promoted to pending memories. */
  promoted: number;
  /** Number of context_items skipped (already promoted or duplicate). */
  skipped: number;
  /** Total eligible items scanned. */
  scanned: number;
}

/**
 * Scan context_items for decisions/gotchas that should be promoted to memories.
 *
 * Criteria:
 * 1. Type is 'decision' or 'gotcha' (not goals or progress)
 * 2. Status is 'active' (not already pending_promotion or promoted)
 * 3. Not already linked to a memory (memory_id IS NULL)
 * 4. Content is substantial enough (> 20 chars)
 *
 * Creates memories with status='pending' for review/approval.
 */
export function runPromote(): PromoteResult {
  const db = getDb();
  const result: PromoteResult = { promoted: 0, skipped: 0, scanned: 0 };

  const minImportance = Number.parseInt(
    getSetting(SETTING_KEYS.PROMOTE_MIN_IMPORTANCE) ||
      getDefault(SETTING_KEYS.PROMOTE_MIN_IMPORTANCE),
    10,
  );

  // Find eligible context items
  const items = db
    .query<
      {
        id: number;
        project_name: string;
        type: string;
        content: string;
      },
      []
    >(
      `SELECT id, project_name, type, content
       FROM context_items
       WHERE type IN ('decision', 'gotcha')
         AND status = 'active'
         AND memory_id IS NULL
         AND LENGTH(content) > 20
       ORDER BY id ASC`,
    )
    .all();

  result.scanned = items.length;

  for (const item of items) {
    const { scrubbed, redactions } = scrubOrRefuse(item.content);
    if (redactions.length > 0) {
      process.stderr.write(`[promote] Scrubbed ${redactions.length} secret(s): ${redactions.join(", ")}\n`);
    }
    const content = scrubbed;
    const dedupKey = normalizeKey(content);

    // Check if a memory with this dedup_key already exists
    const existing = db
      .query<{ id: number }, [string]>(
        "SELECT id FROM memories WHERE dedup_key = ?",
      )
      .get(dedupKey);

    if (existing) {
      // Link the context_item to the existing memory
      db.run(
        "UPDATE context_items SET memory_id = ?, status = 'promoted' WHERE id = ?",
        [existing.id, item.id],
      );
      result.skipped++;
      continue;
    }

    // Map context type to memory category
    const category = item.type === "decision" ? "architecture" : "gotcha";
    const importance = item.type === "gotcha" ? 4 : minImportance;

    // Create a pending memory
    const insertResult = db.run(
      `INSERT INTO memories (content, title, category, importance, confidence, source, project_scope, dedup_key, status, origin)
       VALUES (?, ?, ?, ?, 0.8, 'auto-promote', ?, ?, 'pending', ?)`,
      [content, deriveTitle(content), category, importance, item.project_name, dedupKey, DEFAULT_ORIGIN],
    );

    const memoryId = Number(insertResult.lastInsertRowid);

    // Update the context_item to link it and mark as pending_promotion
    db.run(
      "UPDATE context_items SET memory_id = ?, status = 'pending_promotion' WHERE id = ?",
      [memoryId, item.id],
    );

    result.promoted++;
  }

  return result;
}

/**
 * Approve a pending memory — set status to 'active'.
 * Also updates the linked context_item status to 'promoted'.
 */
export function approveMemory(memoryId: number, actor = "approve"): boolean {
  const db = getDb();
  const mem = db
    .query<{ id: number; status: string }, [number]>(
      "SELECT id, status FROM memories WHERE id = ?",
    )
    .get(memoryId);

  if (!mem || mem.status !== "pending") return false;

  const before = snapshotMemory(db, memoryId);
  db.run("UPDATE memories SET status = 'active' WHERE id = ?", [memoryId]);
  db.run(
    "UPDATE context_items SET status = 'promoted' WHERE memory_id = ?",
    [memoryId],
  );
  insertAudit(db, {
    memory_id: memoryId,
    op: "update",
    actor,
    before_json: before ? JSON.stringify(before) : null,
    after_json: JSON.stringify(snapshotMemory(db, memoryId)),
  });

  return true;
}

/**
 * Accept pending auto-promoted memories older than AUTO_ACCEPT_DAYS (owner
 * decision: unreviewed proposals otherwise rot in the inbox). Also backfills
 * titles on untitled pending auto-promote rows written before runPromote set one.
 */
export function runAutoAccept(): { accepted: number } {
  const db = getDb();
  const untitled = db
    .query<{ id: number; content: string }, []>(
      `SELECT id, content FROM memories
        WHERE status = 'pending' AND source = 'auto-promote' AND (title IS NULL OR title = '')`,
    )
    .all();
  const due = db
    .query<{ id: number }, [string]>(
      `SELECT id FROM memories
        WHERE status = 'pending' AND source = 'auto-promote' AND created_at < datetime('now', ?)`,
    )
    .all(`-${AUTO_ACCEPT_DAYS} days`);
  return db.transaction(() => {
    for (const m of untitled) db.run("UPDATE memories SET title = ? WHERE id = ?", [deriveTitle(m.content), m.id]);
    let accepted = 0;
    for (const m of due) if (approveMemory(m.id, AUTO_ACCEPT_ACTOR)) accepted++;
    return { accepted };
  })();
}

/** Ids of `project`'s memories the janitor auto-accepted in the last AUTO_ACCEPT_DAYS that are still active. */
export function listRecentlyAutoAccepted(project: string): number[] {
  return getDb()
    .query<{ id: number }, [string, string, string]>(
      `SELECT DISTINCT a.memory_id AS id FROM memory_audit a
         JOIN memories m ON m.id = a.memory_id
        WHERE a.op = 'update' AND a.actor = ? AND a.created_at >= datetime('now', ?)
          AND m.status = 'active' AND m.project_scope = ?
        ORDER BY a.memory_id`,
    )
    .all(AUTO_ACCEPT_ACTOR, `-${AUTO_ACCEPT_DAYS} days`, project)
    .map(r => r.id);
}

/**
 * Reject a pending memory — delete it and reset the context_item.
 */
export function rejectMemory(memoryId: number): boolean {
  const db = getDb();
  const mem = db
    .query<{ id: number; status: string }, [number]>(
      "SELECT id, status FROM memories WHERE id = ?",
    )
    .get(memoryId);

  if (!mem || mem.status !== "pending") return false;

  // Reset linked context_items back to active
  db.run(
    "UPDATE context_items SET memory_id = NULL, status = 'active' WHERE memory_id = ?",
    [memoryId],
  );

  // Delete the pending memory
  db.run("DELETE FROM memories WHERE id = ?", [memoryId]);

  return true;
}

/**
 * Get all pending memories for the review UI.
 */
export function getPendingMemories(): Array<{
  id: number;
  content: string;
  category: string;
  importance: number;
  confidence: number;
  project_scope: string | null;
  source: string | null;
  created_at: string;
}> {
  const db = getDb();
  return db
    .query<
      {
        id: number;
        content: string;
        category: string;
        importance: number;
        confidence: number;
        project_scope: string | null;
        source: string | null;
        created_at: string;
      },
      []
    >(
      `SELECT id, content, category, importance, confidence, project_scope, source, created_at
       FROM memories WHERE status = 'pending' ORDER BY created_at DESC`,
    )
    .all();
}
