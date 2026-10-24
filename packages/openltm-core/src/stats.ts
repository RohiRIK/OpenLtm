/**
 * stats.ts — read-only views every host exposes the same way: the memories a
 * commit flagged stale, and counts over the whole store. The MCP `stale` and
 * `stats` tools and the OpenCode/OpenClaw adapters all call these, so a host
 * never approximates them from a sampled recall.
 */
import { getDb } from "./shared-db.js";
import { notPrivateSql } from "./privacy.js";
import { listPendingProposals } from "./proposals.js";

export interface StaleMemory {
  id: number;
  title: string | null;
  content: string;
  category: string;
  importance: number;
  project_scope: string | null;
  stale_flagged_at: string;
  stale_reason: string | null;
}

export interface ListStaleOptions {
  /** Only this project's memories plus global ones. Omit for every project. */
  project?: string;
  /** Max rows (default 50, capped at 200). */
  limit?: number;
  includePrivate?: boolean;
}

/** Active memories flagged stale by a code change, newest flag first. */
export function listStaleMemories(opts: ListStaleOptions = {}): StaleMemory[] {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const where = ["status = 'active'", "stale_flagged_at IS NOT NULL"];
  const params: (string | number)[] = [];
  if (opts.project) {
    where.push("(project_scope = ? OR project_scope IS NULL)");
    params.push(opts.project);
  }
  if (!opts.includePrivate) where.push(notPrivateSql());
  params.push(limit);
  return getDb().query<StaleMemory, (string | number)[]>(
    `SELECT id, title, content, category, importance, project_scope, stale_flagged_at, stale_reason
       FROM memories WHERE ${where.join(" AND ")}
      ORDER BY stale_flagged_at DESC, id DESC LIMIT ?`,
  ).all(...params);
}

export interface MemoryStats {
  project: string | null;
  /** Active memories (the ones recall can return). */
  active: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byImportance: Record<string, number>;
  stale: number;
  private: number;
  /** Active memories with a stored embedding — 0 means recall is full-text only. */
  embedded: number;
  pendingProposals: number;
}

/** Counts over the store, or over one project's memories plus global ones. */
export function memoryStats(project?: string): MemoryStats {
  const db = getDb();
  const scope = project ? "(project_scope = ? OR project_scope IS NULL)" : "1 = 1";
  const args: string[] = project ? [project] : [];
  const tally = (column: string, filter = "status = 'active'"): Record<string, number> => {
    const rows = db.query<{ k: string | number; n: number }, string[]>(
      `SELECT ${column} AS k, COUNT(*) AS n FROM memories WHERE ${filter} AND ${scope} GROUP BY ${column} ORDER BY ${column}`,
    ).all(...args);
    return Object.fromEntries(rows.map((r) => [String(r.k), r.n]));
  };
  const count = (filter: string): number =>
    db.query<{ n: number }, string[]>(`SELECT COUNT(*) AS n FROM memories WHERE status = 'active' AND ${scope} AND ${filter}`)
      .get(...args)?.n ?? 0;

  const byStatus = tally("status", "1 = 1");
  return {
    project: project ?? null,
    active: byStatus["active"] ?? 0,
    byStatus,
    byCategory: tally("category"),
    byImportance: tally("importance"),
    stale: count("stale_flagged_at IS NOT NULL"),
    private: count(`NOT (${notPrivateSql()})`),
    embedded: count("id IN (SELECT memory_id FROM memory_embeddings)"),
    pendingProposals: listPendingProposals().filter((p) => !project || !p.project || p.project === project).length,
  };
}
