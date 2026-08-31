import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import {
  getMigrationFiles,
  runPendingMigrations,
  parseMigration,
  computeChecksum,
} from "./packages/openltm-core/src/migrations.ts";

const ROOT = import.meta.dir;
const SCHEMA = readFileSync(join(ROOT, "packages/openltm-core/src/schema.sql"), "utf8");

// Ensure module-level getDbPath() points at a non-existent temp file so the
// runner's backup/retention side-effects are harmless no-ops.
process.env.LTM_DB_PATH = "/tmp/r2-split-nonexistent/openltm.db";

function colNames(db: Database, t: string): string[] {
  return db.query(`PRAGMA table_info(${t})`).all().map((c: any) => c.name);
}
function indexExists(db: Database, name: string): boolean {
  return (
    db
      .query("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name=?")
      .get(name)?.c > 0
  );
}

// ── Path 1: FRESH shared-db install ─────────────────────────────────────────
async function freshInstall(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA); // schema.sql pre-bakes title/hidden/color/icon (but NOT idx_memories_hidden)
  await runPendingMigrations(db);
  return db;
}

async function legacyInstall(): Promise<Database> {
  // Simulate a pre-015/pre-017 install: schema WITHOUT title/hidden/color/icon
  // columns and WITHOUT idx_memories_hidden. Everything else identical. We echo
  // the fresh schema but strip those five column lines and the index line.
  const legacySchema = SCHEMA
    .replace("\n  title        TEXT,", "")
    .replace("\n  title             TEXT,", "")
    .replace("\n  hidden     INTEGER NOT NULL DEFAULT 0,\n  color      TEXT,\n  icon       TEXT,", "")
    .replace("\nCREATE INDEX IF NOT EXISTS idx_memories_hidden ON memories(hidden) WHERE hidden = 1;", "");

  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(legacySchema);
  // seed data that predates title
  db.exec("INSERT INTO memories (content, category, importance) VALUES ('Short sentence. rest here.', 'pattern', 3);");
  db.exec("INSERT INTO context_items (project_name, type, content) VALUES ('demo', 'goal', 'autopromote when confidence > 0.9 and high value. tail');");
  // record 001..014 as already-applied using their real checksums so the runner
  // treats 015+ as pending (a real legacy install would have these recorded).
  const files = await getMigrationFiles();
  for (const f of files) {
    if (f.version >= 1 && f.version <= 14) {
      db.run("INSERT INTO _schema_version (version, name, checksum) VALUES (?,?,?)", [
        f.version, f.name, computeChecksum(f.content),
      ]);
    }
  }
  await runPendingMigrations(db);
  return db;
}

async function main() {
  console.log("═══ PATH 1: FRESH INSTALL (schema.sql only, no prior migrations) ═══");
  const fresh = await freshInstall();
  const applied = fresh.query("SELECT version, name FROM _schema_version ORDER BY version").all();
  const versions = (applied as any[]).map((r) => r.version);
  const missing = [2, 3, 5, 6, 7, 9, 11, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25].filter((v) => !versions.includes(v));
  console.log(`  recorded versions: ${versions.join(",")}`);
  console.log(`  echo-eligible versions (002,005,006,007,009,011,016,018,019,021,022,023) recorded: ${[2,5,6,7,9,11,16,18,19,21,22,23].every((v)=>versions.includes(v))}`);
  console.log(`  split target 015 recorded: ${versions.includes(15)}`);
  console.log(`  split target 017 recorded: ${versions.includes(17)}`);
  console.log(`  backfill 024 recorded:     ${versions.includes(24)}`);
  console.log(`  index 025 recorded:        ${versions.includes(25)}`);
  console.log(`  NO missing expected versions: ${missing.length === 0 ? "PASS" : "FAIL [" + missing.join(",") + "]"}`);
  console.log(`  title on memories present:     ${colNames(fresh, "memories").includes("title")}`);
  console.log(`  title on context_items present:${colNames(fresh, "context_items").includes("title")}`);
  console.log(`  hidden/color/icon present:     ${["hidden","color","icon"].every((c)=>colNames(fresh,"memories").includes(c))}`);
  console.log(`  idx_memories_hidden exists:    ${indexExists(fresh, "idx_memories_hidden")}`);
  console.log(`  backfill no-op on empty table (0 rows): ${fresh.query("SELECT count(*) c FROM memories").get()?.c === 0}`);

  console.log("");
  console.log("═══ PATH 2: LEGACY pre-015/017 install ═══");
  const legacy = await legacyInstall();
  const lgVers = (legacy as any).query("SELECT version FROM _schema_version ORDER BY version").all().map((r:any)=>r.version);
  console.log(`  recorded versions: ${lgVers.join(",")}`);
  console.log(`  ADD title on memories:         ${colNames(legacy,"memories").includes("title") && !colNames(legacy,"memories").includes("hidden")}`);
  console.log(`  ADD hidden/color/icon:         ${["hidden","color","icon"].every((c)=>colNames(legacy,"memories").includes(c))}`);
  console.log(`  idx_memories_hidden created:   ${indexExists(legacy, "idx_memories_hidden")}`);
  const seededTitle = legacy.query("SELECT title FROM memories").get()?.title;
  const ctxTitle = legacy.query("SELECT title FROM context_items").get()?.title;
  console.log(`  backfill memories.title:       ${seededTitle}`);
  console.log(`  backfill context_items.title:  ${ctxTitle}`);
  console.log(`  backfill non-null on both:     ${!!seededTitle && !!ctxTitle ? "PASS" : "FAIL"}`);

  console.log("═══ PATH 3: rerun-safety (second run is a no-op) ═══");
  // Running the runner again on an already-migrated DB must return [] and not
  // change recorded state.
  const secondRun = await runPendingMigrations(fresh);
  console.log(`  second run returned [] (no pending): ${secondRun.length === 0 ? "PASS" : "FAIL"}`);
  const versionsAfter = (fresh.query("SELECT version FROM _schema_version ORDER BY version").all() as any[]).map((r)=>r.version).join(",");
  console.log(`  recorded set unchanged on rerun: ${versions.join(",") === versionsAfter ? "PASS" : "FAIL"}`);
  // Re-apply 024's SQL directly twice → second UPDATE is a no-op.
  const db2 = new Database(":memory:");
  db2.exec("PRAGMA foreign_keys=ON;");
  db2.exec(SCHEMA);
  db2.exec("INSERT INTO memories (content, category, importance) VALUES ('Only sentence content. more', 'pattern', 3);");
  const f24 = (await getMigrationFiles()).find((f)=>f.version===24)!;
  const { up } = parseMigration(f24.content);
  const t1 = db2.query("SELECT count(*) c FROM memories WHERE title IS NOT NULL").get()?.c;
  db2.exec(up);
  const t2 = db2.query("SELECT count(*) c FROM memories WHERE title IS NOT NULL").get()?.c;
  db2.exec(up); // re-run
  const t3 = db2.query("SELECT count(*) c FROM memories WHERE title IS NOT NULL").get()?.c;
  console.log(`  backfill idempotent: after1=${t1} after2=${t2} after3=${t3} → ${t2===t3 ? "PASS (no-op on re-run)" : "FAIL"}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });