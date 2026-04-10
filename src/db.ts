/**
 * db.ts — Global long-term memory (learned insights, patterns, preferences)
 * Replaces skills/learned/*.md with structured SQLite + FTS5.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { normalizeKey } from "./dedup.js";
import { getDb, DB_PATH } from "./shared-db.js";
import { scrubSecrets } from "./secretsScrubber.js";

export { DB_PATH };
const CLAUDE_DIR  = join(homedir(), ".claude");
const DOCS_DIR    = join(CLAUDE_DIR, "docs");

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
}

export interface LearnInput {
  content: string;
  category: MemoryCategory;
  importance?: number;
  confidence?: number;
  source?: string;
  project_scope?: string;
  tags?: string[];
  relate_to?: Array<{ id: number; relationship_type: RelationshipType }>;
  /** Skip regenerating docs/memory-long-term.md (use during bulk imports) */
  skipExport?: boolean;
}

export interface LearnResult {
  action: "created" | "reinforced";
  id: number;
  confirm_count: number;
}

export interface RecallInput {
  query?: string;
  tags?: string[];
  category?: MemoryCategory;
  project?: string;
  limit?: number;
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
  return { ...mem, tags: getTagsForMemory(db, mem.id), relations: getRelationsForMemory(db, mem.id) };
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
    .filter(mem => mem.importance !== 5 && mem.confirm_count < 5)
    .filter(mem => computeDecayScore(mem) < DEPRECATION_THRESHOLD)
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

  if (existing) {
    db.run(
      `UPDATE memories SET confirm_count=confirm_count+1, last_confirmed_at=datetime('now'),
       confidence=MIN(1.0, confidence+0.05) WHERE id=?`,
      [existing.id]
    );
    if (input.tags) attachTags(db, existing.id, input.tags);
    if (input.relate_to) {
      for (const rel of input.relate_to) {
        relate({ source_id: existing.id, target_id: rel.id, relationship_type: rel.relationship_type });
      }
    }
    if (!skipExport) exportMarkdown();
    const updated = db.query<{ confirm_count: number }, [number]>(
      `SELECT confirm_count FROM memories WHERE id=?`
    ).get(existing.id);
    return { action: "reinforced", id: existing.id, confirm_count: updated?.confirm_count ?? existing.confirm_count + 1 };
  }

  const result = db.run(
    `INSERT INTO memories (content, category, importance, confidence, source, project_scope, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      content,
      input.category,
      input.importance ?? 3,
      input.confidence ?? 1.0,
      input.source ?? null,
      input.project_scope ?? null,
      dedupKey,
    ]
  );

  const newId = Number(result.lastInsertRowid);

  if (input.tags) attachTags(db, newId, input.tags);
  if (input.relate_to) {
    for (const rel of input.relate_to) {
      relate({ source_id: newId, target_id: rel.id, relationship_type: rel.relationship_type });
    }
  }

  if (!skipExport) exportMarkdown();

  // Fire-and-forget: embed + auto-relate — never blocks learn()
  import("./embeddings.js").then(async ({ embedMemory, getSimilarMemories, classifyRelation }) => {
    await embedMemory(db, newId);
    await autoDetectRelations(newId, content, getSimilarMemories, classifyRelation);
  }).catch(err => process.stderr.write(`[learn] Background task failed for memory ${newId}: ${err}\n`));

  return { action: "created", id: newId, confirm_count: 1 };
}

export async function recall(input: RecallInput = {}): Promise<MemoryWithRelations[]> {
  const db = getDb();
  const limit = input.limit ?? 10;

  let ids: Set<number> | null = null;

  if (input.query) {
    // Sanitize for FTS5: quote each token (prevents reserved-word errors) and join with OR
    const ftsQuery = input.query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => `"${t.replace(/"/g, '""')}"`)
      .join(" OR ");
    const ftsResults = db.query<{ rowid: number }, [string]>(
      `SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT 50`
    ).all(ftsQuery);
    ids = new Set(ftsResults.map(r => r.rowid));

    // Semantic fallback: if FTS5 returned fewer results than requested, augment with vector search
    if (ids.size < limit) {
      const { readConfigSync } = await import("./config.js");
      const cfg = readConfigSync();
      const semanticEnabled = cfg.ltm?.semanticFallback !== false; // default true
      if (semanticEnabled) {
        try {
          const { getSimilarMemories } = await import("./embeddings.js");
          const semantic = await getSimilarMemories(input.query, limit * 2, 0.5);
          for (const m of semantic) ids.add(m.id);
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

  conditions.push("status = 'active'");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const rows = db.query<Memory, typeof params>(
    `SELECT * FROM memories ${where} LIMIT ${limit}`
  ).all(...params);

  const sorted = rows
    .map(m => ({ m, score: computeDecayScore(m) }))
    .sort((a, b) => b.score - a.score)
    .map(({ m }) => m);
  updateLastUsed(sorted.map(m => m.id));
  // T11: Update temporal metadata on recall
  if (sorted.length > 0) {
    const placeholders = sorted.map(() => "?").join(",");
    db.run(
      `UPDATE memories SET last_recalled_at = datetime('now'), recall_count = recall_count + 1, first_recalled_at = COALESCE(first_recalled_at, datetime('now')) WHERE id IN (${placeholders})`,
      sorted.map(m => m.id)
    );
  }
  return sorted.map(m => enrichMemory(db, m));
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

export function forget(input: { id: number; reason?: string; skipExport?: boolean }): void {
  const db = getDb();
  if (!db.query<Memory, [number]>(`SELECT * FROM memories WHERE id=?`).get(input.id)) {
    throw new Error(`Memory ${input.id} not found`);
  }
  db.run(`DELETE FROM memories WHERE id=?`, [input.id]);
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

  const globals = sortByDecay(db.query<Memory, []>(
    `SELECT * FROM memories WHERE importance >= 4 AND project_scope IS NULL AND status = 'active'`
  ).all());

  const scoped = sortByDecay(db.query<Memory, [string]>(
    `SELECT * FROM memories WHERE project_scope=? AND importance >= 3 AND status = 'active' LIMIT 15`
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
