/**
 * pluginEnv.ts — normalise the plugin MCP server's environment before core loads.
 *
 * Core resolves the DB as LTM_DB_PATH → $CLAUDE_PLUGIN_DATA/openltm.db, exactly
 * like the hooks, and computes it at import time — so this runs first.
 *
 * Measured with Claude Code 2.1.295: plugin MCP servers inherit the user's
 * environment and get CLAUDE_PLUGIN_DATA, but a manifest entry
 * `"CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}"` reaches the server unexpanded
 * (the literal text), while the same placeholder under another key is expanded.
 * plugin.json therefore passes it as LTM_PLUGIN_DATA. A value that still holds
 * `${` was never expanded and must not become a directory named "${...}".
 */

/** The value, or undefined when it is empty or an unexpanded `${…}` placeholder. */
export function expandedOrUndefined(value: string | undefined): string | undefined {
  return value && !value.includes("${") ? value : undefined;
}

/** Fix up CLAUDE_PLUGIN_DATA / LTM_DB_PATH in place. */
export function normalizePluginEnv(env: NodeJS.ProcessEnv = process.env): void {
  const pluginData = expandedOrUndefined(env["CLAUDE_PLUGIN_DATA"]) ?? expandedOrUndefined(env["LTM_PLUGIN_DATA"]);
  if (pluginData) env["CLAUDE_PLUGIN_DATA"] = pluginData;
  else delete env["CLAUDE_PLUGIN_DATA"];
  if (!expandedOrUndefined(env["LTM_DB_PATH"])) delete env["LTM_DB_PATH"];
}
