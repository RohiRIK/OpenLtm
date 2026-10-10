/**
 * mcp/server.ts — LTM MCP Server (STDIO transport), packaged.
 *
 * The full MCP server lives here so any MCP-capable host can run it via
 * `bunx @rohirik/openltm-core mcp-serve` — not only the Claude Code plugin.
 * The plugin's repo-root src/mcp-server.ts is a thin wrapper around this
 * module that injects config from the plugin's config file.
 *
 * IMPORTANT: Never use console.log() — STDIO transport uses stdout for protocol.
 */
import { readFileSync } from "fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { learn, recall, getMemoryById, relate, forget, revalidate, getContextMerge, type Memory } from "../db.js";
import { getDb, waitForInit } from "../shared-db.js";
import { queryAudit } from "../dao/provenanceAudit.js";
import { getItems, type ContextType } from "../context.js";
import { upsertGoal, addDecision, addGotcha, appendProgress } from "../dao/contextItems.js";
import { writeQueue } from "../lib/writeQueue.js";
import { listPendingProposals, acceptProposal, rejectProposal } from "../proposals.js";
import { traverseGraph, buildReasoningContext } from "../graph.js";
import { categorise } from "../recall/categorise.js";
import { scrubForEgress } from "../secretsScrubber.js";
import { hasPrivateTag, notPrivateSql } from "../privacy.js";

// ─── Options ─────────────────────────────────────────────────────────────────

export interface McpServerOptions {
  /** Host hook: return false to disable the server (e.g. config mcp.enabled=false). Default: enabled. */
  isEnabled?: () => Promise<boolean>;
  /** Host hook: confidence threshold for auto-categorisation (default 0.6). */
  categoriseThreshold?: () => Promise<number>;
  /**
   * Host hook: the project to use when a context tool is called without
   * `project` (e.g. the registry name for the server's cwd). Without it, those
   * calls return an error asking the model to pass `project`.
   */
  defaultProject?: () => string | Promise<string>;
}

/** Server version = the published @rohirik/openltm-core version (src/mcp/ → package root). */
export const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Scrub string content fields before MCP egress (fail-closed). */
function scrubContentField(value: unknown): unknown {
  return typeof value === "string" ? scrubForEgress(value) : value;
}

function scrubMemoryPayload(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(scrubMemoryPayload);
  if (!obj || typeof obj !== "object") return obj;
  const mem = obj as Record<string, unknown>;
  const out: Record<string, unknown> = { ...mem };
  if (typeof out.content === "string") out.content = scrubForEgress(out.content);
  if (typeof out.title === "string") out.title = scrubForEgress(out.title);
  return out;
}

/** Compact formatter — strips verbose fields and truncates content to keep MCP responses small. */
function compact(memories: unknown[]): unknown[] {
  const MAX_CONTENT = 300;
  return memories.map(m => {
    const mem = m as Record<string, unknown>;
    const raw = scrubContentField(mem.content);
    const content = typeof raw === "string" && raw.length > MAX_CONTENT
      ? raw.slice(0, MAX_CONTENT) + "…"
      : raw;
    const relations = Array.isArray(mem.relations) && mem.relations.length > 0
      ? { relations: mem.relations.map((r: Record<string, unknown>) => ({ id: (r.memory as Record<string, unknown>)?.id, type: r.relationship_type, dir: r.direction })) }
      : {};
    const exp = mem.explainer as Record<string, unknown> | undefined;
    const score = exp
      ? { temperature: exp.temperature, score: typeof exp.totalScore === "number" ? Math.round(exp.totalScore * 100) / 100 : undefined }
      : {};
    return { id: mem.id, content, category: mem.category, importance: mem.importance, tags: mem.tags, project_scope: mem.project_scope, ...score, ...relations };
  });
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const NO_PROJECT_MESSAGE =
  "No project given and the server could not infer one from its working directory. " +
  "Pass `project` — the LTM project name (see the SessionStart context banner or ~/.claude/projects/registry.json).";

/** Progress lines `context` returns (most recent last), like SessionStart's summary. */
const CONTEXT_RECENT_PROGRESS = 5;

/** Proposal session ids are file stems in the proposals dir — never allow a path. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** context_add writers — the same DAO calls the hooks use (UpdateContext, onboarding). */
const CONTEXT_WRITERS: Record<ContextType, (project: string, content: string) => unknown> = {
  goal: upsertGoal,
  decision: addDecision,
  gotcha: addGotcha,
  progress: (project, content) => appendProgress(project, content),
};

// ─── Server factory ──────────────────────────────────────────────────────────

/** Build the LTM MCP server with all tools, resources, and prompts registered. */
export function buildMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "openltm", version: SERVER_VERSION },
    // `logging` lets learn/graph send notifications/message; without it the SDK rejects them.
    { capabilities: { logging: {} } },
  );

  /** Best-effort log notification — never fails a tool call (the promise is not awaited). */
  const notify = (data: string): void => {
    void server.server.sendLoggingMessage({ level: "info", logger: "ltm", data }).catch(() => { /* client gone or not listening */ });
  };

  /** Explicit `project`, else the host's default project, else null. */
  async function resolveProjectArg(project: string | undefined): Promise<string | null> {
    const explicit = project?.trim();
    if (explicit) return explicit;
    if (!options.defaultProject) return null;
    try {
      return (await options.defaultProject())?.trim() || null;
    } catch (err) {
      process.stderr.write(`[ltm-mcp] defaultProject failed: ${err}\n`);
      return null;
    }
  }

  const projectParam = z.string().optional()
    .describe("Project name from the LTM registry. Omit to use the current project (the server's working directory).");

  // ─── Tools ─────────────────────────────────────────────────────────────────
  // Annotations: readOnlyHint=true for pure reads; destructiveHint=false marks
  // additive writes (the MCP default for a write is destructive); openWorldHint
  // is false everywhere — every tool works on the local memory store only.

  server.registerTool(
    "recall",
    {
      title: "Recall memories",
      description: "Surface prior decisions, gotchas, and patterns before a non-trivial task, or when starting work in an unfamiliar area. Ranks long-term memories by query, category, project scope, or tags. Skip for trivial one-liners.",
      inputSchema: {
        query: z.string().optional().describe("Natural-language or keyword query (hybrid full-text + semantic search)"),
        project: z.string().optional().describe("Filter by project scope"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        category: z.enum(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).optional(),
        verbose: z.boolean().optional().describe("Return full memory objects (default false)"),
        since: z.string().optional().describe("Filter: memories after this ISO date"),
        until: z.string().optional().describe("Filter: memories before this ISO date"),
        sort_by: z.enum(["relevance", "created", "last_recalled", "recall_count"]).optional().describe("Sort results by"),
        workspace_id: z.string().optional().describe("Filter by workspace (memories in this workspace plus unscoped ones)"),
        agent_id: z.string().optional().describe("Filter by agent (memories from this agent plus unattributed ones)"),
        includeProvenance: z.boolean().optional().default(false).describe("Attach provenance chain to each result (off by default)"),
        includePrivate: z.boolean().optional().default(false).describe("Include memories tagged private (default false — private ≠ encrypted)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, project, limit, category, verbose, since, until, sort_by, workspace_id, agent_id, includeProvenance, includePrivate }) => {
      const results = await recall({ query, project, limit, category, since, until, sort_by, workspace_id, agent_id, includeProvenance, includePrivate });
      return jsonResult(verbose ? scrubMemoryPayload(results) : compact(results));
    },
  );

  server.registerTool(
    "get",
    {
      title: "Get a memory by id",
      description: "Fetch one memory by id after recall (progressive fetch). Use when compact recall truncated content or you need the full body, tags, and metadata. Skip when recall verbose already returned enough. Private-tagged memories require includePrivate.",
      inputSchema: {
        id: z.number().int().describe("Memory id from a prior recall / SessionStart index"),
        includePrivate: z.boolean().optional().default(false).describe("Allow fetching a memory tagged private (default false — private ≠ encrypted)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, includePrivate }) => {
      const mem = getMemoryById(id);
      if (!mem) return jsonResult({ ok: false, error: "not_found", id });
      if (hasPrivateTag(mem.tags) && !includePrivate) return jsonResult({ ok: false, error: "private", id });
      return jsonResult({ ok: true, memory: scrubMemoryPayload(mem) });
    },
  );

  server.registerTool(
    "learn",
    {
      title: "Learn a memory",
      description: "Store or reinforce a memory after discovering a non-obvious pattern, gotcha, or architectural decision worth keeping across sessions. Skip facts already derivable from the code or git history. Always pass a concise title (the title param explains how).",
      inputSchema: {
        content: z.string().describe("The insight, pattern, or decision to store"),
        title: z.string().max(60).optional().describe("Short noun-phrase label (≤60 chars) — e.g. 'Repository pattern for all DAO layers'. Always provide it; you generate it inline, no extra LLM call needed."),
        category: z.enum(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).optional().describe("Category (auto-detected when omitted)"),
        importance: z.number().int().min(1).max(5).optional().describe("Importance 1-5 (default 3, 5=never decays)"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
        files: z.array(z.string()).optional().describe("Repo-relative file paths this memory references — anchors so a commit touching them flags the memory stale"),
        project: z.string().optional().describe("Scope to a specific project. Omit for a cross-project memory; when `files` is given it defaults to the current project"),
        workspace_id: z.string().optional().describe("Workspace for this memory"),
        agent_id: z.string().optional().describe("Agent ID for this memory"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ content, title, category, importance, tags, files, project, workspace_id, agent_id }) => {
      // File anchors are repo-relative, so an anchored memory belongs to a project:
      // without one, a commit to the same path in any repo would flag it stale.
      const scope = project?.trim() || (files && files.length > 0 ? (await resolveProjectArg(undefined)) ?? undefined : undefined);
      let resolvedCategory = category;
      let categoriseSource: string | undefined;

      if (!resolvedCategory) {
        try {
          // Threshold 0 = heuristic only: a private memory is never sent to the LLM fallback.
          const threshold = hasPrivateTag(tags) ? 0 : await (options.categoriseThreshold?.() ?? Promise.resolve(0.6));
          const result = await categorise(content, threshold);
          resolvedCategory = result.category;
          categoriseSource = result.source;
        } catch {
          resolvedCategory = "pattern";
        }
      }

      const result = learn({
        content,
        title,
        category: resolvedCategory,
        importance,
        tags,
        files,
        project_scope: scope,
        workspace_id,
        agent_id,
        actor: "mcp:ltm_learn",
      });

      notify(`memory_stored: id=${result.id} category=${resolvedCategory}${categoriseSource ? ` (auto:${categoriseSource})` : ""} importance=${importance ?? 3} action=${result.action}`);

      // project_scope tells the model where it landed: null = cross-project (global),
      // which SessionStart only lists from importance 4 up.
      return jsonResult({ ...result, category: resolvedCategory, categoriseSource, project_scope: scope ?? null });
    },
  );

  server.registerTool(
    "relate",
    {
      title: "Relate memories",
      description: "Link two memories with a typed relationship when they connect — e.g. a decision caused a gotcha, or a pattern applies to an architecture.",
      inputSchema: {
        source_id: z.number().int(),
        target_id: z.number().int(),
        relationship_type: z.enum(["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ source_id, target_id, relationship_type }) => {
      relate({ source_id, target_id, relationship_type });
      return jsonResult({ ok: true });
    },
  );

  server.registerTool(
    "forget",
    {
      title: "Forget a memory",
      description: "Delete a memory by ID when it is wrong, outdated, or the user requests removal. Cascades to its relations.",
      inputSchema: {
        id: z.number().int(),
        reason: z.string().optional().describe("Why this memory is being removed"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, reason }) => {
      forget({ id, reason, actor: "mcp:ltm_forget" });
      return jsonResult({ ok: true, id, reason });
    },
  );

  server.registerTool(
    "revalidate",
    {
      title: "Revalidate a stale memory",
      description: "Clear a memory's stale flag after reviewing it — the code changed but this memory is still correct. Use forget instead when the memory is actually wrong.",
      inputSchema: {
        id: z.number().int().describe("Memory ID to revalidate"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const result = revalidate(id);
      return jsonResult({ id, ...result });
    },
  );

  server.registerTool(
    "admin_audit",
    {
      title: "Memory audit log",
      description: "Query the memory audit log. Returns a list of audit events (insert, update, forget, redact, etc.) with before/after snapshots. Use for tracing who wrote or deleted a memory.",
      inputSchema: {
        memory_id: z.number().int().optional().describe("Filter to a specific memory ID"),
        op: z.enum(["insert","update","forget","deprecate","supersede","redact","restore","archive"]).optional().describe("Filter by operation type"),
        session_id: z.string().optional().describe("Filter by session that triggered the op"),
        since: z.string().optional().describe("ISO date — only events after this time"),
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max rows (default 50)"),
        verbose: z.boolean().optional().default(false).describe("Include full before/after JSON snapshots"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ memory_id, op, session_id, since, limit, verbose }) => {
      const db = getDb();
      const rows = queryAudit(db, { memoryId: memory_id, op, sessionId: session_id, since, limit });
      const payload = verbose ? rows : rows.map(r => ({
        id: r.id, memory_id: r.memory_id, op: r.op, actor: r.actor,
        session_id: r.session_id, created_at: r.created_at,
        before_preview: r.before_json ? r.before_json.slice(0, 120) : null,
        after_preview: r.after_json ? r.after_json.slice(0, 120) : null,
      }));
      return jsonResult(payload);
    },
  );

  server.registerTool(
    "context",
    {
      title: "Project context",
      description: "Restore project state at session start or when switching projects — what SessionStart injects: the current goal, decisions, gotchas and recent progress (context items), plus high-importance global memories (importance ≥ 4) and the project's memories.",
      inputSchema: {
        project: projectParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const resolved = await resolveProjectArg(project);
      if (!resolved) return errorResult(NO_PROJECT_MESSAGE);
      const items = getItems(resolved);
      const ofType = (type: ContextType) => items.filter((i) => i.type === type).map((i) => scrubForEgress(i.content));
      const merged = getContextMerge(resolved);
      return jsonResult({
        project: resolved,
        goal: ofType("goal").at(-1) ?? null,
        decisions: ofType("decision"),
        gotchas: ofType("gotcha"),
        progress: ofType("progress").slice(-CONTEXT_RECENT_PROGRESS),
        globals: scrubMemoryPayload(merged.globals),
        scoped: scrubMemoryPayload(merged.scoped),
      });
    },
  );

  server.registerTool(
    "graph",
    {
      title: "Traverse memory graph",
      description: "Traverse the memory graph from seed nodes when exploring connections between memories or tracing decision chains. Builds a reasoning context from the traversal.",
      inputSchema: {
        memory_ids: z.array(z.number().int()).min(1).describe("Starting memory IDs for traversal"),
        depth: z.number().int().min(1).max(4).optional().describe("Traversal depth (default 2)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
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
          if (block) blocks.push(scrubForEgress(block));
        }
      }

      notify(`graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}`);

      return { content: [{ type: "text", text: blocks.join("\n\n") || "No reasoning context found." }] };
    },
  );

  server.registerTool(
    "context_items",
    {
      title: "List project context items",
      description: "List specific context types — goals, decisions, progress, or gotchas — for a project. Returns structured context items.",
      inputSchema: {
        project: projectParam,
        type: z.enum(["goal", "decision", "progress", "gotcha"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, type }) => {
      const resolved = await resolveProjectArg(project);
      if (!resolved) return errorResult(NO_PROJECT_MESSAGE);
      return jsonResult(getItems(resolved, type).map((item) => ({ ...item, content: scrubForEgress(item.content) })));
    },
  );

  server.registerTool(
    "context_add",
    {
      title: "Add project context",
      description: "Record a project goal, decision, gotcha, or progress note so it is restored with the project context in later sessions. A goal replaces the current goal; decisions and gotchas are kept permanently; progress keeps the most recent entries.",
      inputSchema: {
        type: z.enum(["goal", "decision", "gotcha", "progress"]).describe("Kind of context item"),
        content: z.string().min(1).describe("The goal, decision, gotcha, or progress note — one concise line"),
        project: projectParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ type, content, project }) => {
      const text = content.trim();
      if (!text) return errorResult("`content` must not be empty.");
      const resolved = await resolveProjectArg(project);
      if (!resolved) return errorResult(NO_PROJECT_MESSAGE);
      await CONTEXT_WRITERS[type](resolved, text);
      // The DAO writers enqueue on the shared write queue — drain it so the
      // item is committed (and visible to context_items) before replying.
      await writeQueue.enqueue(() => undefined);
      return jsonResult({ ok: true, project: resolved, type });
    },
  );

  server.registerTool(
    "proposals",
    {
      title: "Review memory proposals",
      description: "Review memories proposed by end-of-session evaluation before they are stored. action=list shows pending proposals, each identified by session_id + index; accept stores one as a memory, reject discards it. Indexes shift after each accept/reject — list again before the next one.",
      inputSchema: {
        action: z.enum(["list", "accept", "reject"]).describe("list pending proposals, or accept / reject one"),
        session_id: z.string().optional().describe("Proposal session_id from action=list (required for accept/reject)"),
        index: z.number().int().min(0).optional().describe("Proposal index from action=list (required for accept/reject)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ action, session_id, index }) => {
      if (action === "list") {
        const pending = listPendingProposals();
        return jsonResult({
          count: pending.length,
          proposals: pending.map((p) => ({
            session_id: p.sessionId,
            index: p.index,
            content: p.content,
            category: p.category,
            importance: p.importance,
            source: p.source,
            project: p.project,
            generated_at: Number.isFinite(p.generatedAt) ? new Date(p.generatedAt).toISOString() : null,
          })),
        });
      }
      if (!session_id || index === undefined) {
        return errorResult(`action=${action} requires session_id and index — take both from proposals(action="list").`);
      }
      if (!SESSION_ID_RE.test(session_id) || session_id.includes("..")) {
        return errorResult(`Invalid session_id "${session_id}" — use the exact session_id from proposals(action="list").`);
      }
      const ok = action === "accept" ? acceptProposal(session_id, index) : rejectProposal(session_id, index);
      if (!ok) {
        return errorResult(`No pending proposal at session_id=${session_id} index=${index}. Run proposals(action="list") for current ids — indexes shift after each accept/reject.`);
      }
      return jsonResult({ ok: true, action, session_id, index });
    },
  );

  // ─── Resources ─────────────────────────────────────────────────────────────

  server.resource(
    "memory://globals",
    "memory://globals",
    { description: "All importance=5 global memories (never decay)" },
    async () => {
      const db = getDb();
      const rows = db.query<Memory, []>(
        `SELECT * FROM memories WHERE importance = 5 AND project_scope IS NULL AND status = 'active' AND ${notPrivateSql()} ORDER BY created_at DESC`,
      ).all();
      return { contents: [{ uri: "memory://globals", text: JSON.stringify(scrubMemoryPayload(rows)), mimeType: "application/json" }] };
    },
  );

  server.resource(
    "memory://recent",
    "memory://recent",
    { description: "Last 20 memories across all projects" },
    async () => {
      const db = getDb();
      const rows = db.query<Memory, []>(
        `SELECT * FROM memories WHERE status = 'active' AND ${notPrivateSql()} ORDER BY created_at DESC LIMIT 20`,
      ).all();
      return { contents: [{ uri: "memory://recent", text: JSON.stringify(scrubMemoryPayload(rows)), mimeType: "application/json" }] };
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
      return { contents: [{ uri: "memory://tags", text: JSON.stringify(scrubMemoryPayload(rows)), mimeType: "application/json" }] };
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
        `SELECT * FROM memories WHERE project_scope = ? AND status = 'active' AND ${notPrivateSql()} ORDER BY importance DESC, created_at DESC`,
      ).all(projectName);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(scrubMemoryPayload(rows), null, 2),
          mimeType: "application/json",
        }],
      };
    },
  );

  // ─── Prompts ───────────────────────────────────────────────────────────────

  server.prompt(
    "recall_before_task",
    "Before starting a task, recall relevant memories and past decisions",
    { topic: z.string().describe("The topic or task you are about to work on") },
    ({ topic }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Before starting work on "${topic}", use the recall tool to search for relevant memories, past decisions, and gotchas related to this topic. Summarize what you find and note any decisions that should be followed.`,
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
          text: `Extract learnable patterns, gotchas, and architectural decisions from this session summary. For each insight, use learn to store it with the appropriate category and importance.\n\nSession summary:\n${summary}`,
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
          text: `Use recall to find memories related to "${question}", then use graph on the top result IDs to traverse connected memories. Synthesize the chain of reasoning, conflicts, and reinforcements into a coherent answer.`,
        },
      }],
    }),
  );

  server.prompt(
    "learn_after_decision",
    "Store an architectural decision or key choice in long-term memory with full context",
    {
      decision: z.string().describe("The architectural decision or key choice that was made"),
      rationale: z.string().describe("Why this decision was made"),
      project: z.string().optional().describe("Project this decision belongs to"),
    },
    ({ decision, rationale, project }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `We just made an architectural decision that should be preserved for future sessions. Store it using learn.\n\nDecision: ${decision}\nRationale: ${rationale}${project ? `\nProject: ${project}` : ""}\n\nStore with category=architecture, importance=4, and include the rationale in the content so future recall explains the "why".`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll store this decision now using learn with category=architecture and importance=4 so it persists across sessions and surfaces in future context loads.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "context_before_work",
    "Get full project context before starting work — combines context and recall for a complete picture",
    {
      project: z.string().describe("Project name from the LTM registry"),
      topic: z.string().describe("What you are about to work on"),
    },
    ({ project, topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Before starting work on "${topic}" in project "${project}", gather full context:\n\n1. Call context(project="${project}") to load goals, decisions, and gotchas.\n2. Call recall(query="${topic}", project="${project}") to surface relevant past patterns.\n3. Synthesize: list any active decisions, known gotchas, or prior work that affects this task.`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll call context and recall now, then synthesize the relevant context before proceeding with "${topic}".`,
          },
        },
      ],
    }),
  );

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

/** Connect the LTM MCP server to stdio. Resolves once the transport is up. */
export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`[ltm-mcp] Unhandled rejection: ${err}\n`);
  });

  if (options.isEnabled && !(await options.isEnabled())) {
    process.stderr.write("[ltm-mcp] mcp.enabled=false — server disabled\n");
    process.exit(0);
  }

  // Finish schema + migrations before accepting a request. Otherwise the first
  // calls on a brand-new database (an OpenClaw or Pi user with no Claude Code
  // install) hit the bare schema and fail with "no such column: decay_score".
  await waitForInit();

  const server = buildMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[ltm-mcp] LTM MCP server running on stdio\n");
}
