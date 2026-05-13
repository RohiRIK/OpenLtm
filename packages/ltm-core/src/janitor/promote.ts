/**
 * promote.ts — Auto-promote context_items (decisions/gotchas) to pending memories.
 * Unlike the existing context.ts promote() which creates active memories immediately,
 * this creates them as 'pending' for review in the approval UI.
 */
import { getDb, getSetting } from "../shared-db.js";
import { normalizeKey } from "../dedup.js";
import { SETTING_KEYS, getDefault } from "./providers/types.js";

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
    const dedupKey = normalizeKey(item.content);

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
      `INSERT INTO memories (content, category, importance, confidence, source, project_scope, dedup_key, status)
       VALUES (?, ?, ?, 0.8, 'auto-promote', ?, ?, 'pending')`,
      [item.content, category, importance, item.project_name, dedupKey],
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
export function approveMemory(memoryId: number): boolean {
  const db = getDb();
  const mem = db
    .query<{ id: number; status: string }, [number]>(
      "SELECT id, status FROM memories WHERE id = ?",
    )
    .get(memoryId);

  if (!mem || mem.status !== "pending") return false;

  db.run("UPDATE memories SET status = 'active' WHERE id = ?", [memoryId]);
  db.run(
    "UPDATE context_items SET status = 'promoted' WHERE memory_id = ?",
    [memoryId],
  );

  return true;
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
