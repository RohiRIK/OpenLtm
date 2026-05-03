/**
 * dao/types.ts — Shared row types for the DAO layer.
 * MemorySlim omits the embedding blob — use this for all recall paths.
 * MemoryFull includes embedding — only for embeddings.ts internals.
 */

export type MemoryCategory = "preference" | "architecture" | "gotcha" | "pattern" | "workflow" | "constraint";
export type RelationshipType = "supports" | "contradicts" | "refines" | "depends_on" | "related_to" | "supersedes";
export type MemoryStatus = "active" | "pending" | "deprecated" | "superseded";
export type ContextItemType = "goal" | "decision" | "progress" | "gotcha";
export type ContextItemStatus = "active" | "pending_promotion" | "promoted";

/** Slim memory row — no embedding blob. Used by recall(), getContextMerge(), and all MCP responses. */
export interface MemorySlim {
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
  status: MemoryStatus;
  first_recalled_at?: string | null;
  last_recalled_at?: string | null;
  recall_count?: number;
  superseded_by?: number | null;
  superseded_at?: string | null;
  workspace_id?: string | null;
  agent_id?: string | null;
}

/** Full memory row — includes embedding blob. Internal use only (embeddings.ts). */
export interface MemoryFull extends MemorySlim {
  embedding: Buffer | null;
}

export interface ContextItemRow {
  id: number;
  project_name: string;
  type: ContextItemType;
  content: string;
  session_id: string | null;
  permanent: number;
  memory_id: number | null;
  status: ContextItemStatus;
  created_at: string;
}

export interface MemoryRelationRow {
  id: number;
  source_memory_id: number;
  target_memory_id: number;
  relationship_type: RelationshipType;
  created_at: string;
}

// --- Phase 2: Provenance + Audit ---

export type ProvenanceSourceType =
  | "learn" | "git-backfill" | "evaluate-session" | "import-bundle"
  | "user-promotion" | "janitor-rollup" | "legacy";

export type AuditOp =
  | "insert" | "update" | "forget" | "deprecate" | "supersede" | "redact" | "restore";

export interface ProvenanceRow {
  id: number;
  memory_id: number;
  source_type: ProvenanceSourceType;
  source_ref: string | null;
  actor: string | null;
  created_at: string;
  metadata: string | null;
}

export interface ProvenanceInput {
  memory_id: number;
  source_type: ProvenanceSourceType;
  source_ref?: string | null;
  actor?: string | null;
  metadata?: string | null;
}

export interface AuditRow {
  id: number;
  memory_id: number;
  op: AuditOp;
  actor: string;
  session_id: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface AuditInput {
  memory_id: number;
  op: AuditOp;
  actor: string;
  session_id?: string | null;
  before_json?: string | null;
  after_json?: string | null;
}

/**
 * JSON-safe memory snapshot — excludes embedding blob. Used for audit before/after captures.
 * Same shape as MemorySlim but with category/status widened to string (SQLite returns raw strings).
 */
export type MemorySnapshot = Omit<MemorySlim, "category" | "status"> & {
  category: string;
  status: string;
};
