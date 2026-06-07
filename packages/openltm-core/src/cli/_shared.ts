/**
 * cli/_shared.ts — Pure wiring helpers shared by all per-target installers.
 *
 * No filesystem access — all functions are pure transformations over plain
 * objects. This makes them easy to unit-test and safe to compose.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deep-compare two MCP server entries for structural equivalence.
 * Returns true only if command, args, and env are all identical.
 */
function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  if (a.command !== b.command) return false;
  const aArgs = JSON.stringify(a.args ?? []);
  const bArgs = JSON.stringify(b.args ?? []);
  if (aArgs !== bArgs) return false;
  const aEnv = JSON.stringify(a.env ?? {});
  const bEnv = JSON.stringify(b.env ?? {});
  return aEnv === bEnv;
}

/**
 * mergeMcpEntry — add or replace a named MCP server entry in settings.
 *
 * - If `name` is already present with the same shape → return `settings`
 *   unchanged (no new object allocation).
 * - Otherwise → return a new settings object with the entry added/replaced.
 *
 * @param settings - Existing Claude settings object (not mutated).
 * @param name     - Key under `mcpServers` (e.g. `"ltm"`).
 * @param entry    - The MCP server config to set.
 */
export function mergeMcpEntry(
  settings: ClaudeSettings,
  name: string,
  entry: McpServerEntry,
): ClaudeSettings {
  const existing = settings.mcpServers?.[name];
  if (existing && entriesEqual(existing, entry)) {
    return settings;
  }
  return {
    ...settings,
    mcpServers: {
      ...(settings.mcpServers ?? {}),
      [name]: entry,
    },
  };
}

/**
 * wireHooks — add a hook command under `settings.hooks[hookName]` if not
 * already present.
 *
 * The hook format expected by Claude Code is an array of matchers under each
 * event name. We store hooks as:
 *   { hooks: { [hookName]: [ { command, args } ] } }
 *
 * Idempotency: a hook is considered present if any existing entry has the
 * same `command` and `args[0]` (package name).
 *
 * @param settings - Existing Claude settings object (not mutated).
 * @param hookName - Event name e.g. `"SessionStart"`.
 * @param command  - Executable e.g. `"bunx"`.
 * @param args     - Argument list e.g. `["@rohirik/openltm-core", "hook", "--name", "SessionStart"]`.
 */
export function wireHooks(
  settings: ClaudeSettings,
  hookName: string,
  command: string,
  args: string[],
): ClaudeSettings {
  const existing = (settings.hooks ?? {}) as Record<string, unknown>;
  const hookList = existing[hookName];
  const newEntry = { command, args };

  if (Array.isArray(hookList)) {
    const alreadyPresent = hookList.some(
      (h): h is { command: string; args: string[] } =>
        typeof h === "object" &&
        h !== null &&
        (h as { command?: string }).command === command &&
        Array.isArray((h as { args?: unknown[] }).args) &&
        (h as { args: unknown[] }).args[0] === args[0],
    );
    if (alreadyPresent) return settings;

    return {
      ...settings,
      hooks: {
        ...existing,
        [hookName]: [...hookList, newEntry],
      },
    };
  }

  return {
    ...settings,
    hooks: {
      ...existing,
      [hookName]: [newEntry],
    },
  };
}
