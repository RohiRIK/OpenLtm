import type { Hooks } from "@opencode-ai/plugin";
import { buildPrefillContext, deriveProjectFromCwd, recall, PREFILL_DEFAULTS } from "@rohirik/openltm-core";

function projectName(path: string): string {
  // Use last path segment as project scope (matching Claude Code convention)
  return deriveProjectFromCwd(path) || path;
}

export function buildSessionHooks(opts: { dbPath: string; project: string }): Pick<Hooks, "experimental.chat.system.transform" | "experimental.session.compacting"> {
  const project = projectName(opts.project);

  return {
    "experimental.chat.system.transform": async (_ctx, output) => {
      try {
        const block = buildPrefillContext({ project, ...PREFILL_DEFAULTS });
        if (block) output.system.push(block);
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
