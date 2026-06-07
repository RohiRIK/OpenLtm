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
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";

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

function findMcpServer(): string | null {
  // 1. Plugin cache — newest version first (Claude Code users)
  const cacheBase = join(homedir(), ".claude", "plugins", "cache", "ltm", "ltm");
  if (existsSync(cacheBase)) {
    try {
      const versions = readdirSync(cacheBase)
        .filter((v) => /^\d/.test(v))
        .sort()
        .reverse();
      for (const v of versions) {
        const s = join(cacheBase, v, "src", "mcp-server.ts");
        if (existsSync(s)) return s;
      }
    } catch {
      // continue to next strategy
    }
  }
  // 2. openltm-core package (if mcp-server is added in a future version)
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve("@rohirik/openltm-core/package.json");
    const script = resolve(dirname(pkgJson), "src", "mcp-server.ts");
    if (existsSync(script)) return script;
  } catch {
    // not available
  }
  return null;
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
  ) {}

  start(): void {
    if (this.child) return;
    const depth = parseInt(process.env[BRIDGE_DEPTH_ENV] ?? "0", 10);
    const env = { ...process.env, [BRIDGE_DEPTH_ENV]: String(depth + 1) };

    this.child = spawn(this.runtime, [this.script], { stdio: ["pipe", "pipe", "pipe"], env });

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
  const script = findMcpServer();
  if (!bun || !script) return; // degrade gracefully — no bun or server found

  const client = new LtmMcpClient(bun, script);
  client.start();

  // Bootstrap runs async — tools are registered once handshake completes.
  // Pi allows registerTool after extension load; before_agent_start awaits ready.
  const ready = (async () => {
    await client.initialize();
    const tools = await client.listTools();
    for (const tool of tools) {
      const name = tool.name;
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
      const project = cwd.replace(/\/$/, "").split("/").pop() ?? "";
      const text = await client.callTool("ltm_recall", { project, limit: 8, sort_by: "relevance" });
      if (!text || text === "[]") return;
      const block = `## Prior Knowledge (LTM)\n\n${text}\n`;
      const existing = String(ev?.systemPrompt ?? "");
      return { systemPrompt: existing ? `${existing}\n\n${block}` : block };
    } catch {
      // non-fatal
    }
  });
}
