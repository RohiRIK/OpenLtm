import { appendProgress, buildPrefillContext, deriveProjectFromCwd, PREFILL_DEFAULTS } from "@rohirik/openltm-core";

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
      const block = buildPrefillContext({ project, ...PREFILL_DEFAULTS });
      if (!block) return;
      const existing = String(event?.systemPrompt ?? "");
      const parts = existing ? [existing, block] : [block];
      return { systemPrompt: parts.join("\n\n") };
    } catch {
      // Non-fatal — session continues without LTM context
    }
  });

  // Record the compaction summary as this session's progress item. Raw summaries
  // are too noisy to store as memories; progress is one row per session.
  pi.on("session_compact", async (event: PiAny) => {
    try {
      const cwd = String(event?.cwd ?? process.cwd());
      const summary = String(event?.summary ?? "").replace(/\s+/g, " ").trim();
      if (summary.length <= 50) return;
      const rawSessionId = event?.sessionId ?? event?.session_id;
      const sessionId = typeof rawSessionId === "string" && rawSessionId ? rawSessionId : undefined;
      const today = new Date().toISOString().split("T")[0];
      await appendProgress(projectFromCwd(cwd), `✓ [${today}] Compacted: ${summary.slice(0, 300)}`, sessionId);
    } catch {
      // Non-fatal
    }
  });
}
