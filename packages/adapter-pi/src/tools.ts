import { recall, learn, forget } from "@rohirik/openltm-core";

type PiAny = any; // Pi's extension API — no published types package

function toText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function registerTools(pi: PiAny): void {
  pi.registerTool({
    name: "ltm_recall",
    label: "ltm_recall",
    description:
      "Search long-term memories by query, category, or project scope. Call before starting any non-trivial task.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query" },
        project: { type: "string", description: "Filter by project scope" },
        limit: { type: "number", description: "Max results (default 10)", minimum: 1, maximum: 50 },
        category: {
          type: "string",
          enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"],
        },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const results = await recall({
        query: params["query"] as string | undefined,
        project: params["project"] as string | undefined,
        limit: params["limit"] as number | undefined,
        category: params["category"] as string | undefined,
      });
      return {
        content: [{ type: "text", text: toText(results.map(m => ({ id: m.id, content: m.content, category: m.category, importance: m.importance }))) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ltm_learn",
    label: "ltm_learn",
    description:
      "Store or reinforce a memory. Call after discovering a non-obvious pattern, gotcha, or architectural decision. Always provide a title: a concise noun-phrase label (≤60 chars).",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The insight, pattern, or decision to store" },
        title: { type: "string", description: "Short label (≤60 chars, noun-phrase). Always provide this.", maxLength: 60 },
        category: {
          type: "string",
          enum: ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"],
        },
        importance: { type: "number", description: "Importance 1-5 (default 3)", minimum: 1, maximum: 5 },
        project: { type: "string", description: "Scope to a specific project" },
      },
      required: ["content"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const result = learn({
        content: params["content"] as string,
        title: params["title"] as string | undefined,
        category: params["category"] as string | undefined,
        importance: params["importance"] as number | undefined,
        project_scope: params["project"] as string | undefined,
        actor: "pi:ltm_learn",
        skipExport: true,
      });
      return {
        content: [{ type: "text", text: toText({ id: result.id, action: result.action, category: result.category }) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ltm_forget",
    label: "ltm_forget",
    description: "Delete a memory by ID. Call when a memory is wrong or outdated.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Memory ID to delete" },
        reason: { type: "string", description: "Why this memory is being removed" },
      },
      required: ["id"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      forget({ id: params["id"] as number, reason: params["reason"] as string | undefined, actor: "pi:ltm_forget" });
      return {
        content: [{ type: "text", text: toText({ ok: true, id: params["id"] }) }],
        details: {},
      };
    },
  });
}
