/**
 * dao/contextItems.ts — DAO for context_items table.
 * Hooks use these functions instead of raw SQL.
 */
import { getDb } from "../shared-db.js";
import { writeQueue } from "../lib/writeQueue.js";
import type { ContextItemRow, ContextItemType } from "./types.js";

export function listByProject(project: string, type?: ContextItemType): ContextItemRow[] {
  const db = getDb();
  if (type) {
    return db.query<ContextItemRow, [string, string]>(
      `SELECT id, project_name, type, content, session_id, permanent, memory_id, status, created_at
       FROM context_items WHERE project_name=? AND type=? AND status='active' ORDER BY created_at ASC`
    ).all(project, type);
  }
  return db.query<ContextItemRow, [string]>(
    `SELECT id, project_name, type, content, session_id, permanent, memory_id, status, created_at
     FROM context_items WHERE project_name=? AND status='active' ORDER BY type, created_at ASC`
  ).all(project);
}

export function upsertGoal(project: string, content: string): void {
  writeQueue.enqueue(() => {
    const db = getDb();
    db.run(`DELETE FROM context_items WHERE project_name=? AND type='goal'`, [project]);
    db.run(
      `INSERT INTO context_items (project_name, type, content, permanent) VALUES (?, 'goal', ?, 0)`,
      [project, content]
    );
  });
}

export function appendProgress(project: string, content: string, sessionId?: string): void {
  writeQueue.enqueue(() => {
    const db = getDb();
    // Trim to 20 most recent progress entries
    const existing = db.query<{ id: number }, [string]>(
      `SELECT id FROM context_items WHERE project_name=? AND type='progress' ORDER BY created_at DESC`
    ).all(project);
    if (existing.length >= 20) {
      const toDelete = existing.slice(19).map(r => r.id);
      const placeholders = toDelete.map(() => "?").join(",");
      db.run(`DELETE FROM context_items WHERE id IN (${placeholders})`, toDelete);
    }
    db.run(
      `INSERT INTO context_items (project_name, type, content, session_id, permanent) VALUES (?, 'progress', ?, ?, 0)`,
      [project, content, sessionId ?? null]
    );
  });
}

export function addDecision(project: string, content: string): void {
  writeQueue.enqueue(() => {
    getDb().run(
      `INSERT INTO context_items (project_name, type, content, permanent) VALUES (?, 'decision', ?, 1)`,
      [project, content]
    );
  });
}

export function addGotcha(project: string, content: string): void {
  writeQueue.enqueue(() => {
    getDb().run(
      `INSERT INTO context_items (project_name, type, content, permanent) VALUES (?, 'gotcha', ?, 1)`,
      [project, content]
    );
  });
}
