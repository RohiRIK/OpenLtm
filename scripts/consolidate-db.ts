#!/usr/bin/env bun
/**
 * consolidate-db.ts — CLI tool to detect, report, and merge duplicate openltm.db files.
 *
 * Usage:
 *   bun run scripts/consolidate-db.ts [--dry-run]
 *
 * --dry-run: Report DB state without making any changes (default-safe mode).
 *
 * This script ONLY merges the `memories` table. It does NOT touch
 * memory_relations, context_items, tags, or any other tables (v1 scope).
 *
 * Safety:
 *   - Never deletes source DBs
 *   - Creates a timestamped backup of the target before any modification
 *   - Requires explicit "yes" confirmation before any writes
 *   - WAL checkpoint on source before copy/merge
 */

import { Database } from "bun:sqlite";
import { existsSync, statSync, copyFileSync } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { homedir } from "os";
import { getDbPath } from "../src/paths.js";

// ---------------------------------------------------------------------------
// Known DB locations
// ---------------------------------------------------------------------------

const HOME = homedir();

function getKnownPaths(): { label: string; path: string }[] {
  return [
    {
      label: "canonical (getDbPath)",
      path: getDbPath({ skipAutoMigrate: true }),
    },
    {
      label: "legacy (~/.claude/memory/openltm.db)",
      path: join(HOME, ".claude", "memory", "openltm.db"),
    },
    {
      label: "dev (data/openltm.db)",
      path: join(import.meta.dir, "..", "data", "openltm.db"),
    },
  ];
}

// ---------------------------------------------------------------------------
// DB introspection helpers
// ---------------------------------------------------------------------------

interface DbInfo {
  label: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastModified: Date | null;
  rowCount: number;
  error?: string;
}

function inspectDb(label: string, path: string): DbInfo {
  if (!existsSync(path)) {
    return { label, path, exists: false, sizeBytes: 0, lastModified: null, rowCount: 0 };
  }

  let sizeBytes = 0;
  let lastModified: Date | null = null;
  try {
    const stat = statSync(path);
    sizeBytes = stat.size;
    lastModified = stat.mtime;
  } catch (e) {
    return { label, path, exists: true, sizeBytes: 0, lastModified: null, rowCount: 0, error: String(e) };
  }

  let rowCount = 0;
  try {
    const db = new Database(path, { readonly: true });
    try {
      const row = db.query("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
      rowCount = row?.cnt ?? 0;
    } finally {
      db.close();
    }
  } catch (e) {
    return { label, path, exists: true, sizeBytes, lastModified, rowCount: 0, error: `DB open failed: ${e}` };
  }

  return { label, path, exists: true, sizeBytes, lastModified, rowCount };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printDbInfo(info: DbInfo): void {
  const status = info.exists ? "✓ exists" : "✗ not found";
  console.log(`\n  [${info.label}]`);
  console.log(`    Path:     ${info.path}`);
  console.log(`    Status:   ${status}`);
  if (info.exists) {
    console.log(`    Size:     ${formatSize(info.sizeBytes)}`);
    console.log(`    Modified: ${info.lastModified?.toLocaleString() ?? "unknown"}`);
    console.log(`    Rows:     ${info.rowCount} memories`);
    if (info.error) {
      console.log(`    Warning:  ${info.error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// User confirmation prompt
// ---------------------------------------------------------------------------

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

function mergeDb(sourcePath: string, targetPath: string): { merged: number; skipped: number; total: number } {
  // WAL checkpoint on source before we touch anything
  const srcDb = new Database(sourcePath, { readwrite: true, create: false });
  try {
    srcDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    srcDb.close();
  }

  // Backup target
  const timestamp = Date.now();
  const backupPath = `${targetPath}.bak.${timestamp}`;
  console.log(`\n  Creating backup: ${backupPath}`);
  copyFileSync(targetPath, backupPath);
  console.log("  Backup created ✓");

  // Count before
  const tgtDb = new Database(targetPath, { readwrite: true, create: false });
  tgtDb.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

  const beforeRow = tgtDb.query("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
  const countBefore = beforeRow?.cnt ?? 0;

  // Attach and merge
  // Use a safe bind approach — ATTACH doesn't support parameterized queries in SQLite
  const escapedSrc = sourcePath.replace(/'/g, "''");
  tgtDb.exec(`ATTACH DATABASE '${escapedSrc}' AS src`);
  tgtDb.exec("INSERT OR IGNORE INTO memories SELECT * FROM src.memories");
  tgtDb.exec("DETACH DATABASE src");

  const afterRow = tgtDb.query("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
  const countAfter = afterRow?.cnt ?? 0;
  tgtDb.close();

  const srcDb2 = new Database(sourcePath, { readonly: true });
  const srcRow = srcDb2.query("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
  const srcCount = srcRow?.cnt ?? 0;
  srcDb2.close();

  const merged = countAfter - countBefore;
  const skipped = srcCount - merged;

  return { merged, skipped, total: countAfter };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           LTM DB Consolidation Tool                         ║");
  console.log(`║           Mode: ${isDryRun ? "DRY RUN (no changes)         " : "LIVE (will make changes)      "}   ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // 1. Inspect all known DB paths
  console.log("\n── Scanning known DB locations ──");
  const knownPaths = getKnownPaths();
  const infos: DbInfo[] = knownPaths.map(({ label, path }) => inspectDb(label, path));

  for (const info of infos) {
    printDbInfo(info);
  }

  // 2. Filter to existing DBs
  const existing = infos.filter((i) => i.exists && !i.error);

  if (existing.length === 0) {
    console.log("\n⚠  No openltm.db files found. Nothing to consolidate.");
    process.exit(0);
  }

  if (existing.length === 1) {
    console.log(`\n✓ Only one DB found (${existing[0].label}). Nothing to merge.`);
    process.exit(0);
  }

  // 3. Identify primary (largest row count)
  const primary = existing.reduce((max, cur) => (cur.rowCount > max.rowCount ? cur : max), existing[0]);
  const sources = existing.filter((i) => i.path !== primary.path);

  console.log("\n── Consolidation Plan ──");
  console.log(`  Target (primary):  [${primary.label}] — ${primary.rowCount} memories`);
  console.log(`  Source(s) to merge:`);
  for (const src of sources) {
    console.log(`    • [${src.label}] — ${src.rowCount} memories  →  ${primary.path}`);
  }

  if (isDryRun) {
    console.log("\n── DRY RUN complete. No changes made. ──");
    console.log("   Re-run without --dry-run to perform the merge.");
    process.exit(0);
  }

  // 4. Confirmation
  console.log(
    `\nThis will merge ${sources.length} source DB(s) into:\n  ${primary.path}`,
  );
  console.log("A timestamped backup of the target will be created first.");
  console.log("Source DBs will NOT be deleted.");

  const ok = await confirm("\nProceed?");
  if (!ok) {
    console.log("\nAborted. No changes made.");
    process.exit(0);
  }

  // 5. Merge each source into primary
  let totalMerged = 0;
  let totalSkipped = 0;

  for (const src of sources) {
    console.log(`\n── Merging [${src.label}] into target ──`);
    const result = mergeDb(src.path, primary.path);
    console.log(`  ✓ Merged: ${result.merged} memories`);
    console.log(`  ✓ Skipped (duplicates): ${result.skipped}`);
    console.log(`  ✓ Total in target after merge: ${result.total}`);
    totalMerged += result.merged;
    totalSkipped += result.skipped;
  }

  // 6. Final report
  const finalDb = new Database(primary.path, { readonly: true });
  const finalRow = finalDb.query("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
  const finalCount = finalRow?.cnt ?? 0;
  finalDb.close();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                   Consolidation Complete                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Memories merged:   ${totalMerged}`);
  console.log(`  Duplicates skipped: ${totalSkipped}`);
  console.log(`  Total in target:   ${finalCount}`);
  console.log(`  Target DB:         ${primary.path}`);
  console.log("\nDone ✓");
}

main().catch((err) => {
  console.error("\n✗ Error:", err);
  process.exit(1);
});
