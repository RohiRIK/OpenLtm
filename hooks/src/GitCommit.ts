#!/usr/bin/env bun
/**
 * GitCommit.ts — Post-commit hook that auto-extracts learnings from git diffs.
 *
 * Two modes:
 *   hook mode (default):  validates config, spawns detached extractor, exits 0 immediately
 *   extract mode:         --extract <json>  — runs LLM extraction and stores memories
 *
 * Installed globally via ~/.claude/hooks/git/post-commit
 * Controlled by config.ltm.gitLearnEnabled (default: false)
 */
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { resolveProject, CLAUDE_DIR } from "../lib/resolveProject.js";
import { safeRun } from "../lib/hookUtils.js";
import { readConfigSync } from "../../src/config.js";
import type { Config } from "../../src/config.js";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(CLAUDE_DIR, "plugins", "ltm");
const MAX_DIFF_CHARS = 4000;

// ── Git helpers ───────────────────────────────────────────────────────────────

function getProjectRoot(): string {
  // GIT_DIR is set to .git/ inside a hook — go one level up
  const gitDir = process.env.GIT_DIR;
  if (gitDir) return join(gitDir, "..") ;
  return process.cwd();
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", env: process.env });
  return result.stdout?.trim() ?? "";
}

function getCommitMeta(cwd: string): { hash: string; message: string; files: string[] } {
  const hash = runGit(["log", "-1", "--pretty=format:%H"], cwd);
  const message = runGit(["log", "-1", "--pretty=format:%s"], cwd);
  const fileList = runGit(["diff-tree", "--no-commit-id", "-r", "--name-only", "HEAD"], cwd);
  const files = fileList ? fileList.split("\n").filter(Boolean) : [];
  return { hash, message, files };
}

function getDiffText(cwd: string, maxChars: number): string {
  const diff = runGit(["diff", "HEAD~1", "HEAD", "--unified=3", "--no-color"], cwd);
  if (!diff) return runGit(["show", "--unified=3", "--no-color", "HEAD"], cwd).slice(0, maxChars);
  return diff.length > maxChars ? diff.slice(0, maxChars) : diff;
}

function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) return filename.endsWith(pattern.slice(1));
  if (pattern.endsWith("/")) return filename.includes(pattern);
  return filename.includes(pattern);
}

function applyIgnorePatterns(diff: string, patterns: string[]): string {
  if (patterns.length === 0) return diff;
  const lines = diff.split("\n");
  let skip = false;
  return lines.filter(line => {
    if (line.startsWith("diff --git")) {
      // Extract filename from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/.+ b\/(.+)$/);
      const filename = match?.[1] ?? line;
      skip = patterns.some(p => matchesPattern(filename, p));
    }
    return !skip;
  }).join("\n");
}

function shouldSkipRepo(projectRoot: string): boolean {
  return existsSync(join(projectRoot, ".ltmignore"));
}

// ── Extract mode ──────────────────────────────────────────────────────────────

async function runExtract(payload: {
  diff: string;
  commitMsg: string;
  hash: string;
  files: string[];
  projectName: string;
}): Promise<void> {
  const { extractAndLearn } = await import("../lib/llmExtract.js");

  const preamble = `Git commit: ${payload.commitMsg}\nFiles changed: ${payload.files.slice(0, 5).join(", ")}`;

  await extractAndLearn(payload.diff, payload.projectName, {
    source: `git-commit:${payload.hash}`,
    tags: payload.files.slice(0, 5),
    preamble,
  });
}

// ── Hook mode (main entry) ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Extract mode — reads payload from stdin, called by detached subprocess
  if (process.argv.includes("--extract")) {
    try {
      let raw = "";
      for await (const chunk of Bun.stdin.stream()) raw += new TextDecoder().decode(chunk);
      const payload = JSON.parse(raw);
      await runExtract(payload);
    } catch (err) {
      process.stderr.write(`[GitCommit] extract error: ${err}\n`);
    }
    process.exit(0);
  }

  // Hook mode — must exit 0 immediately, never block git
  try {
    const cfg = readConfigSync() as Config;
    if (!cfg.ltm?.gitLearnEnabled) process.exit(0);

    const projectRoot = getProjectRoot();
    if (shouldSkipRepo(projectRoot)) process.exit(0);

    const { hash, message, files } = getCommitMeta(projectRoot);
    if (!hash) process.exit(0);

    const ignorePatterns = cfg.ltm?.gitLearnIgnorePatterns ?? ["package-lock.json", "*.lock", "dist/", ".min.js"];
    const minDiffChars = cfg.ltm?.gitLearnMinDiffChars ?? 200;

    let diff = getDiffText(projectRoot, MAX_DIFF_CHARS);
    diff = applyIgnorePatterns(diff, ignorePatterns);

    if (diff.length < minDiffChars) process.exit(0);

    const projectName = resolveProject(projectRoot).name;

    const payload = { diff, commitMsg: message, hash, files, projectName };

    // Spawn detached so git doesn't wait for LLM extraction — pipe payload via stdin
    const child = Bun.spawn(
      ["bun", "run", join(PLUGIN_ROOT, "hooks/src/GitCommit.ts"), "--extract"],
      {
        detached: true,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      },
    );
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.unref();
  } catch (err) {
    process.stderr.write(`[GitCommit] hook error: ${err}\n`);
  }

  process.exit(0);
}

await safeRun("GitCommit", main);
