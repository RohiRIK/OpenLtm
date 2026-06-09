/**
 * codeAnchors.test.ts — Phase 2: path normaliser + anchor-on-learn.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizeAnchorPath, normalizeAnchorPaths } from "../anchors.js";
import { _setDbForTesting } from "../shared-db.js";
import { learn } from "../db.js";
import { getMigrationFiles, parseMigration } from "../migrations.js";

// Full schema = schema.sql baseline + every migration `up` (later columns like
// created_by come from migrations). Apply ups directly to skip runPendingMigrations'
// real-DB backup/retention side-effects; tolerate dup-column on already-in-schema.sql.
async function freshDb(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf8"));
  for (const f of await getMigrationFiles()) {
    const { up } = parseMigration(f.content);
    if (!up) continue;
    try {
      db.exec(up);
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e))) throw e;
    }
  }
  return db;
}

function anchorPaths(db: Database, memoryId: number): string[] {
  return db
    .query<{ path: string }, [number]>(
      "SELECT path FROM memory_files WHERE memory_id=? ORDER BY path",
    )
    .all(memoryId)
    .map((r) => r.path);
}

describe("normalizeAnchorPath (AC7)", () => {
  it("strips ./ and leading slashes, normalises backslashes", () => {
    expect(normalizeAnchorPath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeAnchorPath("src\\b.ts")).toBe("src/b.ts");
    expect(normalizeAnchorPath("/src/c.ts")).toBe("src/c.ts");
    expect(normalizeAnchorPath("  src/d.ts  ")).toBe("src/d.ts");
  });

  it("makes absolute paths under repoRoot relative", () => {
    expect(normalizeAnchorPath("/repo/root/src/e.ts", "/repo/root")).toBe("src/e.ts");
    expect(normalizeAnchorPath("/repo/root/", "/repo/root")).toBe("");
  });

  it("de-duplicates and drops empties", () => {
    expect(normalizeAnchorPaths(["./a.ts", "a.ts", "", "  ", "b.ts"])).toEqual(["a.ts", "b.ts"]);
  });
});

describe("anchor-on-learn", () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
    _setDbForTesting(db);
  });

  it("stores normalised anchors scoped to the project (AC5, AC7)", () => {
    const r = learn({
      content: "auth uses JWT verified in middleware layer",
      category: "architecture",
      project_scope: "proj",
      files: ["./src/auth.ts", "src\\auth.ts", "src/jwt.ts"],
      skipExport: true,
    });
    expect(anchorPaths(db, r.id)).toEqual(["src/auth.ts", "src/jwt.ts"]);
    const scope = db
      .query<{ project_scope: string }, [number]>(
        "SELECT project_scope FROM memory_files WHERE memory_id=? LIMIT 1",
      )
      .get(r.id);
    expect(scope?.project_scope).toBe("proj");
  });

  it("omitting files writes no anchors (AC6)", () => {
    const r = learn({ content: "a memory with no file anchors at all", category: "pattern", skipExport: true });
    expect(anchorPaths(db, r.id)).toEqual([]);
  });

  it("reinforce merges new anchors without duplicates (AC8)", () => {
    const a = learn({
      content: "shared memory body for reinforcement",
      category: "gotcha",
      project_scope: "p",
      files: ["src/a.ts"],
      skipExport: true,
    });
    const b = learn({
      content: "shared memory body for reinforcement",
      category: "gotcha",
      project_scope: "p",
      files: ["src/a.ts", "src/b.ts"],
      skipExport: true,
    });
    expect(b.action).toBe("reinforced");
    expect(b.id).toBe(a.id);
    expect(anchorPaths(db, a.id)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
