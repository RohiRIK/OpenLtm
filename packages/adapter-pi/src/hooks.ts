import { buildPrefillContext, deriveProjectFromCwd, learn } from "@rohirik/openltm-core";

type PiAny = any;

function projectFromCwd(cwd: string): string {
  return deriveProjectFromCwd(cwd);
}

export function registerHooks(pi: PiAny): void {
  // Inject relevant memories into the system prompt before each agent turn
  pi.on("before_agent_start", async (event: PiAny) => {
    try {
      const cwd = String(event?.cwd ?? process.cwd());
      const project = projectFromCwd(cwd);
      const block = buildPrefillContext({ project, maxMemories: 10, maxLines: 18 });
      if (!block) return;
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
