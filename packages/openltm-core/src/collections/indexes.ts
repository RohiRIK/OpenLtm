/**
 * collections/indexes.ts — managed field indexes.
 *
 * Records are JSON, so a filter is `json_extract(data, '$.field')`. Below a
 * few thousand rows a scan is fine; past `index_min_records` active records
 * the server indexes a field the first time a query filters or sorts on it:
 * a partial expression index scoped to that one collection, at most
 * MAX_INDEXES per collection. The agent never asks for one and never sends
 * DDL. The DDL is built from a collection id (an integer from our own row)
 * and a field name that passed NAME_RE when the collection was defined;
 * both are re-checked here before they reach SQL.
 */
import type { Database } from "bun:sqlite";
import { NAME_RE, type FieldSpec } from "./fieldSpec.js";
import { limit, type Collection } from "./store.js";

export const MAX_INDEXES = 3;
export const INDEX_MIN_RECORDS = 2_000;

/** Field types a managed index can serve (lists use json_each, text uses FTS). */
const INDEXABLE: ReadonlySet<FieldSpec["type"]> = new Set(["string", "integer", "number", "boolean", "date", "enum", "url"]);

function safeParts(collectionId: number, field: string): { id: number; field: string } {
  if (!Number.isSafeInteger(collectionId) || collectionId <= 0 || !NAME_RE.test(field)) {
    throw new Error(`refusing index DDL for collection ${collectionId} field ${JSON.stringify(field)}`);
  }
  return { id: collectionId, field };
}

export function indexName(collectionId: number, field: string): string {
  const p = safeParts(collectionId, field);
  return `idx_rec_${p.id}_${p.field}`;
}

/**
 * The SQL expression a managed index covers. Queries on an indexed field must
 * use exactly this text (and a literal collection id) for SQLite to pick the index.
 */
export function indexedExpr(field: string, alias?: string): string {
  if (!NAME_RE.test(field)) throw new Error(`invalid field name ${JSON.stringify(field)}`);
  return `json_extract(${alias ? `${alias}.` : ""}data, '$.${field}')`;
}

/** Fields of `collectionId` that have a managed index. */
export function managedIndexes(db: Database, collectionId: number): string[] {
  const prefix = `idx_rec_${Math.trunc(collectionId)}_`;
  // A one-off statement, finalized at once: a cached open read on sqlite_master
  // would leave the schema locked for the CREATE/DROP INDEX that follows.
  const stmt = db.prepare<{ name: string }, [string]>(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='records' AND substr(name, 1, length(?1)) = ?1",
  );
  try {
    return stmt.all(prefix).map((r) => r.name.slice(prefix.length));
  } finally {
    stmt.finalize();
  }
}

/**
 * Index the fields a query is about to filter or sort on, when the collection
 * is large enough and has room. Returns the fields indexed afterwards.
 * Never throws: an index is an optimisation, the query runs either way.
 */
export function ensureIndexes(db: Database, c: Collection, wanted: string[]): Set<string> {
  let have: string[];
  try {
    have = managedIndexes(db, c.id);
  } catch {
    return new Set();
  }
  const candidates = [...new Set(wanted)].filter((name) =>
    !have.includes(name) && c.fields.some((f) => f.name === name && INDEXABLE.has(f.type)));
  if (candidates.length === 0 || have.length >= MAX_INDEXES) return new Set(have);
  try {
    const n = db.query<{ n: number }, [number]>("SELECT count(*) AS n FROM records WHERE collection_id=? AND status='active'").get(c.id)!.n;
    if (n < limit(db, "index_min_records", INDEX_MIN_RECORDS)) return new Set(have);
    for (const field of candidates.slice(0, MAX_INDEXES - have.length)) {
      const { id } = safeParts(c.id, field);
      db.run(`CREATE INDEX IF NOT EXISTS ${indexName(id, field)} ON records(${indexedExpr(field)}) WHERE collection_id = ${id}`);
      // Statistics, so the planner prefers it over idx_records_key's collection_id prefix.
      db.run(`ANALYZE ${indexName(id, field)}`);
      have.push(field);
    }
  } catch (err) {
    process.stderr.write(`[collections] managed index on "${c.name}" failed: ${err}\n`);
  }
  return new Set(have);
}

/** Drop the managed indexes of `fields` (removed or retyped by a breaking evolve). */
export function dropIndexes(db: Database, collectionId: number, fields: string[]): void {
  const have = new Set(managedIndexes(db, collectionId));
  for (const field of fields) if (have.has(field)) db.run(`DROP INDEX IF EXISTS ${indexName(collectionId, field)}`);
}
