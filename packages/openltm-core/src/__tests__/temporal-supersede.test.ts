/**
 * Event time (occurred_at), point-in-time recall (as_of) and supersede kinds
 * on learn (migration 034, 2.23.0).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../migrations.js";

const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
let core: typeof import("../index.js");
let db: Database;
const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-temporal-"));
const saved = process.env.LTM_EMBED_PROVIDER;

beforeAll(async () => {
  process.env.LTM_EMBED_PROVIDER = "disabled";
  core = await import("../index.js");
  db = new Database(join(tmpRoot, "t.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);
afterAll(() => {
  if (saved === undefined) delete process.env.LTM_EMBED_PROVIDER; else process.env.LTM_EMBED_PROVIDER = saved;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("occurred_at", () => {
  it("is stored in created_at's format and returned by recall", async () => {
    const r = core.learn({ content: "The ferret cluster moved to Frankfurt.", category: "architecture", occurred_at: "2026-03-15", skipExport: true });
    expect(db.query<{ o: string }, [number]>("SELECT occurred_at o FROM memories WHERE id=?").get(r.id)!.o).toBe("2026-03-15 00:00:00");
    const hits = await core.recall({ query: "ferret cluster", semantic: false });
    expect(hits[0]!.occurred_at).toBe("2026-03-15 00:00:00");
  });
  it("refuses a date SQLite cannot read", () => {
    expect(() => core.learn({ content: "Bad date memory for the ferret test.", category: "pattern", occurred_at: "last Tuesday", skipExport: true })).toThrow(/Invalid date/);
  });
  it("fills a missing event time when a memory is reinforced, never overwrites one", () => {
    const a = core.learn({ content: "The otter service runs on port 9100.", category: "architecture", skipExport: true });
    core.learn({ content: "The otter service runs on port 9100.", category: "architecture", occurred_at: "2026-02-01", skipExport: true });
    core.learn({ content: "The otter service runs on port 9100.", category: "architecture", occurred_at: "2026-05-01", skipExport: true });
    expect(db.query<{ o: string }, [number]>("SELECT occurred_at o FROM memories WHERE id=?").get(a.id)!.o).toBe("2026-02-01 00:00:00");
  });
});

describe("learn({ supersedes })", () => {
  it("updates retires the old memory with its kind", () => {
    const old = core.learn({ content: "The badger API listens on port 7000.", category: "architecture", skipExport: true });
    const neu = core.learn({ content: "The badger API listens on port 7400 since the October move.", category: "architecture", supersedes: { id: old.id }, skipExport: true });
    expect(neu.supersede).toEqual({ id: old.id, relation: "updates", applied: true });
    const row = db.query<{ status: string; superseded_by: number; supersede_kind: string }, [number]>("SELECT status, superseded_by, supersede_kind FROM memories WHERE id=?").get(old.id)!;
    expect(row).toEqual({ status: "superseded", superseded_by: neu.id, supersede_kind: "updates" });
  });
  it("retracts retires it as no longer true", () => {
    const old = core.learn({ content: "The badger staging host has no TLS.", category: "gotcha", skipExport: true });
    const neu = core.learn({ content: "Badger staging now has TLS; the no-TLS gotcha no longer applies.", category: "gotcha", supersedes: { id: old.id, relation: "retracts" }, skipExport: true });
    expect(neu.supersede?.applied).toBe(true);
    expect(db.query<{ k: string }, [number]>("SELECT supersede_kind k FROM memories WHERE id=?").get(old.id)!.k).toBe("retracts");
  });
  it("extends links both and keeps both active", () => {
    const old = core.learn({ content: "Badger backups run nightly.", category: "workflow", skipExport: true });
    const neu = core.learn({ content: "Badger backups also copy to the cold bucket weekly.", category: "workflow", supersedes: { id: old.id, relation: "extends" }, skipExport: true });
    expect(neu.supersede?.applied).toBe(true);
    expect(db.query<{ s: string }, [number]>("SELECT status s FROM memories WHERE id=?").get(old.id)!.s).toBe("active");
    expect(db.query<{ t: string }, [number, number]>("SELECT relationship_type t FROM memory_relations WHERE source_memory_id=? AND target_memory_id=?").get(neu.id, old.id)!.t).toBe("refines");
  });
  it("an agent cannot retire an owner statement: recorded as contradicts", () => {
    const owner = core.learn({ content: "Never deploy the badger service on Fridays.", category: "constraint", origin: "owner-statement", skipExport: true });
    const agent = core.learn({ content: "Friday deploys of badger are fine now.", category: "constraint", supersedes: { id: owner.id, relation: "retracts" }, skipExport: true });
    expect(agent.supersede).toEqual({ id: owner.id, relation: "retracts", applied: false, reason: "owner_statement_protected" });
    expect(db.query<{ s: string }, [number]>("SELECT status s FROM memories WHERE id=?").get(owner.id)!.s).toBe("active");
    expect(db.query<{ t: string }, [number, number]>("SELECT relationship_type t FROM memory_relations WHERE source_memory_id=? AND target_memory_id=?").get(agent.id, owner.id)!.t).toBe("contradicts");
    const ownerAgain = core.learn({ content: "Friday deploys of badger are allowed from now on.", category: "constraint", origin: "owner-statement", supersedes: { id: owner.id }, skipExport: true });
    expect(ownerAgain.supersede?.applied).toBe(true);
  });
  it("reports a missing or inactive target without failing the write", () => {
    const r = core.learn({ content: "Badger note pointing at nothing.", category: "pattern", supersedes: { id: 999_999 }, skipExport: true });
    expect(r.action).toBe("created");
    expect(r.supersede).toEqual({ id: 999_999, relation: "updates", applied: false, reason: "not_found" });
  });
});

describe("recall({ as_of })", () => {
  it("returns what was true then, including a value superseded later", async () => {
    const v1 = core.learn({ content: "The heron database runs Postgres 14.", category: "architecture", skipExport: true });
    db.run("UPDATE memories SET created_at='2026-01-10 09:00:00' WHERE id=?", [v1.id]);
    const v2 = core.learn({ content: "The heron database runs Postgres 16 after the upgrade.", category: "architecture", supersedes: { id: v1.id }, skipExport: true });
    db.run("UPDATE memories SET created_at='2026-06-01 09:00:00' WHERE id=?", [v2.id]);
    db.run("UPDATE memories SET superseded_at='2026-06-01 09:00:00' WHERE id=?", [v1.id]);

    const before = await core.recall({ query: "heron database Postgres", as_of: "2026-03-01", semantic: false });
    expect(before.map((m) => m.id)).toEqual([v1.id]);
    expect(before[0]!.status).toBe("superseded");
    const after = await core.recall({ query: "heron database Postgres", as_of: "2026-07-01", semantic: false });
    expect(after.map((m) => m.id)).toEqual([v2.id]);
    const now = await core.recall({ query: "heron database Postgres", semantic: false });
    expect(now.map((m) => m.id)).toEqual([v2.id]);
  });
  it("does not bump recall stats", async () => {
    const before = db.query<{ n: number }, []>("SELECT SUM(recall_count) n FROM memories").get()!.n;
    await core.recall({ query: "heron database", as_of: "2026-03-01", semantic: false });
    expect(db.query<{ n: number }, []>("SELECT SUM(recall_count) n FROM memories").get()!.n).toBe(before);
  });
  it("uses event time when set", async () => {
    const m = core.learn({ content: "The kestrel team adopted trunk-based development.", category: "workflow", occurred_at: "2025-05-01", skipExport: true });
    const hits = await core.recall({ query: "kestrel trunk-based", as_of: "2025-06-01", semantic: false });
    expect(hits.map((h) => h.id)).toContain(m.id);
    const earlier = await core.recall({ query: "kestrel trunk-based", as_of: "2025-04-01", semantic: false });
    expect(earlier).toHaveLength(0);
  });
});

describe("migration 034", () => {
  it("adds occurred_at and supersede_kind to a v33 database", async () => {
    const v33 = new Database(":memory:");
    v33.exec("PRAGMA foreign_keys=ON;");
    const schema = readFileSync(SCHEMA_PATH, "utf-8")
      .replace(/,\n\s*-- Event time and supersede kind[\s\S]*?\n\);/, "\n);");
    expect(schema).not.toContain("occurred_at");
    v33.exec(schema);
    ensureMigrationsTable(v33);
    for (const f of await getMigrationFiles()) {
      if (f.version > 33) continue;
      v33.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)", [f.version, f.name, computeChecksum(f.content)]);
    }
    const results = await runPendingMigrations(v33);
    expect(results.map((r) => r.version)).toContain(34);
    const cols = v33.query<{ name: string }, []>("PRAGMA table_info(memories)").all().map((c) => c.name);
    expect(cols).toContain("occurred_at");
    expect(cols).toContain("supersede_kind");
    expect(() => v33.run("INSERT INTO memories (content, category, supersede_kind) VALUES ('x', 'pattern', 'bogus')")).toThrow();
  });
});
