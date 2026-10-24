/**
 * collections/tools.ts — the `collection` and `record` tool contract, shared by
 * every host (MCP server, OpenCode, OpenClaw; Pi mirrors the MCP list).
 *
 * Each host passes the model's arguments here and shows the returned object
 * as JSON. Errors come back as { ok: false, error, message, details } so the
 * model can correct itself; nothing here throws for a bad argument.
 */
import { queryRecords, type Filter } from "./query.js";
import { COLLECTION_ACTIONS, COLLECTION_ORIGINS, RECORD_ACTIONS } from "./toolSchema.js";
import {
  CollectionError, archiveRecord, defineCollection, evolveCollection, getRecord,
  listCollections, putRecord, resolveCollection, setCollectionStatus, type Collection,
} from "./store.js";
import { MEMORY_ORIGINS, type MemoryOrigin } from "../origin.js";

export interface CollectionToolArgs {
  action: (typeof COLLECTION_ACTIONS)[number];
  name?: string;
  description?: string;
  fields?: unknown;
  key_field?: string;
  /** define only: "project" scopes the new collection to the current project. Default global. */
  scope?: "global" | "project";
  origin?: (typeof COLLECTION_ORIGINS)[number];
  force?: boolean;
  include_archived?: boolean;
}

export interface RecordToolArgs {
  action: (typeof RECORD_ACTIONS)[number];
  collection?: string;
  data?: Record<string, unknown>;
  merge?: boolean;
  key?: string;
  id?: number;
  where?: Filter[];
  text?: string;
  order_by?: string;
  order?: "asc" | "desc";
  limit?: number;
  include_archived?: boolean;
  origin?: MemoryOrigin;
  memory_id?: number;
}

export interface ToolContext {
  /** The current project, for scoped lookups; null when unknown. */
  project: string | null;
  /** Recorded as created_by (e.g. "mcp", "opencode"). */
  actor: string;
}

export type ToolOutcome = { ok: true; [k: string]: unknown } | { ok: false; error: string; message: string; details?: unknown };

function describeCollection(c: Collection & { record_count?: number }) {
  return {
    name: c.name,
    description: c.description,
    scope: c.project_scope ?? "global",
    key_field: c.key_field,
    version: c.version,
    status: c.status,
    origin: c.origin,
    fields: c.fields,
    ...(c.record_count !== undefined ? { record_count: c.record_count } : {}),
  };
}

function fail(err: unknown): ToolOutcome {
  if (err instanceof CollectionError) return { ok: false, error: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) };
  return { ok: false, error: "internal", message: (err as Error)?.message ?? String(err) };
}

function need<T>(value: T | undefined, what: string, action: string): T {
  if (value === undefined || value === null || value === "") {
    throw new CollectionError("missing_argument", `action=${action} needs ${what}`);
  }
  return value;
}

export function runCollectionTool(args: CollectionToolArgs, ctx: ToolContext): ToolOutcome {
  try {
    switch (args.action) {
      case "list": {
        const list = listCollections({ project: ctx.project, includeArchived: args.include_archived });
        return { ok: true, count: list.length, collections: list.map((c) => ({ ...describeCollection(c), fields: c.fields.map((f) => `${f.name}:${f.type}${f.required ? "!" : ""}`) })) };
      }
      case "describe": {
        const name = need(args.name, "name", "describe");
        const c = listCollections({ project: ctx.project, includeArchived: true }).find((x) => x.id === resolveCollection(name, ctx.project)?.id);
        if (!c) throw new CollectionError("unknown_collection", `no collection "${name}"`);
        return { ok: true, collection: describeCollection(c) };
      }
      case "define": {
        if (args.scope === "project" && !ctx.project) {
          throw new CollectionError("missing_argument", "scope=project needs a current project; pass project");
        }
        const c = defineCollection({
          name: need(args.name, "name", "define"),
          description: need(args.description, "description", "define"),
          fields: need(args.fields, "fields", "define"),
          key_field: args.key_field ?? null,
          project: args.scope === "project" ? ctx.project : null,
          origin: args.origin,
          created_by: ctx.actor,
          force: args.force,
        });
        return { ok: true, created: true, collection: describeCollection(c) };
      }
      case "evolve": {
        const res = evolveCollection({ name: need(args.name, "name", "evolve"), project: ctx.project, fields: args.fields, description: args.description });
        return { ok: true, collection: describeCollection(res.collection), reindexed: res.reindexed };
      }
      case "archive": {
        const c = setCollectionStatus(need(args.name, "name", "archive"), ctx.project, "archived");
        return { ok: true, archived: c.name, note: `The owner can restore it with \`ltm collection restore ${c.name}\`.` };
      }
    }
    throw new CollectionError("invalid_action", `unknown action "${String(args.action)}"`);
  } catch (err) {
    return fail(err);
  }
}

function recordRef(args: RecordToolArgs, action: string): { key?: string; id?: number } {
  if (args.key !== undefined) return { key: String(args.key) };
  if (args.id !== undefined) return { id: args.id };
  throw new CollectionError("missing_argument", `action=${action} needs key (or id)`);
}

export function runRecordTool(args: RecordToolArgs, ctx: ToolContext): ToolOutcome {
  try {
    const collection = need(args.collection, "collection", args.action);
    switch (args.action) {
      case "put": {
        if (args.origin !== undefined && !(MEMORY_ORIGINS as readonly string[]).includes(args.origin)) {
          throw new CollectionError("invalid_origin", `origin must be one of: ${MEMORY_ORIGINS.join(", ")}`);
        }
        const res = putRecord({
          collection, project: ctx.project, data: need(args.data, "data", "put"), merge: args.merge,
          origin: args.origin, created_by: ctx.actor, memory_id: args.memory_id,
        });
        return { ok: true, created: res.created, record: res.record };
      }
      case "get": {
        const rec = getRecord(collection, recordRef(args, "get"), ctx.project);
        if (!rec) throw new CollectionError("not_found", `no record ${args.key ?? args.id} in "${collection}"`);
        return { ok: true, record: rec };
      }
      case "query": {
        const res = queryRecords({
          collection, project: ctx.project, where: args.where, text: args.text, order_by: args.order_by,
          order: args.order, limit: args.limit, include_archived: args.include_archived,
        });
        return { ok: true, ...res };
      }
      case "archive": {
        const rec = archiveRecord(collection, recordRef(args, "archive"), ctx.project);
        return { ok: true, archived: { collection: rec.collection, key: rec.key, id: rec.id } };
      }
    }
    throw new CollectionError("invalid_action", `unknown action "${String(args.action)}"`);
  } catch (err) {
    return fail(err);
  }
}
