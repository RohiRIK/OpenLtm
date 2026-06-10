/**
 * cli/memory.ts — `ltm memory <learn|recall|forget|relate|context>` subcommands.
 *
 * Gives headless/CLI agents (OpenCode CLI, scripts, cron jobs) a direct path
 * to LTM without the agent TUI, slash commands, or a running MCP server:
 *
 *   bunx @rohirik/openltm-core memory learn --text "..." --category gotcha
 *   bunx @rohirik/openltm-core memory recall --query "docker rate limit" --json
 *
 * DB path resolution follows paths.ts: LTM_DB_PATH > CLAUDE_PLUGIN_DATA > dev
 * fallback. All writes route through db.ts learn() and therefore through
 * scrubSecrets — the CLI is not a secret-leak bypass.
 *
 * Exit codes: 0 success · 1 usage error · 2 runtime/DB error.
 */
import { learn, recall, forget, relate, getContextMerge, type MemoryCategory } from "../db.js";
import { waitForInit } from "../shared-db.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryCommand = "learn" | "recall" | "forget" | "relate" | "context";

export interface ParsedMemoryArgs {
  ok: true;
  command: MemoryCommand;
  options: Record<string, string | number | string[] | undefined>;
  json: boolean;
}

export interface MemoryArgsError {
  ok: false;
  error: string;
}

export interface MemoryCommandResult {
  exitCode: number;
  output: string;
}

const CATEGORIES: readonly string[] = ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"];
const RELATIONSHIP_TYPES: readonly string[] = ["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"];

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Scan argv for `--flag value` pairs and bare `--flag` booleans. */
function scanFlags(argv: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

function asInt(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function asList(value: string | true | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * parseMemoryArgs — pure parser for `memory` subcommand argv (without the
 * leading "memory"). Returns a typed parse result; never exits the process.
 */
export function parseMemoryArgs(argv: string[]): ParsedMemoryArgs | MemoryArgsError {
  const command = argv[0];
  if (!command || command.startsWith("--")) {
    return { ok: false, error: "missing subcommand — expected one of: learn, recall, forget, relate, context" };
  }

  const flags = scanFlags(argv.slice(1));
  const json = flags["json"] === true;

  switch (command) {
    case "learn": {
      const text = typeof flags["text"] === "string" ? flags["text"] : undefined;
      if (!text) return { ok: false, error: "learn: --text <content> is required" };
      const category = typeof flags["category"] === "string" ? flags["category"] : undefined;
      if (category && !CATEGORIES.includes(category)) {
        return { ok: false, error: `learn: invalid category '${category}' — expected one of: ${CATEGORIES.join(", ")}` };
      }
      const importance = asInt(flags["importance"]);
      if (flags["importance"] !== undefined && (importance === undefined || importance < 1 || importance > 5)) {
        return { ok: false, error: "learn: --importance must be an integer 1-5" };
      }
      return {
        ok: true,
        command: "learn",
        json,
        options: {
          text,
          title: typeof flags["title"] === "string" ? flags["title"] : undefined,
          category,
          importance,
          project: typeof flags["project"] === "string" ? flags["project"] : undefined,
          tags: asList(flags["tags"]),
          files: asList(flags["files"]),
        },
      };
    }

    case "recall": {
      const limit = asInt(flags["limit"]);
      if (flags["limit"] !== undefined && (limit === undefined || limit < 1)) {
        return { ok: false, error: "recall: --limit must be a positive integer" };
      }
      const category = typeof flags["category"] === "string" ? flags["category"] : undefined;
      if (category && !CATEGORIES.includes(category)) {
        return { ok: false, error: `recall: invalid category '${category}' — expected one of: ${CATEGORIES.join(", ")}` };
      }
      return {
        ok: true,
        command: "recall",
        json,
        options: {
          query: typeof flags["query"] === "string" ? flags["query"] : undefined,
          category,
          project: typeof flags["project"] === "string" ? flags["project"] : undefined,
          limit,
          tags: asList(flags["tags"]),
        },
      };
    }

    case "forget": {
      const id = asInt(flags["id"]);
      if (id === undefined) return { ok: false, error: "forget: --id <number> is required" };
      return {
        ok: true,
        command: "forget",
        json,
        options: { id, reason: typeof flags["reason"] === "string" ? flags["reason"] : undefined },
      };
    }

    case "relate": {
      const from = asInt(flags["from"]);
      const to = asInt(flags["to"]);
      const type = typeof flags["type"] === "string" ? flags["type"] : undefined;
      if (from === undefined || to === undefined) {
        return { ok: false, error: "relate: --from <id> and --to <id> are required" };
      }
      if (!type || !RELATIONSHIP_TYPES.includes(type)) {
        return { ok: false, error: `relate: --type must be one of: ${RELATIONSHIP_TYPES.join(", ")}` };
      }
      return { ok: true, command: "relate", json, options: { from, to, type } };
    }

    case "context": {
      const project = typeof flags["project"] === "string" ? flags["project"] : undefined;
      if (!project) return { ok: false, error: "context: --project <name> is required" };
      return { ok: true, command: "context", json, options: { project } };
    }

    default:
      return { ok: false, error: `unknown memory subcommand '${command}' — expected one of: learn, recall, forget, relate, context` };
  }
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * runMemoryCommand — execute a parsed memory command against the LTM DB.
 * Returns output text + exit code; never writes to stdout/stderr or exits
 * (the bin entrypoint handles I/O), so it is directly unit-testable.
 */
export async function runMemoryCommand(parsed: ParsedMemoryArgs): Promise<MemoryCommandResult> {
  try {
    await waitForInit();
    const o = parsed.options;

    switch (parsed.command) {
      case "learn": {
        const result = learn({
          content: o["text"] as string,
          title: o["title"] as string | undefined,
          category: (o["category"] as MemoryCategory | undefined) ?? "pattern",
          importance: o["importance"] as number | undefined,
          project_scope: o["project"] as string | undefined,
          tags: o["tags"] as string[] | undefined,
          files: o["files"] as string[] | undefined,
          actor: "cli:ltm_memory",
        });
        const payload = { ...result, category: (o["category"] as string | undefined) ?? "pattern" };
        return {
          exitCode: 0,
          output: parsed.json
            ? JSON.stringify(payload)
            : `  ${payload.action === "created" ? "Stored" : "Reinforced"} memory #${payload.id} (category: ${payload.category}, confirms: ${payload.confirm_count})`,
        };
      }

      case "recall": {
        const results = await recall({
          query: o["query"] as string | undefined,
          category: o["category"] as MemoryCategory | undefined,
          project: o["project"] as string | undefined,
          limit: o["limit"] as number | undefined,
          tags: o["tags"] as string[] | undefined,
        });
        if (parsed.json) {
          const compact = results.map((m) => ({
            id: m.id, title: m.title, content: m.content, category: m.category,
            importance: m.importance, project_scope: m.project_scope,
          }));
          return { exitCode: 0, output: JSON.stringify(compact) };
        }
        if (results.length === 0) return { exitCode: 0, output: "  No memories found." };
        const lines = results.map(
          (m) => `  #${m.id} [${m.category}/${m.importance}]${m.project_scope ? ` (${m.project_scope})` : ""} ${m.title ?? m.content.slice(0, 60)}`,
        );
        return { exitCode: 0, output: lines.join("\n") };
      }

      case "forget": {
        forget({ id: o["id"] as number, reason: o["reason"] as string | undefined, actor: "cli:ltm_memory" });
        return {
          exitCode: 0,
          output: parsed.json ? JSON.stringify({ ok: true, id: o["id"] }) : `  Forgot memory #${o["id"]}`,
        };
      }

      case "relate": {
        relate({ source_id: o["from"] as number, target_id: o["to"] as number, relationship_type: o["type"] as string });
        return {
          exitCode: 0,
          output: parsed.json ? JSON.stringify({ ok: true }) : `  Related #${o["from"]} -[${o["type"]}]-> #${o["to"]}`,
        };
      }

      case "context": {
        const result = getContextMerge(o["project"] as string);
        if (parsed.json) return { exitCode: 0, output: JSON.stringify(result) };
        const fmt = (m: { id: number; content: string }) => `  #${m.id} ${m.content.slice(0, 80)}`;
        return {
          exitCode: 0,
          output: [
            `  Globals (${result.globals.length}):`,
            ...result.globals.map(fmt),
            `  Scoped to ${o["project"]} (${result.scoped.length}):`,
            ...result.scoped.map(fmt),
          ].join("\n"),
        };
      }
    }
  } catch (err) {
    return { exitCode: 2, output: `  ltm memory ${parsed.command}: ${String(err)}` };
  }
}

// ── Entrypoint glue ───────────────────────────────────────────────────────────

export function printMemoryHelp(): string {
  return [
    "",
    "  ltm memory <command> [options]",
    "",
    "  Commands:",
    "    learn    --text <content> [--title <t>] [--category <c>] [--importance 1-5]",
    "             [--project <scope>] [--tags a,b] [--files f1,f2] [--json]",
    "    recall   [--query <q>] [--category <c>] [--project <scope>] [--limit N]",
    "             [--tags a,b] [--json]",
    "    forget   --id <n> [--reason <r>] [--json]",
    "    relate   --from <id> --to <id> --type <rel> [--json]",
    "    context  --project <name> [--json]",
    "",
    `    categories: ${CATEGORIES.join(", ")}`,
    `    relations:  ${RELATIONSHIP_TYPES.join(", ")}`,
    "",
    "  DB path: LTM_DB_PATH env var overrides the default plugin data location.",
    "",
  ].join("\n");
}

/** runMemoryCli — top-level handler invoked by bin.ts. Handles I/O + exit code. */
export async function runMemoryCli(argv: string[]): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h" || argv.length === 0) {
    process.stdout.write(printMemoryHelp());
    return argv.length === 0 ? 1 : 0;
  }
  const parsed = parseMemoryArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`  ltm memory: ${parsed.error}\n`);
    process.stderr.write(printMemoryHelp());
    return 1;
  }
  const result = await runMemoryCommand(parsed);
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(result.output + "\n");
  return result.exitCode;
}
