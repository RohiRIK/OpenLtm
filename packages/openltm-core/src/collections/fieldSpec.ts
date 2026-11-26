/**
 * collections/fieldSpec.ts — field definitions for agent-defined collections.
 *
 * A collection is a structured type the agent defines (servers, releases,
 * endpoints…). Its definition is data: a closed set of field types, validated
 * here and stored as JSON in `collections.fields`. Records are validated
 * against a zod schema built from that definition. Nothing here produces SQL.
 */
import { z } from "zod";
import { FIELD_TYPES, MAX_QUERY_LIMIT, type FieldType } from "./toolSchema.js";

export { FIELD_TYPES, type FieldType };

/** Collection and field names: lowercase snake_case, 2–40 chars. */
export const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Names that would read as record metadata in tool output. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "id", "collection", "key", "record_key", "origin", "status", "schema_version",
  "created_at", "updated_at", "created_by", "memory_id", "data",
]);

/** Field types a key field may use (its value becomes records.record_key). */
export const KEY_FIELD_TYPES: ReadonlySet<FieldType> = new Set(["string", "integer", "date", "enum", "url"]);

/** Types whose values feed search_text by default. */
const TEXT_LIKE: ReadonlySet<FieldType> = new Set(["string", "text", "enum", "string[]", "url"]);

export const LIMITS = {
  maxCollections: 50,
  maxFields: 30,
  maxRecordBytes: 16_384,
  maxRecordsPerCollection: 10_000,
  maxQueryLimit: MAX_QUERY_LIMIT,
  maxDescription: 500,
  maxString: 500,
  maxText: 16_000,
  maxUrl: 2_000,
  maxListItems: 50,
  maxEnumValues: 50,
  maxEnumValueLength: 64,
} as const;

export interface FieldSpec {
  name: string;
  type: FieldType;
  required?: boolean;
  /** Feed this field into full-text search. Default: true for text-like types. */
  searchable?: boolean;
  description?: string;
  /** enum only: the allowed values. */
  values?: string[];
}

export const fieldSpecSchema = z.object({
  name: z.string().regex(NAME_RE, "field names are lowercase snake_case, 2-40 chars, starting with a letter")
    .refine((n) => !RESERVED_FIELD_NAMES.has(n), { message: "reserved field name" }),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  description: z.string().max(LIMITS.maxDescription).optional(),
  values: z.array(z.string().min(1).max(LIMITS.maxEnumValueLength)).min(1).max(LIMITS.maxEnumValues).optional(),
}).strict().superRefine((f, ctx) => {
  if (f.type === "enum" && !f.values) ctx.addIssue({ code: "custom", message: `enum field "${f.name}" needs values` });
  if (f.type !== "enum" && f.values) ctx.addIssue({ code: "custom", message: `only enum fields take values ("${f.name}" is ${f.type})` });
  if (f.values && new Set(f.values).size !== f.values.length) ctx.addIssue({ code: "custom", message: `enum field "${f.name}" has duplicate values` });
});

export const fieldListSchema = z.array(fieldSpecSchema).min(1).max(LIMITS.maxFields).superRefine((fields, ctx) => {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) ctx.addIssue({ code: "custom", message: `duplicate field "${f.name}"` });
    seen.add(f.name);
  }
});

/** Human-readable zod issues, one line each, with the path that failed. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/** Validate a key field choice against the field list; returns an error or null. */
export function checkKeyField(fields: FieldSpec[], keyField: string | null | undefined): string | null {
  if (!keyField) return null;
  const f = fields.find((x) => x.name === keyField);
  if (!f) return `key_field "${keyField}" is not one of the fields`;
  if (!KEY_FIELD_TYPES.has(f.type)) return `key_field "${keyField}" must be string, integer, date, enum or url (is ${f.type})`;
  if (!f.required) return `key_field "${keyField}" must be required`;
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A calendar date that exists (no 2026-02-30) and, with a time, one Date can parse. */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return false;
  if (value.length === 10) return true;
  const [hh, mm, ss] = value.slice(11, 19).split(":").map(Number);
  if (hh! > 23 || mm! > 59 || (ss !== undefined && ss > 59)) return false;
  return !Number.isNaN(Date.parse(value.replace(" ", "T")));
}

function isHttpUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function valueSchema(f: FieldSpec): z.ZodType {
  switch (f.type) {
    case "string": return z.string().max(LIMITS.maxString);
    case "text": return z.string().max(LIMITS.maxText);
    case "integer": return z.number().int();
    case "number": return z.number().finite();
    case "boolean": return z.boolean();
    case "date": return z.string().regex(ISO_DATE_RE, "expected an ISO date (YYYY-MM-DD or ISO 8601 datetime)")
      .refine(isRealDate, { message: "not a real date" });
    case "enum": return z.enum(f.values as [string, ...string[]]);
    case "string[]": return z.array(z.string().max(LIMITS.maxString)).max(LIMITS.maxListItems);
    case "url": return z.string().max(LIMITS.maxUrl).refine(isHttpUrl, { message: "expected an http(s) URL" });
  }
}

/** The zod schema a record's data must satisfy. Unknown keys are rejected. */
export function buildRecordSchema(fields: FieldSpec[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.name] = f.required ? valueSchema(f) : valueSchema(f).optional();
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

export function isSearchable(f: FieldSpec): boolean {
  return f.searchable ?? TEXT_LIKE.has(f.type);
}

/** The text FTS indexes for a record: collection name, key, then searchable values. */
export function buildSearchText(collection: string, fields: FieldSpec[], data: Record<string, unknown>, key: string | null): string {
  const parts: string[] = [collection.replace(/_/g, " ")];
  if (key) parts.push(key);
  for (const f of fields) {
    if (!isSearchable(f)) continue;
    const v = data[f.name];
    if (v === undefined || v === null) continue;
    parts.push(Array.isArray(v) ? v.join(" ") : String(v));
  }
  return parts.join("\n");
}

/** records.record_key for a validated record, or null when the collection has no key. */
export function recordKeyOf(keyField: string | null, data: Record<string, unknown>): string | null {
  if (!keyField) return null;
  const v = data[keyField];
  return v === undefined || v === null ? null : String(v);
}

/**
 * Compare an existing field list with a proposed one. Additive changes keep
 * every stored record valid: a new optional field, a new enum value, a field
 * becoming optional, a changed description or searchable flag. Anything else
 * (a removed field, a type change, a dropped enum value, a new required field,
 * an optional field becoming required) is breaking.
 */
export function diffFields(oldFields: FieldSpec[], newFields: FieldSpec[]): { breaking: string[]; searchChanged: boolean } {
  const breaking: string[] = [];
  let searchChanged = false;
  const byName = new Map(newFields.map((f) => [f.name, f]));
  for (const o of oldFields) {
    const n = byName.get(o.name);
    if (!n) { breaking.push(`field "${o.name}" removed`); continue; }
    if (n.type !== o.type) breaking.push(`field "${o.name}" changes type ${o.type} -> ${n.type}`);
    if (n.required && !o.required) breaking.push(`field "${o.name}" becomes required`);
    if (o.type === "enum" && n.type === "enum") {
      const dropped = (o.values ?? []).filter((v) => !(n.values ?? []).includes(v));
      if (dropped.length) breaking.push(`field "${o.name}" drops enum values ${dropped.join(", ")}`);
    }
    if (isSearchable(o) !== isSearchable(n)) searchChanged = true;
  }
  const oldNames = new Set(oldFields.map((f) => f.name));
  for (const n of newFields) {
    if (oldNames.has(n.name)) continue;
    if (n.required) breaking.push(`new field "${n.name}" is required`);
    if (isSearchable(n)) searchChanged = true;
  }
  return { breaking, searchChanged };
}

/** Levenshtein distance, capped: returns cap+1 once the distance exceeds cap. */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

function normalizeName(name: string): string {
  const n = name.replace(/_/g, "");
  if (n.endsWith("ies")) return n.slice(0, -3) + "y";
  if (n.endsWith("s") && !n.endsWith("ss")) return n.slice(0, -1);
  return n;
}

/**
 * True when two collections look like the same type: names equal once
 * pluralisation and underscores are folded, names within edit distance 2,
 * or field names that mostly overlap (Jaccard ≥ 0.6 over ≥ 2 fields).
 */
export function looksSimilar(aName: string, aFields: FieldSpec[], bName: string, bFields: FieldSpec[]): boolean {
  const na = normalizeName(aName);
  const nb = normalizeName(bName);
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 5 && editDistance(na, nb, 2) <= 2) return true;
  const fa = new Set(aFields.map((f) => f.name));
  const fb = new Set(bFields.map((f) => f.name));
  if (fa.size < 2 || fb.size < 2) return false;
  let shared = 0;
  for (const n of fa) if (fb.has(n)) shared++;
  return shared / (fa.size + fb.size - shared) >= 0.6;
}

/** Names that make a record look like a grant of permission (flagged on output). */
const AUTHORITY_WORDS = /(^|_)(approv\w*|authori[sz]\w*|allow\w*|permission\w*|permit\w*|consent\w*|grant\w*)(_|$)/;

export function isAuthorityLike(name: string): boolean {
  return AUTHORITY_WORDS.test(name);
}
