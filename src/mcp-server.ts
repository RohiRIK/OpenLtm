/**
 * mcp-server.ts — LTM MCP Server (STDIO transport)
 * Exposes the Long-Term Memory system as a proper MCP server.
 * IMPORTANT: Never use console.log() — STDIO transport uses stdout for protocol.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./shared-db.js";
import { learn, recall, relate, forget, getContextMerge, type Memory } from "./db.js";
import { getItems } from "./context.js";
import { traverseGraph, buildReasoningContext } from "./graph.js";

// ─── Config check ────────────────────────────────────────────────────────────

async function isEnabled(): Promise<boolean> {
  try {
    const { readConfigSync } = await import("./config.js");
    const cfg = readConfigSync() as Record<string, unknown>;
    const mcp = cfg["mcp"] as { enabled?: boolean } | undefined;
    return mcp?.enabled !== false; // default true if not set
  } catch {
    return true;
  }
}

// Strip embedding blob before sending over MCP — it serializes as {"0":59,...} ~260KB per memory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function strip(obj: any): any {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === "object") {
    const { embedding: _e, ...rest } = obj;
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, strip(v)]));
  }
  return obj;
}

/** Compact formatter — strips verbose fields and truncates content to keep MCP responses small. */
function compact(memories: any[]): any[] {
  const MAX_CONTENT = 300;
  return memories.map(m => ({
    id: m.id,
    content: m.content?.length > MAX_CONTENT ? m.content.slice(0, MAX_CONTENT) + "…" : m.content,
    category: m.category,
    importance: m.importance,
    tags: m.tags,
    project_scope: m.project_scope,
    ...(m.relations?.length > 0 && {
      relations: m.relations.map((r: any) => ({
        id: r.memory?.id,
        type: r.relationship_type,
        dir: r.direction,
      })),
    }),
  }));
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "ltm", version: "1.0.0" },
  {},
);

// ─── Tools ───────────────────────────────────────────────────────────────────

server.tool(
  "ltm_recall",
  "MUST call before any non-trivial task to surface past decisions, gotchas, and patterns. Searches long-term memories by query, category, project scope, or tags. Also call when starting work on any unfamiliar area.",
  {
    query: z.string().optional().describe("Full-text search query"),
    project: z.string().optional().describe("Filter by project scope"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
    category: z.enum(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).optional(),
    verbose: z.boolean().optional().describe("Return full memory objects (default false — returns compact format to save context)"),
  },
  async ({ query, project, limit, category, verbose }) => {
    const results = await recall({ query, project, limit, category });
    const payload = verbose ? strip(results) : compact(strip(results));
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  },
);

server.tool(
  "ltm_learn",
  "MUST call after discovering a non-obvious pattern, gotcha, or architectural decision. Stores or reinforces a memory. Call whenever you learn something worth preserving across sessions.",
  {
    content: z.string().describe("The insight, pattern, or decision to store"),
    category: z.enum(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]),
    importance: z.number().int().min(1).max(5).optional().describe("Importance 1-5 (default 3, 5=never decays)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    project: z.string().optional().describe("Scope to a specific project"),
  },
  async ({ content, category, importance, tags, project }) => {
    const result = learn({
      content,
      category,
      importance,
      tags,
      project_scope: project,
    });

    try {
      server.server.notification({
        method: "notifications/message",
        params: { level: "info", logger: "ltm", data: `memory_stored: id=${result.id} category=${category} importance=${importance ?? 3} action=${result.action}` },
      });
    } catch { /* notifications not supported by this client — ignore */ }

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool(
  "ltm_relate",
  "Call when two memories are linked — e.g. a decision caused a gotcha, or a pattern applies to an architecture. Creates a typed relationship between two memories.",
  {
    source_id: z.number().int(),
    target_id: z.number().int(),
    relationship_type: z.enum(["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"]),
  },
  async ({ source_id, target_id, relationship_type }) => {
    relate({ source_id, target_id, relationship_type });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  },
);

server.tool(
  "ltm_forget",
  "Call when a memory is wrong, outdated, or the user requests removal. Deletes a memory by ID and cascades to its relations.",
  {
    id: z.number().int(),
    reason: z.string().optional().describe("Why this memory is being removed"),
  },
  async ({ id, reason }) => {
    forget({ id, reason });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, id, reason }) }] };
  },
);

server.tool(
  "ltm_context",
  "MUST call at session start or when switching projects to restore goals, decisions, and gotchas. Returns merged context (globals + project-scoped memories).",
  {
    project: z.string().describe("Project name from registry"),
  },
  async ({ project }) => {
    const result = getContextMerge(project);
    return { content: [{ type: "text", text: JSON.stringify(strip(result)) }] };
  },
);

server.tool(
  "ltm_graph",
  "Call when exploring connections between memories or tracing decision chains. Traverses the memory graph from seed nodes and builds a reasoning context.",
  {
    memory_ids: z.array(z.number().int()).min(1).describe("Starting memory IDs for traversal"),
    depth: z.number().int().min(1).max(4).optional().describe("Traversal depth (default 2)"),
  },
  async ({ memory_ids, depth = 2 }) => {
    const results = await Promise.allSettled(
      memory_ids.map((id) => traverseGraph(id, depth, false)),
    );

    const blocks: string[] = [];
    let totalNodes = 0;
    let totalEdges = 0;

    for (const r of results) {
      if (r.status === "fulfilled") {
        const block = buildReasoningContext(r.value);
        totalNodes += r.value.chain.length;
        totalEdges += r.value.reinforcements.length + r.value.conflicts.length;
        if (block) blocks.push(block);
      }
    }

    try {
      server.server.notification({
        method: "notifications/message",
        params: { level: "info", logger: "ltm", data: `graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}` },
      });
    } catch { /* notifications not supported by this client — ignore */ }

    return { content: [{ type: "text", text: blocks.join("\n\n") || "No reasoning context found." }] };
  },
);

server.tool(
  "ltm_context_items",
  "Call when you need to list specific context types — goals, decisions, progress, or gotchas — for a project. Returns structured context items.",
  {
    project: z.string().describe("Project name from registry"),
    type: z.enum(["goal", "decision", "progress", "gotcha"]).optional(),
  },
  async ({ project, type }) => {
    const items = getItems(project, type);
    return { content: [{ type: "text", text: JSON.stringify(items) }] };
  },
);

// ─── Resources ───────────────────────────────────────────────────────────────

server.resource(
  "memory://globals",
  "memory://globals",
  { description: "All importance=5 global memories (never decay)" },
  async () => {
    const db = getDb();
    const rows = db.query<Memory, []>(
      `SELECT * FROM memories WHERE importance = 5 AND project_scope IS NULL AND status = 'active' ORDER BY created_at DESC`,
    ).all();
    return { contents: [{ uri: "memory://globals", text: JSON.stringify(strip(rows)), mimeType: "application/json" }] };
  },
);

server.resource(
  "memory://recent",
  "memory://recent",
  { description: "Last 20 memories across all projects" },
  async () => {
    const db = getDb();
    const rows = db.query<Memory, []>(
      `SELECT * FROM memories WHERE status = 'active' ORDER BY created_at DESC LIMIT 20`,
    ).all();
    return { contents: [{ uri: "memory://recent", text: JSON.stringify(strip(rows)), mimeType: "application/json" }] };
  },
);

server.resource(
  "memory://tags",
  "memory://tags",
  { description: "All unique tags with usage counts" },
  async () => {
    const db = getDb();
    const rows = db.query<{ name: string; count: number }, []>(
      `SELECT t.name, COUNT(mt.memory_id) as count FROM tags t
       JOIN memory_tags mt ON t.id = mt.tag_id
       GROUP BY t.id ORDER BY count DESC`,
    ).all();
    return { contents: [{ uri: "memory://tags", text: JSON.stringify(strip(rows)), mimeType: "application/json" }] };
  },
);

const projectTemplate = new ResourceTemplate("memory://project/{name}", { list: undefined });
server.resource(
  "memory://project/{name}",
  projectTemplate,
  { description: "All active memories scoped to a specific project" },
  async (uri, { name }) => {
    const projectName = (Array.isArray(name) ? name[0] : name) ?? "";
    const db = getDb();
    const rows = db.query<Memory, [string]>(
      `SELECT * FROM memories WHERE project_scope = ? AND status = 'active' ORDER BY importance DESC, created_at DESC`,
    ).all(projectName);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(strip(rows), null, 2),
        mimeType: "application/json",
      }],
    };
  },
);

// ─── Prompts ─────────────────────────────────────────────────────────────────

server.prompt(
  "recall_before_task",
  "Before starting a task, recall relevant memories and past decisions",
  { topic: z.string().describe("The topic or task you are about to work on") },
  ({ topic }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Before starting work on "${topic}", use the ltm_recall tool to search for relevant memories, past decisions, and gotchas related to this topic. Summarize what you find and note any decisions that should be followed.`,
      },
    }],
  }),
);

server.prompt(
  "learn_after_session",
  "Extract learnable patterns and insights from a session summary",
  { summary: z.string().describe("Summary of the session or work done") },
  ({ summary }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Extract learnable patterns, gotchas, and architectural decisions from this session summary. For each insight, use ltm_learn to store it with the appropriate category and importance.\n\nSession summary:\n${summary}`,
      },
    }],
  }),
);

server.prompt(
  "graph_reason",
  "Use graph traversal to reason about a question using connected memories",
  { question: z.string().describe("The question or topic to reason about") },
  ({ question }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Use ltm_recall to find memories related to "${question}", then use ltm_graph on the top result IDs to traverse connected memories. Synthesize the chain of reasoning, conflicts, and reinforcements into a coherent answer.`,
      },
    }],
  }),
);

// ─── Start ────────────────────────────────────────────────────────────────────

process.on("unhandledRejection", (err) => {
  process.stderr.write(`[ltm-mcp] Unhandled rejection: ${err}\n`);
});

async function main() {
  if (!(await isEnabled())) {
    process.stderr.write("[ltm-mcp] mcp.enabled=false — server disabled\n");
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[ltm-mcp] LTM MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[ltm-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
