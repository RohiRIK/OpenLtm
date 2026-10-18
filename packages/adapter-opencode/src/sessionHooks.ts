import type { Plugin } from "@opencode/plugin";
import { buildPrefillContext, deriveProjectFromCwd, frameRecalledMemory, recall, scrubForEgress, PREFILL_DEFAULTS } from "@rohirik/openltm-core";

type SystemPart = { type: "text"; text: string };

export interface SessionHookHandlers {
  /** Prior Knowledge block for the session's system prompt, or undefined when there is nothing to inject. */
  context(): SystemPart | undefined;
  /** Active memories to keep through compaction, or undefined when the project has none. */
  compaction(): Promise<SystemPart | undefined>;
}

export function buildSessionHooks(opts: { project: string }): SessionHookHandlers {
  // Same resolver as every other host (registry → repo root → folder name).
  const project = deriveProjectFromCwd(opts.project) || opts.project;

  return {
    context() {
      try {
        const block = buildPrefillContext({ project, ...PREFILL_DEFAULTS });
        return block ? { type: "text", text: block } : undefined;
      } catch {
        // Non-fatal — session continues without LTM context
        return undefined;
      }
    },

    async compaction() {
      try {
        const existing = await recall({ project, limit: 5, sort_by: "created" });
        if (existing.length === 0) return undefined;
        const summary = existing.map(m => `- ${scrubForEgress(m.content)}`).join("\n");
        return { type: "text", text: `## LTM Active Memories (${opts.project})\n\n${frameRecalledMemory(summary)}` };
      } catch {
        // Non-fatal
        return undefined;
      }
    },
  };
}

export async function registerSessionHooks(ctx: Pick<Plugin.Context, "session">, opts: { project: string }): Promise<void> {
  const handlers = buildSessionHooks(opts);
  await ctx.session.hook("context", event => {
    const part = handlers.context();
    if (part) event.system.push(part);
  });
  await ctx.session.hook("compaction", async event => {
    const part = await handlers.compaction();
    if (part) event.system.push(part);
  });
}
