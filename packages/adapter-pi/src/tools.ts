import type { PiExtensionAPI, PiToolDefinition } from "@earendil-works/pi-ai";
import { recall, learn, forget } from "@rohirik/ltm-core";

export function registerTools(pi: PiExtensionAPI): void {
  const tools: PiToolDefinition[] = [
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
      async handler({ query, project, limit, category }) {
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
      description: "Store or reinforce a memory. Call after discovering a non-obvious pattern, gotcha, or architectural decision.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The insight, pattern, or decision to store" },
          category: { type: "string", enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] },
          importance: { type: "number", description: "Importance 1-5 (default 3)", minimum: 1, maximum: 5 },
          project: { type: "string", description: "Scope to a specific project" },
        },
        required: ["content"],
      },
      async handler({ content, category, importance, project }) {
        const result = learn({
          content: content as string,
          category: category as string | undefined,
          importance: importance as number | undefined,
          project_scope: project as string | undefined,
          actor: "pi:ltm_learn",
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
      async handler({ id, reason }) {
        forget({ id: id as number, reason: reason as string | undefined, actor: "pi:ltm_forget" });
        return { ok: true, id };
      },
    },
  ];

  for (const tool of tools) {
    pi.registerTool(tool);
  }
}
