/**
 * cli/collections.ts — `ltm collection …` and `ltm record …`, the owner's view
 * of agent-defined collections.
 *
 *   ltm collection list [--archived]           ltm record list <collection> [--where '<json>'] [--text q]
 *   ltm collection show <name>                 ltm record get <collection> <key>
 *   ltm collection define <name> --description "…" --fields '<json>' [--key f] [--scope project] [--force]
 *   ltm collection evolve <name> [--fields '<json>'] [--description "…"] [--allow-breaking]
 *   ltm collection archive|restore <name>      ltm record put <collection> --data '<json>' [--merge]
 *   ltm record archive <collection> <key>      ltm record export <collection>   (JSON lines)
 *
 * Writes from here are the owner's own: origin defaults to owner-statement.
 * Only this path can make a breaking schema change, and it backs the DB up first.
 * Exit codes: 0 success · 1 usage error · 2 refused / runtime error.
 */
import { waitForInit, getDb } from "../shared-db.js";
import { scrubForEgress } from "../secretsScrubber.js";
import { isMemoryOrigin } from "../origin.js";
import { deriveProjectFromCwd } from "../prefill.js";
import { backupDb } from "../migrations.js";
import { CollectionError, evolveCollection, setCollectionStatus, resolveCollection, _toRecordView, type RecordRow } from "../collections/store.js";
import { runCollectionTool, runRecordTool, type ToolOutcome } from "../collections/tools.js";

export interface CliResult {
  exitCode: number;
  output: string;
}

function scanFlags(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[arg.slice(2)] = next; i++; }
    else flags[arg.slice(2)] = true;
  }
  return { flags, positional };
}

function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[REDACTED:scrub-failed]";
  if (typeof value === "string") return scrubForEgress(value);
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepScrub(v, depth + 1)]));
  return value;
}

const print = (value: unknown): string => JSON.stringify(deepScrub(value), null, 2);
const usage = (message: string): CliResult => ({ exitCode: 1, output: `ltm: ${message}` });
const done = (o: ToolOutcome): CliResult => ({ exitCode: o.ok ? 0 : 2, output: print(o) });

function parseJson(flag: string | true | undefined, name: string): unknown {
  if (typeof flag !== "string") throw new CollectionError("usage", `--${name} '<json>' is required`);
  try {
    return JSON.parse(flag);
  } catch {
    throw new CollectionError("usage", `--${name} is not valid JSON`);
  }
}

const COLLECTION_HELP = [
  "ltm collection list [--archived] [--project p]",
  "ltm collection show <name>",
  "ltm collection define <name> --description \"…\" --fields '<json array>' [--key field] [--scope project] [--force]",
  "ltm collection evolve <name> [--fields '<json array>'] [--description \"…\"] [--allow-breaking]",
  "ltm collection archive <name> | restore <name>",
].join("\n");

const RECORD_HELP = [
  "ltm record list <collection> [--where '<json filters>'] [--text q] [--order-by f] [--limit n] [--archived]",
  "ltm record get <collection> <key>",
  "ltm record put <collection> --data '<json object>' [--merge] [--origin o]",
  "ltm record archive <collection> <key>",
  "ltm record export <collection>",
].join("\n");

export async function runCollectionCommand(argv: string[]): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "help") return { exitCode: command ? 0 : 1, output: COLLECTION_HELP };
  const { flags, positional } = scanFlags(rest);
  const project = typeof flags["project"] === "string" ? flags["project"] : deriveProjectFromCwd(process.cwd()) || null;
  const ctx = { project, actor: "cli" };
  await waitForInit();
  try {
    switch (command) {
      case "list":
        return done(runCollectionTool({ action: "list", include_archived: flags["archived"] === true }, ctx));
      case "show":
        if (!positional[0]) return usage("collection show <name>");
        return done(runCollectionTool({ action: "describe", name: positional[0] }, ctx));
      case "define": {
        if (!positional[0]) return usage("collection define <name> --description … --fields …");
        if (typeof flags["description"] !== "string") return usage("collection define: --description is required");
        return done(runCollectionTool({
          action: "define", name: positional[0], description: flags["description"], fields: parseJson(flags["fields"], "fields"),
          key_field: typeof flags["key"] === "string" ? flags["key"] : undefined,
          scope: flags["scope"] === "project" ? "project" : "global", origin: "owner-statement", force: flags["force"] === true,
        }, ctx));
      }
      case "evolve": {
        if (!positional[0]) return usage("collection evolve <name> [--fields …] [--description …] [--allow-breaking]");
        const fields = flags["fields"] === undefined ? undefined : parseJson(flags["fields"], "fields");
        const description = typeof flags["description"] === "string" ? flags["description"] : undefined;
        if (flags["allow-breaking"] !== true) {
          return done(runCollectionTool({ action: "evolve", name: positional[0], fields, description }, ctx));
        }
        // Owner-only breaking change: back up, then rewrite every record or change nothing.
        const backup = await backupDb(new Date(), getDb());
        const res = evolveCollection({ name: positional[0], project, fields, description, allowBreaking: true });
        return { exitCode: 0, output: print({ ok: true, backup, version: res.collection.version, rewritten: res.rewritten, reindexed: res.reindexed }) };
      }
      case "archive":
      case "restore": {
        if (!positional[0]) return usage(`collection ${command} <name>`);
        const c = setCollectionStatus(positional[0], project, command === "archive" ? "archived" : "active");
        return { exitCode: 0, output: print({ ok: true, name: c.name, status: c.status }) };
      }
      default:
        return usage(`unknown collection command '${command}'\n${COLLECTION_HELP}`);
    }
  } catch (err) {
    if (err instanceof CollectionError) return { exitCode: err.code === "usage" ? 1 : 2, output: print({ ok: false, error: err.code, message: err.message, details: err.details }) };
    return { exitCode: 2, output: `ltm: ${(err as Error).message}` };
  }
}

export async function runRecordCommand(argv: string[]): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "help") return { exitCode: command ? 0 : 1, output: RECORD_HELP };
  const { flags, positional } = scanFlags(rest);
  const project = typeof flags["project"] === "string" ? flags["project"] : deriveProjectFromCwd(process.cwd()) || null;
  const ctx = { project, actor: "cli" };
  const collection = positional[0];
  if (!collection) return usage(`record ${command} <collection> …\n${RECORD_HELP}`);
  await waitForInit();
  try {
    switch (command) {
      case "list":
        return done(runRecordTool({
          action: "query", collection,
          where: flags["where"] === undefined ? undefined : parseJson(flags["where"], "where") as never,
          text: typeof flags["text"] === "string" ? flags["text"] : undefined,
          order_by: typeof flags["order-by"] === "string" ? flags["order-by"] : undefined,
          order: flags["asc"] === true ? "asc" : undefined,
          limit: typeof flags["limit"] === "string" ? Number.parseInt(flags["limit"], 10) : undefined,
          include_archived: flags["archived"] === true,
        }, ctx));
      case "get":
        if (!positional[1]) return usage("record get <collection> <key>");
        return done(runRecordTool({ action: "get", collection, key: positional[1] }, ctx));
      case "put": {
        const origin = typeof flags["origin"] === "string" ? flags["origin"] : "owner-statement";
        if (!isMemoryOrigin(origin)) return usage(`record put: invalid --origin '${origin}'`);
        return done(runRecordTool({
          action: "put", collection, data: parseJson(flags["data"], "data") as Record<string, unknown>,
          merge: flags["merge"] === true, origin,
        }, ctx));
      }
      case "archive":
        if (!positional[1]) return usage("record archive <collection> <key>");
        return done(runRecordTool({ action: "archive", collection, key: positional[1] }, ctx));
      case "export": {
        const c = resolveCollection(collection, project);
        if (!c) return { exitCode: 2, output: print({ ok: false, error: "unknown_collection", message: `no collection "${collection}"` }) };
        const rows = getDb().query<RecordRow, [number]>("SELECT * FROM records WHERE collection_id=? ORDER BY id").all(c.id);
        return { exitCode: 0, output: rows.map((r) => JSON.stringify(deepScrub(_toRecordView(c, r)))).join("\n") };
      }
      default:
        return usage(`unknown record command '${command}'\n${RECORD_HELP}`);
    }
  } catch (err) {
    if (err instanceof CollectionError) return { exitCode: err.code === "usage" ? 1 : 2, output: print({ ok: false, error: err.code, message: err.message, details: err.details }) };
    return { exitCode: 2, output: `ltm: ${(err as Error).message}` };
  }
}
