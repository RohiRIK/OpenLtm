#!/usr/bin/env bun
/**
 * qa/hooks-smoke.ts — runs every Claude Code hook as Claude Code would (JSON on
 * stdin, via hooks/bin/run-hook.sh with a stripped PATH) in a throwaway sandbox,
 * and prints PASS/FAIL per check. Never touches the real ~/.claude.
 *
 * Usage (repo root): bun run scripts/qa/hooks-smoke.ts
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const T = mkdtempSync(join(tmpdir(), "ltm-hooks-smoke-"));
const home = join(T, "home"), data = join(T, "data"), tmp = join(T, "tmp");
const repo = join(T, "code", "Demo_Repo");
for (const d of [home, data, tmp, join(repo, "src", "deep")]) mkdirSync(d, { recursive: true });
const dbPath = join(data, "openltm.db");
const env: Record<string, string> = {
  // Stripped PATH like Claude Code's hook runner; run-hook.sh must still find bun.
  PATH: "/usr/bin:/bin", HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
  CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data, LTM_DB_PATH: dbPath, TMPDIR: tmp,
  LTM_EMBED_PROVIDER: "disabled", LTM_JANITOR_ON_SESSION_END: "0",
};
// run-hook.sh checks ~/.bun/bin/bun; the sandbox HOME has none, so link this bun in.
mkdirSync(join(home, ".bun", "bin"), { recursive: true });
Bun.spawnSync(["ln", "-s", process.execPath, join(home, ".bun", "bin", "bun")]);

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${String(detail).slice(0, 600)}` : ""}`);
}
function hook(file: string, payload: object): { code: number; out: string; ms: number } {
  const t0 = performance.now();
  const r = Bun.spawnSync([join(ROOT, "hooks", "bin", "run-hook.sh"), join(ROOT, "hooks", "src", file)], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)), env, cwd: T,
  });
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), ms: performance.now() - t0 };
}
function git(...args: string[]): void {
  Bun.spawnSync(["git", "-C", repo, "-c", "user.name=qa", "-c", "user.email=qa@example.com", "-c", "core.hooksPath=/dev/null", ...args]);
}
function seed(content: string, opts: { importance?: number; project?: string | null; files?: string[] } = {}): number {
  const r = Bun.spawnSync([process.execPath, "-e",
    `const c = await import("@rohirik/openltm-core"); await c.waitForInit();
     const r = c.learn(${JSON.stringify({ content, category: "gotcha", importance: opts.importance ?? 3, project_scope: opts.project ?? undefined, files: opts.files, skipExport: true })});
     console.log(r.id);`], { env: { ...env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }, cwd: ROOT });
  return Number(r.stdout.toString().trim().split("\n").pop());
}
const transcript = (name: string, lines: object[]) => { const p = join(T, `${name}.jsonl`); writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n"); return p; };
const edit = (path: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: path, name: "Edit", input: { file_path: path } }] } });
const user = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const toolErr = (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", is_error: true, content: text }] } });

try {
  git("init", "-q");
  const globalId = seed("SQLite WAL needs busy_timeout because hooks and the MCP server write concurrently", { importance: 5 });

  // ── SessionStart ────────────────────────────────────────────────────────────
  const start = hook("SessionStart.ts", { cwd: join(repo, "src", "deep"), session_id: "s1", source: "startup" });
  check("SessionStart (startup) exits 0 under a stripped PATH", start.code === 0, start.out);
  check("new project registered under the repo-root name, not the subfolder", start.out.includes('**"demo-repo"**'), start.out);
  const registry = join(data, "projects", "registry.json");
  check("registry lives in the plugin data dir", existsSync(registry) && readFileSync(registry, "utf-8").includes("demo-repo"));
  check("nothing written to ~/.claude/projects", !existsSync(join(home, ".claude", "projects", "registry.json")));
  check("brand-new project still gets the globals index", start.out.includes(`[${globalId}]`), start.out);
  check("compact index header present", start.out.includes("LTM index (use MCP get <id> for full memory)"), start.out);

  const resume = hook("SessionStart.ts", { cwd: repo, session_id: "s1", source: "resume" });
  check("SessionStart (resume) shows no onboarding or new-project prompt", resume.code === 0 && !/auto-onboard|New Project/.test(resume.out), resume.out);

  mkdirSync(join(data, "proposals"), { recursive: true });
  writeFileSync(join(data, "proposals", "p.json"), JSON.stringify({ generatedAt: Date.now(), proposals: [{ content: "x", category: "gotcha", importance: 3, source: "qa" }] }));
  const withProps = hook("SessionStart.ts", { cwd: repo, session_id: "s2", source: "resume" });
  check("pending proposals are announced", withProps.out.includes("1 memory proposal(s) pending"), withProps.out);
  rmSync(join(data, "proposals", "p.json"));

  // ── UserPromptSubmit ────────────────────────────────────────────────────────
  const prompt = { prompt: "why does sqlite need a busy timeout when hooks write concurrently?", cwd: repo, session_id: "q1" };
  const p1 = hook("UserPromptSubmit.ts", prompt);
  check("UserPromptSubmit injects the relevant memory", p1.out.includes("LTM (relevant to this prompt):") && p1.out.includes(`[${globalId}]`), p1.out);
  check(`UserPromptSubmit is fast (${Math.round(p1.ms)}ms incl. bun start, budget 300ms)`, p1.ms < 300);
  check("UserPromptSubmit never repeats a memory in the same session", hook("UserPromptSubmit.ts", prompt).out.trim() === "");
  check("slash commands are skipped", hook("UserPromptSubmit.ts", { ...prompt, session_id: "q2", prompt: "/openltm:memory recall sqlite busy timeout" }).out.trim() === "");

  // ── PostToolUse (git commit → stale) ───────────────────────────────────────
  const anchored = seed("The parser entry point lives in src/parser.ts", { project: "demo-repo", files: ["src/parser.ts"] });
  writeFileSync(join(repo, "src", "parser.ts"), "export {}\n");
  git("add", "-A"); git("commit", "-qm", "parser");
  const ptu = hook("PostToolUse.ts", { cwd: repo, session_id: "s1", tool_name: "Bash", tool_input: { command: "git commit -m parser" }, tool_response: { stdout: "", stderr: "", interrupted: false } });
  const stale = new Database(dbPath, { readonly: true }).query<{ n: number }, [number]>("SELECT COUNT(*) n FROM memories WHERE id=? AND stale_flagged_at IS NOT NULL").get(anchored)!.n;
  check("PostToolUse flags the anchored memory stale after git commit", ptu.code === 0 && ptu.out === "" && stale === 1, ptu.out);

  // ── Stop (UpdateContext): one row per session ─────────────────────────────
  const t1 = transcript("t1", [user("hi"), edit("/repo/a.ts"), user("ok")]);
  const stop1 = hook("UpdateContext.ts", { cwd: repo, session_id: "sess-AAA", transcript_path: t1 });
  writeFileSync(t1, readFileSync(t1, "utf-8") + JSON.stringify(edit("/repo/b.ts")) + "\n");
  hook("UpdateContext.ts", { cwd: repo, session_id: "sess-AAA", transcript_path: t1 });
  const rows = new Database(dbPath, { readonly: true }).query<{ content: string }, []>("SELECT content FROM context_items WHERE type='progress' AND session_id='sess-AAA'").all();
  check("Stop prints nothing", stop1.out === "", stop1.out);
  check("Stop keeps one progress row per session, updated each turn", rows.length === 1 && rows[0]!.content.includes("b.ts"), JSON.stringify(rows));

  // ── SessionEnd (EvaluateSession) ───────────────────────────────────────────
  writeFileSync(join(tmp, "ltm-prompt-recall-sess-AAA.json"), "[1]");
  const t2 = transcript("t2", [user("a"), user("b"), edit("/repo/c.ts"), toolErr("<tool_use_error>File has not been read yet</tool_use_error>"),
    toolErr("Exit code 1\nerror: Cannot find module 'left-pad' from '/repo/src/index.ts'"), user("c")]);
  const end = hook("EvaluateSession.ts", { cwd: repo, session_id: "sess-AAA", transcript_path: t2, reason: "exit" });
  const patterns = existsSync(join(data, "learned", "patterns")) ? readdirSync(join(data, "learned", "patterns")) : [];
  check("SessionEnd writes the session summary under the plugin data dir", end.code === 0 && patterns.some((f) => f.endsWith("-sess-AAA.md")), patterns);
  check("nothing written into the plugin install dir", !existsSync(join(ROOT, "skills", "Learned", "patterns", patterns[0] ?? "none")));
  const props = existsSync(join(data, "proposals", "sess-AAA.json")) ? readFileSync(join(data, "proposals", "sess-AAA.json"), "utf-8") : "";
  check("SessionEnd proposes the real error, drops harness noise", props.includes("left-pad") && !props.includes("has not been read"), props);
  check("SessionEnd removes the prompt-recall dedupe state", !existsSync(join(tmp, "ltm-prompt-recall-sess-AAA.json")));

  // ── PreCompact → SessionStart(compact) ─────────────────────────────────────
  hook("PreCompact.ts", { cwd: repo, session_id: "s1" });
  const compact = hook("SessionStart.ts", { cwd: repo, session_id: "s1", source: "compact" });
  check("SessionStart (compact) leads with the compaction snapshot", compact.out.includes("compaction snapshot") && compact.out.includes("Compaction checkpoint"), compact.out);
} catch (err) {
  failures++;
  console.log(`FAIL  smoke run threw: ${err}`);
} finally {
  rmSync(T, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll hook smoke checks passed." : `\n${failures} hook smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
