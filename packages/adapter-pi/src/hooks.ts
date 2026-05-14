import type { PiExtensionAPI } from "@earendil-works/pi-ai";
import { recall, learn } from "@rohirik/ltm-core";

const MAX_CONTEXT_MEMORIES = 10;

function formatContextBlock(memories: Array<{ id: number; content: string; category: string }>): string {
  const lines = memories.map(m => `- [${m.id}] (${m.category}) ${m.content}`);
  return "## Prior Knowledge (LTM)\n\n" + lines.join("\n") + "\n";
}

function projectFromCwd(cwd: string): string {
  return cwd.replace(/\/$/, "").split("/").pop() ?? "";
}

export function registerHooks(pi: PiExtensionAPI): void {
  pi.on("session:start", async (ctx) => {
    try {
      const project = projectFromCwd(ctx.cwd);
      const memories = await recall({
        project,
        limit: MAX_CONTEXT_MEMORIES,
        sort_by: "relevance",
      });
      if (memories.length > 0) {
        ctx.appendToSystemPrompt(formatContextBlock(
          memories.map(m => ({ id: m.id, content: m.content, category: m.category })),
        ));
      }
    } catch {
      // Non-fatal — session continues without LTM context
    }
  });

  pi.on("compact", async (ctx) => {
    try {
      const project = projectFromCwd(ctx.cwd);
      const summary = ctx.getSessionSummary();
      if (summary.trim().length > 50) {
        learn({
          content: summary.slice(0, 500),
          category: "pattern",
          importance: 2,
          project_scope: project,
          actor: "pi:compact",
          skipExport: true,
        });
      }
    } catch {
      // Non-fatal
    }
  });
}
