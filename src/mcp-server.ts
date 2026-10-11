/**
 * mcp-server.ts — Claude Code plugin entrypoint for the LTM MCP server.
 *
 * Thin wrapper: the full server (tools, resources, prompts) lives in
 * @rohirik/openltm-core/mcp so any MCP-capable host can run it via
 * `bunx @rohirik/openltm-core mcp-serve`. This wrapper injects the plugin's
 * config file (mcp.enabled flag + categorisation threshold) and the default
 * project for context tools called without `project` (the registry name the
 * hooks resolve for the server's cwd — Claude Code launches it in the project).
 *
 * The DB is resolved like the hooks': LTM_DB_PATH → $CLAUDE_PLUGIN_DATA/openltm.db
 * (see pluginEnv.ts for why plugin.json passes LTM_PLUGIN_DATA).
 *
 * IMPORTANT: Never use console.log() — STDIO transport uses stdout for protocol.
 */
import { join } from "path";
import { normalizePluginEnv } from "./pluginEnv.js";
import { ensurePluginDeps } from "../scripts/ensure-deps.js";

// Claude Code skips installing this plugin's packages (its bun.lock lists more
// than one workspace), so install them on first start. Claude Code waits 30s
// for the handshake; a slower install fails this start and the next one works.
if (!ensurePluginDeps(join(import.meta.dir, ".."), { waitMs: 25_000 })) {
  process.stderr.write("[ltm-mcp] the plugin's packages are still installing; the server starts next session\n");
  process.exit(1);
}

// Before core is imported: it resolves the DB path from the environment at load time.
normalizePluginEnv();
const { startMcpServer } = await import("@rohirik/openltm-core/mcp");
const { resolveProject } = await import("../hooks/lib/resolveProject.js");

async function readConfig(): Promise<Record<string, unknown>> {
  try {
    const { readConfigSync } = await import("./config.js");
    return readConfigSync() as Record<string, unknown>;
  } catch {
    return {};
  }
}

startMcpServer({
  async isEnabled() {
    const cfg = await readConfig();
    const mcp = cfg["mcp"] as { enabled?: boolean } | undefined;
    return mcp?.enabled !== false; // default true if not set
  },
  async categoriseThreshold() {
    const cfg = await readConfig();
    const embeddings = cfg["embeddings"] as { confidenceThreshold?: number } | undefined;
    return embeddings?.confidenceThreshold ?? 0.6;
  },
  defaultProject: () => resolveProject(process.cwd()).name,
}).catch((err) => {
  process.stderr.write(`[ltm-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
