/**
 * hive/store.ts — the shared "hive" memory file several agents can opt in to.
 *
 * Default deny everywhere: a new hive is disabled and has no members; a member
 * has no capability until the owner grants one; agent tools never create the
 * file. Grants are explicit `read` / `write` rows. Unknown capability names are
 * dropped, never widened (the fail-closed rule hermes-herald uses for routes).
 *
 * The hive is a separate SQLite file with its own versioned schema. It never
 * touches the main OpenLTM database. Python twin: hermes/openltm_hermes/_hive.py.
 *
 * Boundary: this guards the memory tools. Any process running as the same OS
 * user can still open the file directly (see docs/hive-mode.md, "Limits").
 */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { dirname, join } from "path";
import { homedir } from "os";
import { MEMORY_ORIGINS, type MemoryOrigin } from "../origin.js";
import { scrubOrRefuse, scrubForEgress, SCRUB_FAILED_PLACEHOLDER } from "../secretsScrubber.js";

export const HIVE_SCHEMA_VERSION = 1;
export const HIVE_CAPABILITIES = ["read", "write"] as const;
export type HiveCapability = (typeof HIVE_CAPABILITIES)[number];

/** Origins an agent may claim in the hive. owner-statement / historical-approval are the owner's. */
export const AGENT_HIVE_ORIGINS = ["agent-observation", "external-source", "proposal"] as const satisfies readonly MemoryOrigin[];

export const HIVE_CATEGORIES = ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] as const;

export const HIVE_LIMITS = { maxContent: 8_000, maxTitle: 200, maxReason: 500, maxRecall: 50, defaultRecall: 10 } as const;

const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OWNER = "owner";

export type HiveErrorCode =
  | "hive_missing" | "hive_exists" | "hive_disabled" | "hive_unknown_agent" | "hive_no_grant"
  | "hive_owner_key" | "hive_invalid" | "hive_not_found" | "hive_not_author";

export class HiveError extends Error {
  constructor(readonly code: HiveErrorCode, message: string) {
    super(message);
    this.name = "HiveError";
  }
}

// ─── Paths & host config ─────────────────────────────────────────────────────

export function getHiveSchemaPath(): string {
  return join(import.meta.dir, "schema.sql");
}

export function defaultHivePath(): string {
  return join(homedir(), ".openltm", "hive", "hive.db");
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export interface HiveHostConfig {
  /** Host-side opt-in. False means the agent tools are not registered at all. */
  enabled: boolean;
  path: string;
  token: string | null;
  /** Which kind of host wrote a memory (informational). */
  host: string;
}

/**
 * The host side of the double opt-in. Env wins over the `hive` block of the
 * LTM config.json: LTM_HIVE=1, LTM_HIVE_PATH, LTM_HIVE_TOKEN, LTM_HIVE_HOST.
 * `configJson` is the parsed config.json (or null).
 */
export function hiveHostConfig(env: NodeJS.ProcessEnv = process.env, configJson: unknown = null): HiveHostConfig {
  const block = (configJson && typeof configJson === "object" ? (configJson as Record<string, unknown>)["hive"] : null) as Record<string, unknown> | null;
  const cfg = block && typeof block === "object" ? block : {};
  const enabled = env["LTM_HIVE"] !== undefined ? truthy(env["LTM_HIVE"]) : cfg["enabled"] === true;
  const rawPath = env["LTM_HIVE_PATH"] || (typeof cfg["path"] === "string" ? cfg["path"] : "") || defaultHivePath();
  const token = env["LTM_HIVE_TOKEN"] || (typeof cfg["token"] === "string" ? cfg["token"] : "") || null;
  const host = env["LTM_HIVE_HOST"] || "openltm-mcp";
  return { enabled, path: expandHome(rawPath), token, host };
}

// ─── Open / init ─────────────────────────────────────────────────────────────

/** Open an existing hive. Never creates one: a missing file is `hive_missing`. */
export function openHive(path: string): Database {
  if (!existsSync(path)) throw new HiveError("hive_missing", `No hive at ${path}. The owner creates one with 'ltm hive init'.`);
  const db = new Database(path, { create: false });
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  const version = metaGet(db, "schema_version");
  if (version !== String(HIVE_SCHEMA_VERSION)) {
    db.close();
    throw new HiveError("hive_invalid", `${path} is not a hive (schema_version ${version ?? "missing"}).`);
  }
  return db;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Create a hive file. It starts disabled with no members. Returns the owner key (shown once). */
export function initHive(path: string): { ownerKey: string } {
  if (existsSync(path)) throw new HiveError("hive_exists", `A file already exists at ${path}.`);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    db.exec(readFileSync(getHiveSchemaPath(), "utf-8"));
    const ownerKey = newSecret("hiveowner");
    const put = db.prepare("INSERT INTO hive_meta(key, value) VALUES (?, ?)");
    db.transaction(() => {
      put.run("schema_version", String(HIVE_SCHEMA_VERSION));
      put.run("enabled", "0");
      put.run("owner_key_sha256", sha256(ownerKey));
      put.run("created_at", new Date().toISOString());
    })();
    audit(db, OWNER, "init", path);
    try { chmodSync(path, 0o600); } catch { /* best effort (e.g. Windows) */ }
    return { ownerKey };
  } finally {
    db.close();
  }
}

function metaGet(db: Database, key: string): string | null {
  try {
    return db.query<{ value: string }, [string]>("SELECT value FROM hive_meta WHERE key = ?").get(key)?.value ?? null;
  } catch {
    return null;
  }
}

export function isHiveEnabled(db: Database): boolean {
  return metaGet(db, "enabled") === "1";
}

export function audit(db: Database, agent: string, action: string, detail = "", memoryIds: number[] = []): void {
  db.query("INSERT INTO hive_audit(agent, action, detail, memory_ids) VALUES (?, ?, ?, ?)")
    .run(agent, action, detail.slice(0, 300), memoryIds.join(","));
}

// ─── Owner operations (CLI only; every write needs the owner key) ────────────

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function verifyOwner(db: Database, ownerKey: string | null | undefined): void {
  const stored = metaGet(db, "owner_key_sha256");
  if (!ownerKey || !stored || !safeEqualHex(sha256(ownerKey), stored)) {
    audit(db, OWNER, "denied", "owner key missing or wrong");
    throw new HiveError("hive_owner_key", "Owner key missing or wrong (set LTM_HIVE_OWNER_KEY or pass --owner-key).");
  }
}

/** Keep only known capability names. Malformed input grants nothing. */
export function parseCapabilities(raw: unknown): HiveCapability[] {
  const items = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const wanted = new Set(items.map((x) => String(x).trim().toLowerCase()));
  return HIVE_CAPABILITIES.filter((c) => wanted.has(c));
}

function requireAgentName(name: string): void {
  if (!AGENT_NAME_RE.test(name)) throw new HiveError("hive_invalid", `Agent name must match ${AGENT_NAME_RE} (got '${name}').`);
}

export function setHiveEnabled(db: Database, enabled: boolean): void {
  db.query("INSERT OR REPLACE INTO hive_meta(key, value) VALUES ('enabled', ?)").run(enabled ? "1" : "0");
  audit(db, OWNER, enabled ? "enable" : "disable");
}

/** Register (or re-register) a member with no grants. Returns its token (shown once). */
export function addAgent(db: Database, name: string): { token: string } {
  requireAgentName(name);
  const token = newSecret("hive");
  const existing = db.query<{ status: string }, [string]>("SELECT status FROM hive_agents WHERE name = ?").get(name);
  if (existing?.status === "active") throw new HiveError("hive_exists", `Agent '${name}' is already a member. Remove it first to rotate its token.`);
  db.transaction(() => {
    if (existing) {
      db.query("UPDATE hive_agents SET token_sha256 = ?, status = 'active', created_at = datetime('now'), last_seen_at = NULL WHERE name = ?").run(sha256(token), name);
    } else {
      db.query("INSERT INTO hive_agents(name, token_sha256) VALUES (?, ?)").run(name, sha256(token));
    }
    db.query("DELETE FROM hive_grants WHERE agent = ?").run(name);
  })();
  audit(db, OWNER, "agent-add", name);
  return { token };
}

export function removeAgent(db: Database, name: string): boolean {
  const changed = db.transaction(() => {
    db.query("DELETE FROM hive_grants WHERE agent = ?").run(name);
    db.query("UPDATE hive_requests SET status = 'denied', decided_at = datetime('now') WHERE agent = ? AND status = 'pending'").run(name);
    // A removed member's token must never match again, even before a re-add.
    return db.query("UPDATE hive_agents SET status = 'removed', token_sha256 = 'removed:' || name WHERE name = ? AND status = 'active'").run(name).changes;
  })();
  if (changed) audit(db, OWNER, "agent-remove", name);
  return changed > 0;
}

export interface HiveAgentRow { name: string; status: string; capabilities: HiveCapability[]; created_at: string; last_seen_at: string | null }

export function listAgents(db: Database): HiveAgentRow[] {
  const rows = db.query<{ name: string; status: string; created_at: string; last_seen_at: string | null }, []>(
    "SELECT name, status, created_at, last_seen_at FROM hive_agents ORDER BY name",
  ).all();
  return rows.map((r) => ({ ...r, capabilities: grantsOf(db, r.name) }));
}

function grantsOf(db: Database, agent: string): HiveCapability[] {
  const have = new Set(db.query<{ capability: string }, [string]>("SELECT capability FROM hive_grants WHERE agent = ?").all(agent).map((r) => r.capability));
  return HIVE_CAPABILITIES.filter((c) => have.has(c));
}

function requireActiveAgent(db: Database, name: string): void {
  const row = db.query<{ status: string }, [string]>("SELECT status FROM hive_agents WHERE name = ?").get(name);
  if (row?.status !== "active") throw new HiveError("hive_unknown_agent", `'${name}' is not an active hive member.`);
}

export function grant(db: Database, agent: string, caps: HiveCapability[]): HiveCapability[] {
  requireActiveAgent(db, agent);
  if (caps.length === 0) throw new HiveError("hive_invalid", `No valid capability given (use ${HIVE_CAPABILITIES.join(", ")}).`);
  const ins = db.prepare("INSERT OR IGNORE INTO hive_grants(agent, capability) VALUES (?, ?)");
  db.transaction(() => { for (const c of caps) ins.run(agent, c); })();
  audit(db, OWNER, "grant", `${agent}:${caps.join(",")}`);
  return grantsOf(db, agent);
}

/** Revoke the given capabilities, or all of them when `caps` is empty. */
export function revoke(db: Database, agent: string, caps: HiveCapability[] = []): HiveCapability[] {
  const list = caps.length > 0 ? caps : [...HIVE_CAPABILITIES];
  const del = db.prepare("DELETE FROM hive_grants WHERE agent = ? AND capability = ?");
  db.transaction(() => { for (const c of list) del.run(agent, c); })();
  audit(db, OWNER, "revoke", `${agent}:${list.join(",")}`);
  return grantsOf(db, agent);
}

export interface HiveRequestRow { id: number; agent: string; capabilities: string; reason: string; status: string; created_at: string; decided_at: string | null }

export function listRequests(db: Database, status: "pending" | "all" = "pending"): HiveRequestRow[] {
  const where = status === "pending" ? "WHERE status = 'pending'" : "";
  return db.query<HiveRequestRow, []>(`SELECT * FROM hive_requests ${where} ORDER BY id`).all();
}

/** Approve (grants what was asked) or deny a pending request. */
export function decideRequest(db: Database, id: number, approve: boolean): HiveRequestRow {
  const row = db.query<HiveRequestRow, [number]>("SELECT * FROM hive_requests WHERE id = ?").get(id);
  if (!row) throw new HiveError("hive_not_found", `No access request #${id}.`);
  if (row.status !== "pending") throw new HiveError("hive_invalid", `Request #${id} is already ${row.status}.`);
  db.transaction(() => {
    if (approve) grant(db, row.agent, parseCapabilities(row.capabilities));
    db.query("UPDATE hive_requests SET status = ?, decided_at = datetime('now') WHERE id = ?").run(approve ? "approved" : "denied", id);
  })();
  audit(db, OWNER, approve ? "approve" : "deny", `#${id} ${row.agent}:${row.capabilities}`);
  return db.query<HiveRequestRow, [number]>("SELECT * FROM hive_requests WHERE id = ?").get(id)!;
}

export interface HiveAuditRow { id: number; ts: string; agent: string; action: string; detail: string; memory_ids: string }

export function readAudit(db: Database, limit = 50): HiveAuditRow[] {
  return db.query<HiveAuditRow, [number]>("SELECT * FROM hive_audit ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(limit, 1000)));
}

export function hiveSummary(db: Database): { enabled: boolean; schema_version: number; members: number; memories: number; pending_requests: number } {
  const count = (sql: string): number => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  return {
    enabled: isHiveEnabled(db),
    schema_version: Number(metaGet(db, "schema_version")),
    members: count("SELECT COUNT(*) AS n FROM hive_agents WHERE status = 'active'"),
    memories: count("SELECT COUNT(*) AS n FROM hive_memories WHERE status = 'active'"),
    pending_requests: count("SELECT COUNT(*) AS n FROM hive_requests WHERE status = 'pending'"),
  };
}

// ─── Agent identity ──────────────────────────────────────────────────────────

export interface HiveIdentity { agent: string; capabilities: HiveCapability[] }

/**
 * Resolve a token to a member. Checks, in order: hive enabled, token known,
 * capability granted. Every refusal is audited. `need` omitted = identity only.
 */
export function authenticate(db: Database, token: string | null | undefined, need?: HiveCapability): HiveIdentity {
  if (!isHiveEnabled(db)) {
    audit(db, "?", "denied", "hive disabled");
    throw new HiveError("hive_disabled", "The hive is disabled. Only the owner can enable it ('ltm hive enable').");
  }
  const row = token
    ? db.query<{ name: string }, [string]>("SELECT name FROM hive_agents WHERE token_sha256 = ? AND status = 'active'").get(sha256(token))
    : null;
  if (!row) {
    audit(db, "?", "denied", "unknown or missing token");
    throw new HiveError("hive_unknown_agent", "This agent is not a hive member (missing or unknown LTM_HIVE_TOKEN). The owner registers agents with 'ltm hive agent add'.");
  }
  const capabilities = grantsOf(db, row.name);
  db.query("UPDATE hive_agents SET last_seen_at = datetime('now') WHERE name = ?").run(row.name);
  if (need && !capabilities.includes(need)) {
    audit(db, row.name, "denied", `needs ${need}`);
    throw new HiveError("hive_no_grant", `Agent '${row.name}' has no '${need}' grant in the hive. Ask with hive_request_access; the owner decides.`);
  }
  return { agent: row.name, capabilities };
}

export function requestAccess(db: Database, agent: string, caps: HiveCapability[], reason = ""): HiveRequestRow {
  if (caps.length === 0) throw new HiveError("hive_invalid", `Ask for at least one of: ${HIVE_CAPABILITIES.join(", ")}.`);
  const pending = db.query<HiveRequestRow, [string, string]>(
    "SELECT * FROM hive_requests WHERE agent = ? AND capabilities = ? AND status = 'pending'",
  ).get(agent, caps.join(","));
  if (pending) return pending;
  const cleanReason = scrubForEgress(reason).slice(0, HIVE_LIMITS.maxReason);
  const id = Number(db.query("INSERT INTO hive_requests(agent, capabilities, reason) VALUES (?, ?, ?)").run(agent, caps.join(","), cleanReason).lastInsertRowid);
  audit(db, agent, "request", caps.join(","));
  return db.query<HiveRequestRow, [number]>("SELECT * FROM hive_requests WHERE id = ?").get(id)!;
}

// ─── Memories ────────────────────────────────────────────────────────────────

/** Normalized-content dedup key, scoped by project. The Python twin computes the same value. */
export function hiveDedupKey(content: string, project: string | null): string {
  const normalized = content.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  return sha256(`${project ?? ""}\n${normalized}`);
}

export interface HiveLearnInput {
  content: string;
  title?: string | null;
  category?: string | null;
  importance?: number | null;
  project?: string | null;
  origin?: string | null;
  sourceHost?: string | null;
}

/**
 * Store a memory as `author`. Agents (`asOwner` false) may only claim
 * AGENT_HIVE_ORIGINS. Content is secret-scrubbed first (a hive write is egress).
 */
export function hiveLearn(db: Database, author: string, input: HiveLearnInput, asOwner = false): { id: number; duplicate: boolean } {
  const raw = (input.content ?? "").trim();
  if (!raw) throw new HiveError("hive_invalid", "content is required.");
  if (raw.length > HIVE_LIMITS.maxContent) throw new HiveError("hive_invalid", `content is longer than ${HIVE_LIMITS.maxContent} characters.`);
  const category = input.category ?? "pattern";
  if (!(HIVE_CATEGORIES as readonly string[]).includes(category)) throw new HiveError("hive_invalid", `category must be one of ${HIVE_CATEGORIES.join(", ")}.`);
  const importance = input.importance ?? 3;
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new HiveError("hive_invalid", "importance must be an integer 1-5.");
  const origin = input.origin ?? (asOwner ? "owner-statement" : "agent-observation");
  const allowed: readonly string[] = asOwner ? MEMORY_ORIGINS : AGENT_HIVE_ORIGINS;
  if (!allowed.includes(origin)) {
    throw new HiveError("hive_invalid", `origin '${origin}' is not allowed here. Agents may use ${AGENT_HIVE_ORIGINS.join(", ")}; owner-statement and historical-approval are the owner's.`);
  }
  const content = scrubOrRefuse(raw).scrubbed;
  if (content === SCRUB_FAILED_PLACEHOLDER) throw new HiveError("hive_invalid", "Secret scrubbing failed; nothing was stored.");
  const titleRaw = (input.title ?? "").trim();
  const title = titleRaw ? scrubOrRefuse(titleRaw.slice(0, HIVE_LIMITS.maxTitle)).scrubbed : null;
  const project = (input.project ?? "").trim().toLowerCase() || null;
  const key = hiveDedupKey(content, project);
  const existing = db.query<{ id: number; status: string }, [string]>("SELECT id, status FROM hive_memories WHERE dedup_key = ?").get(key);
  if (existing) {
    if (existing.status === "archived") {
      db.query("UPDATE hive_memories SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(existing.id);
    }
    audit(db, author, "learn-duplicate", "", [existing.id]);
    return { id: existing.id, duplicate: true };
  }
  const id = Number(db.query(
    `INSERT INTO hive_memories(content, title, category, importance, project_scope, origin, author_agent, source_host, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(content, title, category, importance, project, origin, author, input.sourceHost ?? null, key).lastInsertRowid);
  audit(db, author, "learn", "", [id]);
  return { id, duplicate: false };
}

/** FTS5 MATCH expression: distinct word tokens (2+ chars), quoted, ORed. Null when none. */
export function hiveFtsQuery(query: string): string | null {
  const seen: string[] = [];
  for (const m of query.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
    const w = m[0];
    if (w.length >= 2 && !seen.includes(w)) seen.push(w);
    if (seen.length >= 16) break;
  }
  return seen.length > 0 ? seen.map((w) => `"${w}"`).join(" OR ") : null;
}

export interface HiveMemory {
  id: number; content: string; title: string | null; category: string; importance: number;
  project_scope: string | null; origin: string | null; author_agent: string; source_host: string | null; created_at: string;
}

export interface HiveRecallInput { query?: string | null; project?: string | null; category?: string | null; limit?: number | null }

export function hiveRecall(db: Database, reader: string, input: HiveRecallInput = {}): HiveMemory[] {
  const limit = Math.max(1, Math.min(input.limit ?? HIVE_LIMITS.defaultRecall, HIVE_LIMITS.maxRecall));
  const where = ["m.status = 'active'"];
  const params: (string | number)[] = [];
  const project = (input.project ?? "").trim().toLowerCase();
  if (project) { where.push("(m.project_scope IS NULL OR m.project_scope = ?)"); params.push(project); }
  if (input.category) { where.push("m.category = ?"); params.push(input.category); }
  const cols = "m.id, m.content, m.title, m.category, m.importance, m.project_scope, m.origin, m.author_agent, m.source_host, m.created_at";
  const match = input.query ? hiveFtsQuery(input.query) : null;
  let rows: HiveMemory[];
  if (match) {
    rows = db.query<HiveMemory, (string | number)[]>(
      `SELECT ${cols} FROM hive_memories_fts f JOIN hive_memories m ON m.id = f.rowid
       WHERE hive_memories_fts MATCH ? AND ${where.join(" AND ")}
       ORDER BY bm25(hive_memories_fts), m.importance DESC LIMIT ?`,
    ).all(match, ...params, limit);
  } else {
    rows = db.query<HiveMemory, (string | number)[]>(
      `SELECT ${cols} FROM hive_memories m WHERE ${where.join(" AND ")} ORDER BY m.importance DESC, m.created_at DESC LIMIT ?`,
    ).all(...params, limit);
  }
  audit(db, reader, "recall", (input.query ?? "").slice(0, 120), rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, content: scrubForEgress(r.content), title: r.title ? scrubForEgress(r.title) : null }));
}

/** Archive a memory. Agents may archive only what they wrote; the owner may archive any. */
export function hiveArchive(db: Database, actor: string, id: number, asOwner = false): void {
  const row = db.query<{ author_agent: string; status: string }, [number]>("SELECT author_agent, status FROM hive_memories WHERE id = ?").get(id);
  if (!row) throw new HiveError("hive_not_found", `No hive memory #${id}.`);
  if (!asOwner && row.author_agent !== actor) {
    audit(db, actor, "denied", `archive #${id} written by ${row.author_agent}`, [id]);
    throw new HiveError("hive_not_author", `Memory #${id} was written by '${row.author_agent}'. Agents can archive only their own hive memories.`);
  }
  db.query("UPDATE hive_memories SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);
  audit(db, asOwner ? OWNER : actor, "archive", "", [id]);
}
