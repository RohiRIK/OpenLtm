import { recall, learn } from "@rohirik/ltm-core";

type PiAny = any;

const MAX_CONTEXT_MEMORIES = 10;

function formatContextBlock(memories: Array<{ id: number; content: string; category: string }>): string {
  const lines = memories.map((m) => `- [${m.id}] (${m.category}) ${m.content}`);
  return "## Prior Knowledge (LTM)\n\n" + lines.join("\n") + "\n";
}

function projectFromCwd(cwd: string): string {
  return cwd.replace(/\/$/, "").split("/").pop() ?? "";
}

export function registerHooks(pi: PiAny): void {
  // Inject relevant memories into the system prompt before each agent turn
  pi.on("before_agent_start", async (event: PiAny) => {
    try {
      const cwd = String(event?.cwd ?? process.cwd());
      const project = projectFromCwd(cwd);
      const memories = await recall({ project, limit: MAX_CONTEXT_MEMORIES, sort_by: "relevance" });
      if (memories.length === 0) return;

      const block = formatContextBlock(
        memories.map((m) => ({ id: m.id, content: m.content, category: m.category })),
      );
      const existing = String(event?.systemPrompt ?? "");
      const parts = existing ? [existing, block] : [block];
      return { systemPrompt: parts.join("\n\n") };
    } catch {
      // Non-fatal — session continues without LTM context
    }
  });

  // Learn from session summary after compact
  pi.on("session_compact", (event: PiAny) => {
    try {
      const cwd = String(event?.cwd ?? process.cwd());
      const project = projectFromCwd(cwd);
      const summary = String(event?.summary ?? "");
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
