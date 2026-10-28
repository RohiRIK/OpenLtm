/**
 * Memory origin (memory-versus-authority Phase 2): every write records where
 * the claim came from, the owner restating a memory makes it the owner's, and
 * nothing else changes an origin.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../migrations.js";

const dbPath = `/tmp/test-openltm-origin-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

let core: typeof import("../index.js");
let db: Database;
const originOf = (id: number) => db.query<{ origin: string | null }, [number]>("SELECT origin FROM memories WHERE id=?").get(id)!.origin;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("learn() records origin", () => {
  it("defaults to agent-observation", () => {
    const r = core.learn({ content: "Origin probe: the build cache lives in .turbo", category: "pattern", skipExport: true });
    expect(r.origin).toBe("agent-observation");
    expect(originOf(r.id)).toBe("agent-observation");
  });

  it("stores an explicit origin, and null as unknown", () => {
    const owner = core.learn({ content: "Origin probe: the owner wants squash merges only", category: "preference", origin: "owner-statement", skipExport: true });
    expect(originOf(owner.id)).toBe("owner-statement");
    const unknown = core.learn({ content: "Origin probe: imported legacy note about deploy windows", category: "workflow", origin: null, skipExport: true });
    expect(unknown.origin).toBeNull();
    expect(originOf(unknown.id)).toBeNull();
  });

  it("the owner restating an agent observation makes it an owner statement", () => {
    const content = "Origin probe: integration tests need a running postgres";
    const first = core.learn({ content, category: "gotcha", skipExport: true });
    const again = core.learn({ content, category: "gotcha", origin: "owner-statement", skipExport: true });
    expect(again.action).toBe("reinforced");
    expect(again.id).toBe(first.id);
    expect(again.origin).toBe("owner-statement");
  });

  it("an agent re-observing an owner statement never demotes it", () => {
    const content = "Origin probe: never deploy on Fridays";
    const first = core.learn({ content, category: "constraint", origin: "owner-statement", skipExport: true });
    const again = core.learn({ content, category: "constraint", origin: "external-source", skipExport: true });
    expect(again.origin).toBe("owner-statement");
    expect(originOf(first.id)).toBe("owner-statement");
  });

  it("the column rejects a value outside the enum", () => {
    expect(() => db.run(
      "INSERT INTO memories (content, category, dedup_key, origin) VALUES ('x', 'pattern', 'origin-bad', 'the-boss')",
    )).toThrow();
  });

  it("the audit snapshot carries the origin", () => {
    const r = core.learn({ content: "Origin probe: audit snapshot keeps the origin", category: "pattern", origin: "external-source", skipExport: true });
    const after = db.query<{ after_json: string }, [number]>(
      "SELECT after_json FROM memory_audit WHERE memory_id=? AND op='insert'",
    ).get(r.id)!;
    expect(JSON.parse(after.after_json).origin).toBe("external-source");
  });
});

describe("migration 030", () => {
  it("adds origin, marks session-end extractions as agent observations, leaves the rest unknown", async () => {
    const v29 = new Database(":memory:");
    v29.exec("PRAGMA foreign_keys=ON;");
    // A v29 database: no memories.origin, and none of the later tables (031 collections).
    const schema = readFileSync(SCHEMA_PATH, "utf-8")
      // origin (030) and the columns after it (032 occurred_at, supersede_kind)
      .replace(/,\n\s*-- Where the claim came from[\s\S]*?\n\);/, "\n);")
      .split(/\n-- =+\n-- collections \+ records/)[0]!;
    expect(schema).not.toContain("origin");
    v29.exec(schema);
    ensureMigrationsTable(v29);
    for (const f of await getMigrationFiles()) {
      if (f.version > 29) continue;
      v29.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)", [f.version, f.name, computeChecksum(f.content)]);
    }
    v29.run("INSERT INTO memories (content, category, dedup_key, source) VALUES ('from session end', 'gotcha', 'm030-a', 'evaluate-session')");
    v29.run("INSERT INTO memories (content, category, dedup_key, source) VALUES ('from somewhere', 'gotcha', 'm030-b', NULL)");

    await runPendingMigrations(v29);

    const rows = v29.query<{ dedup_key: string; origin: string | null }, []>("SELECT dedup_key, origin FROM memories ORDER BY dedup_key").all();
    expect(rows).toEqual([{ dedup_key: "m030-a", origin: "agent-observation" }, { dedup_key: "m030-b", origin: null }]);
    expect(v29.query<{ n: number }, []>("SELECT COUNT(*) n FROM _schema_version WHERE version=30").get()!.n).toBe(1);
  });
});

describe("origin constants", () => {
  it("the OpenClaw and Hermes copies match core", async () => {
    const openclaw = readFileSync(join(import.meta.dir, "..", "..", "..", "adapter-openclaw", "src", "index.ts"), "utf-8");
    for (const o of core.MEMORY_ORIGINS) expect(openclaw).toContain(`"${o}"`);
    const hermes = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "hermes", "openltm_hermes", "_origin.py"), "utf-8");
    expect(hermes).toContain(`MEMORY_ORIGINS = (${core.MEMORY_ORIGINS.map((o) => `"${o}"`).join(", ")})`);
    // Same description text on every host: compare with the concatenated literals stripped.
    const joined = (src: string) => [...src.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    const pyDesc = joined(hermes.slice(hermes.indexOf("ORIGIN_PARAM_DESCRIPTION")));
    const ocDesc = joined(openclaw.slice(openclaw.indexOf("ORIGIN_DESCRIPTION ="), openclaw.indexOf('";\n', openclaw.indexOf("ORIGIN_DESCRIPTION =")) + 1));
    expect(pyDesc).toBe(core.ORIGIN_PARAM_DESCRIPTION);
    expect(ocDesc).toBe(core.ORIGIN_PARAM_DESCRIPTION);
  });
});
