/**
 * cli/hook.ts — Hook dispatcher stub.
 *
 * Full hook logic lives in the Claude Code plugin (hooks/src/).
 * When invoked via `bunx @rohirik/openltm-core hook --name <hookName>`, this
 * stub exits cleanly (exit 0) so Claude Code does not treat the absent hook
 * runner as an error.
 *
 * A future phase can wire actual hook logic here once openltm-core ships the
 * compiled hook handlers.
 */

/**
 * runHook — stub dispatcher for LTM lifecycle hooks.
 *
 * @param name - Hook event name (e.g. "SessionStart", "PreCompact").
 */
export function runHook(name: string): void {
  // Stub: full hook logic requires the Claude Code plugin.
  // Exit 0 so Claude Code does not break when the hook is registered.
  process.stderr.write(
    `LTM: hook '${name}' via bunx not yet supported — install the Claude Code plugin for full hook support\n`,
  );
  process.exit(0);
}
