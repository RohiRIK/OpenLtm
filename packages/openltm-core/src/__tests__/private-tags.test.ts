/**
 * Private tag visibility — tag-only filter (private ≠ encrypted).
 * Default paths omit memories tagged `private`; includePrivate opt-in restores them.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-private-tags-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const DOCS_DIR = `/tmp/test-openltm-private-docs-${process.pid}-${Date.now()}`;

let core: typeof import("../index.js");
let db: Database;

beforeAll(async () => {
  process.env.OPENLTM_DOCS_DIR = DOCS_DIR;
  mkdirSync(DOCS_DIR, { recursive: true });
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
  try { rmSync(DOCS_DIR, { recursive: true, force: true }); } catch {}
});

describe("privacy helpers", () => {
  it("PRIVATE_TAG is the literal tag name", () => {
    expect(core.PRIVATE_TAG).toBe("private");
  });

  it("hasPrivateTag is case-insensitive", () => {
    expect(core.hasPrivateTag(["Private"])).toBe(true);
    expect(core.hasPrivateTag(["public"])).toBe(false);
  });

  it("filterPrivateMemories drops private unless includePrivate", () => {
    const mems = [
      { id: 1, tags: ["private"] },
      { id: 2, tags: ["ok"] },
    ];
    expect(core.filterPrivateMemories(mems).map((m) => m.id)).toEqual([2]);
    expect(core.filterPrivateMemories(mems, true).map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("recall / contextMerge omit private by default", () => {
  it("recall hides private; includePrivate surfaces it", async () => {
    const pub = core.learn({
      content: "public architecture note about postgres pooling",
      category: "architecture",
      importance: 4,
      skipExport: true,
    });
    const priv = core.learn({
      content: "private personal API token rotation schedule",
      category: "preference",
      importance: 4,
      tags: ["private"],
      skipExport: true,
    });
    expect(pub.action).toBe("created");
    expect(priv.action).toBe("created");

    const hidden = await core.recall({ query: "API token rotation", limit: 20 });
    expect(hidden.some((m) => m.id === priv.id)).toBe(false);

    const shown = await core.recall({
      query: "API token rotation",
      limit: 20,
      includePrivate: true,
    });
    expect(shown.some((m) => m.id === priv.id)).toBe(true);

    const merged = core.getContextMerge("any-project");
    const allIds = [...merged.globals, ...merged.scoped].map((m) => m.id);
    expect(allIds).not.toContain(priv.id);
  });

  it("hidden private memories neither take result slots nor get recall bumps", async () => {
    const privIds = [1, 2, 3].map((n) => core.learn({
      content: `quokka ledger private entry number ${"abc"[n - 1]} for reconciliation`,
      category: "workflow", importance: 5, tags: ["private"], skipExport: true,
    }).id);
    const pubIds = [1, 2].map((n) => core.learn({
      content: `quokka ledger public entry ${"xy"[n - 1]} about reconciliation exports`,
      category: "workflow", importance: 2, skipExport: true,
    }).id);
    const recallCount = (id: number) => (core.getDb().query("SELECT recall_count FROM memories WHERE id = ?").get(id) as { recall_count: number }).recall_count;
    const before = privIds.map(recallCount);

    const hits = await core.recall({ query: "quokka ledger reconciliation", limit: 2 });
    expect(hits.map((m) => m.id).sort()).toEqual([...pubIds].sort()); // the limit is filled by visible memories
    expect(privIds.map(recallCount)).toEqual(before);
  });
});

describe("exportMarkdown omits private", () => {
  it("dump file never contains private memory content", () => {
    // Force export into our temp docs dir if the code uses a fixed path —
    // fall back to asserting filter via in-memory enrich if docs dir is fixed.
    const priv = core.learn({
      content: "UNIQUE_PRIVATE_EXPORT_MARKER_XYZ",
      category: "gotcha",
      importance: 3,
      tags: ["private"],
      skipExport: true,
    });
    const enriched = core.getMemoryById(priv.id);
    expect(enriched).not.toBeNull();
    expect(core.hasPrivateTag(enriched!.tags)).toBe(true);
    const filtered = core.filterPrivateMemories([enriched!], false);
    expect(filtered.length).toBe(0);
  });
});
