/**
 * NotifyLtmServer.ts — PostToolUse hook
 * When memory/ files are edited, notify the LTM server to broadcast a graph refresh.
 */
import { join } from "path";
import { CLAUDE_DIR } from "../lib/resolveProject.js";
import { readStdin, safeRun } from "../lib/hookUtils.js";

const PID_PATH = join(CLAUDE_DIR, "tmp", "ltm-server.pid");
const MEMORY_DIR = join(CLAUDE_DIR, "memory");

async function main(): Promise<void> {
  const input = await readStdin();

  // Parse and extract file path — passthrough if anything fails
  let parsed: { tool_input?: { file_path?: string } };
  try { parsed = JSON.parse(input); } catch { process.stdout.write(input); return; }

  const filePath = parsed?.tool_input?.file_path ?? "";

  // Only notify if edited file is inside ~/.claude/memory/
  if (!filePath.startsWith(MEMORY_DIR)) { process.stdout.write(input); return; }

  // Read PID — if missing or dead, skip silently
  let pid: number;
  try {
    pid = Number((await Bun.file(PID_PATH).text()).trim());
  } catch {
    process.stdout.write(input);
    return;
  }
  if (!pid || isNaN(pid)) { process.stdout.write(input); return; }

  try {
    process.kill(pid, 0); // throws if process is dead
  } catch {
    process.stdout.write(input);
    return;
  }

  // Notify server to broadcast refresh — ignore errors silently
  try {
    await fetch("http://localhost:7331/api/reload", { method: "POST", signal: AbortSignal.timeout(1000) });
  } catch {}

  process.stdout.write(input);
}

await safeRun("NotifyLtmServer", main);
