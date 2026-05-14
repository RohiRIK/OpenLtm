#!/usr/bin/env bun
/**
 * cli/bin.ts — ltm CLI entrypoint.
 *
 * Usage:
 *   ltm install --target claude-code [--dry-run] [--non-interactive]
 *   ltm install --target open-code   [--dry-run] [--non-interactive]
 *
 * This entrypoint parses argv and delegates to the install orchestrator.
 * Additional sub-commands (onboard, recall, learn …) will be added in
 * subsequent phases.
 */
import { runInstall } from "./install.js";
import type { CliInstallOptions, InstallTargetId } from "./types.js";
import { InstallTarget } from "./types.js";

const VALID_TARGETS = Object.values(InstallTarget) as string[];

function parseArgs(argv: string[]): CliInstallOptions & { subcommand: string } {
  const [subcommand = "help", ...rest] = argv;

  let target: string = InstallTarget.claudeCode;
  let nonInteractive = false;
  let dryRun = false;
  let pluginDataDir: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--target" || arg === "-t") {
      target = rest[++i] ?? target;
    } else if (arg?.startsWith("--target=")) {
      target = arg.split("=")[1] ?? target;
    } else if (arg === "--non-interactive" || arg === "--ci") {
      nonInteractive = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--plugin-data-dir") {
      pluginDataDir = rest[++i];
    }
  }

  return { subcommand, target: target as InstallTargetId, nonInteractive, dryRun, pluginDataDir };
}

function printHelp(): void {
  process.stdout.write([
    "",
    "  ltm — LTM plugin CLI",
    "",
    "  Commands:",
    "    install   Install LTM into a host environment",
    "",
    "  Options for install:",
    "    --target, -t <target>    Host to install into (default: claude-code)",
    `                             Valid: ${VALID_TARGETS.join(", ")}`,
    "    --dry-run                Print steps without writing files",
    "    --non-interactive, --ci  Skip interactive prompts",
    "    --plugin-data-dir <dir>  Override plugin data directory",
    "",
  ].join("\n"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const { subcommand, ...opts } = parseArgs(argv);

  if (subcommand === "install") {
    const result = await runInstall(opts);
    if (result.success) {
      process.stdout.write(`\n  ${result.message}\n\n`);
    } else {
      process.stderr.write(`\n  Error: ${result.message}\n\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write(`\n  Unknown command: "${subcommand}". Run "ltm --help" for usage.\n\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n  ltm fatal: ${String(err)}\n\n`);
  process.exit(1);
});
