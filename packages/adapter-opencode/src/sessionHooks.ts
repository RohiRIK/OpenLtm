import type { Hooks } from "@opencode-ai/plugin";
import { recall } from "@rohirik/openltm-core";

const MAX_CONTEXT_MEMORIES = 10;
const PRIOR_KNOWLEDGE_HEADER = "## Prior Knowledge (LTM)\n\n";

function formatContextBlock(memories: Array<{ id: number; content: string; category: string }>): string {
  const lines = memories.map(m => `- [${m.id}] (${m.category}) ${m.content}`);
  return PRIOR_KNOWLEDGE_HEADER + lines.join("\n") + "\n";
}

function projectName(path: string): string {
  // Use last path segment as project scope (matching Claude Code convention)
  return path.replace(/\/$/, "").split("/").pop() ?? path;
}

export function buildSessionHooks(opts: { dbPath: string; project: string }): Pick<Hooks, "experimental.chat.system.transform" | "experimental.session.compacting"> {
  const project = projectName(opts.project);

  return {
    "experimental.chat.system.transform": async (_ctx, output) => {
      try {
        const memories = await recall({
          project,
          limit: MAX_CONTEXT_MEMORIES,
          sort_by: "relevance",
        });
        if (memories.length > 0) {
          output.system.push(formatContextBlock(
            memories.map(m => ({ id: m.id, content: m.content, category: m.category })),
          ));
        }
      } catch {
        // Non-fatal — session continues without LTM context
      }
    },

    "experimental.session.compacting": async (_ctx, output) => {
      try {
        const existing = await recall({ project, limit: 5, sort_by: "created" });
        if (existing.length > 0) {
          const summary = existing.map(m => `- ${m.content}`).join("\n");
          output.context.push(`## LTM Active Memories (${opts.project})\n\n${summary}\n`);
        }
      } catch {
        // Non-fatal
      }
    },
  };
}
