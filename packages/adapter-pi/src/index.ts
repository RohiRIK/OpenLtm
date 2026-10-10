/**
 * Pi extension entry point.
 *
 * Pi loads extensions with Node.js, not Bun — so bun:sqlite is unavailable.
 * We bridge LTM tools by spawning the openltm-core MCP server as a Bun child
 * process and proxying calls via newline-delimited JSON-RPC (MCP stdio transport).
 *
 * Pattern adapted from context-mode's Pi adapter (MIT).
 */
import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { findCoreCli } from "./find-core.js";
// Relative import so esbuild inlines the Node-safe resolver into dist (core itself is external).
import { dataDirFor, legacyLastSegment, loadProjectRegistry, resolveProjectName } from "../../openltm-core/src/project.js";

// ── Fork-bomb prevention ──────────────────────────────────────────────────────

const BRIDGE_DEPTH_ENV = "LTM_BRIDGE_DEPTH";

// ── Runtime discovery ─────────────────────────────────────────────────────────

function findBun(): string | null {
  const candidates = [
    process.env["BUN_INSTALL"] ? join(process.env["BUN_INSTALL"]!, "bin", "bun") : null,
    join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ].filter((p): p is string => p !== null && existsSync(p));

  if (candidates.length > 0) return candidates[0]!;

  // PATH fallback — try `which` which works even from Node.js
  for (const cmd of ["which bun", "command -v bun"]) {
    try {
      const out = execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
      if (out && existsSync(out) && !/\bpi\b/.test(out)) return out;
    } catch {
      // try next
    }
  }
  return null;
}

/** Compare dotted versions numerically ("2.17.0" > "2.9.3"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface McpServerLocation {
  script: string;
  args: string[];
  /** DB the server must open — passed to it as LTM_DB_PATH so naming and storage agree. */
  dbPath: string | null;
}

function findMcpServer(): McpServerLocation | null {
  const explicitDb = process.env["LTM_DB_PATH"] || null;
  // 1. Claude Code plugin cache — newest version first. Share Claude Code's
  //    database (its plugin data dir) so both agents see the same memories.
  const claudeDir = join(homedir(), ".claude", "plugins");
  for (const [marketplace, plugin, dataDirName] of [["OpenLtm", "openltm", "OpenLtm-openltm"], ["ltm", "ltm", "ltm-ltm"]] as const) {
    const cacheBase = join(claudeDir, "cache", marketplace, plugin);
    if (!existsSync(cacheBase)) continue;
    try {
      const versions = readdirSync(cacheBase).filter((v) => /^\d/.test(v)).sort(compareVersions).reverse();
      for (const v of versions) {
        const script = join(cacheBase, v, "src", "mcp-server.ts");
        if (existsSync(script)) {
          return { script, args: [], dbPath: explicitDb ?? join(claudeDir, "data", dataDirName, "openltm.db") };
        }
      }
    } catch {
      // continue to next strategy
    }
  }
  // 2. openltm-core package — run the packaged CLI entrypoint with mcp-serve
  const core = findCoreCli(import.meta.url);
  if (!core) return null;
  const dbPath = explicitDb
    ?? (process.env["CLAUDE_PLUGIN_DATA"] ? join(process.env["CLAUDE_PLUGIN_DATA"]!, "openltm.db") : null)
    ?? join(dirname(core.script), "..", "..", "..", "..", "data", "openltm.db");
  return { ...core, dbPath };
}

// ── Minimal MCP stdio client ──────────────────────────────────────────────────

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

class LtmMcpClient {
  private child: ReturnType<typeof spawn> | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private nextId = 1;
  private exited = false;

  constructor(
    private readonly runtime: string,
    private readonly script: string,
    private readonly args: string[] = [],
    private readonly extraEnv: Record<string, string> = {},
  ) {}

  start(): void {
    if (this.child) return;
    const depth = parseInt(process.env[BRIDGE_DEPTH_ENV] ?? "0", 10);
    const env = { ...process.env, ...this.extraEnv, [BRIDGE_DEPTH_ENV]: String(depth + 1) };

    this.child = spawn(this.runtime, [this.script, ...this.args], { stdio: ["pipe", "pipe", "pipe"], env });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } };
          if (msg.id !== undefined) {
            const handler = this.pending.get(msg.id);
            if (handler) {
              this.pending.delete(msg.id);
              if (msg.error) handler.reject(new Error(msg.error.message));
              else handler.resolve(msg.result);
            }
          }
        } catch {
          // ignore malformed lines
        }
      }
    });

    this.child.on("exit", () => {
      this.exited = true;
      for (const h of this.pending.values()) h.reject(new Error("LTM MCP server exited"));
      this.pending.clear();
    });
    this.child.on("error", () => {
      this.exited = true;
      for (const h of this.pending.values()) h.reject(new Error("LTM MCP server error"));
      this.pending.clear();
    });
  }

  private send(method: string, params?: unknown, id?: number): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    this.child?.stdin?.write(msg);
  }

  private request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LTM MCP timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.send(method, params, id);
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-ltm-bridge", version: "1.0.0" },
    });
    this.send("notifications/initialized");
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.request("tools/list") as { tools?: MCPTool[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args }, 60_000) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result?.content ?? [])
      .filter((c) => c?.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
    if (result?.isError) throw new Error(text || `${name} returned an error`);
    return text;
  }
}

// ── Extension entry point ─────────────────────────────────────────────────────

function formatContextPayload(project: string, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      globals?: Array<{ id: number; content: string }>;
      scoped?: Array<{ id: number; content: string }>;
    };
    const globals = Array.isArray(parsed.globals) ? parsed.globals : [];
    const scoped = Array.isArray(parsed.scoped) ? parsed.scoped : [];
    if (globals.length === 0 && scoped.length === 0) return "";

    const lines: string[] = ["## Prior Knowledge (LTM)", ""];
    if (globals.length > 0) {
      lines.push("Global:");
      for (const m of globals.slice(0, 3)) lines.push(`- [${m.id}] ${String(m.content).replace(/\s+/g, " ").trim()}`);
      lines.push("");
    }
    if (scoped.length > 0) {
      lines.push(`Project (${project}):`);
      for (const m of scoped.slice(0, 7)) lines.push(`- [${m.id}] ${String(m.content).replace(/\s+/g, " ").trim()}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
  } catch {
    return "";
  }
}

/**
 * Shared resolver (registry → repo root → cwd basename), memoised per cwd. Pi used
 * the raw cwd basename before unified identity; that name is kept while it is
 * the only one with rows, so no memory is orphaned.
 */
const projectCache = new Map<string, string>();
function projectOf(cwd: string, dbPath: string | null): string {
  let name = projectCache.get(cwd);
  if (name === undefined) {
    name = resolveProjectName(cwd, {
      registry: dbPath ? loadProjectRegistry(join(dataDirFor(dbPath), "projects", "registry.json")) : null,
      legacyName: legacyLastSegment(cwd),
      legacyScope: "all",
      dbPath,
    });
    projectCache.set(cwd, name);
  }
  return name;
}

export default function ltmExtension(pi: unknown): void {
  const p = pi as {
    registerTool: (def: {
      name: string; label: string; description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
    }) => void;
    on: (event: string, handler: (...args: unknown[]) => unknown) => void;
  };

  // Guard: skip if already inside a spawned bridge child
  if (parseInt(process.env[BRIDGE_DEPTH_ENV] ?? "0", 10) > 0) return;

  const bun = findBun();
  const server = findMcpServer();
  if (!bun || !server) return; // degrade gracefully — no bun or server found

  const client = new LtmMcpClient(bun, server.script, server.args, server.dbPath ? { LTM_DB_PATH: server.dbPath } : {});
  client.start();

  // Bootstrap runs async — tools are registered once handshake completes.
  // Pi allows registerTool after extension load; before_agent_start awaits ready.
  const toolNames = new Set<string>();
  const ready = (async () => {
    await client.initialize();
    const tools = await client.listTools();
    for (const tool of tools) {
      const name = tool.name;
      toolNames.add(name);
      p.registerTool({
        name,
        label: name,
        description: tool.description ?? "",
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const text = await client.callTool(name, params ?? {});
          return { content: [{ type: "text", text }], details: {} };
        },
      });
    }
  })().catch(() => {});

  // Inject relevant memories — wait for bootstrap so tools are live first
  p.on("before_agent_start", async (event: unknown) => {
    await ready;
    const ev = event as { cwd?: string; systemPrompt?: string } | null;
    try {
      const cwd = String(ev?.cwd ?? process.cwd());
      const project = projectOf(cwd, server.dbPath);
      const toolName = toolNames.has("context") ? "context" : (toolNames.has("recall") ? "recall" : "");
      if (!toolName) return;
      const text = toolName === "context"
        ? await client.callTool("context", { project })
        : await client.callTool("recall", { project, limit: 8, sort_by: "relevance" });
      const block = toolName === "context"
        ? formatContextPayload(project, text)
        : `## Prior Knowledge (LTM)\n\n${text}\n`;
      if (!block.trim()) return;
      const existing = String(ev?.systemPrompt ?? "");
      return { systemPrompt: existing ? `${existing}\n\n${block}` : block };
    } catch {
      // non-fatal
    }
  });

  // Record the compaction summary as a progress item for the project. Raw
  // summaries are too noisy to store as memories.
  p.on("session_compact", async (event: unknown) => {
    await ready;
    const ev = event as { cwd?: string; summary?: string } | null;
    try {
      const summary = String(ev?.summary ?? "").replace(/\s+/g, " ").trim();
      if (summary.length <= 50 || !toolNames.has("context_add")) return;
      const today = new Date().toISOString().split("T")[0];
      await client.callTool("context_add", {
        type: "progress",
        content: `✓ [${today}] Compacted: ${summary.slice(0, 300)}`,
        project: projectOf(String(ev?.cwd ?? process.cwd()), server.dbPath),
      });
    } catch {
      // non-fatal
    }
  });
}
