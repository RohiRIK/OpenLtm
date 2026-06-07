#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readdirSync, statSync, existsSync } from "fs";
import { dirname, join } from "path";
import { enforceRetention, getRetentionDefault } from "../packages/openltm-core/src/migrations.js";

const HELP = `Usage: bun run cleanup:bak [options]

Options:
  --dry-run       Show what would be deleted; do not delete anything.
  --keep <N>      Number of most-recent .bak files to keep (default: \${LTM_BACKUP_RETENTION:-1}).
  --yes, -y       Skip the confirmation prompt.
  --no-grace      Override the 60s grace period (delete files newer than 60s).
  --path <path>   Database path (default: \$LTM_DB_PATH or ./data/openltm.db).
  --help, -h      Print this help and exit.

The active database file (<db-path>) is never touched.`;

interface ParsedArgs {
  dryRun: boolean;
  keep: number;
  yes: boolean;
  noGrace: boolean;
  path: string | null;
}

function parseCli(argv: string[]): ParsedArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      "keep": { type: "string" },
      "yes": { type: "boolean", short: "y", default: false },
      "no-grace": { type: "boolean", default: false },
      "path": { type: "string" },
      "help": { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const keepStr = values.keep;
  let keep = getRetentionDefault();
  if (keepStr !== undefined) {
    const n = parseInt(keepStr, 10);
    if (Number.isNaN(n) || n < 0) {
      console.error(`Invalid --keep value: "${keepStr}" — must be a non-negative integer`);
      process.exit(2);
    }
    keep = n;
  }

  return {
    dryRun: values["dry-run"] ?? false,
    keep,
    yes: values.yes ?? false,
    noGrace: values["no-grace"] ?? false,
    path: values.path ?? null,
  };
}

function resolveDbPath(cliPath: string | null): string {
  if (cliPath) return cliPath;
  if (process.env["LTM_DB_PATH"]) return process.env["LTM_DB_PATH"]!;
  return join(import.meta.dir, "..", "data", "openltm.db");
}

function listBakFiles(dbPath: string): { path: string; size: number; mtime: number }[] {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("openltm.db.bak-"))
    .map((f) => {
      const fullPath = join(dir, f);
      const st = statSync(fullPath);
      return { path: fullPath, size: st.size, mtime: st.mtimeMs };
    });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, "-");
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("(non-interactive stdin; declining. Pass --yes to skip prompt.)");
    return false;
  }
  process.stderr.write(question);
  for await (const chunk of Bun.stdin.stream()) {
    const text = new TextDecoder().decode(chunk);
    if (text.includes("\n")) {
      const answer = text.trim().toLowerCase();
      return answer === "y" || answer === "yes";
    }
  }
  return false;
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const dbPath = resolveDbPath(args.path);

  const files = listBakFiles(dbPath);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const toDelete = files.slice(0, Math.max(0, files.length - args.keep));
  const toKeep = files.slice(toDelete.length);
  const deleteSize = toDelete.reduce((s, f) => s + f.size, 0);

  console.error(`Database: ${dbPath}`);
  console.error(`Found:    ${files.length} .bak file(s)`);
  console.error(`Keep:     ${toKeep.length} most recent`);
  console.error(`Delete:   ${toDelete.length} file(s) (${formatBytes(deleteSize)})`);
  if (files.length > 0) {
    console.error(`Oldest:   ${formatTimestamp(files[0]!.mtime)}`);
    console.error(`Newest:   ${formatTimestamp(files[files.length - 1]!.mtime)}`);
  }
  console.error("");

  if (toDelete.length === 0) {
    console.error("Nothing to delete.");
    return;
  }

  if (args.dryRun) {
    console.error("[dry-run] Would delete:");
    for (const f of toDelete.slice(0, 10)) {
      console.error(`  - ${f.path}  (${formatBytes(f.size)})`);
    }
    if (toDelete.length > 10) {
      console.error(`  ... and ${toDelete.length - 10} more`);
    }
    return;
  }

  if (!args.yes) {
    const ok = await confirm(`Delete ${toDelete.length} file(s) (${formatBytes(deleteSize)})? [y/N] `);
    if (!ok) {
      console.error("Aborted.");
      process.exit(2);
    }
  }

  const result = await enforceRetention(args.keep, {
    dbPath,
    gracePeriodMs: args.noGrace ? 0 : undefined,
  });
  console.error(`Deleted:  ${result.deleted.length} file(s)`);
  if (result.warnings.length > 0) {
    console.error(`Warnings: ${result.warnings.length}`);
    for (const w of result.warnings) console.error(`  ! ${w}`);
  }
}

main().catch((err) => {
  console.error("cleanup-bak error:", err);
  process.exit(1);
});
