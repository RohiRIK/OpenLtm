/** integrity.ts — `ltm doctor` checks and safe repair. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runPendingMigrations } from "../migrations.js";
import { checkIntegrity, repairIntegrity } from "../integrity.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-integrity-"));
let db: Database;

beforeAll(async () => {
  db = new Database(join(tmpRoot, "doctor.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
  await runPendingMigrations(db);
  db.run("INSERT INTO memories (content, category, dedup_key) VALUES ('The pelican service retries three times.', 'pattern', 'k1')");
  db.run("INSERT INTO memories (content, category, dedup_key) VALUES ('The pelican queue is FIFO.', 'architecture', 'k2')");
  db.run("INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (1, x'00000000', 'bge-m3', 1)");
  db.run("INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (2, x'00000000', 'old-model', 1)");
}, 30_000);
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const failing = (r: ReturnType<typeof checkIntegrity>) => r.checks.filter((c) => !c.ok).map((c) => c.id).sort();

describe("checkIntegrity", () => {
  it("reports a healthy database as ok", () => {
    const r = checkIntegrity(db, { activeModel: "bge-m3" });
    expect(failing(r)).toEqual(["embeddings_model"]);
    db.run("UPDATE memory_embeddings SET model='bge-m3' WHERE memory_id=2");
    expect(checkIntegrity(db, { activeModel: "bge-m3" }).ok).toBe(true);
  });

  it("finds a desynced FTS index, orphan rows, orphan vectors and a dangling supersede", () => {
    db.run("UPDATE memory_embeddings SET model='old-model' WHERE memory_id=2");
    // Desync the external-content FTS: drop the index row for memory 1 behind the trigger's back.
    db.run("INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES ('delete', 1, NULL, 'The pelican service retries three times.')");
    db.exec("PRAGMA foreign_keys=OFF");
    db.run("INSERT INTO memory_tags (memory_id, tag_id) VALUES (999, 1)");
    db.run("INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (998, x'00000000', 'bge-m3', 1)");
    db.exec("PRAGMA foreign_keys=ON");
    db.run("INSERT INTO memories (content, category, dedup_key, status) VALUES ('Old pelican note.', 'pattern', 'k3', 'superseded')");
    const r = checkIntegrity(db, { activeModel: "bge-m3" });
    expect(failing(r)).toEqual(["embeddings_model", "embeddings_orphans", "foreign_keys", "fts", "supersede_links"]);
    expect(r.checks.find((c) => c.id === "supersede_links")!.fix).toBeUndefined();
  });

  it("never offers to delete every vector when none matches the configured model", async () => {
    const solo = new Database(":memory:");
    solo.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
    await runPendingMigrations(solo);
    solo.run("INSERT INTO memories (content, category, dedup_key) VALUES ('x memory', 'pattern', 'x')");
    solo.run("INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (1, x'00000000', 'nomic', 1)");
    const c = checkIntegrity(solo, { activeModel: "bge-m3" }).checks.find((x) => x.id === "embeddings_model")!;
    expect(c.ok).toBe(false);
    expect(c.fix).toBeUndefined();
  });
});

describe("repairIntegrity", () => {
  it("backs up, repairs what it can, leaves memory rows alone", async () => {
    const before = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM memories").get()!.n;
    const report = checkIntegrity(db, { activeModel: "bge-m3" });
    const result = await repairIntegrity(db, report, { activeModel: "bge-m3" });
    expect(result.backupPath && existsSync(result.backupPath)).toBe(true);
    expect(result.applied.map((a) => a.id).sort()).toEqual(["embeddings_model", "embeddings_orphans", "foreign_keys", "fts"]);
    expect(failing(result.after)).toEqual(["supersede_links"]);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM memories").get()!.n).toBe(before);
    // FTS finds memory 1 again.
    expect(db.query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'retries'").all()).toHaveLength(1);
  });

  it("does nothing when nothing is fixable", async () => {
    const r = await repairIntegrity(db, checkIntegrity(db, { activeModel: "bge-m3" }), { activeModel: "bge-m3" });
    expect(r.applied).toEqual([]);
    expect(r.backupPath).toBeNull();
  });
});
