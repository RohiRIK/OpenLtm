import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { getMigrationFiles, parseMigration } from "../../migrations.js";

async function migration023() {
  const files = await getMigrationFiles();
  const f = files.find((m) => m.version === 23 && m.name === "memory_files");
  if (!f) throw new Error("migration 023_memory_files.sql not found");
  return parseMigration(f.content);
}

// Minimal pre-021 memories table (the upgrade path only needs the FK target).
function baseMemories(db: Database) {
  db.exec(
    "CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, importance INTEGER NOT NULL DEFAULT 3);",
  );
}

function colNames(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

describe("migration 021 — memory_files + staleness columns", () => {
  it("UP creates memory_files and adds stale columns (AC1, AC2)", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    baseMemories(db);

    const { up } = await migration023();
    expect(up).toBeTruthy();
    db.exec(up!);

    const tbl = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_files'",
      )
      .get();
    expect(tbl?.name).toBe("memory_files");

    const cols = colNames(db, "memories");
    expect(cols).toContain("stale_flagged_at");
    expect(cols).toContain("stale_reason");

    // Anchor row inserts and ON DELETE CASCADE wipes it with the parent.
    db.exec("INSERT INTO memories (id, importance) VALUES (1, 3);");
    db.exec("INSERT INTO memory_files (memory_id, path, project_scope) VALUES (1, 'src/a.ts', 'demo');");
    expect(
      db.query<{ n: number }, []>("SELECT count(*) n FROM memory_files").get()?.n,
    ).toBe(1);
    db.exec("DELETE FROM memories WHERE id=1;");
    expect(
      db.query<{ n: number }, []>("SELECT count(*) n FROM memory_files").get()?.n,
    ).toBe(0);
  });

  it("DOWN reverses cleanly and re-UP works (AC3 idempotent roundtrip)", async () => {
    const db = new Database(":memory:");
    baseMemories(db);
    const { up, down } = await migration023();
    expect(down).toBeTruthy();

    db.exec(up!);
    db.exec(down!);

    expect(
      db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_files'")
        .get(),
    ).toBeNull();
    expect(colNames(db, "memories")).not.toContain("stale_flagged_at");

    // Re-applying after a clean DOWN must succeed.
    db.exec(up!);
    expect(
      db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_files'")
        .get(),
    ).toBeTruthy();
  });
});
