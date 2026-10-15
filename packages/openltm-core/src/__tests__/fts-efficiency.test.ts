/**
 * fts-efficiency.test.ts — the FTS index is rewritten only when indexed text
 * changes (migration 028), the recall probe still filters inside FTS, and the
 * keyed near-duplicate check agrees with isNearDuplicate.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isNearDuplicate, isNearDuplicateKey, nearDuplicateKey } from "../similarity.js";

type Core = typeof import("../index.js");
let core: Core;
let db: Database;

const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-fts-efficiency-"));
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const savedProvider = process.env.LTM_EMBED_PROVIDER;

const ftsDataRows = () => (db.query(`SELECT count(*) AS c FROM memories_fts_data`).get() as { c: number }).c;
const matchIds = (q: string) =>
  (db.query(`SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?`).all(q) as { rowid: number }[]).map((r) => r.rowid);

beforeAll(async () => {
  process.env.LTM_EMBED_PROVIDER = "disabled";
  core = await import("../index.js");
  db = new Database(join(tmpRoot, "openltm.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  if (savedProvider === undefined) delete process.env.LTM_EMBED_PROVIDER;
  else process.env.LTM_EMBED_PROVIDER = savedProvider;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("FTS triggers fire only on text changes", () => {
  it("a metadata update leaves the index untouched", () => {
    const { id } = core.learn({ content: "Kingfisher pipelines retry three times before paging", category: "workflow", skipExport: true });
    const before = ftsDataRows();
    db.run(`UPDATE memories SET recall_count = recall_count + 1, decay_score = 0.5, last_recalled_at = datetime('now') WHERE id = ?`, [id]);
    expect(ftsDataRows()).toBe(before);
    expect(matchIds('"kingfisher"')).toEqual([id]);
  });

  it("a content or title update re-indexes the row", () => {
    const { id } = core.learn({ content: "Pelican builds publish nightly artifacts", category: "workflow", skipExport: true });
    db.run(`UPDATE memories SET content = 'Heron builds publish nightly artifacts' WHERE id = ?`, [id]);
    expect(matchIds('content:"pelican"')).toEqual([]); // the derived title still says pelican
    expect(matchIds('"heron"')).toEqual([id]);
    db.run(`UPDATE memories SET title = 'Cormorant title' WHERE id = ?`, [id]);
    expect(matchIds('"cormorant"')).toEqual([id]);
  });

  it("context_items follow the same rule", () => {
    db.run(`INSERT INTO context_items (project_name, type, content) VALUES ('p', 'goal', 'Albatross migration goal')`);
    const id = (db.query(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;
    db.run(`UPDATE context_items SET status = 'promoted' WHERE id = ?`, [id]);
    db.run(`UPDATE context_items SET content = 'Osprey migration goal' WHERE id = ?`, [id]);
    const hit = (q: string) => db.query(`SELECT rowid FROM context_items_fts WHERE context_items_fts MATCH ?`).all(q).length;
    expect(hit('"albatross"')).toBe(0);
    expect(hit('"osprey"')).toBe(1);
  });
});

describe("recall FTS probe filters inside the search", () => {
  it("returns only in-scope, active matches", async () => {
    const inScope = core.learn({ content: "Flamingo cache warms on deploy", category: "pattern", project_scope: "birds", skipExport: true });
    const otherScope = core.learn({ content: "Flamingo cache warms on boot", category: "pattern", project_scope: "fish", skipExport: true });
    const deprecated = core.learn({ content: "Flamingo cache warms lazily", category: "pattern", project_scope: "birds", skipExport: true });
    db.run(`UPDATE memories SET status = 'deprecated' WHERE id = ?`, [deprecated.id]);
    const ids = (await core.recall({ query: "flamingo cache", project: "birds", semantic: false })).map((m) => m.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(otherScope.id);
    expect(ids).not.toContain(deprecated.id);
  });
});

describe("isNearDuplicateKey", () => {
  const texts = [
    "Use bun instead of npm for every script",
    "Use bun instead of npm for every script and test run",
    "Do not use bun instead of npm for every script",
    "Retry 3 times before paging the on-call engineer",
    "Retry 5 times before paging the on-call engineer",
    "short text",
    "",
  ];
  it("agrees with isNearDuplicate on every pair", () => {
    for (const a of texts) {
      for (const b of texts) {
        expect(isNearDuplicateKey(nearDuplicateKey(a), nearDuplicateKey(b))).toBe(isNearDuplicate(a, b));
      }
    }
  });
});
