#!/usr/bin/env bun
/**
 * PostToolUse.ts (matcher: Bash) — commit-driven stale flagging.
 *
 * When Claude runs `git commit` successfully, flag memories anchored to the
 * committed files as stale (flagStaleByPaths; importance=5 exempt). Gives
 * code-anchored invalidation without installing the global git post-commit hook.
 *
 * Gated by ltm.gitInvalidateEnabled (default true). Always silent, never blocks:
 * every Bash call passes through here, so the non-commit path exits before any
 * heavy import.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { readStdin, safeRun } from "../lib/hookUtils.js";
import { commitRepoDir } from "../lib/commitCommand.js";

/** HEAD must be this fresh to count as "the commit that command just made". */
const MAX_COMMIT_AGE_MS = 10 * 60 * 1000;
const LAST_COMMIT_FILE = join(tmpdir(), "ltm-posttooluse-last-commit");

/** Belt-and-braces: PostToolUse normally fires only on success, but honour explicit failure fields. */
function toolFailed(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const r = response as Record<string, unknown>;
  if (r.interrupted === true || r.is_error === true || r.isError === true) return true;
  const code = r.exit_code ?? r.exitCode;
  return typeof code === "number" && code !== 0;
}

function git(args: string[], cwd: string): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 3000 });
  return res.status === 0 ? (res.stdout ?? "").trim() : "";
}

async function main(): Promise<void> {
  let input: Record<string, any>;
  try { input = JSON.parse(await readStdin()) as Record<string, any>; }
  catch { return; }

  if (input.tool_name !== undefined && input.tool_name !== "Bash") return;
  const command = String(input.tool_input?.command ?? "");
  const sessionCwd = typeof input.cwd === "string" ? input.cwd : "";
  if (!sessionCwd || toolFailed(input.tool_response)) return;
  // `git -c k=v commit`, `git -C ../repo commit`, … — the repo is where the commit ran.
  const cwd = commitRepoDir(command, sessionCwd);
  if (!cwd || !existsSync(cwd)) return;

  const { readConfigSync } = await import("../../src/config.js");
  if (readConfigSync().ltm?.gitInvalidateEnabled === false) return;
  const { getDbPath, resolveProject } = await import("../lib/resolveProject.js");
  if (!existsSync(getDbPath())) return;

  // `git commit` may have been a no-op ("nothing to commit", `|| true`): only act
  // on a HEAD that is fresh and not already processed.
  const [sha, committedAt] = git(["log", "-1", "--format=%H %ct"], cwd).split(" ");
  if (!sha || !committedAt) return;
  if (Date.now() - Number(committedAt) * 1000 > MAX_COMMIT_AGE_MS) return;
  try { if (readFileSync(LAST_COMMIT_FILE, "utf-8").trim() === sha) return; } catch { /* first commit seen */ }

  // --root so a repository's first commit lists its files too. Paths are
  // repo-relative regardless of cwd, matching normalised anchors.
  const files = git(["diff-tree", "--no-commit-id", "-r", "--name-only", "--root", "HEAD"], cwd)
    .split("\n").filter(Boolean);
  try { writeFileSync(LAST_COMMIT_FILE, sha); } catch { /* dedupe is best-effort */ }
  if (files.length === 0) return;

  const { flagStaleByPaths } = await import("@rohirik/openltm-core");
  const project = resolveProject(cwd).name;
  const res = flagStaleByPaths(files, { project_scope: project, reason: `commit ${sha}`, actor: "claude-posttooluse" });
  if (res.flagged > 0) {
    const { logEvent } = await import("../lib/hookLogger.js");
    const { EVENTS } = await import("../lib/eventNames.js");
    logEvent("PostToolUse", EVENTS.STALE_FLAGGED, { project, count: res.flagged, detail: `commit ${sha.slice(0, 12)}` });
  }
}

await safeRun("PostToolUse", main);
