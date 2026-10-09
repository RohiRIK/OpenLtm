/**
 * db.ts — Global long-term memory (learned insights, patterns, preferences)
 * Replaces skills/learned/*.md with structured SQLite + FTS5.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeKey } from "./dedup.js";
import { differsMeaningfully, isNearDuplicate, jaccardSimilarity } from "./similarity.js";
import { filterPrivateMemories } from "./privacy.js";
import { normalizeAnchorPaths } from "./anchors.js";
import { getDb, DB_PATH, configure as configureDb } from "./shared-db.js";
import { enqueueEmbedding } from "./queue/index.js";
import { notifyLtm, notifyMemoryAdded } from "./events/index.js";
import { scrubOrRefuse } from "./secretsScrubber.js";
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
  /** How an existing memory was matched (absent on clean create). */
  matched_by?: "exact" | "containment" | "jaccard";
  /** Similarity score in [0,1] when matched_by is jaccard/containment. */
  score?: number;
  /** Id of the near-duplicate candidate (reinforced or noted on create). */
  matched_id?: number;
}

export interface RecallInput {
  /** Opt-in: include memories tagged `private` (default false). */
  includePrivate?: boolean;
  since?: string;
  until?: string;
  sort_by?: "relevance" | "created" | "last_recalled" | "recall_count";

  query?: string;
  tags?: string[];
  category?: MemoryCategory;
  project?: string;
  limit?: number;
  /** Only memories in this workspace (or with no workspace) are returned. */
  workspace_id?: string;
  /** Only memories written by this agent (or with no agent) are returned. */
  agent_id?: string;
  /** When true, each result includes a `provenance` array. Off by default to preserve latency. */
  includeProvenance?: boolean;
  /**
   * Hybrid ranking: run the embedding search alongside FTS and fuse both with
   * Reciprocal Rank Fusion. Default true. Pass false on a hot path to force
   * FTS-only (no provider round-trip). Also off when `ltm.semanticFallback`
   * is false or the embeddings provider is "disabled".
   */
  semantic?: boolean;
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

function oneLineForLog(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/** Conservative near-dup thresholds (#16). Strong → reinforce; ambiguous → note only. */
const JACCARD_REINFORCE = 0.85;
const JACCARD_AMBIGUOUS = 0.55;

interface NearDupHit {
  memory: Memory;
  matched_by: "containment" | "jaccard";
  score: number;
  /** True only for strong matches — safe to reinforce silently. */
  reinforce: boolean;
}

/**
 * findNearDuplicate — FTS candidate shortlist + containment/Jaccard tiers.
 * Scoped to the same project scope. Never silently merges ambiguous paraphrases.
 */
function findNearDuplicate(
  db: Database,
  content: string,
  projectScope: string | null,
  dedupKey: string,
): NearDupHit | null {
  let candidates: Memory[] = [];

  // Tier 0 — FTS shortlist (cheap index probe)
  try {
    const ftsQuery = content
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 12)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" OR ");
    if (ftsQuery) {
      const ftsIds = db.query<{ rowid: number }, [string]>(
        `SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT 10`,
      ).all(ftsQuery);
      if (ftsIds.length > 0) {
        const placeholders = ftsIds.map(() => "?").join(",");
        candidates = db.query<Memory, (string | number | null)[]>(
          `SELECT * FROM memories
            WHERE id IN (${placeholders}) AND status='active' AND dedup_key<>?
              AND (project_scope IS ? OR project_scope = ?)`,
        ).all(...ftsIds.map((r) => r.rowid), dedupKey, projectScope, projectScope);
      }
    }
  } catch {
    // FTS unavailable / bad query — fall through to decay shortlist
  }

  if (candidates.length === 0) {
    candidates = db.query<Memory, [string, string | null, string | null]>(
      `SELECT * FROM memories
        WHERE status='active' AND dedup_key<>?
          AND (project_scope IS ? OR project_scope = ?)
        ORDER BY decay_score DESC, id DESC
        LIMIT 40`,
    ).all(dedupKey, projectScope, projectScope);
  }

  // Tier 1 — token containment (existing conservative rule)
  for (const row of candidates) {
    if (isNearDuplicate(row.content, content)) {
      return { memory: row, matched_by: "containment", score: 1, reinforce: true };
    }
  }

  // Tier 2 — Jaccard; reinforce only at strong threshold
  let best: NearDupHit | null = null;
  for (const row of candidates) {
    const score = jaccardSimilarity(row.content, content);
    if (score < JACCARD_AMBIGUOUS) continue;
    // A strong score is not enough when the difference is a marker, number, or
    // polarity word ("plan A" vs "plan B") — record it as ambiguous instead.
    const reinforce = score >= JACCARD_REINFORCE && !differsMeaningfully(row.content, content);
    const hit: NearDupHit = { memory: row, matched_by: "jaccard", score, reinforce };
    if (!best || score > best.score) best = hit;
  }
  return best;
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

// ── Recall ranking (Recall v2) ────────────────────────────────────────────────

/** Weights for the composite relevance score. Kept in one place so the
 *  explainer and the sort can never drift apart. */
export const RANK_WEIGHTS = {
  decay: 1.0,
  importance: 0.6,
  projectScope: 0.9,
  recallFrequency: 0.25,
  stalePenalty: 0.8,
  duplicatePenalty: 0.5,
  /**
   * Query relevance (fused RRF score, see `fuseRecallRankings`). RRF scores are
   * flat — rank 1 vs rank 2 of one retriever differ by ~1.6% — so the weight is
   * large: near the top one rank ≈ 0.3 points, i.e. project scope ≈ 3 ranks,
   * while a hit from both retrievers (+20) outranks a single-retriever hit.
   */
  relevance: 20,
} as const;

/** Reciprocal Rank Fusion constant (Cormack et al. 2009). */
export const RRF_K = 60;

/** One retriever's hits, best first. `score` is only used to give exact ties a shared rank. */
export type RankedList = ReadonlyArray<{ id: number; score?: number }>;

/**
 * reciprocalRankFusion — fuse ranked lists: score(d) = Σ 1 / (k + rank(d)),
 * with 1-based ranks. Entries with an equal `score` share a rank (competition
 * ranking) so exact ties fuse identically; a repeated id within one list only
 * counts its best rank. Pure function.
 */
export function reciprocalRankFusion(lists: readonly RankedList[], k: number = RRF_K): Map<number, number> {
  const fused = new Map<number, number>();
  for (const list of lists) {
    const seen = new Set<number>();
    let rank = 0;
    let prevScore: number | undefined;
    list.forEach((entry, i) => {
      if (i === 0 || entry.score === undefined || entry.score !== prevScore) rank = i + 1;
      prevScore = entry.score;
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + 1 / (k + rank));
    });
  }
  return fused;
}

/**
 * fuseRecallRankings — RRF-fuse retriever lists into a relevance map scaled so
 * 1.0 means "ranked first by one retriever" (2.0 = first by both). This is the
 * `relevance` input to rankRecallResults.
 */
export function fuseRecallRankings(lists: readonly RankedList[], k: number = RRF_K): Map<number, number> {
  const fused = reciprocalRankFusion(lists, k);
  for (const [id, score] of fused) fused.set(id, score * (k + 1));
  return fused;
}

/** Penalty applied to the k-th occurrence of a near-duplicate cluster. */
const DUPLICATE_DECAY_FACTOR = 0.4;

/**
 * rankRecallResults — order recall candidates for relevance.
 *
 * Behaviour:
 *   - explicit `sort_by` requests are honoured verbatim
 *   - project-scoped memories outrank globals of otherwise equal strength
 *   - stale (code-invalidated) memories are demoted but still returned
 *   - near-duplicate clusters are demoted progressively, never dropped
 *   - ties break on ascending id so identical inputs give identical output
 *   - with `relevance` (a query recall), the fused query relevance leads and
 *     the decay term is normalised to [0,1] (decay_score / 5) so priors nudge
 *     near-ties instead of overriding the match
 */
export function rankRecallResults(
  candidates: Memory[],
  opts: {
    limit: number;
    project?: string;
    defaultSort?: boolean;
    sortBy?: "relevance" | "created" | "last_recalled" | "recall_count";
    /** id → fused query relevance (fuseRecallRankings). Absent ids score 0. */
    relevance?: ReadonlyMap<number, number>;
  },
): Memory[] {
  const rows = [...candidates];

  // Explicit user-requested sorts stay literal.
  if (opts.sortBy === "created") {
    return rows
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || a.id - b.id)
      .slice(0, opts.limit);
  }
  if (opts.sortBy === "last_recalled") {
    return rows
      .sort((a, b) => new Date(b.last_recalled_at ?? "1970").getTime() - new Date(a.last_recalled_at ?? "1970").getTime() || a.id - b.id)
      .slice(0, opts.limit);
  }
  if (opts.sortBy === "recall_count") {
    return rows
      .sort((a, b) => (b.recall_count ?? 0) - (a.recall_count ?? 0) || a.id - b.id)
      .slice(0, opts.limit);
  }

  const relevanceMap = opts.relevance;
  const scored = rows.map((memory) => {
    const decay = memory.decay_score ?? computeDecayScore(memory);
    const importance = memory.importance / 5;
    const projectScope = opts.project && memory.project_scope === opts.project ? 1 : 0;
    const recallFrequency = Math.min(1, Math.log2((memory.recall_count ?? 0) + 1) / 4);
    const stale = memory.stale_flagged_at ? RANK_WEIGHTS.stalePenalty : 0;
    const relevance = relevanceMap ? (relevanceMap.get(memory.id) ?? 0) * RANK_WEIGHTS.relevance : 0;
    const decayTerm = relevanceMap ? Math.min(1, decay / 5) : decay;
    const score =
      relevance +
      decayTerm * RANK_WEIGHTS.decay +
      importance * RANK_WEIGHTS.importance +
      projectScope * RANK_WEIGHTS.projectScope +
      recallFrequency * RANK_WEIGHTS.recallFrequency -
      stale;
    return { memory, score, decay, stale };
  });

  scored.sort((a, b) => b.score - a.score || b.decay - a.decay || a.memory.id - b.memory.id);

  // Progressive near-duplicate demotion: first occurrence keeps its rank,
  // later ones decay by a fixed factor each. Nothing is removed.
  const seen: Memory[] = [];
  const adjusted = scored.map((entry) => {
    const clusterIndex = seen.findIndex((m) => isNearDuplicate(m.content, entry.memory.content));
    if (clusterIndex === -1) {
      seen.push(entry.memory);
      return { ...entry, finalScore: entry.score };
    }
    const penalty = Math.min(1, entry.score * RANK_WEIGHTS.duplicatePenalty * Math.pow(DUPLICATE_DECAY_FACTOR, clusterIndex));
    return { ...entry, finalScore: entry.score - penalty };
  });

  adjusted.sort((a, b) => b.finalScore - a.finalScore || b.decay - a.decay || a.memory.id - b.memory.id);
  return adjusted.slice(0, opts.limit).map((entry) => entry.memory);
}

// ── Memory hygiene (hygiene v2) ───────────────────────────────────────────────

/** Operational noise: runtime chatter, not durable knowledge. */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*(?:ok|okay|done|thanks|thank you|sure|got it|understood|acknowledged)\b[.!]?\s*$/i,
  /\b(?:running|running\.\.\.|in progress|queued|processing)\b\s*$/i,
  /\btook \d+(?:\.\d+)?\s*m?s\b/i,
  /\bexit(?:ed)?\s+(?:code|status)\s+\d+\b/i,
  /\b(?:compacted|compaction)\b.{0,40}\b(?:reference only|summary only)\b/i,
  /\b(?:background|async|delegation)\b.{0,30}\b(?:process|task|batch|job)?\b.*\b(?:complete|completed|done|finished)\b/i,
  /\bnotification\b.{0,30}\b(?:background|completed)\b/i,
  /^\s*[\[\(<{].{0,20}[\]\)>}].{0,40}$/,
];

/** Noise that is only noise when it carries no durable signal. */
const DURABLE_SIGNAL_RE = /\b(must|never|always|avoid|prefer|require|constraint|gotcha|decision|instead of|do not|don't)\b/i;

/**
 * isOperationalNoise — true when text looks like runtime chatter.
 * A message that still states a rule ("always use bun, not npm") is kept even
 * if it matches, because the durable signal outweighs the shape.
 */
export function isOperationalNoise(content: string): boolean {
  const text = content.trim();
  if (text.length < 12) return true;
  if (DURABLE_SIGNAL_RE.test(text)) return false;
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export function learn(input: LearnInput): LearnResult {
  const db = getDb();

  // Scrub secrets before any DB write or dedup check
  const { scrubbed, redactions } = scrubOrRefuse(input.content);
  if (redactions.length > 0) {
    process.stderr.write(`[learn] Scrubbed ${redactions.length} secret(s): ${redactions.join(", ")}\n`);
  }
  const content = scrubbed;

  // Hygiene: operational noise is downgraded rather than stored verbatim.
  if (isOperationalNoise(content)) {
    input = {
      ...input,
      importance: Math.min(input.importance ?? 3, 2),
      category: (input.category ?? "pattern") as MemoryCategory,
    };
    if ((input.importance ?? 3) >= 4) {
      process.stderr.write(`[learn] Downgraded operational-noise memory: "${oneLineForLog(content)}"\n`);
    }
  }

  const dedupKey = normalizeKey(content);
  const skipExport = input.skipExport ?? false;

  const exact = db.query<Memory, [string]>(`SELECT * FROM memories WHERE dedup_key=?`).get(dedupKey);
  const near = exact ? null : findNearDuplicate(db, content, input.project_scope ?? null, dedupKey);
  // Reinforce only exact or strong near-dup; ambiguous near-dup creates + annotates.
  const reinforceTarget: Memory | null =
    exact ?? (near?.reinforce ? near.memory : null);
  const nearNote = near && !near.reinforce ? near : null;

  const actor = input.actor ?? "mcp:ltm_learn";

  if (reinforceTarget) {
    const existing = reinforceTarget;
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
    return {
      action: "reinforced",
      id: existing.id,
      confirm_count: updated?.confirm_count ?? existing.confirm_count + 1,
      matched_by: exact ? "exact" : near!.matched_by,
      score: exact ? 1 : near!.score,
      matched_id: existing.id,
    };
  }

  const title = input.title?.trim().slice(0, 60) || deriveTitle(content);

  const result = db.run(
    `INSERT INTO memories (content, title, category, importance, confidence, source, project_scope, dedup_key, created_by, workspace_id, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.workspace_id ?? null,
      input.agent_id ?? null,
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

  return {
    action: "created",
    id: newId,
    confirm_count: 1,
    ...(nearNote
      ? { matched_by: nearNote.matched_by, score: nearNote.score, matched_id: nearNote.memory.id }
      : {}),
  };
}

// ── Recall query building + hybrid retrieval ─────────────────────────────────

/**
 * Words that carry no retrieval signal in a natural-language query ("how do we
 * handle …"). OR-ing them into the FTS query fills the result set with
 * incidental matches, so they are dropped before the MATCH is built.
 * Directional/temporal words (up, down, before, after, …) are kept on purpose:
 * they are meaningful in technical text ("down migration", "after deploy").
 */
const RECALL_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "about", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "being", "both", "but", "by",
  "can", "could", "did", "do", "does", "doing", "each", "else", "etc",
  "for", "from", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his",
  "how", "hows", "how's", "i", "i'm", "if", "in", "into", "is", "it", "it's", "its", "itself",
  "just", "let", "lets", "let's", "me", "my", "myself", "no", "nor", "not", "now",
  "of", "on", "once", "or", "our", "ours", "ourselves", "please", "she", "should", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "then", "there", "there's", "these", "they", "this", "those", "to", "too",
  "us", "very", "was", "we", "we're", "were", "what", "whats", "what's", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself",
]);

const WORD_EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const PLAIN_WORD_RE = /^[\p{L}\p{N}]+$/u;

function quoteFts(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * One FTS5 term for a kept query word. Plain words of 4+ chars become a prefix
 * match with a light plural fold, so "migrations" also finds "migration" and
 * "handle" finds "handles"/"handler". Anything else stays an exact phrase.
 */
function ftsTerm(word: string): string {
  if (!PLAIN_WORD_RE.test(word) || word.length < 4) return quoteFts(word);
  const stem = word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return `${quoteFts(stem)}*`;
}

/**
 * buildFtsQuery — turn a natural-language query into an FTS5 MATCH expression.
 * Drops stopwords and tokens shorter than 2 chars, de-duplicates, quotes every
 * term (no reserved-word errors) and ORs them. When nothing survives the
 * filter (e.g. "how do we"), falls back to the original tokens. Returns null
 * when the query holds no searchable token at all.
 */
export function buildFtsQuery(query: string): string | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    const word = token.toLowerCase().replace(WORD_EDGE_RE, "");
    if (word.length < 2 || RECALL_STOPWORDS.has(word) || kept.includes(word)) continue;
    kept.push(word);
  }
  if (kept.length > 0) return kept.map(ftsTerm).join(" OR ");
  const fallback = tokens.filter((t) => /[\p{L}\p{N}]/u.test(t));
  return fallback.length > 0 ? fallback.map(quoteFts).join(" OR ") : null;
}

/** Embedding search used by hybrid recall: hits best-first, similarity in [0,1]. */
export type RecallSemanticSearch = (query: string, topN: number) => Promise<Array<{ id: number; similarity: number }>>;

/** Minimum cosine similarity for a semantic hit to join the candidate set. */
const SEMANTIC_MIN_SIMILARITY = 0.5;
/** A slow provider must not stall recall: past this budget, recall is FTS-only. */
const SEMANTIC_TIMEOUT_MS = 2_000;

let semanticSearchOverride: RecallSemanticSearch | null = null;

/** Test seam: replace the embedding search recall() uses (null restores the provider). */
export function _setRecallSemanticSearchForTesting(fn: RecallSemanticSearch | null): void {
  semanticSearchOverride = fn;
}

/** The embedding search to run, or null when hybrid recall is off for this call. */
async function resolveSemanticSearch(enabled: boolean | undefined): Promise<RecallSemanticSearch | null> {
  if (enabled === false) return null;
  const { readConfigSync } = await import("./config.js");
  const cfg = readConfigSync();
  if (cfg.ltm?.semanticFallback === false) return null;
  if (semanticSearchOverride) return semanticSearchOverride;
  const { explicitEmbedProvider } = await import("./providers/embeddingProvider.js");
  if ((explicitEmbedProvider() ?? cfg.embeddings?.provider) === "disabled") return null;
  const { getSimilarMemories } = await import("./embeddings.js");
  return (query, topN) => getSimilarMemories(query, topN, SEMANTIC_MIN_SIMILARITY);
}

/** Run the semantic retriever. Never rejects: any failure or timeout yields []. */
async function semanticHits(query: string, topN: number, enabled: boolean | undefined): Promise<Array<{ id: number; similarity: number }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const search = await resolveSemanticSearch(enabled);
    if (!search) return [];
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SEMANTIC_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    const hits = await Promise.race([search(query, topN), timeout]);
    if (hits === null) {
      process.stderr.write(`[recall] Semantic search exceeded ${SEMANTIC_TIMEOUT_MS}ms — FTS only\n`);
      return [];
    }
    return [...hits].sort((a, b) => b.similarity - a.similarity);
  } catch (err) {
    process.stderr.write(`[recall] Semantic search failed — FTS only: ${err}\n`);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const RECALL_COLUMNS = `id, content, category, importance, confidence, source, project_scope, dedup_key,
              created_at, last_confirmed_at, last_used_at, confirm_count, status,
              first_recalled_at, last_recalled_at, recall_count, superseded_by, superseded_at,
              workspace_id, agent_id, decay_score, stale_flagged_at, stale_reason, title`;

/** SQL ORDER BY for a recall without a query (no relevance signal to rank on). */
function recallSqlOrder(sortBy: RecallInput["sort_by"]): string {
  switch (sortBy) {
    case "created": return "ORDER BY created_at DESC, id ASC";
    case "last_recalled": return "ORDER BY last_recalled_at DESC, id ASC";
    case "recall_count": return "ORDER BY recall_count DESC, id ASC";
    default: return "ORDER BY decay_score DESC";
  }
}

/**
 * recall — ranked long-term memories.
 *
 * With a query, retrieval is hybrid: FTS5 (stopwords dropped, BM25 order) and,
 * unless disabled, an embedding search run alongside it. Both lists are fused
 * with Reciprocal Rank Fusion (k=60); the fused relevance then leads the
 * Recall v2 score (importance, decay, project scope, staleness, near-dupes).
 * If the embedding search is off, fails or times out, recall is FTS-only.
 */
export async function recall(input: RecallInput = {}): Promise<MemoryWithRelations[]> {
  const db = getDb();
  const limit = input.limit ?? 10;

  let ids: Set<number> | null = null;
  let relevance: Map<number, number> | null = null;
  const ftsRanks = new Map<number, number>();      // id → BM25 relative to the best hit, (0,1]
  const semanticScores = new Map<number, number>(); // id → cosine similarity [0,1]

  if (input.query) {
    // Start the embedding round-trip first so it overlaps the (synchronous) FTS query.
    const semanticPromise = semanticHits(input.query, Math.max(limit * 2, 20), input.semantic);

    const ftsQuery = buildFtsQuery(input.query);
    const ftsResults = ftsQuery
      ? db.query<{ rowid: number; rank: number }, [string]>(
          `SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT 50`
        ).all(ftsQuery)
      : [];
    // FTS5 rank is BM25 negated: more negative = better, best hit first.
    const bestRank = ftsResults[0]?.rank ?? 0;
    for (const r of ftsResults) {
      ftsRanks.set(r.rowid, bestRank < 0 ? r.rank / bestRank : 1);
    }

    const semantic = await semanticPromise;
    for (const m of semantic) semanticScores.set(m.id, m.similarity);

    relevance = fuseRecallRankings([
      ftsResults.map((r) => ({ id: r.rowid, score: r.rank })),
      semantic.map((m) => ({ id: m.id, score: m.similarity })),
    ]);
    ids = new Set(relevance.keys());
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

  // Workspace / agent isolation: rows written for this workspace (agent) plus
  // unscoped rows, mirroring how project scope treats globals.
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
  let candidateRows: Memory[];
  if (relevance) {
    // Query recall: every fused hit that passes the filters (≤ 50 FTS + the
    // semantic list), cut to the limit*3 most relevant before the O(n²)
    // near-duplicate pass in rankRecallResults.
    const fused = relevance;
    candidateRows = db.query<Memory, typeof params>(`SELECT ${RECALL_COLUMNS} FROM memories ${where}`).all(...params)
      .sort((a, b) => (fused.get(b.id) ?? 0) - (fused.get(a.id) ?? 0) || a.id - b.id)
      .slice(0, limit * 3);
  } else {
    // No query: SQL picks the limit*3 strongest rows for the requested sort
    // (decay_score DESC by default, an O(log N) index scan).
    candidateRows = db.query<Memory, typeof params>(
      `SELECT ${RECALL_COLUMNS} FROM memories ${where} ${recallSqlOrder(input.sort_by)} LIMIT ${limit * 3}`
    ).all(...params);
  }
  const sorted = rankRecallResults(candidateRows, {
    limit,
    project: input.project,
    defaultSort: !relevance && (!input.sort_by || input.sort_by === "relevance"),
    sortBy: input.sort_by,
    relevance: relevance ?? undefined,
  });
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
  let enriched = sorted.map(m => enrichMemory(db, m));
  enriched = filterPrivateMemories(enriched, input.includePrivate === true);
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

/**
 * Fetch a single active memory by id (for progressive MCP get-after-index).
 * Returns null when missing or not active.
 */
export function getMemoryById(id: number): MemoryWithRelations | null {
  const db = getDb();
  const row = db.query<Memory, [number]>(
    `SELECT * FROM memories WHERE id=? AND status='active'`
  ).get(id);
  if (!row) return null;
  return enrichMemory(db, row);
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

  // Vectors live in memory_embeddings since migration 010 (memories.embedding was
  // dropped). Only vectors with the query's dimension are comparable.
  const scopeSql = projectScope ? "m.project_scope = ?" : "m.project_scope IS NULL";
  const params: (string | number)[] = projectScope
    ? [projectScope, minImportance, queryVec.length]
    : [minImportance, queryVec.length];
  const rows = db.query<Memory & { vec_blob: Buffer }, typeof params>(
    `SELECT m.*, e.embedding AS vec_blob FROM memories m
       JOIN memory_embeddings e ON e.memory_id = m.id
      WHERE ${scopeSql} AND m.importance >= ? AND m.status = 'active' AND e.dim = ?`,
  ).all(...params);

  const scored = rows.map(row => {
    const { vec_blob, ...mem } = row as Memory & { vec_blob: Buffer };
    const sim = cosineSimilarity(queryVec, blobToVec(vec_blob));
    return { mem: mem as Memory, sim };
  });

  scored.sort((a, b) => b.sim - a.sim);
  const picked: Memory[] = [];
  for (const s of scored) {
    const enriched = enrichMemory(db, s.mem);
    if (filterPrivateMemories([enriched], false).length === 0) continue;
    picked.push(s.mem);
    if (picked.length >= limit) break;
  }
  return picked;
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
               workspace_id, agent_id, title`;
  const globals = sortByDecay(db.query<Memory, []>(
    `SELECT ${SLIM} FROM memories WHERE importance >= 4 AND project_scope IS NULL AND status = 'active'`
  ).all());

  const scoped = sortByDecay(db.query<Memory, [string]>(
    `SELECT ${SLIM} FROM memories WHERE project_scope=? AND importance >= 3 AND status = 'active' LIMIT 15`
  ).all(project));

  const gEnriched = globals.map(m => enrichMemory(db, m));
  const sEnriched = scoped.map(m => enrichMemory(db, m));
  const gVis = filterPrivateMemories(gEnriched, false);
  const sVis = filterPrivateMemories(sEnriched, false);
  const allIds = [...gVis, ...sVis].map(m => m.id);
  updateLastUsed(allIds);

  return { globals: gVis, scoped: sVis };
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
  const visibleRows = rows.filter((m) => {
    const tags = tagsByMemory.get(m.id) ?? [];
    return filterPrivateMemories([{ tags }], false).length > 0;
  });

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
  for (const m of visibleRows) {
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
  const tagsByMemory = getTagsBatch(db, memories.map(m => m.id));
  const visible = memories.filter((m) => {
    const tags = tagsByMemory.get(m.id) ?? [];
    return filterPrivateMemories([{ tags }], false).length > 0;
  });
  const visibleIds = new Set(visible.map(m => m.id));
  const relations = db.query<MemoryRelation, []>(`SELECT * FROM memory_relations`).all()
    .filter(r => visibleIds.has(r.source_memory_id) && visibleIds.has(r.target_memory_id));

  writeFileSync(join(DOCS_DIR, "memory-graph.json"), JSON.stringify({
    nodes: visible.map(m => ({
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
