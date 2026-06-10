/**
 * db.ts — Global long-term memory (learned insights, patterns, preferences)
 * Replaces skills/learned/*.md with structured SQLite + FTS5.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeKey } from "./dedup.js";
import { normalizeAnchorPaths } from "./anchors.js";
import { getDb, DB_PATH, configure as configureDb } from "./shared-db.js";
import { enqueueEmbedding } from "./queue/index.js";
import { notifyLtm, notifyMemoryAdded } from "./events/index.js";
import { scrubSecrets } from "./secretsScrubber.js";
import { insertProvenance, insertAudit, snapshotMemory, listProvenanceBatch } from "./dao/provenanceAudit.js";
import type { ProvenanceSourceType } from "./dao/types.js";
import type { LtmCoreConfig } from "./adapterTypes.js";
import { tmpdir } from "os";

export { DB_PATH };
/** Adapters can override via configureDocs() or LtmCoreConfig.docsDir. */
let DOCS_DIR = join(tmpdir(), "ltm-docs");

export function configureDocs(dir: string): void { DOCS_DIR = dir; }

export function configureCore(config: LtmCoreConfig): void {
  configureDb(config);
  if (config.docsDir) DOCS_DIR = config.docsDir;
}

export type MemoryCategory = "preference" | "architecture" | "gotcha" | "pattern" | "workflow" | "constraint";
export type RelationshipType = "supports" | "contradicts" | "refines" | "depends_on" | "related_to" | "supersedes";

export interface Memory {
  id: number;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  source: string | null;
  project_scope: string | null;
  dedup_key: string | null;
  created_at: string;
  last_confirmed_at: string;
  last_used_at: string;
  confirm_count: number;
  status: "active" | "pending" | "deprecated" | "superseded";
  first_recalled_at?: string;
  last_recalled_at?: string;
  recall_count?: number;
  superseded_by?: number;
  superseded_at?: string;
  workspace_id?: string;
  agent_id?: string;
  decay_score?: number;
  stale_flagged_at?: string | null;
  stale_reason?: string | null;
}

export interface MemoryRelation {
  id: number;
  source_memory_id: number;
  target_memory_id: number;
  relationship_type: RelationshipType;
  created_at: string;
}

export interface MemoryWithRelations extends Memory {
  tags: string[];
  relations: Array<{ memory: Memory; relationship_type: RelationshipType; direction: "outgoing" | "incoming" }>;
  /** Populated only when recall({ includeProvenance: true }) is requested. */
  provenance?: import("./dao/types.js").ProvenanceRow[];
  /** Score breakdown + temperature — always populated by recall(). */
  explainer?: import("./recall/explainer.js").RecallExplainer;
  /** True when a commit touched an anchored file and the memory hasn't been re-confirmed. */
  stale?: boolean;
}

export interface LearnInput {
  content: string;
  /** Short human-readable label (≤60 chars). Agent-supplied; falls back to heuristic. */
  title?: string;
  category: MemoryCategory;
  importance?: number;
  confidence?: number;
  source?: string;
  project_scope?: string;
  workspace_id?: string;
  agent_id?: string;
  tags?: string[];
  relate_to?: Array<{ id: number; relationship_type: RelationshipType }>;
  /** Repo-relative file paths this memory references — anchors for code-change invalidation. */
  files?: string[];
  /** Skip regenerating docs/memory-long-term.md (use during bulk imports) */
  skipExport?: boolean;
  /** Audit/provenance — all optional; safe to omit from existing callers. */
  actor?: string;
  sessionId?: string;
  provenanceSourceType?: ProvenanceSourceType;
  provenanceSourceRef?: string;
  provenanceMetadata?: string;
}

export interface LearnResult {
  action: "created" | "reinforced";
  id: number;
  confirm_count: number;
}

export interface RecallInput {
  since?: string;
  until?: string;
  sort_by?: "relevance" | "created" | "last_recalled" | "recall_count";

  query?: string;
  tags?: string[];
  category?: MemoryCategory;
  project?: string;
  limit?: number;
  workspace_id?: string;
  agent_id?: string;
  /** When true, each result includes a `provenance` array. Off by default to preserve latency. */
  includeProvenance?: boolean;
}


/** Derive a short title from content when none is agent-supplied. */
export function deriveTitle(content: string): string {
  const trimmed = content.trim();
  const dot = trimmed.indexOf('.');
  const nl = trimmed.indexOf('\n');
  const boundary = [dot, nl].filter(i => i > 1 && i <= 60).sort((a, b) => a - b)[0];
  if (boundary !== undefined) return trimmed.slice(0, boundary).trim();
  if (trimmed.length <= 60) return trimmed;
  const cut = trimmed.slice(0, 57);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

function tryAudit(fn: () => void): void {
  try { fn(); } catch (e) { process.stderr.write(`[audit] write failed: ${e}\n`); }
}

function upsertTag(db: Database, name: string): number {
  db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [name]);
  return db.query<{ id: number }, [string]>(`SELECT id FROM tags WHERE name=?`).get(name)!.id;
}

function attachTags(db: Database, memoryId: number, tags: string[]): void {
  for (const tag of tags) {
    const tagId = upsertTag(db, tag.toLowerCase().trim());
    db.run(`INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES (?, ?)`, [memoryId, tagId]);
  }
}

/** Anchor a memory to the repo files it references (merge-safe). */
function attachFiles(db: Database, memoryId: number, files: string[], projectScope: string | null): void {
  for (const path of normalizeAnchorPaths(files)) {
    db.run(
      `INSERT OR IGNORE INTO memory_files (memory_id, path, project_scope) VALUES (?, ?, ?)`,
      [memoryId, path, projectScope],
    );
  }
}

/** Fetch tags for a single memory — used in recall() results. */
function getTagsForMemory(db: Database, memoryId: number): string[] {
  return db.query<{ name: string }, [number]>(
    `SELECT t.name FROM tags t JOIN memory_tags mt ON t.id=mt.tag_id WHERE mt.memory_id=?`
  ).all(memoryId).map(r => r.name);
}

/** Batch-fetch tags for many memories — used in exportMarkdown to avoid N+1. */
function getTagsBatch(db: Database, ids: number[]): Map<number, string[]> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.query<{ memory_id: number; name: string }, number[]>(
    `SELECT mt.memory_id, t.name FROM memory_tags mt JOIN tags t ON t.id=mt.tag_id
     WHERE mt.memory_id IN (${placeholders})`
  ).all(...ids);
  const result = new Map<number, string[]>();
  for (const r of rows) {
    if (!result.has(r.memory_id)) result.set(r.memory_id, []);
    result.get(r.memory_id)!.push(r.name);
  }
  return result;
}

function getRelationsForMemory(db: Database, memoryId: number): MemoryWithRelations["relations"] {
  const outgoing = db.query<{ target_memory_id: number; relationship_type: string }, [number]>(
    `SELECT target_memory_id, relationship_type FROM memory_relations WHERE source_memory_id=?`
  ).all(memoryId);

  const incoming = db.query<{ source_memory_id: number; relationship_type: string }, [number]>(
    `SELECT source_memory_id, relationship_type FROM memory_relations WHERE target_memory_id=?`
  ).all(memoryId);

  const results: MemoryWithRelations["relations"] = [];

  for (const r of outgoing) {
    const mem = db.query<Memory, [number]>(`SELECT * FROM memories WHERE id=?`).get(r.target_memory_id);
    if (mem) results.push({ memory: mem, relationship_type: r.relationship_type as RelationshipType, direction: "outgoing" });
  }
  for (const r of incoming) {
    const mem = db.query<Memory, [number]>(`SELECT * FROM memories WHERE id=?`).get(r.source_memory_id);
    if (mem) results.push({ memory: mem, relationship_type: r.relationship_type as RelationshipType, direction: "incoming" });
  }

  return results;
}

function enrichMemory(db: Database, mem: Memory): MemoryWithRelations {
  return { ...mem, stale: !!mem.stale_flagged_at, tags: getTagsForMemory(db, mem.id), relations: getRelationsForMemory(db, mem.id) };
}

// --- Decay / relevance scoring ---

/** Half-life in days by importance level. Infinity = never decays. */
const HALF_LIVES: Record<number, number> = {
  5: Infinity,
  4: 180,
  3: 90,
  2: 30,
  1: 14,
};

/** Memories below this score are soft-deprecated (not deleted). */
const DEPRECATION_THRESHOLD = 0.25;

/**
 * Compute effective relevance score.
 * score = importance × confidence × decay
 * decay = 0.5 ^ (days_since / half_life)  (1.0 for importance=5)
 */
export function computeDecayScore(memory: Memory): number {
  const halfLife = HALF_LIVES[memory.importance] ?? 90;
  if (halfLife === Infinity) {
    return memory.importance * memory.confidence;
  }
  const latestTs = [memory.last_used_at, memory.last_confirmed_at, memory.created_at]
    .map(t => new Date(t).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const daysSince = (Date.now() - latestTs) / 86_400_000;
  const decay = Math.pow(0.5, daysSince / halfLife);
  return memory.importance * memory.confidence * decay;
}

/** Update last_used_at for a batch of memory IDs. */
export function updateLastUsed(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.run(
    `UPDATE memories SET last_used_at = datetime('now') WHERE id IN (${placeholders})`,
    ids
  );
}

export interface DecayResult {
  deprecated: number;
  scored: number;
}

/**
 * Compute decay scores for all active memories. Deprecate those below threshold.
 * Protection: importance=5 OR confirm_count>=5 are never deprecated.
 */
export function decayMemories(): DecayResult {
  const db = getDb();

  const rows = db.query<Memory, []>(
    `SELECT * FROM memories WHERE status = 'active'`
  ).all();

  const toDeprecate = rows
    .filter(mem => mem.importance !== 5)
    .filter(mem =>
      // Code-invalidated memories are decay-eligible regardless of recall
      // frequency — this is the "high-traffic but stale" case decay can't
      // otherwise see. Otherwise fall back to the recency/confirm guard.
      mem.stale_flagged_at != null ||
      (mem.confirm_count < 5 && computeDecayScore(mem) < DEPRECATION_THRESHOLD)
    )
    .map(mem => mem.id);

  if (toDeprecate.length > 0) {
    const placeholders = toDeprecate.map(() => "?").join(",");
    db.run(
      `UPDATE memories SET status = 'deprecated' WHERE id IN (${placeholders})`,
      toDeprecate
    );
  }

  return { deprecated: toDeprecate.length, scored: rows.length };
}

export interface FlagStaleResult {
  flagged: number;
  ids: number[];
}

/**
 * Flag active memories anchored to any of `paths` as stale — the code they
 * reference changed. Never deletes (audit trail preserved) and never touches
 * importance=5 (permanent). Matches anchors in the same project scope or global
 * (NULL-scoped) anchors. Idempotent: re-flagging refreshes stale_flagged_at.
 */
export function flagStaleByPaths(
  paths: string[],
  opts: { project_scope?: string | null; reason?: string; actor?: string; sessionId?: string } = {},
): FlagStaleResult {
  const db = getDb();
  const norm = normalizeAnchorPaths(paths);
  if (norm.length === 0) return { flagged: 0, ids: [] };

  const scope = opts.project_scope ?? null;
  const placeholders = norm.map(() => "?").join(",");
  const candidates = db
    .query<{ id: number }, (string | null)[]>(
      `SELECT DISTINCT m.id
         FROM memories m
         JOIN memory_files mf ON mf.memory_id = m.id
        WHERE m.status = 'active'
          AND m.importance <> 5
          AND mf.path IN (${placeholders})
          AND (mf.project_scope IS ? OR mf.project_scope IS NULL)`,
    )
    .all(...norm, scope)
    .map((r) => r.id);

  const reason = opts.reason ?? "code change";
  const actor = opts.actor ?? "git-commit";

  for (const id of candidates) {
    const beforeSnap = snapshotMemory(db, id);
    db.run(
      `UPDATE memories SET stale_flagged_at = datetime('now'), stale_reason = ? WHERE id = ?`,
      [reason, id],
    );
    tryAudit(() => {
      const afterSnap = snapshotMemory(db, id);
      insertAudit(db, {
        memory_id: id,
        op: "update",
        actor,
        session_id: opts.sessionId,
        before_json: beforeSnap ? JSON.stringify(beforeSnap) : null,
        after_json: afterSnap ? JSON.stringify(afterSnap) : null,
      });
    });
  }

  return { flagged: candidates.length, ids: candidates };
}

/**
 * Clear a stale flag — the memory was reviewed and is still valid. Use forget()
 * instead when the memory is actually wrong. No-op if the memory wasn't flagged.
 */
export function revalidate(id: number): { revalidated: boolean } {
  const db = getDb();
  const before = snapshotMemory(db, id);
  const res = db.run(
    `UPDATE memories SET stale_flagged_at = NULL, stale_reason = NULL
      WHERE id = ? AND stale_flagged_at IS NOT NULL`,
    [id],
  );
  const revalidated = Number(res.changes ?? 0) > 0;
  if (revalidated) {
    tryAudit(() => {
      insertAudit(db, {
        memory_id: id,
        op: "update",
        actor: "revalidate",
        before_json: before ? JSON.stringify(before) : null,
        after_json: JSON.stringify(snapshotMemory(db, id)),
      });
    });
  }
  return { revalidated };
}

// Auto-relation detection — called fire-and-forget from learn()
async function autoDetectRelations(
  newId: number,
  content: string,
  getSimilarMemories: (text: string, topN: number, threshold: number) => Promise<Array<{ id: number; content: string; similarity: number }>>,
  classifyRelation: (a: string, b: string) => Promise<RelationshipType | null>,
): Promise<void> {
  try {
    const { readConfigSync } = await import("./config.js");
    if (readConfigSync().ltm?.autoRelate === false) return;

    const candidates = await getSimilarMemories(content, 5, 0.6);
    const others = candidates.filter(c => c.id !== newId);
    if (!others.length) return;

    await Promise.allSettled(
      others.map(async (candidate) => {
        const relType = await classifyRelation(content, candidate.content);
        if (!relType) return;
        try {
          relate({ source_id: newId, target_id: candidate.id, relationship_type: relType });
        } catch {
          // Memory may have been deleted between detection and insertion — ignore
        }
      })
    );
  } catch (err) {
    process.stderr.write(`[autoDetectRelations] error for memory ${newId}: ${err}\n`);
  }
}

export function learn(input: LearnInput): LearnResult {
  const db = getDb();

  // Scrub secrets before any DB write or dedup check
  const { scrubbed, redactions } = scrubSecrets(input.content);
  if (redactions.length > 0) {
    process.stderr.write(`[learn] Scrubbed ${redactions.length} secret(s): ${redactions.join(", ")}\n`);
  }
  const content = scrubbed;

  const dedupKey = normalizeKey(content);
  const skipExport = input.skipExport ?? false;

  const existing = db.query<Memory, [string]>(`SELECT * FROM memories WHERE dedup_key=?`).get(dedupKey);

  const actor = input.actor ?? "mcp:ltm_learn";

  if (existing) {
    const beforeSnap = snapshotMemory(db, existing.id);
    db.run(
      `UPDATE memories SET confirm_count=confirm_count+1, last_confirmed_at=datetime('now'),
       confidence=MIN(1.0, confidence+0.05),
       stale_flagged_at=NULL, stale_reason=NULL WHERE id=?`,
      [existing.id]
    );
    if (input.tags) attachTags(db, existing.id, input.tags);
    if (input.files) attachFiles(db, existing.id, input.files, existing.project_scope ?? input.project_scope ?? null);
    if (input.relate_to) {
      for (const rel of input.relate_to) {
        relate({ source_id: existing.id, target_id: rel.id, relationship_type: rel.relationship_type });
      }
    }
    tryAudit(() => {
      const afterSnap = snapshotMemory(db, existing.id);
      insertAudit(db, {
        memory_id: existing.id, op: "update", actor,
        session_id: input.sessionId,
        before_json: beforeSnap ? JSON.stringify(beforeSnap) : null,
        after_json: afterSnap ? JSON.stringify(afterSnap) : null,
      });
    });
    if (!skipExport) exportMarkdown();
    const updated = db.query<{ confirm_count: number }, [number]>(
      `SELECT confirm_count FROM memories WHERE id=?`
    ).get(existing.id);
    return { action: "reinforced", id: existing.id, confirm_count: updated?.confirm_count ?? existing.confirm_count + 1 };
  }

  const title = input.title?.trim().slice(0, 60) || deriveTitle(content);

  const result = db.run(
    `INSERT INTO memories (content, title, category, importance, confidence, source, project_scope, dedup_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      content,
      title,
      input.category,
      input.importance ?? 3,
      input.confidence ?? 1.0,
      input.source ?? null,
      input.project_scope ?? null,
      dedupKey,
      actor,
    ]
  );

  const newId = Number(result.lastInsertRowid);

  if (input.tags) attachTags(db, newId, input.tags);
  if (input.files) attachFiles(db, newId, input.files, input.project_scope ?? null);
  if (input.relate_to) {
    for (const rel of input.relate_to) {
      relate({ source_id: newId, target_id: rel.id, relationship_type: rel.relationship_type });
    }
  }

  tryAudit(() => {
    insertProvenance(db, {
      memory_id: newId,
      source_type: input.provenanceSourceType ?? "learn",
      source_ref: input.provenanceSourceRef ?? input.sessionId ?? null,
      actor,
      metadata: input.provenanceMetadata ?? null,
    });
    const afterSnap = snapshotMemory(db, newId);
    insertAudit(db, {
      memory_id: newId, op: "insert", actor,
      session_id: input.sessionId,
      before_json: null,
      after_json: afterSnap ? JSON.stringify(afterSnap) : null,
    });
  });

  if (!skipExport) exportMarkdown();

  // Embedding generation: prefer the durable Honker queue (a long-lived worker
  // claims + embeds with retry/dead-letter — short-lived hooks just enqueue and
  // exit). When no queue is available, embed inline as before. Auto-relate runs
  // inline regardless: it embeds the query text fresh and compares against other
  // memories' stored vectors, so it does not depend on this memory's own row.
  const enqueuedJobId = enqueueEmbedding(newId);
  import("./embeddings.js").then(async ({ embedMemory, getSimilarMemories, classifyRelation }) => {
    if (enqueuedJobId === null) await embedMemory(db, newId);
    await autoDetectRelations(newId, content, getSimilarMemories, classifyRelation);
  }).catch(err => process.stderr.write(`[learn] Background task failed for memory ${newId}: ${err}\n`));

  // Push a cross-process liveness event so any graph-app listener refreshes
  // without waiting on the file-watcher. No-op when Honker is unavailable.
  notifyLtm({ type: "refresh", reason: "memory_created", id: newId });
  // Opt-in cross-agent sync: notify sibling processes of the new memory. No-op
  // unless the ltm.crossProcessSync flag is on AND Honker is available.
  notifyMemoryAdded({ id: newId, project_scope: input.project_scope ?? null });

  return { action: "created", id: newId, confirm_count: 1 };
}

export async function recall(input: RecallInput = {}): Promise<MemoryWithRelations[]> {
  const db = getDb();
  const limit = input.limit ?? 10;

  let ids: Set<number> | null = null;
  const ftsRanks = new Map<number, number>();      // id → normalized [0,1]
  const semanticScores = new Map<number, number>(); // id → cosine similarity [0,1]

  if (input.query) {
    // Sanitize for FTS5: quote each token (prevents reserved-word errors) and join with OR
    const ftsQuery = input.query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => `"${t.replace(/"/g, '""')}"`)
      .join(" OR ");
    const ftsResults = db.query<{ rowid: number; rank: number }, [string]>(
      `SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT 50`
    ).all(ftsQuery);
    ids = new Set<number>();
    for (const r of ftsResults) {
      ids.add(r.rowid);
      // FTS5 BM25 rank is a negative number (closer to 0 = better).
      // Math.exp maps it to (0, 1] where 1 is a perfect match.
      ftsRanks.set(r.rowid, Math.exp(r.rank));
    }

    // Semantic fallback: if FTS5 returned fewer results than requested, augment with vector search
    if (ids.size < limit) {
      const { readConfigSync } = await import("./config.js");
      const cfg = readConfigSync();
      const semanticEnabled = cfg.ltm?.semanticFallback !== false; // default true
      if (semanticEnabled) {
        try {
          const { getSimilarMemories } = await import("./embeddings.js");
          const semantic = await getSimilarMemories(input.query, limit * 2, 0.5);
          for (const m of semantic) {
            ids.add(m.id);
            semanticScores.set(m.id, m.similarity);
          }
        } catch (err) {
          process.stderr.write(`[recall] Semantic fallback failed: ${err}\n`);
        }
      }
    }
  }

  if (input.tags && input.tags.length > 0) {
    const tagIds = input.tags.map(t => {
      const row = db.query<{ id: number }, [string]>(`SELECT id FROM tags WHERE name=?`).get(t.toLowerCase());
      return row?.id;
    }).filter((id): id is number => id !== undefined);

    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => "?").join(",");
      const tagMemIds = db.query<{ memory_id: number }, number[]>(
        `SELECT DISTINCT memory_id FROM memory_tags WHERE tag_id IN (${placeholders})`
      ).all(...tagIds).map(r => r.memory_id);

      const tagSet = new Set(tagMemIds);
      ids = ids ? new Set([...ids].filter(id => tagSet.has(id))) : tagSet;
    }
  }

  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (ids !== null) {
    if (ids.size === 0) return [];
    const placeholders = [...ids].map(() => "?").join(",");
    conditions.push(`id IN (${placeholders})`);
    params.push(...ids);
  }

  if (input.category) {
    conditions.push("category=?");
    params.push(input.category);
  }

  if (input.project) {
    conditions.push("(project_scope IS NULL OR project_scope=?)");
    params.push(input.project);
  }

  if (input.workspace_id) {
    conditions.push("(workspace_id IS NULL OR workspace_id=?)");
    params.push(input.workspace_id);
  }
  if (input.agent_id) {
    conditions.push("(agent_id IS NULL OR agent_id=?)");
    params.push(input.agent_id);
  }

  conditions.push("status = 'active'");

  if (input.since) {
    conditions.push("(created_at > ? OR last_recalled_at > ?)");
    params.push(input.since, input.since);
  }
  if (input.until) {
    conditions.push("(created_at < ? OR last_recalled_at < ?)");
    params.push(input.until, input.until);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  // Explicit columns — excludes embedding blob (~260 KB/row) from hot recall path.
  // Use getById(id, { withEmbedding: true }) when the blob is needed.
  // default sort (no query): ORDER BY decay_score DESC pushed to SQL → O(log N)
  const defaultSqlSort = (!input.sort_by || input.sort_by === "relevance") && ids === null;
  const orderBy = defaultSqlSort ? "ORDER BY decay_score DESC" : "";
  const rows = db.query<Memory, typeof params>(
    `SELECT id, content, category, importance, confidence, source, project_scope, dedup_key,
            created_at, last_confirmed_at, last_used_at, confirm_count, status,
            first_recalled_at, last_recalled_at, recall_count, superseded_by, superseded_at,
            workspace_id, agent_id, decay_score, stale_flagged_at, stale_reason
     FROM memories ${where} ${orderBy} LIMIT ${limit}`
  ).all(...params);

  let sorted: typeof rows;
  if (defaultSqlSort) {
    sorted = rows; // already ordered by decay_score DESC in SQL
  } else if (input.sort_by === "created") {
    sorted = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (input.sort_by === "last_recalled") {
    sorted = rows.sort((a, b) => new Date(b.last_recalled_at ?? "1970").getTime() - new Date(a.last_recalled_at ?? "1970").getTime());
  } else if (input.sort_by === "recall_count") {
    sorted = rows.sort((a, b) => (b.recall_count ?? 0) - (a.recall_count ?? 0));
  } else {
    // FTS/semantic path: small result set (≤50), JS sort is O(k log k) — negligible.
    // Use materialised decay_score if available, fall back to computing it.
    sorted = rows
      .map(m => ({ m, score: m.decay_score ?? computeDecayScore(m) }))
      .sort((a, b) => b.score - a.score)
      .map(({ m }) => m);
  }
  // Downrank stale (code-invalidated) memories: stable partition pushes them
  // after fresh ones at equal relevance — still returned, just demoted.
  sorted = [
    ...sorted.filter(m => !m.stale_flagged_at),
    ...sorted.filter(m => m.stale_flagged_at),
  ];
  if (sorted.length > 0) {
    const placeholders = sorted.map(() => "?").join(",");
    db.run(
      `UPDATE memories SET last_used_at = datetime('now'), last_recalled_at = datetime('now'),
              recall_count = recall_count + 1,
              first_recalled_at = COALESCE(first_recalled_at, datetime('now'))
       WHERE id IN (${placeholders})`,
      sorted.map(m => m.id),
    );
  }
  const enriched = sorted.map(m => enrichMemory(db, m));
  if (input.includeProvenance) {
    const provMap = listProvenanceBatch(db, enriched.map(m => m.id));
    for (const m of enriched) {
      m.provenance = provMap.get(m.id) ?? [];
    }
  }

  // Attach explainer (pure function — no extra DB calls).
  if (enriched.length > 0) {
    const { buildExplainer } = await import("./recall/explainer.js");
    for (const m of enriched) {
      m.explainer = buildExplainer({
        importance: m.importance,
        recall_count: m.recall_count ?? 0,
        last_recalled_at: m.last_recalled_at,
        ftsRank: ftsRanks.get(m.id) ?? null,
        semanticScore: semanticScores.get(m.id) ?? null,
      });
    }
  }

  return enriched;
}

export function relate(input: {
  source_id: number;
  target_id: number;
  relationship_type: RelationshipType;
}): void {
  const db = getDb();
  if (!db.query<{ id: number }, [number]>(`SELECT id FROM memories WHERE id=?`).get(input.source_id)) {
    throw new Error(`Source memory ${input.source_id} not found`);
  }
  if (!db.query<{ id: number }, [number]>(`SELECT id FROM memories WHERE id=?`).get(input.target_id)) {
    throw new Error(`Target memory ${input.target_id} not found`);
  }
  db.run(
    `INSERT OR IGNORE INTO memory_relations (source_memory_id, target_memory_id, relationship_type)
     VALUES (?, ?, ?)`,
    [input.source_id, input.target_id, input.relationship_type]
  );
}

export function forget(input: { id: number; reason?: string; skipExport?: boolean; actor?: string; sessionId?: string }): void {
  const db = getDb();
  const snap = snapshotMemory(db, input.id);
  if (!snap) throw new Error(`Memory ${input.id} not found`);
  db.run(`DELETE FROM memories WHERE id=?`, [input.id]);
  tryAudit(() => insertAudit(db, {
    memory_id: input.id,
    op: "forget",
    actor: input.actor ?? "mcp:ltm_forget",
    session_id: input.sessionId,
    before_json: JSON.stringify(snap),
    after_json: null,
  }));
  if (!input.skipExport) exportMarkdown();
}

export function getSimilarMemories(
  db: Database,
  queryVec: Float32Array,
  opts: { projectScope?: string; limit?: number; minImportance?: number }
): Memory[] {
  const { projectScope, limit = 15, minImportance = 2 } = opts;
  const { blobToVec, cosineSimilarity } = require("./embeddings.js") as typeof import("./embeddings.js");

  let query: string;
  let params: (string | number)[];

  if (projectScope) {
    query = `SELECT * FROM memories WHERE project_scope=? AND importance>=? AND embedding IS NOT NULL AND status='active' LIMIT ${limit * 3}`;
    params = [projectScope, minImportance];
  } else {
    query = `SELECT * FROM memories WHERE project_scope IS NULL AND importance>=? AND embedding IS NOT NULL AND status='active' LIMIT ${limit * 3}`;
    params = [minImportance];
  }

  const rows = db.query<Memory & { embedding: Buffer }, typeof params>(query).all(...params);

  const scored = rows.map(row => {
    const { embedding, ...mem } = row as Memory & { embedding: Buffer };
    const sim = cosineSimilarity(queryVec, blobToVec(embedding));
    return { mem, sim };
  });

  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, limit).map(s => s.mem);
}

export function getContextMerge(project: string): { globals: Memory[]; scoped: Memory[] } {
  const db = getDb();
  const sortByDecay = (arr: Memory[]) =>
    arr.map(m => ({ m, score: computeDecayScore(m) }))
       .sort((a, b) => b.score - a.score)
       .map(({ m }) => m);

  const SLIM = `id, content, category, importance, confidence, source, project_scope, dedup_key,
               created_at, last_confirmed_at, last_used_at, confirm_count, status,
               first_recalled_at, last_recalled_at, recall_count, superseded_by, superseded_at,
               workspace_id, agent_id`;
  const globals = sortByDecay(db.query<Memory, []>(
    `SELECT ${SLIM} FROM memories WHERE importance >= 4 AND project_scope IS NULL AND status = 'active'`
  ).all());

  const scoped = sortByDecay(db.query<Memory, [string]>(
    `SELECT ${SLIM} FROM memories WHERE project_scope=? AND importance >= 3 AND status = 'active' LIMIT 15`
  ).all(project));

  const allIds = [...globals, ...scoped].map(m => m.id);
  updateLastUsed(allIds);

  return { globals, scoped };
}

/**
 * Async variant: returns getContextMerge result plus graph insights block.
 * Used by SessionStart hook when graphReasoning is enabled.
 */
export async function getContextMergeWithGraph(project: string): Promise<{ globals: Memory[]; scoped: Memory[]; graphInsights?: string }> {
  const base = getContextMerge(project);

  const { readConfigSync } = await import("./config.js");
  if (!readConfigSync().ltm?.graphReasoning) return base;

  const seeds = [...base.globals.slice(0, 2), ...base.scoped.slice(0, 1)].map(m => m.id);
  if (seeds.length === 0) return base;

  try {
    const { traverseGraph, buildReasoningContext } = await import("./graph.js");
    const results = await Promise.allSettled(seeds.map(id => traverseGraph(id, 2, false)));
    const lines: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        const block = buildReasoningContext(r.value);
        if (block) lines.push(block);
      }
    }
    const graphInsights = lines.slice(0, 5).join("\n") || undefined;
    return { ...base, graphInsights };
  } catch (err) {
    process.stderr.write(`[getContextMergeWithGraph] error: ${err}\n`);
    return base;
  }
}

/** Write docs/memory-long-term-dump.md — auto-generated snapshot (never overwrites the architecture doc). */
export function exportMarkdown(): void {
  const db = getDb();
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

  const rows = db.query<Memory, []>(
    `SELECT * FROM memories ORDER BY importance DESC, category ASC, created_at DESC LIMIT 500`
  ).all();

  // Batch-fetch all tags in one query to avoid N+1
  const tagsByMemory = getTagsBatch(db, rows.map(r => r.id));

  const timestamp = new Date().toISOString().replace("T", " ").replace(/\..+/, "");
  const lines: string[] = [
    `# Long-Term Memory — Generated Dump`,
    ``,
    `> Auto-generated by \`memory/db.ts\`. Last updated: ${timestamp}`,
    `> This is a raw data export. For the architecture guide see \`docs/memory-long-term.md\`.`,
    `> Edit via \`/learn\`, \`/forget\`, \`/relate\` commands — do not edit directly.`,
    ``,
  ];

  const byCategory = new Map<string, Memory[]>();
  for (const m of rows) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m);
  }

  for (const [cat, mems] of byCategory) {
    lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
    lines.push("");
    for (const m of mems) {
      const tags = tagsByMemory.get(m.id) ?? [];
      const tagStr = tags.length > 0 ? ` \`[${tags.join(", ")}]\`` : "";
      const scope = m.project_scope ? ` *(${m.project_scope})*` : "";
      const imp = "★".repeat(m.importance) + "☆".repeat(5 - m.importance);
      lines.push(`- **[${m.id}]** ${m.content}${scope}${tagStr} ${imp} (conf: ${m.confidence.toFixed(2)}, confirmed: ${m.confirm_count}x)`);
    }
    lines.push("");
  }

  if (rows.length === 0) {
    lines.push("*No memories stored yet. Use `/learn` to add insights.*");
    lines.push("");
  }

  writeFileSync(join(DOCS_DIR, "memory-long-term-dump.md"), lines.join("\n"));
}

/** Write docs/memory-graph.json — nodes + links for Force-Graph visualization. */
export function exportGraphJson(): void {
  const db = getDb();
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

  const memories = db.query<Memory, []>(`SELECT * FROM memories`).all();
  const relations = db.query<MemoryRelation, []>(`SELECT * FROM memory_relations`).all();

  writeFileSync(join(DOCS_DIR, "memory-graph.json"), JSON.stringify({
    nodes: memories.map(m => ({
      id: m.id,
      label: m.content.substring(0, 60),
      category: m.category,
      importance: m.importance,
      project_scope: m.project_scope,
    })),
    links: relations.map(r => ({
      source: r.source_memory_id,
      target: r.target_memory_id,
      type: r.relationship_type,
    })),
  }, null, 2));
}
