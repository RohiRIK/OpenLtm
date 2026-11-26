/**
 * cli/doctor.ts — `ltm doctor [--fix] [--deep] [--json]`: database health.
 *
 * Without --fix it only reads. With --fix it backs the database up, applies
 * the safe repairs integrity.ts offers, and checks again. Exit code 0 when
 * everything is healthy (after repair, with --fix), 1 otherwise.
 */
import { checkIntegrity, repairIntegrity, type IntegrityCheck, type IntegrityReport } from "../integrity.js";

export interface DoctorCommandResult {
  exitCode: number;
  output: string;
}

const HELP = [
  "",
  "  ltm doctor [--fix] [--deep] [--json]",
  "",
  "  Checks the memory database: SQLite integrity, rows pointing at deleted",
  "  memories, full-text indexes, vectors from another embedding model, the",
  "  vec index, and superseded memories with no replacement.",
  "",
  "    --fix    Back up the database, then repair what can be repaired safely",
  "             (rebuild indexes, delete orphan rows). Memory text and status",
  "             are never changed.",
  "    --deep   Full PRAGMA integrity_check instead of quick_check",
  "    --json   Machine-readable output",
  "",
].join("\n");

function line(c: IntegrityCheck): string {
  return `  ${c.ok ? "✓" : "✗"} ${c.message}${!c.ok && c.fix ? `  [--fix: ${c.fix}]` : ""}`;
}

function render(report: IntegrityReport): string {
  return report.checks.map(line).join("\n");
}

async function activeModel(): Promise<string | null> {
  try {
    const { getEmbeddingProvider } = await import("../embeddings.js");
    const p = await getEmbeddingProvider();
    return p.name === "disabled" ? null : p.model;
  } catch {
    return null;
  }
}

export async function runDoctorCommand(argv: string[]): Promise<DoctorCommandResult> {
  if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, output: HELP };
  const unknown = argv.filter((a) => !["--fix", "--deep", "--json"].includes(a));
  if (unknown.length > 0) return { exitCode: 1, output: `  ltm doctor: unknown option '${unknown[0]}'\n${HELP}` };
  const fix = argv.includes("--fix");
  const json = argv.includes("--json");
  const opts = { deep: argv.includes("--deep"), activeModel: await activeModel() };

  const { waitForInit, getDb } = await import("../shared-db.js");
  await waitForInit();
  const db = getDb();
  const report = checkIntegrity(db, opts);

  if (!fix) {
    if (json) return { exitCode: report.ok ? 0 : 1, output: JSON.stringify(report, null, 2) };
    const fixable = report.checks.some((c) => !c.ok && c.fix);
    const tail = report.ok ? "\n  Database is healthy." : fixable ? "\n  Run 'ltm doctor --fix' to repair (a backup is taken first)." : "";
    return { exitCode: report.ok ? 0 : 1, output: `${render(report)}${tail}` };
  }

  try {
    const result = await repairIntegrity(db, report, opts);
    if (json) return { exitCode: result.after.ok ? 0 : 1, output: JSON.stringify({ before: report, ...result }, null, 2) };
    const out = [render(report), ""];
    if (result.applied.length === 0) out.push("  Nothing to repair automatically.");
    else {
      if (result.backupPath) out.push(`  Backup: ${result.backupPath}`);
      for (const a of result.applied) out.push(`  fixed ${a.id}: ${a.detail}`);
      out.push("", "  After repair:", render(result.after));
    }
    return { exitCode: result.after.ok ? 0 : 1, output: out.join("\n") };
  } catch (err) {
    return { exitCode: 1, output: `${render(report)}\n\n  ltm doctor --fix: ${(err as Error).message}` };
  }
}
