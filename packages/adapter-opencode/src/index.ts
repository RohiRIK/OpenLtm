import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { buildTools } from "./tools.js";
import { buildSessionHooks } from "./sessionHooks.js";
import { DB_PATH } from "@rohirik/openltm-core";

const server: Plugin = async ({ project }) => {
  const dbPath = process.env["LTM_DB_PATH"] ?? DB_PATH;
  // Prefer explicit name (basename if not set); sessionHooks also derives name from path
  const projectPath = project.name ?? project.path;

  return {
    tool: buildTools(dbPath),
    ...buildSessionHooks({ dbPath, project: projectPath }),
  };
};

export const plugin: PluginModule = { server };
