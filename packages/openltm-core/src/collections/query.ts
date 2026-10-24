/**
 * collections/query.ts — structured record queries, compiled to parameterised SQL.
 *
 * The agent never sends SQL. A filter names a field the collection defines,
 * an operator from a closed set and a value; field paths reach SQL only as
 * bound parameters (`json_extract(data, ?)`), so no agent text is ever
 * interpolated into a statement.
 */
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { getDb } from "../shared-db.js";
import { buildFtsQuery } from "../db.js";
import { LIMITS, type FieldSpec } from "./fieldSpec.js";
import { CollectionError, collectionsById, resolveCollection, _toRecordView, type Collection, type RecordRow, type RecordView } from "./store.js";
import { FILTER_OPS, type FilterOp } from "./toolSchema.js";
import { ensureIndexes, indexedExpr } from "./indexes.js";

export { FILTER_OPS, type FilterOp };

/** Columns a filter or sort may use besides the collection's own fields. */
const META_COLUMNS: Record<string, string> = {
  created_at: "r.created_at",
  updated_at: "r.updated_at",
  origin: "r.origin",
  key: "r.record_key",
};

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const filterSchema = z.object({
  field: z.string().min(1).max(40),
  op: z.enum(FILTER_OPS),
  value: z.union([scalar, z.array(scalar).max(LIMITS.maxListItems)]).optional(),
}).strict();

export type Filter = z.infer<typeof filterSchema>;

export interface QueryRecordsInput {
  collection: string;
  project?: string | null;
  where?: Filter[];
  /** Full-text search inside this collection's searchable fields. */
  text?: string;
  order_by?: string;
  order?: "asc" | "desc";
  limit?: number;
  include_archived?: boolean;
}

export interface QueryRecordsResult {
  collection: string;
  count: number;
  records: RecordView[];
}

const SQL_OPS: Record<Exclude<FilterOp, "in" | "contains" | "exists">, string> = {
  eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=",
};

/** Bind a JSON value the way json_extract returns it (booleans as 0/1). */
function bindValue(v: string | number | boolean): string | number {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

function checkValueType(f: FieldSpec | undefined, op: FilterOp, v: unknown): void {
  if (!f || v === undefined) return;
  const values = Array.isArray(v) ? v : [v];
  const want = f.type === "integer" || f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string";
  for (const x of values) {
    if (typeof x !== want) {
      throw new CollectionError("invalid_query", `field "${f.name}" is ${f.type}; ${op} needs a ${want} value`);
    }
  }
}

/**
 * Compile one filter to a SQL fragment + params. A field with a managed index
 * uses the index's literal expression (built from the validated field name,
 * never from filter text) so SQLite can use it; other paths are bound.
 */
function compileFilter(c: Collection, filter: Filter, indexed: Set<string>): { sql: string; params: (string | number)[] } {
  const field = c.fields.find((f) => f.name === filter.field);
  const meta = META_COLUMNS[filter.field];
  if (!field && !meta) {
    throw new CollectionError("invalid_query",
      `"${filter.field}" is not a field of "${c.name}" (fields: ${c.fields.map((f) => f.name).join(", ")}; also created_at, updated_at, origin, key)`);
  }
  const path = `$.${filter.field}`;
  const literal = !meta && field && indexed.has(field.name);
  const expr = meta ?? (literal ? indexedExpr(field.name, "r") : "json_extract(r.data, ?)");
  const exprParams: (string | number)[] = meta || literal ? [] : [path];
  const { op, value } = filter;

  if (op === "exists") {
    if (meta) return { sql: `${meta} IS NOT NULL`, params: [] };
    return { sql: "json_type(r.data, ?) IS NOT NULL", params: [path] };
  }
  if (value === undefined) throw new CollectionError("invalid_query", `${op} on "${filter.field}" needs a value`);
  checkValueType(field, op, value);

  if (op === "in") {
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0) throw new CollectionError("invalid_query", `in on "${filter.field}" needs at least one value`);
    if (field?.type === "string[]") {
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(r.data, ?) j WHERE j.value IN (${list.map(() => "?").join(",")}))`,
        params: [path, ...list.map(bindValue)],
      };
    }
    return { sql: `${expr} IN (${list.map(() => "?").join(",")})`, params: [...exprParams, ...list.map(bindValue)] };
  }
  if (Array.isArray(value)) throw new CollectionError("invalid_query", `${op} on "${filter.field}" takes one value, not a list`);

  if (op === "contains") {
    if (field?.type === "string[]") {
      return { sql: "EXISTS (SELECT 1 FROM json_each(r.data, ?) j WHERE j.value = ?)", params: [path, bindValue(value)] };
    }
    return { sql: `instr(lower(${expr}), lower(?)) > 0`, params: [...exprParams, String(value)] };
  }
  if (field?.type === "string[]") {
    throw new CollectionError("invalid_query", `field "${filter.field}" is a list; use contains or in`);
  }
  return { sql: `${expr} ${SQL_OPS[op]} ?`, params: [...exprParams, bindValue(value)] };
}

export function queryRecords(input: QueryRecordsInput, db: Database = getDb()): QueryRecordsResult {
  const c = resolveCollection(input.collection, input.project, db);
  if (!c) throw new CollectionError("unknown_collection", `no collection "${input.collection}". collection(action="list") shows the existing ones.`);
  if (c.status !== "active" && !input.include_archived) {
    throw new CollectionError("archived", `collection "${c.name}" is archived`);
  }
  const filters: Filter[] = (input.where ?? []).map((raw) => {
    const parsed = filterSchema.safeParse(raw);
    if (!parsed.success) throw new CollectionError("invalid_query", `invalid filter: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return parsed.data;
  });
  const indexed = ensureIndexes(db, c, [...filters.map((f) => f.field), ...(input.order_by ? [input.order_by] : [])]);
  // A literal collection id lets SQLite match the managed indexes' WHERE clause (c.id is our own integer).
  const where: string[] = indexed.size > 0 ? [`r.collection_id = ${Math.trunc(c.id)}`] : ["r.collection_id = ?"];
  const params: (string | number)[] = indexed.size > 0 ? [] : [c.id];
  if (!input.include_archived) where.push("r.status = 'active'");
  for (const filter of filters) {
    const f = compileFilter(c, filter, indexed);
    where.push(f.sql);
    params.push(...f.params);
  }
  let from = "records r";
  let orderSql = "r.updated_at DESC, r.id DESC";
  if (input.text) {
    const match = buildFtsQuery(input.text);
    if (!match) return { collection: c.name, count: 0, records: [] };
    from = "records_fts JOIN records r ON r.id = records_fts.rowid";
    where.push("records_fts MATCH ?");
    params.push(match);
    orderSql = "bm25(records_fts), r.id DESC";
  }
  if (input.order_by) {
    const field = c.fields.find((f) => f.name === input.order_by);
    const meta = META_COLUMNS[input.order_by];
    if (!field && !meta) throw new CollectionError("invalid_query", `cannot order by "${input.order_by}": not a field of "${c.name}"`);
    const dir = input.order === "asc" ? "ASC" : "DESC";
    // The path is a bound parameter here too; it is pushed after the WHERE params.
    const literal = !meta && indexed.has(input.order_by);
    orderSql = meta ? `${meta} ${dir}, r.id ${dir}`
      : literal ? `${indexedExpr(input.order_by, "r")} ${dir}, r.id ${dir}`
      : `json_extract(r.data, ?) ${dir}, r.id ${dir}`;
    if (!meta && !literal) params.push(`$.${input.order_by}`);
  }
  const max = LIMITS.maxQueryLimit;
  const lim = Math.min(Math.max(1, Math.floor(input.limit ?? 20)), max);
  params.push(lim);
  const rows = db.query<RecordRow, (string | number)[]>(
    `SELECT r.* FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${orderSql} LIMIT ?`,
  ).all(...params);
  return { collection: c.name, count: rows.length, records: rows.map((r) => _toRecordView(c, r)) };
}

/** A record hit for recall: the record plus its FTS rank. */
export interface RecordHit extends RecordView {
  rank: number;
}

/**
 * Full-text search across every active collection visible from `project`
 * (its own and global ones). Used by recall to surface records next to memories.
 */
export function searchRecords(query: string, opts: { project?: string | null; limit?: number } = {}, db: Database = getDb()): RecordHit[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const lim = Math.min(Math.max(1, opts.limit ?? 3), LIMITS.maxQueryLimit);
  let rows: (RecordRow & { rank: number })[];
  try {
    rows = db.query<RecordRow & { rank: number }, [string, string, number]>(
      `SELECT r.*, bm25(records_fts) AS rank
         FROM records_fts
         JOIN records r ON r.id = records_fts.rowid
         JOIN collections c ON c.id = r.collection_id
        WHERE records_fts MATCH ?
          AND r.status = 'active' AND c.status = 'active'
          AND (c.project_scope IS NULL OR c.project_scope = ?)
        ORDER BY rank
        LIMIT ?`,
    ).all(match, opts.project ?? "", lim);
  } catch {
    return []; // no collections table yet (pre-031 DB) or a bad MATCH: records are optional in recall
  }
  const byId = collectionsById(db);
  return rows.flatMap((r) => {
    const c = byId.get(r.collection_id);
    return c ? [{ ..._toRecordView(c, r), rank: r.rank }] : [];
  });
}
