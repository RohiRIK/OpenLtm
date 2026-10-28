/**
 * cli/capsule.ts — `ltm export` / `ltm import`: a project's memory as one file.
 *
 * The passphrase for an encrypted capsule is read from an environment
 * variable (LTM_CAPSULE_PASSPHRASE, or the one --passphrase-env names) so it
 * never lands in shell history.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { buildCapsule, importCapsule, openCapsule } from "../capsule.js";

export interface CapsuleCommandResult {
  exitCode: number;
  output: string;
}

const EXPORT_HELP = [
  "",
  "  ltm export --project <name> [--out <file>] [--include-global] [--include-private]",
  "             [--mask-pii] [--encrypt] [--passphrase-env VAR]",
  "",
  "  Writes the project's active memories, relations, goal/decisions/gotchas,",
  "  and project collections + records to one JSON file (default",
  "  <project>.ltm.json), with a SHA-256 over the content. --encrypt uses",
  "  AES-256-GCM with the passphrase in $LTM_CAPSULE_PASSPHRASE (or VAR).",
  "  Private memories are left out unless --include-private.",
  "",
].join("\n");

const IMPORT_HELP = [
  "",
  "  ltm import <file> [--project <name>] [--keep-origin] [--dry-run] [--passphrase-env VAR]",
  "",
  "  Verifies the checksum, then stores the capsule through learn (secrets",
  "  scrubbed, duplicates reinforced). Imported claims are marked",
  "  external-source unless --keep-origin. Never replaces the project's goal.",
  "",
].join("\n");

function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function passphrase(argv: string[]): string | undefined {
  const name = option(argv, "--passphrase-env") ?? "LTM_CAPSULE_PASSPHRASE";
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function unknownFlag(argv: string[], known: string[], withValue: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (withValue.includes(a)) { i++; continue; }
    if (a.startsWith("--") && !known.includes(a)) return a;
  }
  return undefined;
}

export async function runExportCommand(argv: string[]): Promise<CapsuleCommandResult> {
  if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, output: EXPORT_HELP };
  const bad = unknownFlag(argv, ["--include-global", "--include-private", "--mask-pii", "--encrypt"], ["--project", "--out", "--passphrase-env"]);
  if (bad) return { exitCode: 1, output: `  ltm export: unknown option '${bad}'\n${EXPORT_HELP}` };
  const project = option(argv, "--project")?.trim();
  if (!project) return { exitCode: 1, output: `  ltm export: --project is required\n${EXPORT_HELP}` };
  const encrypt = argv.includes("--encrypt");
  const pass = encrypt ? passphrase(argv) : undefined;
  if (encrypt && !pass) return { exitCode: 1, output: "  ltm export --encrypt: set the passphrase in $LTM_CAPSULE_PASSPHRASE (or the variable --passphrase-env names)" };

  const { waitForInit } = await import("../shared-db.js");
  await waitForInit();
  const env = buildCapsule({
    project,
    includeGlobal: argv.includes("--include-global"),
    includePrivate: argv.includes("--include-private"),
    maskPii: argv.includes("--mask-pii"),
    passphrase: pass,
  });
  const out = option(argv, "--out") ?? `${project.replace(/[^A-Za-z0-9._-]/g, "_")}.ltm.json`;
  if (existsSync(out)) return { exitCode: 1, output: `  ltm export: ${out} exists; choose another --out` };
  writeFileSync(out, JSON.stringify(env, null, 2) + "\n", { mode: 0o600 });
  const counts = "payload" in env
    ? `${env.payload.memories.length} memories, ${env.payload.relations.length} relations, ${env.payload.context.length} context items, ${env.payload.collections.length} collections, ${env.payload.records.length} records`
    : "encrypted";
  return { exitCode: 0, output: `  Wrote ${out} (${counts}; sha256 ${env.sha256.slice(0, 12)}…)` };
}

export async function runImportCommand(argv: string[]): Promise<CapsuleCommandResult> {
  if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, output: IMPORT_HELP };
  const bad = unknownFlag(argv, ["--keep-origin", "--dry-run"], ["--project", "--passphrase-env"]);
  if (bad) return { exitCode: 1, output: `  ltm import: unknown option '${bad}'\n${IMPORT_HELP}` };
  const file = argv.find((a, i) => !a.startsWith("--") && !["--project", "--passphrase-env"].includes(argv[i - 1] ?? ""));
  if (!file) return { exitCode: 1, output: `  ltm import: name the capsule file\n${IMPORT_HELP}` };
  if (!existsSync(file)) return { exitCode: 1, output: `  ltm import: ${file} not found` };

  let payload;
  try {
    payload = openCapsule(readFileSync(file, "utf-8"), passphrase(argv));
  } catch (err) {
    return { exitCode: 1, output: `  ltm import: ${(err as Error).message}` };
  }
  const { waitForInit } = await import("../shared-db.js");
  await waitForInit();
  const r = await importCapsule(payload, { project: option(argv, "--project"), keepOrigin: argv.includes("--keep-origin"), dryRun: argv.includes("--dry-run") });
  const lines = [
    `  ${r.dryRun ? "Would import" : "Imported"} into project ${r.project}:`,
    `    memories: ${r.memories.created} new${r.dryRun ? "" : `, ${r.memories.reinforced} already known (reinforced)`}`,
    `    relations: ${r.relations}, context items: ${r.context}`,
    `    collections: ${r.collections.created} new${r.collections.existing ? `, ${r.collections.existing} existing` : ""}, records: ${r.records}`,
    ...r.errors.map((e) => `    error: ${e}`),
  ];
  return { exitCode: r.errors.length === 0 ? 0 : 1, output: lines.join("\n") };
}
