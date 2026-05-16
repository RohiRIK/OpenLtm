import type { ToolDefinition } from "@opencode-ai/plugin";
import { recall, learn, forget, relate, getContextMerge } from "@rohirik/ltm-core";

export function buildTools(_dbPath: string): ToolDefinition[] {
  return [
    {
      name: "ltm_recall",
      description: "Search long-term memories by query, category, or project scope. Call before starting any non-trivial task.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full-text search query" },
          project: { type: "string", description: "Filter by project scope" },
          limit: { type: "number", description: "Max results (default 10)", minimum: 1, maximum: 50 },
          category: { type: "string", enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] },
        },
      },
      async execute({ query, project, limit, category }: Record<string, unknown>) {
        const results = await recall({
          query: query as string | undefined,
          project: project as string | undefined,
          limit: limit as number | undefined,
          category: category as string | undefined,
        });
        return results.map(m => ({ id: m.id, content: m.content, category: m.category, importance: m.importance }));
      },
    },

    {
      name: "ltm_learn",
      description: "Store or reinforce a memory. Call after discovering a non-obvious pattern, gotcha, or architectural decision. Always provide a title: a concise noun-phrase label (≤60 chars).",
      parameters: {
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
      async execute({ content, title, category, importance, project }: Record<string, unknown>) {
        const result = learn({
          content: content as string,
          title: title as string | undefined,
          category: category as string | undefined,
          importance: importance as number | undefined,
          project_scope: project as string | undefined,
          actor: "opencode:ltm_learn",
          skipExport: true,
        });
        return { id: result.id, action: result.action, category: result.category };
      },
    },

    {
      name: "ltm_forget",
      description: "Delete a memory by ID. Call when a memory is wrong or outdated.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Memory ID to delete" },
          reason: { type: "string", description: "Why this memory is being removed" },
        },
        required: ["id"],
      },
      async execute({ id, reason }: Record<string, unknown>) {
        forget({ id: id as number, reason: reason as string | undefined, actor: "opencode:ltm_forget" });
        return { ok: true, id };
      },
    },

    {
      name: "ltm_relate",
      description: "Create a typed relationship between two memories.",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "number" },
          target_id: { type: "number" },
          relationship_type: { type: "string", enum: ["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"] },
        },
        required: ["source_id", "target_id", "relationship_type"],
      },
      async execute({ source_id, target_id, relationship_type }: Record<string, unknown>) {
        relate({ source_id: source_id as number, target_id: target_id as number, relationship_type: relationship_type as string });
        return { ok: true };
      },
    },

    {
      name: "ltm_context",
      description: "Restore project context — goals, decisions, and gotchas. Call at session start.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name" },
        },
        required: ["project"],
      },
      async execute({ project }: Record<string, unknown>) {
        const result = getContextMerge(project as string);
        return result;
      },
    },
  ];
}
