/**
 * settingsHooks.ts — OpenLTM hook entries in a user's ~/.claude/settings.json.
 *
 * The plugin's hooks live in hooks/hooks.json. Entries in settings.json come
 * from a dev/git-clone install (scripts/install-wiring.ts), an older version, or
 * the bunx installer. Next to the plugin they make every hook fire twice — and
 * they run that other checkout's code against its own database.
 *
 * Shared by install-wiring.ts (removal on install), unwire-legacy-hooks.ts (the
 * fix command) and SessionStart (the warning). No core import: install scripts
 * load it too.
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type HookCommand = { type?: string; command?: string };
type HookEntry = { matcher?: string; hooks?: HookCommand[] };
export type HooksSection = Record<string, HookEntry[]>;

/** The four original hook files: their path is distinctive enough to match anywhere in a command. */
const ORIGINAL_HOOK_PATHS = [
  "hooks/src/SessionStart.ts",
  "hooks/src/UpdateContext.ts",
  "hooks/src/EvaluateSession.ts",
  "hooks/src/PreCompact.ts",
];
/** Exactly what install-wiring.ts writes, for any root — quoted or the older unquoted form. */
const WRITTEN_COMMAND_RE =
  /^CLAUDE_PLUGIN_ROOT=('?)(.+)\1 bun run ('?)\2\/hooks\/src\/(SessionStart|UserPromptSubmit|PostToolUse|UpdateContext|EvaluateSession|SessionEnd|PreCompact)\.ts\3$/;
/** What the bunx installer (packages/openltm-core/src/cli/claude.ts) writes. */
const BUNX_COMMAND_RE = /@rohirik\/openltm-core hook --name /;

/** True for a hook command that runs OpenLTM. `extra` adds exact commands a caller knows it wrote. */
export function isLtmHookCommand(command: string, extra?: ReadonlySet<string>): boolean {
  return (extra?.has(command) ?? false)
    || WRITTEN_COMMAND_RE.test(command)
    || BUNX_COMMAND_RE.test(command)
    || ORIGINAL_HOOK_PATHS.some((p) => command.includes(p));
}

/** Every OpenLTM hook command in a settings `hooks` section. */
export function findLtmHooks(hooks: HooksSection | undefined, extra?: ReadonlySet<string>): Array<{ event: string; command: string }> {
  const found: Array<{ event: string; command: string }> = [];
  for (const [event, entries] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const h of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        if (typeof h?.command === "string" && isLtmHookCommand(h.command, extra)) found.push({ event, command: h.command });
      }
    }
  }
  return found;
}

/** Remove every OpenLTM hook command in place; drops emptied entries and events. Returns how many were removed. */
export function removeLtmHooks(hooks: HooksSection, extra?: ReadonlySet<string>): number {
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      const before = entry.hooks.length;
      entry.hooks = entry.hooks.filter((h) => !(typeof h?.command === "string" && isLtmHookCommand(h.command, extra)));
      removed += before - entry.hooks.length;
    }
    hooks[event] = entries.filter((e) => !Array.isArray(e?.hooks) || e.hooks.length > 0);
    if (hooks[event]!.length === 0) delete hooks[event];
  }
  return removed;
}

/** The user settings file Claude Code reads (CLAUDE_CONFIG_DIR, else ~/.claude). */
export function userSettingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude"), "settings.json");
}

/** OpenLTM hooks in the user's settings.json; [] when the file is missing or not valid JSON. */
export function findLtmHooksInUserSettings(path = userSettingsPath()): Array<{ event: string; command: string }> {
  if (!existsSync(path)) return [];
  try {
    const settings = JSON.parse(readFileSync(path, "utf-8")) as { hooks?: HooksSection };
    return findLtmHooks(settings.hooks);
  } catch {
    return [];
  }
}
