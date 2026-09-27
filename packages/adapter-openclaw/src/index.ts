/**
 * index.ts — OpenClaw plugin entry.
 *
 * Registers OpenLTM's eight memory tools and, unless disabled, injects a
 * compact Prior Knowledge block into the system prompt each turn. Storage is
 * delegated entirely to `@rohirik/openltm-core`, so this plugin shares one
 * SQLite database with the Claude Code, OpenCode, and Pi plugins.
 *
 * The OpenClaw plugin SDK is resolved from the host's own `openclaw` package
 * (`openclaw/plugin-sdk/*`), which is why it is a peer dependency and why it is
 * externalised in the bundle.
 */
import {
  buildPrefillContext,
  deriveProjectFromCwd,
  learn,
  recall,
  forget,
  relate,
  getContextMerge,
  traverseGraph,
  buildReasoningContext,
  PREFILL_DEFAULTS,
  type Memory,
} from "@rohirik/openltm-core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";

interface OpenLtmConfig {
  autoRecall?: boolean;
  prefillLines?: number;
  dbPath?: string;
}

const CATEGORIES = [
  "preference",
  "architecture",
  "gotcha",
  "pattern",
  "workflow",
  "constraint",
] as const;

type Category = (typeof CATEGORIES)[number];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Compact projection of a memory row for tool output. */
function slim(memory: Memory): Record<string, unknown> {
  return {
    id: memory.id,
    title: memory.title ?? null,
    content: memory.content.length > 300 ? `${memory.content.slice(0, 297)}…` : memory.content,
    category: memory.category,
    importance: memory.importance,
    project: memory.project_scope ?? null,
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return textResult(`openltm: ${message}`);
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
    const readConfig = (): OpenLtmConfig => {
      const raw = api.pluginConfig as OpenLtmConfig | undefined;
      return raw ?? {};
    };

    // Auto-recall: one Prior Knowledge block per turn, capped by the shared
    // host budget so the injected text matches every other OpenLTM adapter.
    const autoRecall = api.registerMemoryPromptSupplement?.bind(api);
    if (autoRecall) {
      autoRecall((params) => {
        try {
          const cfg = readConfig();
          if (cfg.autoRecall === false) return [];
          const cwd = process.cwd();
          const project = deriveProjectFromCwd(cwd);
          const maxLines = toNumber(cfg.prefillLines) ?? PREFILL_DEFAULTS.maxLines;
          const block = buildPrefillContext({ project, maxLines });
          return block ? [block] : [];
        } catch (err) {
          api.logger.warn(`openltm: prefill failed: ${String(err)}`);
          return [];
        }
      });
    }

    const tool = <T>(name: string, label: string, description: string, parameters: unknown, execute: (params: Record<string, unknown>) => Promise<unknown>) => {
      api.registerTool({
        name,
        label,
        description,
        parameters: parameters as never,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            return await execute(params);
          } catch (err) {
            return errorResult(`${name} failed: ${String(err)}`);
          }
        },
      } as never);
    };

    tool(
      "openltm_recall",
      "OpenLTM Recall",
      "Search long-term memory by meaning. Call before any non-trivial task to surface past decisions, preferences, and gotchas.",
      Type.Object({
        query: Type.Optional(Type.String({ description: "Search query" })),
        project: Type.Optional(Type.String({ description: "Project scope" })),
        category: Type.Optional(Type.Union(CATEGORIES.map((c) => Type.Literal(c)), { description: "Restrict to one category" })),
        limit: Type.Optional(Type.Integer({ description: "Max results (default 10)", minimum: 1, maximum: 50 })),
      }),
      async (params) => {
        const results = await recall({
          query: params["query"] as string | undefined,
          project: params["project"] as string | undefined,
          category: isCategory(params["category"]) ? params["category"] : undefined,
          limit: toNumber(params["limit"]),
        });
        return textResult(results.length === 0 ? "No memories found." : JSON.stringify(results.map(slim)));
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
      async (params) => {
        const result = learn({
          content: params["content"] as string,
          title: params["title"] as string | undefined,
          category: isCategory(params["category"]) ? params["category"] : "pattern",
          importance: toNumber(params["importance"]),
          project_scope: params["project"] as string | undefined,
          actor: "openclaw:openltm_learn",
          skipExport: true,
        });
        return textResult(JSON.stringify(result));
      },
    );

    tool(
      "openltm_forget",
      "OpenLTM Forget",
      "Delete a memory by id. Call when a memory is wrong, outdated, or the user asks for removal.",
      Type.Object({
        id: Type.Integer({ description: "Memory id to delete" }),
        reason: Type.Optional(Type.String({ description: "Why it is being removed" })),
      }),
      async (params) => {
        forget({
          id: toNumber(params["id"])!,
          reason: params["reason"] as string | undefined,
          actor: "openclaw:openltm_forget",
        });
        return textResult(JSON.stringify({ ok: true }));
      },
    );

    tool(
      "openltm_context",
      "OpenLTM Context",
      "Restore project context: goals, decisions, and gotchas. Call at session start or when switching projects.",
      Type.Object({
        project: Type.Optional(Type.String({ description: "Project name; defaults to the working directory" })),
      }),
      async (params) => {
        const project =
          (params["project"] as string | undefined) || deriveProjectFromCwd(process.cwd());
        return textResult(JSON.stringify(getContextMerge(project)));
      },
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
      async (params) => {
        relate({
          source_id: toNumber(params["source_id"])!,
          target_id: toNumber(params["target_id"])!,
          relationship_type: params["relationship_type"] as never,
        });
        return textResult(JSON.stringify({ ok: true }));
      },
    );

    tool(
      "openltm_graph",
      "OpenLTM Graph",
      "Traverse the memory graph from a starting memory to trace decision chains and find related memories.",
      Type.Object({
        memory_id: Type.Integer({ description: "Starting memory id" }),
        depth: Type.Optional(Type.Integer({ description: "Traversal depth (default 2, max 4)", minimum: 1, maximum: 4 })),
      }),
      async (params) => {
        const result = await traverseGraph(toNumber(params["memory_id"])!, toNumber(params["depth"]) ?? 2, false);
        const block = buildReasoningContext(result);
        return textResult(block || "No reasoning context found.");
      },
    );

    tool(
      "openltm_brain_stats",
      "OpenLTM Stats",
      "Get memory statistics: totals, category spread, importance distribution, and relations.",
      Type.Object({}),
      async () => {
        const { getDb } = await import("@rohirik/openltm-core");
        const db = getDb();
        const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memories WHERE status='active'").get()?.n ?? 0;
        const byCategory = db
          .query<{ category: string; n: number }, []>(
            "SELECT category, COUNT(*) AS n FROM memories WHERE status='active' GROUP BY category ORDER BY n DESC",
          )
          .all();
        return textResult(JSON.stringify({ total, byCategory }));
      },
    );

    tool(
      "openltm_stale",
      "OpenLTM Stale",
      "List memories flagged as stale by code changes, or clear the flag after review.",
      Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("clear")], { description: "List stale memories, or clear a flag" }),
        memory_id: Type.Optional(Type.Integer({ description: "Required when action is 'clear'" })),
        reason: Type.Optional(Type.String({ description: "Why the memory is stale" })),
      }),
      async (params) => {
        const { getDb } = await import("@rohirik/openltm-core");
        const db = getDb();
        if (params["action"] === "clear") {
          const id = toNumber(params["memory_id"]);
          if (id === undefined) return errorResult("memory_id is required when action is 'clear'");
          db.run("UPDATE memories SET stale_flagged_at=NULL, stale_reason=NULL WHERE id=?", [id]);
          return textResult(JSON.stringify({ ok: true, id }));
        }
        const rows = db
          .query<{ id: number; content: string; stale_reason: string | null }, []>(
            "SELECT id, content, stale_reason FROM memories WHERE status='active' AND stale_flagged_at IS NOT NULL ORDER BY stale_flagged_at DESC LIMIT 50",
          )
          .all();
        return textResult(rows.length === 0 ? "No stale memories." : JSON.stringify(rows));
      },
    );

    api.logger.info("openltm: registered (shared SQLite memory)");
  },
});
