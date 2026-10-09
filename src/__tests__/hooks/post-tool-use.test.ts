/**
 * PostToolUse (matcher Bash): `git commit` → flag memories anchored to the
 * committed files as stale. Uses a real temp git repo.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { initSandboxDb, makeSandbox, registerProject, runHook, seedMemory, writeConfig, type Sandbox } from "./hookHarness";

let sb: Sandbox;
let repo: string;

function git(args: string[], env: Record<string, string> = {}): string {
  const res = Bun.spawnSync(["git", "-c", "user.name=LTM Test", "-c", "user.email=ltm@test.local", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    env: { ...sb.env, GIT_CONFIG_NOSYSTEM: "1", ...env },
  });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout.toString().trim();
}

function commitFiles(files: Record<string, string>, env: Record<string, string> = {}): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "test commit"], env);
  return git(["rev-parse", "HEAD"]);
}

function staleOf(id: number): { stale_flagged_at: string | null; stale_reason: string | null } {
  const db = new Database(sb.dbPath, { readonly: true });
  try {
    return db.query<{ stale_flagged_at: string | null; stale_reason: string | null }, [number]>(
      "SELECT stale_flagged_at, stale_reason FROM memories WHERE id = ?",
    ).get(id)!;
  } finally {
    db.close();
  }
}

const payload = (command: string, extra: Record<string, unknown> = {}) => ({
  session_id: "s1",
  cwd: repo,
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command, description: "commit" },
  tool_response: { stdout: "[main abc123] test commit", stderr: "", interrupted: false },
  ...extra,
});

beforeEach(() => {
  sb = makeSandbox("posttooluse");
  repo = join(sb.base, "repo");
  mkdirSync(repo, { recursive: true });
  git(["init", "-q"]);
  initSandboxDb(sb);
  registerProject(sb, repo, "repo-proj");
});

afterEach(() => sb.cleanup());

describe("PostToolUse hook (subprocess)", () => {
  it("flags memories anchored to committed files; exempts importance 5 and untouched files", async () => {
    const anchored = seedMemory(sb, { content: "a.ts exports the parser", project: "repo-proj", files: ["src/a.ts"] });
    const globalAnchor = seedMemory(sb, { content: "docs/b.md documents setup", project: null, files: ["docs/b.md"] });
    const untouched = seedMemory(sb, { content: "other.ts is unrelated", project: "repo-proj", files: ["src/other.ts"] });
    const permanent = seedMemory(sb, { content: "a.ts permanent rule", project: "repo-proj", importance: 5, files: ["src/a.ts"] });
    const sha = commitFiles({ "src/a.ts": "export {}\n", "docs/b.md": "# b\n" });

    const { exitCode, stdout } = await runHook("PostToolUse.ts", payload(`git add -A && git commit -m "feat: parser"`), sb);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(staleOf(anchored).stale_flagged_at).not.toBeNull();
    expect(staleOf(anchored).stale_reason).toBe(`commit ${sha}`);
    expect(staleOf(globalAnchor).stale_flagged_at).not.toBeNull();
    expect(staleOf(untouched).stale_flagged_at).toBeNull();
    expect(staleOf(permanent).stale_flagged_at).toBeNull();
  }, 30_000);

  it("ignores non-commit commands, failed tool calls and disabled config", async () => {
    const anchored = seedMemory(sb, { content: "a.ts exports the parser", project: "repo-proj", files: ["src/a.ts"] });
    commitFiles({ "src/a.ts": "export {}\n" });

    await runHook("PostToolUse.ts", payload("git status && git log -1"), sb);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();

    await runHook("PostToolUse.ts", payload("git commit -m x", { tool_response: { interrupted: true } }), sb);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();

    await runHook("PostToolUse.ts", payload("git commit -m x", { tool_name: "Read" }), sb);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();

    writeConfig(sb, { ltm: { gitInvalidateEnabled: false } });
    const { exitCode } = await runHook("PostToolUse.ts", payload("git commit -m x"), sb);
    expect(exitCode).toBe(0);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();
  }, 30_000);

  it("does not re-flag for a HEAD it already processed or an old HEAD (no-op commit)", async () => {
    const anchored = seedMemory(sb, { content: "a.ts exports the parser", project: "repo-proj", files: ["src/a.ts"] });
    commitFiles({ "src/a.ts": "export {}\n" });
    await runHook("PostToolUse.ts", payload("git commit -m x"), sb);
    expect(staleOf(anchored).stale_flagged_at).not.toBeNull();

    // Reviewed + revalidated, then `git commit` runs again with nothing to commit.
    const db = new Database(sb.dbPath);
    db.run("UPDATE memories SET stale_flagged_at = NULL, stale_reason = NULL WHERE id = ?", [anchored]);
    db.close();
    await runHook("PostToolUse.ts", payload("git commit -m again || true"), sb);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();

    // A HEAD committed long ago is not "the commit this command made".
    const old = "2020-01-01T00:00:00Z";
    commitFiles({ "src/a.ts": "export const x = 1;\n" }, { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
    await runHook("PostToolUse.ts", payload("git commit -m old"), sb);
    expect(staleOf(anchored).stale_flagged_at).toBeNull();
  }, 30_000);

  it("exits 0 silently on malformed input or a cwd that is not a repo", async () => {
    const bad = await runHook("PostToolUse.ts", "not json", sb);
    expect(bad.exitCode).toBe(0);
    expect(bad.stdout).toBe("");
    const notRepo = join(sb.base, "plain-dir");
    mkdirSync(notRepo);
    const res = await runHook("PostToolUse.ts", { ...payload("git commit -m x"), cwd: notRepo }, sb);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  }, 30_000);
});
