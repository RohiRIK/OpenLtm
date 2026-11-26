import type { Plugin } from "@opencode/plugin";
import { buildTools } from "./tools.js";
import { registerSessionHooks } from "./sessionHooks.js";

// OpenCode V2 loads the module's default export and requires { id, setup }.
// A type-only import keeps the runtime free of @opencode/plugin: the host
// provides it, and a plugin may not bundle its own copy.
const plugin: Plugin.Plugin = {
  id: "openltm",
  async setup(ctx) {
    // Resolve from the directory, like every other host (registry → repo root →
    // folder name), so OpenCode and Claude Code share one project name.
    const directory = ctx.location.directory;

    await ctx.tool.transform(editor => {
      for (const tool of buildTools({ directory })) editor.add(tool);
    });
    await registerSessionHooks(ctx, { project: directory });
  },
};

export default plugin;
