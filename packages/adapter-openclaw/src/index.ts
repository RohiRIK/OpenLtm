/**
 * index.ts — OpenClaw plugin entry.
 *
 * OpenClaw runs on Node, and `@rohirik/openltm-core` is Bun code that imports
 * `bun:sqlite`. Importing it directly fails at load time with
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME` (verified against openclaw 2026.9.6), so this
 * adapter never imports core. Instead it spawns the core MCP server as a Bun
 * child process and speaks newline-delimited JSON-RPC over stdio — the same
 * approach as the Pi adapter, and the reason both hosts can share one database.
 *
 * Bun is located at runtime; if it is missing the plugin degrades to tools that
 * return an explanatory error rather than failing the whole load.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";

const BRIDGE_DEPTH_ENV = "LTM_BRIDGE_DEPTH";
const CATEGORIES = ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] as const;

// ── Bun discovery ────────────────────────────────────────────────────────────

function findBun(): string | null {
  const candidates = [
    process.env["BUN_INSTALL"] ? join(process.env["BUN_INSTALL"]!, "bin", "bun") : null,
    join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ].filter((p): p is string => p !== null && existsSync(p));
  if (candidates.length > 0) return candidates[0]!;

  for (const cmd of ["which bun", "command -v bun"]) {
    try {
      const out = execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
      if (out && existsSync(out) && !/\bpi\b/.test(out)) return out;
    } catch {
      // try the next probe
    }
  }
  return null;
}

/** Locate the core CLI entry that can run `mcp-serve`. */
function findMcpServer(): { script: string; args: string[] } | null {
  let entry: string;
  try {
    // Resolve the package's main entry, not `@rohirik/openltm-core/package.json`:
    // core has an `exports` map, and Node (unlike Bun) refuses any subpath it
    // does not list (ERR_PACKAGE_PATH_NOT_EXPORTED).
    entry = createRequire(import.meta.url).resolve("@rohirik/openltm-core");
  } catch {
    return null;
  }
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    const script = resolve(dir, "src", "cli", "bin.ts");
    if (existsSync(script)) return { script, args: ["mcp-serve"] };
  }
  return null;
}

// ── Minimal MCP stdio client ────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

class LtmBridge {
  private child: ReturnType<typeof spawn> | null = null;
  private buffer = "";
  private nextId = 1;
  private ready: Promise<void> | null = null;
  private failed: Error | null = null;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly tools = new Map<string, McpTool>();

  constructor(
    private readonly runtime: string,
    private readonly script: string,
    private readonly args: string[],
    private readonly dbPath: string | undefined,
  ) {}

  start(): void {
    if (this.child) return;
    const depth = Number.parseInt(process.env[BRIDGE_DEPTH_ENV] ?? "0", 10) || 0;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [BRIDGE_DEPTH_ENV]: String(depth + 1),
    };
    if (this.dbPath) env["LTM_DB_PATH"] = this.dbPath;

    this.child = spawn(this.runtime, [this.script, ...this.args], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: { id?: number; result?: unknown; error?: { message: string } };
        try {
          msg = JSON.parse(trimmed) as typeof msg;
        } catch {
          continue;
        }
        if (msg.id === undefined) continue;
        const handler = this.pending.get(msg.id);
        if (!handler) continue;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message));
        else handler.resolve(msg.result);
      }
    });

    const fail = (message: string) => {
      this.failed = new Error(message);
      for (const handler of this.pending.values()) handler.reject(this.failed);
      this.pending.clear();
    };
    this.child.on("error", () => fail("OpenLTM bridge failed to start (is Bun installed?)"));
    this.child.on("exit", () => fail("OpenLTM bridge exited unexpectedly"));
  }

  private send(method: string, params?: unknown, id?: number): void {
    this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  }

  private request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenLTM bridge timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolvePromise(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send(method, params, id);
    });
  }

  /** Handshake once, lazily. Repeated calls reuse the same promise. */
  init(): Promise<void> {
    if (this.ready) return this.ready;
    this.start();
    this.ready = (async () => {
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "openclaw-ltm", version: "1.0.0" },
      });
      this.send("notifications/initialized");
      const result = (await this.request("tools/list")) as { tools?: McpTool[] };
      for (const tool of result?.tools ?? []) this.tools.set(tool.name, tool);
    })();
    return this.ready;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    await this.init();
    const result = (await this.request("tools/call", { name, arguments: args }, 60_000)) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result?.content ?? [])
      .filter((c) => c?.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
    if (result?.isError) throw new Error(text || `${name} failed`);
    return text;
  }

  async callJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return JSON.parse(await this.call(name, args)) as T;
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

interface OpenLtmConfig {
  autoRecall?: boolean;
  prefillLines?: number;
  dbPath?: string;
}

interface MemoryHit {
  id: number;
  content: string;
  category: string;
  importance: number;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export default definePluginEntry({
  id: "openltm",
  name: "OpenLTM Memory",
  description:
    "Long-term memory for OpenClaw agents in a local SQLite database: FTS5 search, optional vector recall, importance-weighted decay, and a memory graph.",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      autoRecall: { type: "boolean" },
      prefillLines: { type: "number", minimum: 4, maximum: 200 },
      dbPath: { type: "string" },
    },
  },

  register(api) {
    const readConfig = (): OpenLtmConfig => (api.pluginConfig as OpenLtmConfig | undefined) ?? {};

    let bridge: LtmBridge | null = null;
    let bridgeError: string | null = null;

    const getBridge = (): LtmBridge => {
      if (bridge) return bridge;
      const dbPath = readConfig().dbPath;
      const runtime = findBun();
      const server = findMcpServer();
      if (!runtime) {
        bridgeError = "Bun was not found on PATH. OpenLTM stores memory in a local SQLite database and needs the Bun runtime; install Bun from https://bun.sh";
        throw new Error(bridgeError);
      }
      if (!server) {
        bridgeError = "Could not resolve @rohirik/openltm-core. Reinstall the OpenLTM plugin so its memory engine is present.";
        throw new Error(bridgeError);
      }
      bridge = new LtmBridge(runtime, server.script, server.args, dbPath);
      return bridge;
    };

    // A missing engine is reported, never papered over: an empty fallback made
    // recall answer "No memories found." when nothing could be searched at all.
    const run = async <T>(fn: (b: LtmBridge) => Promise<T>): Promise<T> => {
      try {
        return await fn(getBridge());
      } catch (err) {
        if (!bridgeError) api.logger.warn(`openltm: ${String(err)}`);
        throw err;
      }
    };

    const tool = (
      name: string,
      label: string,
      description: string,
      parameters: unknown,
      handler: (params: Record<string, unknown>) => Promise<unknown>,
    ) => {
      api.registerTool({
        name,
        label,
        description,
        parameters: parameters as never,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            return await handler(params);
          } catch (err) {
            return textResult(`openltm: ${String(err)}`);
          }
        },
      } as never);
    };

    const projectOf = (explicit: unknown): string => {
      const given = typeof explicit === "string" && explicit.trim() ? explicit : "";
      if (given) return given;
      return process.cwd().replace(/\/$/, "").split("/").pop() ?? "";
    };

    // ── Auto-recall ────────────────────────────────────────────────────────
    const prefill = async (): Promise<string[]> => {
      const cfg = readConfig();
      if (cfg.autoRecall === false) return [];
      const budget = Math.max(4, Math.min(200, cfg.prefillLines ?? 18));
      const hits = await getBridge().callJson<MemoryHit[]>("recall", {
        project: projectOf(undefined),
        limit: Math.min(50, budget - 1),
      });
      if (hits.length === 0) return [];
      return [
        "## Prior Knowledge (LTM)",
        ...hits.slice(0, budget - 1).map((m) => `- (${m.category}) ${m.content.replace(/\s+/g, " ").slice(0, 200)}`),
      ];
    };
    const prefillOrNothing = async (): Promise<string[]> => {
      try {
        return await prefill();
      } catch (err) {
        api.logger.warn(`openltm: prefill unavailable: ${String(err)}`);
        return [];
      }
    };

    if (api.registerMemoryPromptPreparation) {
      // The host awaits preparations before building the prompt, so the block
      // is current on every turn, including the first.
      api.registerMemoryPromptPreparation(prefillOrNothing);
    } else if (api.registerMemoryPromptSupplement) {
      // Older hosts only offer a synchronous builder: serve the last prepared
      // block and refresh it in the background for the next turn.
      let cached: string[] = [];
      api.registerMemoryPromptSupplement(() => {
        if (readConfig().autoRecall === false) return [];
        void prefillOrNothing().then((lines) => {
          cached = lines;
        });
        return cached;
      });
    }

    // ── Tools ──────────────────────────────────────────────────────────────

    tool(
      "openltm_recall",
      "OpenLTM Recall",
      "Search long-term memory by meaning. Call before any non-trivial task to surface past decisions, preferences, and gotchas.",
      Type.Object({
        query: Type.Optional(Type.String({ description: "Search query" })),
        project: Type.Optional(Type.String({ description: "Project scope" })),
        category: Type.Optional(
          Type.Union(CATEGORIES.map((c) => Type.Literal(c)), { description: "Restrict to one category" }),
        ),
        limit: Type.Optional(Type.Integer({ description: "Max results (default 10)", minimum: 1, maximum: 50 })),
      }),
      async (params) => {
        const results = await run(
          (b) =>
            b.callJson<MemoryHit[]>("recall", {
              query: params["query"],
              project: params["project"],
              category: params["category"],
              limit: params["limit"],
            }),
        );
        if (results.length === 0) return textResult("No memories found.");
        return textResult(
          results
            .map((m) => `- [${m.id}] (${m.category}/${m.importance}) ${m.content.slice(0, 300)}`)
            .join("\n"),
        );
      },
    );

    tool(
      "openltm_learn",
      "OpenLTM Learn",
      "Store or reinforce a durable memory. Call after discovering a non-obvious pattern, gotcha, or architectural decision. Skip facts derivable from code or git history.",
      Type.Object({
        content: Type.String({ description: "The insight to store" }),
        title: Type.Optional(Type.String({ description: "Concise noun-phrase label (max 60 chars)", maxLength: 60 })),
        category: Type.Optional(Type.Union(CATEGORIES.map((c) => Type.Literal(c)))),
        importance: Type.Optional(Type.Integer({ description: "1-5, where 5 never decays", minimum: 1, maximum: 5 })),
        project: Type.Optional(Type.String({ description: "Project scope" })),
      }),
      async (params) =>
        run(
          async (b) =>
            textResult(
              await b.call("learn", {
                content: params["content"],
                title: params["title"],
                category: params["category"],
                importance: params["importance"],
                project: params["project"],
              }),
            ),
        ),
    );

    tool(
      "openltm_forget",
      "OpenLTM Forget",
      "Delete a memory by id. Call when a memory is wrong, outdated, or the user asks for removal.",
      Type.Object({
        id: Type.Integer({ description: "Memory id to delete" }),
        reason: Type.Optional(Type.String({ description: "Why it is being removed" })),
      }),
      async (params) =>
        run(
          async (b) => textResult(await b.call("forget", { id: params["id"], reason: params["reason"] })),
        ),
    );

    tool(
      "openltm_context",
      "OpenLTM Context",
      "Restore project context: goals, decisions, and gotchas. Call at session start or when switching projects.",
      Type.Object({ project: Type.Optional(Type.String({ description: "Project name; defaults to the working directory" })) }),
      async (params) =>
        run(
          async (b) => textResult(await b.call("context", { project: projectOf(params["project"]) })),
        ),
    );

    tool(
      "openltm_relate",
      "OpenLTM Relate",
      "Link two memories with a typed relationship when they connect.",
      Type.Object({
        source_id: Type.Integer(),
        target_id: Type.Integer(),
        relationship_type: Type.Union(
          ["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"].map((r) =>
            Type.Literal(r),
          ),
        ),
      }),
      async (params) =>
        run(
          async (b) =>
            textResult(
              await b.call("relate", {
                source_id: params["source_id"],
                target_id: params["target_id"],
                relationship_type: params["relationship_type"],
              }),
            ),
        ),
    );

    tool(
      "openltm_graph",
      "OpenLTM Graph",
      "Traverse the memory graph from a starting memory to trace decision chains and find related memories.",
      Type.Object({
        memory_id: Type.Integer({ description: "Starting memory id" }),
        depth: Type.Optional(Type.Integer({ description: "Traversal depth (default 2, max 4)", minimum: 1, maximum: 4 })),
      }),
      async (params) =>
        run(
          async (b) =>
            textResult(await b.call("graph", { memory_ids: [params["memory_id"]], depth: params["depth"] ?? 2 })),
        ),
    );

    tool(
      "openltm_brain_stats",
      "OpenLTM Stats",
      "Get memory statistics: totals, category spread, and importance distribution.",
      Type.Object({}),
      async () =>
        run(async (b) => {
          const hits = await b.callJson<MemoryHit[]>("recall", { limit: 50 });
          const byCategory = new Map<string, number>();
          for (const h of hits) byCategory.set(h.category, (byCategory.get(h.category) ?? 0) + 1);
          return textResult(
            JSON.stringify({
              sampled: hits.length,
              byCategory: Object.fromEntries(byCategory),
            }),
          );
        }),
    );

    tool(
      "openltm_stale",
      "OpenLTM Stale",
      "List memories flagged as stale by code changes, or clear the flag after review.",
      Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("clear")], {
          description: "List stale memories, or clear a flag",
        }),
        memory_id: Type.Optional(Type.Integer({ description: "Required when action is 'clear'" })),
        reason: Type.Optional(Type.String({ description: "Why the memory is stale" })),
      }),
      async (params) =>
        run(
          async (b) => {
            if (params["action"] === "clear") {
              if (params["memory_id"] === undefined) {
                return textResult("openltm: memory_id is required when action is 'clear'");
              }
              return textResult(
                await b.call("revalidate", { memory_id: params["memory_id"], reason: params["reason"] }),
              );
            }
            const hits = await b.callJson<Array<{ id: number; stale?: boolean }>>("recall", { limit: 50 });
            const stale = hits.filter((h) => h.stale);
            return textResult(stale.length === 0 ? "No stale memories." : JSON.stringify(stale));
          },
        ),
    );

    api.logger.info("openltm: registered (Bun-backed local SQLite memory)");
  },
});
