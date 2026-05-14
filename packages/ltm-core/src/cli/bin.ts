#!/usr/bin/env bun
/**
 * cli/bin.ts — ltm CLI entrypoint.
 *
 * Usage:
 *   bunx @rohirik/ltm-core                    # auto-detect agents
 *   bunx @rohirik/ltm-core --claude           # Claude Code only
 *   bunx @rohirik/ltm-core --opencode         # OpenCode only
 *   bunx @rohirik/ltm-core --pi               # Pi only
 *   bunx @rohirik/ltm-core --dry-run --claude # preview without writing
 *
 *   bunx @rohirik/ltm-core hook --name <hookName>  # lifecycle hook stub
 *   bunx @rohirik/ltm-core mcp-serve               # MCP server (future)
 */
import { runInstallCli } from "./install.js";
import { runHook } from "./hook.js";

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "  bunx @rohirik/ltm-core [options]",
      "",
      "  Options:",
      "    --claude        Install into Claude Code",
      "    --opencode      Install into OpenCode",
      "    --pi            Install into Pi",
      "    --dry-run       Preview without writing files",
      "    --help, -h      Show this help",
      "",
      "  Sub-commands:",
      "    hook --name <event>   Lifecycle hook stub (for Claude Code hook wiring)",
      "    mcp-serve             Start the LTM MCP server",
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

  // Sub-command: mcp-serve (stub — full implementation deferred)
  if (argv[0] === "mcp-serve") {
    process.stderr.write(
      "  ltm mcp-serve: not yet implemented — install the Claude Code plugin for MCP server support\n",
    );
    process.exit(0);
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
