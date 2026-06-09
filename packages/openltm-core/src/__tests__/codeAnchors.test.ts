/**
 * codeAnchors.test.ts — Phase 2: path normaliser + anchor-on-learn.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizeAnchorPath, normalizeAnchorPaths } from "../anchors.js";
import { _setDbForTesting } from "../shared-db.js";
import { learn, flagStaleByPaths, revalidate, recall, decayMemories } from "../db.js";
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

describe("flagStaleByPaths (invalidate-on-commit)", () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
    _setDbForTesting(db);
  });

  function staleAt(id: number): string | null {
    return (
      db
        .query<{ stale_flagged_at: string | null }, [number]>(
          "SELECT stale_flagged_at FROM memories WHERE id=?",
        )
        .get(id)?.stale_flagged_at ?? null
    );
  }

  it("flags a memory anchored to a changed path + records reason and audit (AC10)", () => {
    const m = learn({
      content: "auth verified via jwt in the middleware layer",
      category: "architecture",
      project_scope: "p",
      files: ["src/auth.ts"],
      skipExport: true,
    });
    const res = flagStaleByPaths(["src/auth.ts"], { project_scope: "p", reason: "commit abc" });
    expect(res.flagged).toBe(1);
    expect(res.ids).toContain(m.id);
    expect(staleAt(m.id)).not.toBeNull();
    const row = db
      .query<{ stale_reason: string }, [number]>("SELECT stale_reason FROM memories WHERE id=?")
      .get(m.id);
    expect(row?.stale_reason).toBe("commit abc");
    const audit = db
      .query<{ n: number }, [number]>(
        "SELECT count(*) n FROM memory_audit WHERE memory_id=? AND op='update'",
      )
      .get(m.id);
    expect(audit?.n ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("never flags importance=5 memories (AC12)", () => {
    const m = learn({
      content: "permanent architectural rule never decays",
      category: "architecture",
      importance: 5,
      project_scope: "p",
      files: ["src/auth.ts"],
      skipExport: true,
    });
    const res = flagStaleByPaths(["src/auth.ts"], { project_scope: "p" });
    expect(res.flagged).toBe(0);
    expect(staleAt(m.id)).toBeNull();
  });

  it("returns flagged:0 when no memory is anchored to the path (AC14)", () => {
    learn({ content: "anchored to a different file entirely", category: "pattern", project_scope: "p", files: ["src/other.ts"], skipExport: true });
    expect(flagStaleByPaths(["src/unrelated.ts"], { project_scope: "p" }).flagged).toBe(0);
  });

  it("normalises commit paths (./ , backslash) before matching", () => {
    const m = learn({ content: "path normalisation parity check body", category: "gotcha", project_scope: "p", files: ["src/n.ts"], skipExport: true });
    expect(flagStaleByPaths(["./src/n.ts"], { project_scope: "p" }).ids).toContain(m.id);
  });

  it("flags global (null-scope) anchors regardless of commit scope", () => {
    const m = learn({ content: "global anchor not scoped to a project", category: "pattern", files: ["src/g.ts"], skipExport: true });
    expect(flagStaleByPaths(["src/g.ts"], { project_scope: "someproj" }).ids).toContain(m.id);
  });
});

describe("stale-aware recall + decay + revalidate", () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
    _setDbForTesting(db);
  });

  function staleAt(id: number): string | null {
    return (
      db
        .query<{ stale_flagged_at: string | null }, [number]>(
          "SELECT stale_flagged_at FROM memories WHERE id=?",
        )
        .get(id)?.stale_flagged_at ?? null
    );
  }
  function statusOf(id: number): string {
    return (
      db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id=?").get(id)
        ?.status ?? ""
    );
  }

  it("recall marks stale + downranks but still returns it (AC15)", async () => {
    const fresh = learn({ content: "alpha keyword fresh memory body", category: "pattern", project_scope: "p", files: ["src/x.ts"], skipExport: true });
    const stale = learn({ content: "alpha keyword stale memory body", category: "pattern", project_scope: "p", files: ["src/y.ts"], skipExport: true });
    flagStaleByPaths(["src/y.ts"], { project_scope: "p" });

    const res = await recall({ query: "alpha keyword", limit: 10 });
    const ids = res.map((r) => r.id);
    expect(ids).toContain(fresh.id);
    expect(ids).toContain(stale.id);
    expect(res.find((r) => r.id === stale.id)?.stale).toBe(true);
    expect(res.find((r) => r.id === fresh.id)?.stale).toBe(false);
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(stale.id));
  });

  it("decay deprecates a flagged memory but never importance:5 or unflagged-fresh (AC16)", () => {
    const flagged = learn({ content: "beta flagged should decay now", category: "pattern", project_scope: "p", files: ["src/a.ts"], skipExport: true });
    const permanent = learn({ content: "beta permanent rule stays", category: "architecture", importance: 5, project_scope: "p", files: ["src/a.ts"], skipExport: true });
    const freshUnflagged = learn({ content: "beta fresh untouched stays", category: "pattern", project_scope: "p", files: ["src/b.ts"], skipExport: true });

    flagStaleByPaths(["src/a.ts"], { project_scope: "p" }); // flags `flagged`; skips imp5 `permanent`
    decayMemories();

    expect(statusOf(flagged.id)).toBe("deprecated");
    expect(statusOf(permanent.id)).toBe("active");
    expect(statusOf(freshUnflagged.id)).toBe("active");
  });

  it("reinforce (re-learn same content) clears the stale flag (AC17)", () => {
    const m = learn({ content: "gamma reconfirm body text", category: "gotcha", project_scope: "p", files: ["src/a.ts"], skipExport: true });
    flagStaleByPaths(["src/a.ts"], { project_scope: "p" });
    expect(staleAt(m.id)).not.toBeNull();
    const again = learn({ content: "gamma reconfirm body text", category: "gotcha", project_scope: "p", skipExport: true });
    expect(again.id).toBe(m.id);
    expect(staleAt(m.id)).toBeNull();
  });

  it("revalidate clears the flag and is a no-op when not flagged (AC18)", () => {
    const m = learn({ content: "delta revalidate body text", category: "pattern", project_scope: "p", files: ["src/a.ts"], skipExport: true });
    flagStaleByPaths(["src/a.ts"], { project_scope: "p" });
    expect(revalidate(m.id).revalidated).toBe(true);
    expect(staleAt(m.id)).toBeNull();
    expect(revalidate(m.id).revalidated).toBe(false);
  });
});
