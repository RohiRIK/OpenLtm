import { recall, learn, forget, relate, getContextMerge, scrubForEgress, categorise } from "@rohirik/openltm-core";
import type { MemoryCategory, RelationshipType } from "@rohirik/openltm-core";

/** A V2 tool with a JSON Schema input and no declared output: results reach the model as text content. */
export interface LtmTool {
  readonly name: string;
  readonly description: string;
  readonly input: { readonly type: "object"; readonly properties: Record<string, unknown>; readonly required?: string[] };
  readonly options: { readonly codemode: false };
  execute(input: unknown): Promise<{ content: string }>;
}

// codemode: false exposes each tool directly to the model, as in V1, instead of
// behind OpenCode's `execute` code-mode tool.
const options = { codemode: false } as const;

export function buildTools(): LtmTool[] {
  return [
    {
      name: "ltm_recall",
      description: "Search long-term memories by query, category, or project scope. Call before starting any non-trivial task.",
      options,
      input: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full-text search query" },
          project: { type: "string", description: "Filter by project scope" },
          limit: { type: "number", description: "Max results (default 10)", minimum: 1, maximum: 50 },
          category: { type: "string", enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] },
        },
      },
      async execute(input) {
        const { query, project, limit, category } = input as Record<string, unknown>;
        const results = await recall({
          query: query as string | undefined,
          project: project as string | undefined,
          limit: limit as number | undefined,
          category: category as MemoryCategory | undefined,
        });
        return text(results.map(m => ({ id: m.id, content: scrubForEgress(m.content), category: m.category, importance: m.importance })));
      },
    },

    {
      name: "ltm_learn",
      description: "Store or reinforce a memory. Call after discovering a non-obvious pattern, gotcha, or architectural decision. Always provide a title: a concise noun-phrase label (≤60 chars). Write the title and content in English, translating if the conversation is in another language.",
      options,
      input: {
        type: "object",
        properties: {
          content: { type: "string", description: "The insight, pattern, or decision to store" },
          title: { type: "string", description: "Short label (≤60 chars, noun-phrase). Always provide this.", maxLength: 60 },
          category: { type: "string", enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] },
          importance: { type: "number", description: "Importance 1-5 (default 3)", minimum: 1, maximum: 5 },
          project: { type: "string", description: "Scope to a specific project" },
        },
        required: ["content"],
      },
      async execute(input) {
        const { content, title, category, importance, project } = input as Record<string, unknown>;
        // Like the MCP learn tool: an omitted category is auto-detected (heuristic only, no LLM).
        const resolved = (category as MemoryCategory | undefined) ?? (await categorise(content as string, 0).catch(() => ({ category: "pattern" as const }))).category;
        const result = learn({
          content: content as string,
          title: title as string | undefined,
          category: resolved,
          importance: importance as number | undefined,
          project_scope: project as string | undefined,
          actor: "opencode:ltm_learn",
          skipExport: true,
        });
        return text({ id: result.id, action: result.action, category: resolved });
      },
    },

    {
      name: "ltm_forget",
      description: "Delete a memory by ID. Call when a memory is wrong or outdated.",
      options,
      input: {
        type: "object",
        properties: {
          id: { type: "number", description: "Memory ID to delete" },
          reason: { type: "string", description: "Why this memory is being removed" },
        },
        required: ["id"],
      },
      async execute(input) {
        const { id, reason } = input as Record<string, unknown>;
        forget({ id: id as number, reason: reason as string | undefined, actor: "opencode:ltm_forget" });
        return text({ ok: true, id });
      },
    },

    {
      name: "ltm_relate",
      description: "Create a typed relationship between two memories.",
      options,
      input: {
        type: "object",
        properties: {
          source_id: { type: "number" },
          target_id: { type: "number" },
          relationship_type: { type: "string", enum: ["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"] },
        },
        required: ["source_id", "target_id", "relationship_type"],
      },
      async execute(input) {
        const { source_id, target_id, relationship_type } = input as Record<string, unknown>;
        relate({ source_id: source_id as number, target_id: target_id as number, relationship_type: relationship_type as RelationshipType });
        return text({ ok: true });
      },
    },

    {
      name: "ltm_context",
      description: "Restore project context — goals, decisions, and gotchas. Call at session start.",
      options,
      input: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name" },
        },
        required: ["project"],
      },
      async execute(input) {
        const { project } = input as Record<string, unknown>;
        const result = getContextMerge(project as string);
        return text(deepScrub(result));
      },
    },
  ];
}

/** The V2 host rejects `output` without an output schema, so results go to the model as JSON text. */
function text(value: unknown): { content: string } {
  return { content: JSON.stringify(value) };
}

/** Scrub every string in a tool result before it reaches the model; stub past depth 32. */
function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[scrub-failed]";
  if (typeof value === "string") return scrubForEgress(value);
  if (Array.isArray(value)) return value.map(v => deepScrub(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepScrub(v, depth + 1)]));
  }
  return value;
}
