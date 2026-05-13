/**
 * dao/conflicts.ts — DAO for querying superseded-memory conflicts.
 */
import type { Database } from "bun:sqlite";
import type { ConflictRow } from "./types.js";

/**
 * Return memories superseded within the last 7 days for a given project.
 * Used by SessionStart to surface recent conflicts in the session header.
 */
export function getRecentConflicts(
  db: Database,
  project: string,
  limit: number,
): ConflictRow[] {
  return db.query<ConflictRow, [string, string, number]>(
    `SELECT m1.id as olderId, m1.content as olderContent,
            m2.id as newerId,  m2.content as newerContent
     FROM memories m1
     JOIN memories m2 ON m1.superseded_by = m2.id
     WHERE (m1.project_scope = ? OR (m1.project_scope IS NULL AND ? IS NULL))
       AND m1.superseded_at > datetime('now', '-7 days')
     ORDER BY m1.superseded_at DESC
     LIMIT ?`
  ).all(project, project, limit);
}
