/**
 * supersedes.ts — Manage supersedes relations between memories.
 * When a new memory supersedes an old one, the old memory is marked
 * as 'superseded' and a directed relation is created.
 */
import { getDb } from "../shared-db.js";

/**
 * Mark a memory as superseding another.
 * - Creates a 'supersedes' relation from newId -> oldId
 * - Sets the old memory's status to 'superseded'
 * - Optionally transfers tags from old to new
 */
export function supersede(
  newId: number,
  oldId: number,
  transferTags = true,
): void {
  const db = getDb();

  const newMem = db.query("SELECT id, status FROM memories WHERE id = ?").get(newId) as { id: number; status: string } | undefined;
  const oldMem = db.query("SELECT id, status FROM memories WHERE id = ?").get(oldId) as { id: number; status: string } | undefined;

  if (!newMem) throw new Error(`New memory ${newId} not found`);
  if (!oldMem) throw new Error(`Old memory ${oldId} not found`);
  if (newId === oldId) throw new Error("Cannot supersede self");

  db.transaction(() => {
    db.run(
      `INSERT OR IGNORE INTO memory_relations (source_memory_id, target_memory_id, relationship_type)
       VALUES (?, ?, 'supersedes')`,
      [newId, oldId],
    );
    db.run("UPDATE memories SET status = 'superseded' WHERE id = ?", [oldId]);
    if (transferTags) {
      db.run(
        `INSERT OR IGNORE INTO memory_tags (memory_id, tag_id)
         SELECT ?, tag_id FROM memory_tags WHERE memory_id = ?`,
        [newId, oldId],
      );
    }
    db.run("UPDATE context_items SET memory_id = ? WHERE memory_id = ?", [newId, oldId]);
  })();
}

export function getSupersededChain(
  memoryId: number,
): Array<{ id: number; content: string; created_at: string }> {
  const db = getDb();
  const chain: Array<{ id: number; content: string; created_at: string }> = [];
  const visited = new Set<number>();
  const queue = [memoryId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const superseded = db.query(
      `SELECT m.id, m.content, m.created_at
       FROM memories m
       JOIN memory_relations r ON r.target_memory_id = m.id
       WHERE r.source_memory_id = ? AND r.relationship_type = 'supersedes'`
    ).all(currentId) as typeof chain;

    for (const s of superseded) {
      chain.push(s);
      queue.push(s.id);
    }
  }

  return chain;
}

export function getSupersededBy(
  memoryId: number,
): { id: number; content: string } | null {
  const db = getDb();
  return db.query(
    `SELECT m.id, m.content
     FROM memories m
     JOIN memory_relations r ON r.source_memory_id = m.id
     WHERE r.target_memory_id = ? AND r.relationship_type = 'supersedes'
     LIMIT 1`
  ).get(memoryId)  as { id: number; content: string } | null ?? null;
}

export function unsupersede(newId: number, oldId: number): void {
  const db = getDb();

  db.transaction(() => {
    db.run(
      `DELETE FROM memory_relations
       WHERE source_memory_id = ? AND target_memory_id = ? AND relationship_type = 'supersedes'`,
      [newId, oldId],
    );

    const stillSuperseded = db.query(
      `SELECT COUNT(*) as cnt FROM memory_relations
       WHERE target_memory_id = ? AND relationship_type = 'supersedes'`
    ).get(oldId) as { cnt: number } | undefined;

    if ((stillSuperseded?.cnt ?? 0) === 0) {
      db.run("UPDATE memories SET status = 'active' WHERE id = ? AND status = 'superseded'", [oldId]);
    }
  })();
}

// ============================================================
// Contradiction detection
// ============================================================

export interface Contradiction {
  olderId: number;
  olderContent: string;
  newerId: number;
  newerContent: string;
  term: string;
}

const CONTRADICTION_PAIRS = [
  ["npm", "bun"],
  ["yarn", "bun"],
  ["npm", "pnpm"],
  ["rest", "graphql"],
  ["sql", "nosql"],
  ["mysql", "postgres"],
  ["javascript", "typescript"],
  ["js", "ts"],
  ["class", "functional"],
  ["oop", "functional"],
];

export function detectContradictions(
  projectScope: string | null,
): Contradiction[] {
  const db = getDb();
  const contradictions: Contradiction[] = [];

  let memories: Array<{ id: number; content: string; category: string; created_at: string }>;
  if (projectScope) {
    memories = db.query(
      `SELECT id, content, category, created_at FROM memories WHERE project_scope = ? AND status = 'active'`
    ).all(projectScope) as typeof memories;
  } else {
    memories = db.query(
      `SELECT id, content, category, created_at FROM memories WHERE project_scope IS NULL AND status = 'active'`
    ).all() as typeof memories;
  }

  for (const mem of memories) {
    const content = mem.content.toLowerCase();

    for (const [term1, term2] of CONTRADICTION_PAIRS) {
      if (content.includes(term1)) {
        const opposite = memories.filter(
          m => m.id !== mem.id &&
            m.content.toLowerCase().includes(term2) &&
            m.category === mem.category,
        );

        for (const opp of opposite) {
          if (new Date(opp.created_at) > new Date(mem.created_at)) {
            contradictions.push({
              olderId: mem.id,
              olderContent: mem.content,
              newerId: opp.id,
              newerContent: opp.content,
              term: `${term1} vs ${term2}`,
            });
          }
        }
      }
    }
  }

  return contradictions;
}

export function applyContradictions(contradictions: Contradiction[]): number {
  const db = getDb();
  let applied = 0;

  for (const con of contradictions) {
    const existing = db.query(
      `SELECT id FROM memories WHERE id = ? AND superseded_by IS NOT NULL`
    ).get(con.olderId) as { id: number } | null;

    if (existing) continue;

    db.run(
      `UPDATE memories SET superseded_by = ?, superseded_at = datetime('now') WHERE id = ?`,
      [con.newerId, con.olderId],
    );
    applied++;
  }

  return applied;
}
