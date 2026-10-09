/**
 * hookHarness.ts — shared helpers for hook subprocess tests (not a test file).
 *
 * Every sandbox points HOME, CLAUDE_PLUGIN_DATA, LTM_DB_PATH and TMPDIR at a
 * fresh temp dir, so hook runs never touch the real ~/.claude, registry or DB.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
export const HOOKS_SRC = join(PROJECT_ROOT, "hooks", "src");

export interface Sandbox {
  base: string;
  home: string;
  data: string;
  dbPath: string;
  tmp: string;
  env: Record<string, string | undefined>;
  cleanup(): void;
}

export function makeSandbox(label: string): Sandbox {
  const base = mkdtempSync(join(tmpdir(), `ltm-${label}-`));
  const home = join(base, "home");
  const data = join(base, "plugin-data");
  const tmp = join(base, "tmp");
  for (const d of [home, data, tmp]) mkdirSync(d, { recursive: true });
  const dbPath = join(data, "openltm.db");
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    CLAUDE_PLUGIN_DATA: data,
    CLAUDE_PLUGIN_ROOT: PROJECT_ROOT,
    LTM_DB_PATH: dbPath,
    TMPDIR: tmp,
    LTM_EMBED_PROVIDER: "disabled",
  };
  return { base, home, data, dbPath, tmp, env, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export interface HookResult { exitCode: number | null; stdout: string; stderr: string; ms: number }

export async function runHook(
  hook: string,
  payload: unknown,
  sb: Sandbox,
  extraEnv: Record<string, string | undefined> = {},
): Promise<HookResult> {
  const start = performance.now();
  const proc = Bun.spawn([process.execPath, "run", join(HOOKS_SRC, hook)], {
    stdin: new Blob([typeof payload === "string" ? payload : JSON.stringify(payload)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...sb.env, ...extraEnv },
    cwd: PROJECT_ROOT,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr, ms: performance.now() - start };
}

/** Create + fully migrate the sandbox DB (schema.sql, then migrations) in a subprocess. */
export function initSandboxDb(sb: Sandbox): void {
  const res = Bun.spawnSync(
    [process.execPath, "-e", 'const c = await import("@rohirik/openltm-core"); await c.waitForInit();'],
    { env: sb.env, cwd: PROJECT_ROOT },
  );
  if (res.exitCode !== 0) throw new Error(`DB init failed: ${res.stderr.toString()}`);
}

export function seedMemory(
  sb: Sandbox,
  m: { content: string; category?: string; importance?: number; project?: string | null; status?: string; stale?: boolean; files?: string[] },
): number {
  const db = new Database(sb.dbPath);
  try {
    const res = db.run(
      `INSERT INTO memories (content, category, importance, project_scope, status, stale_flagged_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [m.content, m.category ?? "pattern", m.importance ?? 3, m.project ?? null, m.status ?? "active", m.stale ? "2026-01-01 00:00:00" : null],
    );
    const id = Number(res.lastInsertRowid);
    for (const f of m.files ?? []) {
      db.run(`INSERT INTO memory_files (memory_id, path, project_scope) VALUES (?, ?, ?)`, [id, f, m.project ?? null]);
    }
    return id;
  } finally {
    db.close();
  }
}

export function registerProject(sb: Sandbox, cwd: string, name: string): string {
  const projects = join(sb.home, ".claude", "projects");
  mkdirSync(join(projects, name), { recursive: true });
  writeFileSync(join(projects, "registry.json"), JSON.stringify({ [cwd]: name }));
  return join(projects, name);
}

export function writeConfig(sb: Sandbox, config: unknown): void {
  mkdirSync(join(sb.home, ".claude"), { recursive: true });
  writeFileSync(join(sb.home, ".claude", "config.json"), JSON.stringify(config));
}

export function markOnboarded(sb: Sandbox): void {
  writeFileSync(join(sb.data, "onboarded.flag"), new Date().toISOString());
}
