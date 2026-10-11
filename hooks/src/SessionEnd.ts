#!/usr/bin/env bun
/**
 * SessionEnd.ts — curate the memory DB when a Claude Code session ends.
 *
 * Spawns a detached `ltm janitor run --if-due --quiet` against the same DB the
 * other hooks use, then exits immediately. No graph-server, no Honker.
 * Throttled by the janitor interval (default 6h, LTM_JANITOR_INTERVAL_MINUTES)
 * and single-instance via `<db>.janitor.lock`. Output: `<db dir>/janitor.log`.
 * Opt out: LTM_JANITOR_ON_SESSION_END=0.
 */
import { getDbPath } from "../lib/resolveProject.js";
import { logHook } from "../lib/hookLogger.js";
import { readStdin, safeRun } from "../lib/hookUtils.js";
import { spawnJanitorDetached } from "@rohirik/openltm-core/cli";

await safeRun("SessionEnd", async () => {
  await readStdin(); // drain the host's JSON payload; nothing in it is needed
  const result = spawnJanitorDetached({ dbPath: getDbPath() });
  logHook("SessionEnd", "info", result.spawned ? `janitor spawned pid=${result.pid} log=${result.logPath}` : `janitor not spawned: ${result.reason}`);
});
