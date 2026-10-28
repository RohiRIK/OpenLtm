/**
 * capsule.ts — One portable file holding a project's memory (`ltm export` / `ltm import`).
 *
 * A capsule carries a project's active memories (with tags, file anchors,
 * origin and event time), the relations among them, its goal, decisions and
 * gotchas, and the collections and records scoped to it. It is JSON with a
 * SHA-256 over the payload, so a damaged or edited file is refused. With a
 * passphrase the payload is encrypted (AES-256-GCM, key from scrypt).
 *
 * Import goes through learn(), so secrets are scrubbed and duplicates
 * reinforce instead of piling up. A claim from someone else's store is not
 * this owner's statement: imported memories and records are marked
 * external-source unless keepOrigin is set. Private memories are left out of
 * an export unless asked for.
 *
 * Inspired by memvid's single-file .mv2 / encrypted .mv2e capsules.
 */
import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { getDb } from "./shared-db.js";
import { learn, relate, type MemoryCategory, type RelationshipType } from "./db.js";
import { notPrivateSql } from "./privacy.js";
import { maskPii } from "./pii.js";
import type { MemoryOrigin } from "./origin.js";

export const CAPSULE_FORMAT = "openltm-capsule";
export const CAPSULE_VERSION = 1;

export interface CapsuleMemory {
  ref: number;
  content: string;
  title: string | null;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  origin: MemoryOrigin | null;
  occurred_at: string | null;
  created_at: string;
  tags: string[];
  files: string[];
}

export interface CapsulePayload {
  project: string;
  exported_at: string;
  memories: CapsuleMemory[];
  relations: Array<{ source_ref: number; target_ref: number; type: RelationshipType }>;
  context: Array<{ type: "goal" | "decision" | "gotcha"; content: string }>;
  collections: Array<{ name: string; description: string; fields: unknown; key_field: string | null }>;
  records: Array<{ collection: string; data: unknown; origin: MemoryOrigin | null; memory_ref: number | null }>;
}

interface PlainEnvelope { format: typeof CAPSULE_FORMAT; version: number; sha256: string; payload: CapsulePayload }
interface EncryptedEnvelope {
  format: typeof CAPSULE_FORMAT;
  version: number;
  sha256: string;
  encryption: { alg: "aes-256-gcm"; kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; tag: string };
  ciphertext: string;
}
export type CapsuleEnvelope = PlainEnvelope | EncryptedEnvelope;

export interface ExportOptions {
  project: string;
  /** Also export global (unscoped) memories. Default false. */
  includeGlobal?: boolean;
  /** Include memories tagged private. Default false. */
  includePrivate?: boolean;
  /** Replace personal data with placeholders before writing (pii.ts). */
  maskPii?: boolean;
  /** Encrypt the payload with this passphrase. */
  passphrase?: string;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function deriveKey(passphrase: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(passphrase, salt, 32, { N: n, r, p, maxmem: 128 * n * r * 2 });
}

/** Build the capsule for one project. Reads only. */
export function buildCapsule(opts: ExportOptions, db: Database = getDb()): CapsuleEnvelope {
  const scope = opts.includeGlobal ? "(project_scope = ? OR project_scope IS NULL)" : "project_scope = ?";
  const privacy = opts.includePrivate ? "" : ` AND ${notPrivateSql("id")}`;
  const mask = (s: string) => (opts.maskPii ? maskPii(s).masked : s);
  const rows = db.query<{
    id: number; content: string; title: string | null; category: MemoryCategory; importance: number; confidence: number;
    origin: MemoryOrigin | null; occurred_at: string | null; created_at: string;
  }, [string]>(
    `SELECT id, content, title, category, importance, confidence, origin, occurred_at, created_at
       FROM memories WHERE status = 'active' AND ${scope}${privacy} ORDER BY id`,
  ).all(opts.project);

  const refOf = new Map<number, number>();
  const memories: CapsuleMemory[] = rows.map((r, i) => {
    refOf.set(r.id, i + 1);
    const tags = db.query<{ name: string }, [number]>(
      "SELECT t.name FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name",
    ).all(r.id).map((t) => t.name);
    const files = tableHas(db, "memory_files")
      ? db.query<{ path: string }, [number]>("SELECT path FROM memory_files WHERE memory_id = ? ORDER BY path").all(r.id).map((f) => f.path)
      : [];
    return {
      ref: i + 1, content: mask(r.content), title: r.title ? mask(r.title) : null, category: r.category,
      importance: r.importance, confidence: r.confidence, origin: r.origin, occurred_at: r.occurred_at,
      created_at: r.created_at, tags, files,
    };
  });

  const relations: CapsulePayload["relations"] = [];
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    for (const rel of db.query<{ s: number; t: number; type: RelationshipType }, number[]>(
      `SELECT source_memory_id s, target_memory_id t, relationship_type type FROM memory_relations
        WHERE source_memory_id IN (${ph}) AND target_memory_id IN (${ph}) ORDER BY id`,
    ).all(...ids, ...ids)) {
      relations.push({ source_ref: refOf.get(rel.s)!, target_ref: refOf.get(rel.t)!, type: rel.type });
    }
  }

  const context = db.query<{ type: "goal" | "decision" | "gotcha"; content: string }, [string]>(
    `SELECT type, content FROM context_items WHERE project_name = ? AND type IN ('goal','decision','gotcha') AND status = 'active' ORDER BY id`,
  ).all(opts.project).map((c) => ({ type: c.type, content: mask(c.content) }));

  const collections: CapsulePayload["collections"] = [];
  const records: CapsulePayload["records"] = [];
  if (tableHas(db, "collections")) {
    for (const c of db.query<{ id: number; name: string; description: string; fields: string; key_field: string | null }, [string]>(
      "SELECT id, name, description, fields, key_field FROM collections WHERE project_scope = ? AND status = 'active' ORDER BY id",
    ).all(opts.project)) {
      collections.push({ name: c.name, description: c.description, fields: JSON.parse(c.fields), key_field: c.key_field });
      for (const r of db.query<{ data: string; origin: MemoryOrigin | null; memory_id: number | null }, [number]>(
        "SELECT data, origin, memory_id FROM records WHERE collection_id = ? AND status = 'active' ORDER BY id",
      ).all(c.id)) {
        const data = opts.maskPii ? JSON.parse(mask(r.data)) : JSON.parse(r.data);
        records.push({ collection: c.name, data, origin: r.origin, memory_ref: r.memory_id ? refOf.get(r.memory_id) ?? null : null });
      }
    }
  }

  const payload: CapsulePayload = { project: opts.project, exported_at: new Date().toISOString(), memories, relations, context, collections, records };
  const json = JSON.stringify(payload);
  const digest = sha256(json);
  if (!opts.passphrase) return { format: CAPSULE_FORMAT, version: CAPSULE_VERSION, sha256: digest, payload };

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(opts.passphrase, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(json, "utf-8"), cipher.final()]);
  return {
    format: CAPSULE_FORMAT, version: CAPSULE_VERSION, sha256: digest,
    encryption: { alg: "aes-256-gcm", kdf: "scrypt", ...SCRYPT, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
    ciphertext: ciphertext.toString("base64"),
  };
}

function tableHas(db: Database, name: string): boolean {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name)!.n > 0;
}

/** Parse and verify a capsule file's text. Throws with a plain reason on any problem. */
export function openCapsule(text: string, passphrase?: string): CapsulePayload {
  let env: CapsuleEnvelope;
  try {
    env = JSON.parse(text) as CapsuleEnvelope;
  } catch {
    throw new Error("not a capsule: the file is not JSON");
  }
  if (env?.format !== CAPSULE_FORMAT) throw new Error("not an OpenLTM capsule");
  if (env.version > CAPSULE_VERSION) throw new Error(`capsule version ${env.version} is newer than this OpenLTM understands (${CAPSULE_VERSION}); upgrade first`);
  let json: string;
  if ("encryption" in env) {
    if (!passphrase) throw new Error("this capsule is encrypted: pass the passphrase");
    const e = env.encryption;
    try {
      const key = deriveKey(passphrase, Buffer.from(e.salt, "base64"), e.N, e.r, e.p);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
      decipher.setAuthTag(Buffer.from(e.tag, "base64"));
      json = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]).toString("utf-8");
    } catch {
      throw new Error("could not decrypt: wrong passphrase or damaged file");
    }
  } else {
    json = JSON.stringify(env.payload);
  }
  if (sha256(json) !== env.sha256) throw new Error("checksum mismatch: the capsule was changed or damaged");
  return JSON.parse(json) as CapsulePayload;
}

export interface ImportOptions {
  /** Store into this project instead of the one the capsule names. */
  project?: string;
  /** Keep each memory's recorded origin. Default false: everything becomes external-source. */
  keepOrigin?: boolean;
  /** Report what would happen, write nothing. */
  dryRun?: boolean;
}

export interface ImportResult {
  project: string;
  memories: { created: number; reinforced: number };
  relations: number;
  context: number;
  collections: { created: number; existing: number };
  records: number;
  errors: string[];
  dryRun: boolean;
}

/** Load a verified payload into the store. Idempotent: importing twice reinforces, never duplicates. */
export async function importCapsule(payload: CapsulePayload, opts: ImportOptions = {}, db: Database = getDb()): Promise<ImportResult> {
  const project = opts.project?.trim() || payload.project;
  const result: ImportResult = {
    project, memories: { created: 0, reinforced: 0 }, relations: 0, context: 0,
    collections: { created: 0, existing: 0 }, records: 0, errors: [], dryRun: opts.dryRun === true,
  };
  if (opts.dryRun) {
    result.memories.created = payload.memories.length;
    result.relations = payload.relations.length;
    result.context = payload.context.length;
    result.collections.created = payload.collections.length;
    result.records = payload.records.length;
    return result;
  }
  const origin = (m: MemoryOrigin | null): MemoryOrigin | null => (opts.keepOrigin ? m : "external-source");

  const idOf = new Map<number, number>();
  for (const m of payload.memories) {
    try {
      const r = learn({
        content: m.content,
        title: m.title ?? undefined,
        category: m.category,
        importance: m.importance,
        confidence: m.confidence,
        tags: m.tags,
        files: m.files.length > 0 ? m.files : undefined,
        project_scope: project,
        origin: origin(m.origin),
        // Keep when it was known: event time, else the original record time.
        occurred_at: m.occurred_at ?? m.created_at,
        source: "capsule",
        actor: "ltm:import",
        provenanceSourceType: "import-bundle",
        provenanceSourceRef: `capsule:${payload.project}@${payload.exported_at}`,
        skipExport: true,
      });
      idOf.set(m.ref, r.id);
      if (r.action === "created") result.memories.created++; else result.memories.reinforced++;
    } catch (err) {
      result.errors.push(`memory ${m.ref}: ${(err as Error).message}`);
    }
  }
  for (const rel of payload.relations) {
    const s = idOf.get(rel.source_ref);
    const t = idOf.get(rel.target_ref);
    if (s === undefined || t === undefined || s === t) continue;
    try {
      relate({ source_id: s, target_id: t, relationship_type: rel.type });
      result.relations++;
    } catch (err) {
      result.errors.push(`relation ${rel.source_ref}->${rel.target_ref}: ${(err as Error).message}`);
    }
  }

  const { addContextItem } = await import("./dao/contextItems.js");
  const hasGoal = db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM context_items WHERE project_name=? AND type='goal'").get(project)!.n > 0;
  for (const c of payload.context) {
    // Never replace the target's own goal; skip items it already has.
    if (c.type === "goal" && hasGoal) continue;
    const dup = db.query<{ n: number }, [string, string, string]>(
      "SELECT COUNT(*) n FROM context_items WHERE project_name=? AND type=? AND content=?",
    ).get(project, c.type, c.content)!.n > 0;
    if (dup) continue;
    await addContextItem(c.type, project, c.content);
    result.context++;
  }

  if (payload.collections.length > 0) {
    const { defineCollection, putRecord, resolveCollection } = await import("./collections/store.js");
    for (const c of payload.collections) {
      const existing = resolveCollection(c.name, project, db);
      if (existing) { result.collections.existing++; continue; }
      try {
        defineCollection({ name: c.name, description: c.description, fields: c.fields, key_field: c.key_field, project, origin: "agent-observation", created_by: "ltm:import", force: true }, db);
        result.collections.created++;
      } catch (err) {
        result.errors.push(`collection ${c.name}: ${(err as Error).message}`);
      }
    }
    for (const r of payload.records) {
      try {
        putRecord({
          collection: r.collection, project, data: r.data,
          origin: (origin(r.origin) ?? "external-source") as MemoryOrigin,
          created_by: "ltm:import",
          memory_id: r.memory_ref !== null ? idOf.get(r.memory_ref) ?? null : null,
        }, db);
        result.records++;
      } catch (err) {
        result.errors.push(`record in ${r.collection}: ${(err as Error).message}`);
      }
    }
  }
  return result;
}
