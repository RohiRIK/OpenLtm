#!/usr/bin/env bun
/**
 * cli/bin.ts — ltm CLI entrypoint.
 *
 * Usage:
 *   bunx @rohirik/openltm-core                    # auto-detect agents
 *   bunx @rohirik/openltm-core --claude           # Claude Code only
 *   bunx @rohirik/openltm-core --opencode         # OpenCode only
 *   bunx @rohirik/openltm-core --pi               # Pi only
 *   bunx @rohirik/openltm-core --dry-run --claude # preview without writing
 *
 *   bunx @rohirik/openltm-core hook --name <hookName>  # lifecycle hook stub
 *   bunx @rohirik/openltm-core mcp-serve               # MCP server (future)
 */
import { runInstallCli } from "./install.js";
import { runHook } from "./hook.js";
import { runMemoryCli } from "./memory.js";

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "  bunx @rohirik/openltm-core [options]",
      "",
      "  Options:",
      "    --claude        Install into Claude Code",
      "    --opencode      Install into OpenCode",
      "    --pi            Install into Pi",
      "    --dry-run       Preview without writing files",
      "    --help, -h      Show this help",
      "",
      "  Sub-commands:",
      "    memory <cmd>          Read/write memories from the shell (learn, recall,",
      "                          forget, relate, context) — run 'memory --help'",
      "    hook --name <event>   Lifecycle hook stub (for Claude Code hook wiring)",
      "    mcp-serve             Start the LTM MCP server (stdio)",
      "",
      "  If no target flags are given, agents are auto-detected.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  // Sub-command: memory (learn | recall | forget | relate | context)
  if (argv[0] === "memory") {
    const exitCode = await runMemoryCli(argv.slice(1));
    process.exit(exitCode);
  }

  // Sub-command: hook
  if (argv[0] === "hook") {
    const nameIdx = argv.indexOf("--name");
    const hookName = nameIdx !== -1 ? (argv[nameIdx + 1] ?? "") : "";
    if (!hookName) {
      process.stderr.write("  ltm hook: missing --name argument\n");
      process.exit(1);
    }
    runHook(hookName);
    return;
  }

  // Sub-command: mcp-serve — run the LTM MCP server on stdio
  if (argv[0] === "mcp-serve") {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer();
    return; // keep the process alive — transport owns the event loop
  }

  // Unknown positional sub-command: print help + exit 1. Never fall through
  // to the install wizard (e.g. `ltm memry learn ...` must not start installing).
  if (argv[0] && !argv[0].startsWith("--")) {
    process.stderr.write(`  ltm: unknown sub-command '${argv[0]}'\n`);
    printHelp();
    process.exit(1);
  }

  // Parse installer flags
  let claude = false;
  let opencode = false;
  let pi = false;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--claude") claude = true;
    else if (arg === "--opencode") opencode = true;
    else if (arg === "--pi") pi = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  const result = await runInstallCli({
    targets: { claude, opencode, pi },
    dryRun,
  });

  process.exit(result.exitCode);
}

main().catch((err: unknown) => {
  process.stderr.write(`\n  ltm fatal: ${String(err)}\n\n`);
  process.exit(1);
});
