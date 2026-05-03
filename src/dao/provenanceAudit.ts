/**
 * dao/provenanceAudit.ts — DAO for memory_provenance and memory_audit tables.
 * All writes to memories go through here for uniform audit coverage.
 *
 * Note: memory_audit.memory_id is intentionally NOT a FK — audit rows survive
 * memory deletion. Do not add a FK constraint.
 */
import type { Database } from "bun:sqlite";
import type {
  ProvenanceRow, ProvenanceInput,
  AuditRow, AuditInput,
  MemorySnapshot,
} from "./types.js";

/** Capture a slim memory snapshot (no embedding blob) for audit before/after JSON. */
export function snapshotMemory(db: Database, memoryId: number): MemorySnapshot | null {
  return db.query<MemorySnapshot, [number]>(
    `SELECT id, content, category, importance, confidence, source, project_scope, dedup_key,
            created_at, last_confirmed_at, last_used_at, confirm_count, status,
            first_recalled_at, last_recalled_at, recall_count, superseded_by, superseded_at,
            workspace_id, agent_id
     FROM memories WHERE id=?`
  ).get(memoryId) ?? null;
}

/** Insert a provenance row. Returns the new row id. */
export function insertProvenance(db: Database, input: ProvenanceInput): number {
  const result = db.run(
    `INSERT INTO memory_provenance (memory_id, source_type, source_ref, actor, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [input.memory_id, input.source_type, input.source_ref ?? null, input.actor ?? null, input.metadata ?? null]
  );
  return Number(result.lastInsertRowid);
}

/** Insert an audit row. Returns the new row id. */
export function insertAudit(db: Database, input: AuditInput): number {
  const result = db.run(
    `INSERT INTO memory_audit (memory_id, op, actor, session_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.memory_id,
      input.op,
      input.actor,
      input.session_id ?? null,
      input.before_json ?? null,
      input.after_json ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
}

/** List all provenance rows for a memory, newest first. */
export function listProvenance(db: Database, memoryId: number): ProvenanceRow[] {
  return db.query<ProvenanceRow, [number]>(
    `SELECT id, memory_id, source_type, source_ref, actor, created_at, metadata
     FROM memory_provenance WHERE memory_id=? ORDER BY created_at DESC, id DESC`
  ).all(memoryId);
}

export interface QueryAuditOpts {
  memoryId?: number;
  op?: string;
  sessionId?: string;
  since?: string;
  limit?: number;
}

/** Query audit rows with optional filters. Results are ordered newest first. */
export function queryAudit(db: Database, opts: QueryAuditOpts = {}): AuditRow[] {
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (opts.memoryId !== undefined) { conditions.push("memory_id=?"); params.push(opts.memoryId); }
  if (opts.op)        { conditions.push("op=?");         params.push(opts.op); }
  if (opts.sessionId) { conditions.push("session_id=?"); params.push(opts.sessionId); }
  if (opts.since)     { conditions.push("created_at>=?");params.push(opts.since); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;

  return db.query<AuditRow, typeof params>(
    `SELECT id, memory_id, op, actor, session_id, before_json, after_json, created_at
     FROM memory_audit ${where} ORDER BY created_at DESC LIMIT ${limit}`
  ).all(...params);
}
