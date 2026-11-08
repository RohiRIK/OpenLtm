/**
 * cli/hive.ts — `ltm hive …`: the owner's controls for the shared hive memory.
 *
 * Every command that changes who can do what (enable, disable, agent add/remove,
 * grant, revoke, approve, deny) needs the owner key printed once by `init`
 * (LTM_HIVE_OWNER_KEY or --owner-key). Agents get no tool for any of these.
 */
import type { Database } from "bun:sqlite";
import {
  addAgent, decideRequest, grant, hiveArchive, HiveError, hiveLearn, hiveRecall, hiveSummary, initHive, listAgents,
  listRequests, openHive, parseCapabilities, readAudit, removeAgent, revoke, setHiveEnabled, verifyOwner,
  HIVE_CAPABILITIES,
} from "../hive/store.js";
import { loadHiveHostConfig } from "../hive/tools.js";

export interface HiveCommandResult { exitCode: number; output: string }

const HELP = `
  ltm hive <command> [--path <hive.db>] [--owner-key <key>] [--json]

  Shared memory several agents can opt in to. Closed by default: a new hive is
  disabled, has no members, and a member can do nothing until granted.

  Owner setup:
    init                         Create the hive (disabled); prints the owner key once
    enable | disable             Master switch                                  [owner key]
    agent add <name>             Register an agent; prints its token once       [owner key]
    agent remove <name>          Remove an agent and all its grants             [owner key]
    agent list                   Members and their grants
    grant <agent> <read,write>   Grant capabilities                             [owner key]
    revoke <agent> [read|write]  Revoke one capability, or all                  [owner key]
    requests [--all]             Access requests agents filed
    approve <id> | deny <id>     Decide a request                               [owner key]

  Inspect and write:
    status                       Enabled?, members, memories, pending requests
    audit [--limit N]            Who read, wrote or was refused, newest first
    recall [query] [--project P] [--limit N]
    learn "<text>" [--origin O] [--category C] [--importance N] [--project P]
                                 Owner write (default origin owner-statement)  [owner key]
    archive <id>                 Archive any hive memory                        [owner key]

  Agent side: set LTM_HIVE=1 and LTM_HIVE_TOKEN=<token> (and LTM_HIVE_PATH if not
  the default ~/.openltm/hive/hive.db) in the agent's MCP server environment.
`;

function takeOpt(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v === undefined ? 1 : 2);
  return v;
}

function takeFlag(argv: string[], name: string): boolean {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

export async function runHiveCommand(rawArgv: string[], env: NodeJS.ProcessEnv = process.env): Promise<HiveCommandResult> {
  const argv = [...rawArgv];
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    return { exitCode: argv.length === 0 ? 1 : 0, output: HELP };
  }
  const path = takeOpt(argv, "--path") ?? loadHiveHostConfig(env).path;
  const ownerKey = takeOpt(argv, "--owner-key") ?? env["LTM_HIVE_OWNER_KEY"] ?? null;
  const json = takeFlag(argv, "--json");
  const [cmd, ...rest] = argv;
  const print = (value: unknown, text: string): HiveCommandResult => ({ exitCode: 0, output: json ? JSON.stringify(value, null, 2) : text });

  if (cmd === "init") {
    try {
      const { ownerKey: key } = initHive(path);
      return print({ path, owner_key: key, enabled: false }, [
        `  Hive created at ${path} (disabled, no members).`,
        "",
        `  Owner key (shown once, keep it out of every agent's environment):`,
        `    ${key}`,
        "",
        "  Next: export LTM_HIVE_OWNER_KEY=<key>; ltm hive agent add <name>; ltm hive grant <name> read; ltm hive enable",
      ].join("\n"));
    } catch (err) {
      return fail(err);
    }
  }

  let db: Database;
  try {
    db = openHive(path);
  } catch (err) {
    return fail(err);
  }
  const owner = (): void => verifyOwner(db, ownerKey);
  try {
    switch (cmd) {
      case "status": {
        const s = { path, ...hiveSummary(db) };
        return print(s, [
          `  Hive: ${path}`,
          `  Enabled: ${s.enabled ? "yes" : "no"}   Members: ${s.members}   Memories: ${s.memories}   Pending requests: ${s.pending_requests}`,
        ].join("\n"));
      }
      case "enable":
      case "disable": {
        owner();
        setHiveEnabled(db, cmd === "enable");
        return print({ enabled: cmd === "enable" }, `  Hive ${cmd}d.`);
      }
      case "agent": {
        const [sub, name] = rest;
        if (sub === "list") {
          const rows = listAgents(db);
          return print(rows, rows.length === 0 ? "  No members." : rows.map((r) =>
            `  ${r.name.padEnd(24)} ${r.status.padEnd(8)} ${(r.capabilities.join(",") || "-").padEnd(11)} last seen ${r.last_seen_at ?? "never"}`).join("\n"));
        }
        if (!name) return { exitCode: 1, output: "  ltm hive agent: need add|remove|list and a name" };
        owner();
        if (sub === "add") {
          const { token } = addAgent(db, name);
          return print({ agent: name, token, capabilities: [] }, [
            `  Agent '${name}' registered with no grants.`,
            "",
            "  Token (shown once). Put it in that agent's environment only:",
            `    LTM_HIVE=1 LTM_HIVE_TOKEN=${token}`,
            "",
            `  Then: ltm hive grant ${name} read   (or read,write)`,
          ].join("\n"));
        }
        if (sub === "remove") {
          const ok = removeAgent(db, name);
          return ok ? print({ removed: name }, `  Agent '${name}' removed; its token and grants no longer work.`) : { exitCode: 1, output: `  No active agent '${name}'.` };
        }
        return { exitCode: 1, output: `  ltm hive agent: unknown '${sub}'` };
      }
      case "grant": {
        const [name, caps] = rest;
        if (!name || !caps) return { exitCode: 1, output: `  ltm hive grant <agent> <${HIVE_CAPABILITIES.join(",")}>` };
        owner();
        const now = grant(db, name, parseCapabilities(caps));
        return print({ agent: name, capabilities: now }, `  ${name}: ${now.join(",")}`);
      }
      case "revoke": {
        const [name, caps] = rest;
        if (!name) return { exitCode: 1, output: "  ltm hive revoke <agent> [read|write]" };
        owner();
        const parsed = caps ? parseCapabilities(caps) : [];
        if (caps && parsed.length === 0) return { exitCode: 1, output: `  Unknown capability '${caps}'.` };
        const now = revoke(db, name, parsed);
        return print({ agent: name, capabilities: now }, `  ${name}: ${now.join(",") || "no grants"}`);
      }
      case "requests": {
        const rows = listRequests(db, takeFlag(rest, "--all") ? "all" : "pending");
        return print(rows, rows.length === 0 ? "  No requests." : rows.map((r) =>
          `  #${r.id} ${r.agent} wants ${r.capabilities} [${r.status}] ${r.created_at}${r.reason ? `\n      reason: ${r.reason}` : ""}`).join("\n"));
      }
      case "approve":
      case "deny": {
        const id = Number.parseInt(rest[0] ?? "", 10);
        if (!Number.isInteger(id)) return { exitCode: 1, output: `  ltm hive ${cmd} <request id>` };
        owner();
        const row = decideRequest(db, id, cmd === "approve");
        return print(row, `  Request #${id} ${row.status}.`);
      }
      case "audit": {
        const limit = Number.parseInt(takeOpt(rest, "--limit") ?? "50", 10);
        const rows = readAudit(db, Number.isInteger(limit) ? limit : 50);
        return print(rows, rows.map((r) => `  ${r.ts}  ${r.agent.padEnd(16)} ${r.action.padEnd(16)} ${r.detail}${r.memory_ids ? ` [${r.memory_ids}]` : ""}`).join("\n") || "  Empty.");
      }
      case "recall": {
        const project = takeOpt(rest, "--project");
        const limit = Number.parseInt(takeOpt(rest, "--limit") ?? "10", 10);
        const rows = hiveRecall(db, "owner", { query: rest.join(" ") || null, project, limit: Number.isInteger(limit) ? limit : 10 });
        return print(rows, rows.length === 0 ? "  No hive memories match." : rows.map((m) =>
          `  #${m.id} [${m.category}/${m.origin ?? "?"}] by ${m.author_agent}${m.project_scope ? ` (${m.project_scope})` : ""}: ${m.content}`).join("\n"));
      }
      case "learn": {
        const origin = takeOpt(rest, "--origin");
        const category = takeOpt(rest, "--category");
        const importance = takeOpt(rest, "--importance");
        const project = takeOpt(rest, "--project");
        owner();
        const res = hiveLearn(db, "owner", {
          content: rest.join(" "), origin, category, project, sourceHost: "cli",
          importance: importance === undefined ? null : Number(importance),
        }, true);
        return print(res, res.duplicate ? `  Already in the hive as #${res.id}.` : `  Stored as #${res.id}.`);
      }
      case "archive": {
        const id = Number.parseInt(rest[0] ?? "", 10);
        if (!Number.isInteger(id)) return { exitCode: 1, output: "  ltm hive archive <id>" };
        owner();
        hiveArchive(db, "owner", id, true);
        return print({ archived: id }, `  #${id} archived.`);
      }
      default:
        return { exitCode: 1, output: `  ltm hive: unknown command '${cmd}'\n${HELP}` };
    }
  } catch (err) {
    return fail(err);
  } finally {
    db.close();
  }
}

function fail(err: unknown): HiveCommandResult {
  const msg = err instanceof HiveError ? `${err.code}: ${err.message}` : (err as Error)?.message ?? String(err);
  return { exitCode: 1, output: `  ltm hive: ${msg}` };
}
