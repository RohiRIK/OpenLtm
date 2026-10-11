import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { buildTools } from "./tools.js";
import { buildSessionHooks } from "./sessionHooks.js";
import { DB_PATH } from "@rohirik/openltm-core";

const server: Plugin = async ({ project }) => {
  const dbPath = process.env["LTM_DB_PATH"] ?? DB_PATH;
  // Resolve from the directory, like every other host (registry → repo root →
  // folder name), so OpenCode and Claude Code share one project name. A display
  // name cannot match the registry or a repo root.
  const projectPath = project.path ?? process.cwd();

  return {
    tool: buildTools(dbPath),
    // Before 2.17 the scope was project.name when the host set it — keep it while
    // it is the only name holding memories.
    ...buildSessionHooks({ dbPath, project: projectPath, legacyName: project.name }),
  };
};

export const plugin: PluginModule = { server };
