/**
 * cli/hook.ts — Lightweight Claude-compatible hook dispatcher.
 *
 * For bunx installs we support a portable SessionStart prefill directly from
 * openltm-core so users still get an "already pre-filled" experience without
 * the full Claude plugin checkout. Other hook events are safe no-ops.
 */
import { buildPrefillContext, deriveProjectFromCwd, PREFILL_DEFAULTS } from "../prefill.js";

function parseHookCwd(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cwd = parsed["cwd"]
      ?? parsed["working_directory"]
      ?? (parsed["session"] as Record<string, unknown> | undefined)?.["cwd"];
    return typeof cwd === "string" ? cwd : "";
  } catch {
    return "";
  }
}

export async function buildHookOutput(name: string, rawInput: string): Promise<string> {
  switch (name) {
    case "SessionStart": {
      const cwd = parseHookCwd(rawInput);
      if (!cwd) return "";
      const project = deriveProjectFromCwd(cwd);
      if (!project) return "";
      return buildPrefillContext({ project, ...PREFILL_DEFAULTS });
    }
    case "PreCompact":
    case "PostEditCheck":
      return "";
    default:
      return "";
  }
}

async function readStdin(): Promise<string> {
  let result = "";
  try {
    for await (const chunk of Bun.stdin.stream()) {
      result += new TextDecoder().decode(chunk);
    }
  } catch {
    // stdin may be absent in some hook invocations
  }
  return result;
}

/**
 * runHook — dispatch a lifecycle hook.
 *
 * SessionStart emits a compact Prior Knowledge block when memories exist.
 * Other events intentionally no-op until a richer host-independent contract is
 * extracted from the full Claude plugin hook suite.
 */
export async function runHook(name: string): Promise<void> {
  const raw = await readStdin();
  const output = await buildHookOutput(name, raw);
  if (output) process.stdout.write(output);
}
