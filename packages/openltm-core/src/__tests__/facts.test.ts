/** facts.ts — rule-based entity/slot/value extraction into the facts collection. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractFacts } from "../facts.js";

const f = (s: string) => extractFacts(s).map((x) => `${x.entity}.${x.slot}=${x.value}`);

describe("extractFacts", () => {
  it("finds ports, pins, uses, language, preferences, locations, dependencies, defaults", () => {
    expect(f("The API server listens on port 7331.")).toEqual(["api server.port=7331"]);
    expect(f("llama-server runs on port 8080 with bge-m3.")).toEqual(["llama-server.port=8080"]);
    expect(f("The plugin SDK is pinned to 2.0.32 for now.")).toEqual(["plugin sdk.pinned_version=2.0.32"]);
    expect(f("The MCP server uses stdio for transport.")).toEqual(["mcp server.uses=stdio"]);
    expect(f("The hooks are written in TypeScript and bundled.")).toEqual(["hooks.language=TypeScript"]);
    expect(f("Prefer bun over npm for every script.")).toEqual(["owner.prefer_over_npm=bun"]);
    expect(f("We use bun instead of npm.")).toEqual(["owner.prefer_over_npm=bun"]);
    expect(f("Database migrations live in migrations/NNN_name.sql and run in order.")).toEqual(["database migrations.location=migrations/NNN_name.sql"]);
    expect(f("The janitor depends on the Honker queue when installed.")).toEqual(["janitor.depends_on=Honker queue"]);
    expect(f("The default embedding model is bge-m3.")).toEqual(["defaults.embedding_model=bge-m3"]);
  });
  it("ignores pronoun subjects and prose without a fact shape", () => {
    expect(f("It uses a lot of memory.")).toEqual([]);
    expect(f("Never write to stdout from the MCP server; log to stderr.")).toEqual([]);
  });
});

describe("scan + apply", () => {
  let core: typeof import("../index.js");
  const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-facts-"));
  const saved = process.env.LTM_EMBED_PROVIDER;
  beforeAll(async () => {
    process.env.LTM_EMBED_PROVIDER = "disabled";
    core = await import("../index.js");
    const db = new Database(join(tmpRoot, "t.db"), { create: true });
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
    await core.runPendingMigrations(db);
    core._setDbForTesting(db);
  }, 30_000);
  afterAll(() => {
    if (saved === undefined) delete process.env.LTM_EMBED_PROVIDER; else process.env.LTM_EMBED_PROVIDER = saved;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("stores one record per entity.slot, newest memory wins, linked to its memory", async () => {
    const db = core.getDb();
    const old = core.learn({ content: "The badger API listens on port 7000.", category: "architecture", skipExport: true });
    const neu = core.learn({ content: "After the move the badger API listens on port 7400.", category: "architecture", origin: "owner-statement", skipExport: true });
    db.run("UPDATE memories SET created_at='2026-01-01 00:00:00' WHERE id=?", [old.id]);
    db.run("UPDATE memories SET created_at='2026-06-01 00:00:00' WHERE id=?", [neu.id]);
    const candidates = core.scanMemoryFacts();
    expect(candidates.map((c) => c.memory_id)).toEqual([old.id, neu.id]);
    const r = await core.applyFacts(candidates);
    expect(r).toMatchObject({ defined: true, created: 1, updated: 0, errors: [] });
    const { getRecord } = await import("../collections/store.js");
    const rec = getRecord("facts", { key: "badger api.port" }, null)!;
    expect(rec.data.value).toBe("7400");
    expect(rec.memory_id).toBe(neu.id);
    expect(rec.origin).toBe("owner-statement");
    const again = await core.applyFacts(core.scanMemoryFacts());
    expect(again).toMatchObject({ defined: false, created: 0, updated: 0, unchanged: 1 });
  });
});
