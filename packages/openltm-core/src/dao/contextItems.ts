/**
 * dao/contextItems.ts — DAO for context_items table.
 * Hooks use these functions instead of raw SQL.
 */
import type { Database } from "bun:sqlite";
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
    db.transaction(() => {
      db.run(`DELETE FROM context_items WHERE project_name=? AND type='goal'`, [project]);
      db.run(
        `INSERT INTO context_items (project_name, type, content, permanent) VALUES (?, 'goal', ?, 0)`,
        [project, content]
      );
    })();
  });
}

const MAX_PROGRESS_ROWS = 20;

function deleteIds(db: Database, ids: number[]): void {
  if (ids.length === 0) return;
  db.run(`DELETE FROM context_items WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

/**
 * Record a progress line for a project.
 *
 * With a sessionId this is an upsert keyed on (project, session_id): a later call
 * for the same session rewrites that row's content and timestamp instead of adding
 * a row, so the 20-row cap counts sessions, not calls (the Stop hook calls this
 * every turn). Without a sessionId every call inserts.
 *
 * Resolves once the write has run, so callers can await it to catch DB errors.
 */
export function appendProgress(project: string, content: string, sessionId?: string): Promise<void> {
  return writeQueue.enqueue(() => {
    const db = getDb();
    db.transaction(() => {
      if (sessionId) {
        const rows = db.query<{ id: number }, [string, string]>(
          `SELECT id FROM context_items WHERE project_name=? AND type='progress' AND session_id=? ORDER BY id DESC`
        ).all(project, sessionId);
        const [keep, ...duplicates] = rows;
        if (keep) {
          db.run(`UPDATE context_items SET content=?, created_at=datetime('now') WHERE id=?`, [content, keep.id]);
          deleteIds(db, duplicates.map(r => r.id));
          return;
        }
      }
      const existing = db.query<{ id: number }, [string]>(
        `SELECT id FROM context_items WHERE project_name=? AND type='progress' ORDER BY created_at DESC, id DESC`
      ).all(project);
      deleteIds(db, existing.slice(MAX_PROGRESS_ROWS - 1).map(r => r.id));
      db.run(
        `INSERT INTO context_items (project_name, type, content, session_id, permanent) VALUES (?, 'progress', ?, ?, 0)`,
        [project, content, sessionId ?? null]
      );
    })();
  });
}

function insertPermanent(project: string, type: ContextItemType, content: string): void {
  writeQueue.enqueue(() => {
    getDb().run(
      `INSERT INTO context_items (project_name, type, content, permanent) VALUES (?, ?, ?, 1)`,
      [project, type, content]
    );
  });
}

export function addDecision(project: string, content: string): void {
  insertPermanent(project, "decision", content);
}

export function addGotcha(project: string, content: string): void {
  insertPermanent(project, "gotcha", content);
}
