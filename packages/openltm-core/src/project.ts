/**
 * project.ts — the one project-identity resolver shared by every host.
 *
 * Every adapter (Claude Code hooks, Pi, OpenCode, OpenClaw, the bunx hook CLI)
 * maps a working directory to a `project_scope` through this module, so the
 * same repository gets the same name — and therefore the same memories —
 * whichever agent is running.
 *
 * Precedence (resolveProjectName):
 *   1. registry exact match            { "/abs/path": "name" }
 *   2. registry longest-prefix match   (cwd is inside a registered path)
 *   3. git repository root basename, normalized (worktrees → main repo)
 *   4. cwd basename, normalized
 *
 * Continuity rule: before a host switches to the new name, it passes the name it
 * used for this cwd historically (`legacyName`). If the database has rows under
 * that legacy name and none under the new one, the legacy name is kept, so no
 * existing memory is orphaned by the change.
 *
 * Runtime contract: this file must stay loadable under plain Node (the OpenClaw
 * adapter inlines it into a Node bundle). Only `node:` built-ins at module level;
 * SQLite is reached through an injected opener, never a static `bun:sqlite`
 * import. Bun hosts inject theirs via `createProjectDataProbe` (projectProbe.ts).
 */
import { copyFileSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

// ── Home / legacy locations ─────────────────────────────────────────────────

/**
 * The user's home directory, honouring a runtime `HOME` (`USERPROFILE` on
 * Windows) change. Bun caches `os.homedir()` at startup, so test isolation that
 * swaps HOME in-process would otherwise be ignored.
 */
export function getHomeDir(): string {
  const fromEnv = process.platform === "win32" ? process.env["USERPROFILE"] : process.env["HOME"];
  return fromEnv && fromEnv.trim() ? fromEnv : homedir();
}

/** `~/.claude` — Claude Code's own directory. */
export function getLegacyClaudeDir(): string {
  return join(getHomeDir(), ".claude");
}

/**
 * `~/.claude/projects` — Claude Code's transcript directory. OpenLTM kept its
 * registry and context files here before 2.17; it is now read-only for OpenLTM
 * (legacy migration source + transcripts).
 */
export function getClaudeTranscriptsDir(): string {
  return join(getLegacyClaudeDir(), "projects");
}

/** Legacy OpenLTM registry inside Claude Code's transcript dir. Never written. */
export function getLegacyRegistryPath(): string {
  return join(getClaudeTranscriptsDir(), "registry.json");
}

// ── Name derivation ──────────────────────────────────────────────────────────

/** Lowercase, every non-alphanumeric run → "-", trim leading/trailing dashes. */
export function normalizeProjectName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function stripTrailingSep(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, "") : p;
}

/** Raw last path segment — the name Pi, OpenCode and OpenClaw used before 2.17. */
export function legacyLastSegment(cwd: string): string {
  return stripTrailingSep(cwd).split(/[\\/]/).pop() ?? "";
}

/** Full-path slug — the name Claude Code hooks used for unregistered cwds before 2.17. */
export function legacyClaudeSlug(cwd: string): string {
  return cwd.replace(new RegExp("\\" + sep, "g"), "-").replace(/\./g, "-");
}

/**
 * Walk up from `cwd` to the nearest directory containing a `.git` entry (a
 * directory for a normal clone, a file for worktrees/submodules). Pure fs, no
 * subprocess — this runs on hook hot paths. Returns null outside a repository,
 * for relative input, and when the only match is the home directory or the
 * filesystem root (a dotfiles repo at ~ must not swallow every project).
 */
export function findRepoRoot(cwd: string): string | null {
  if (!cwd || !isAbsolute(cwd)) return null;
  const home = resolve(getHomeDir());
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      const parent = dirname(dir);
      if (dir === home || parent === dir) return null;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * For a linked worktree (`.git` file → `<main>/.git/worktrees/<id>`), return the
 * main repository root so every worktree of a repo shares one project name.
 * Submodules and normal clones return `root` unchanged.
 */
export function repoIdentityRoot(root: string): string {
  const gitPath = join(root, ".git");
  try {
    if (!statSync(gitPath).isFile()) return root;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(gitPath, "utf-8"));
    if (!m) return root;
    const gitdir = resolve(root, m[1]!.trim());
    const marker = `${sep}.git${sep}worktrees${sep}`;
    const idx = gitdir.lastIndexOf(marker);
    return idx > 0 ? gitdir.slice(0, idx) : root;
  } catch {
    return root;
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

export type ProjectRegistry = Record<string, string>;

/** true = rows exist, false = none (or no database), null = could not check. */
export type ProjectDataProbe = (name: string) => boolean | null;

export type ProjectNameSource = "registry" | "registry-prefix" | "repo-root" | "cwd" | "legacy";

export interface ResolveProjectNameOptions {
  /** cwd → name map (see loadProjectRegistry). */
  registry?: ProjectRegistry | null;
  /** Name this host used for `cwd` before the unified resolver. */
  legacyName?: string | null;
  /**
   * Which resolved names the legacy name may shadow.
   *  - "fallback" (default): only names from steps 3/4. Use when the registry
   *    already WAS the host's legacy mechanism (Claude Code hooks).
   *  - "all": registry names too. Use for hosts that never read the registry
   *    (Pi, OpenCode, OpenClaw), whose old rows live under the raw cwd segment.
   */
  legacyScope?: "fallback" | "all";
  /** Continuity probe. Defaults to a read-only check of `dbPath` (Node only). */
  hasProjectData?: ProjectDataProbe;
  /** Database to probe when `hasProjectData` is not given. */
  dbPath?: string | null;
}

export interface ProjectNameResolution {
  name: string;
  source: ProjectNameSource;
  /** Registry key that matched (registry / registry-prefix), else null. */
  registeredPath: string | null;
  /** The name the precedence chain produced before the continuity rule. */
  candidate: string;
  /** source === "legacy" and the probe confirmed legacy rows (vs. could not check). */
  legacyVerified: boolean;
}

function matchRegistry(cwd: string, registry: ProjectRegistry | null | undefined): { name: string; path: string; exact: boolean } | null {
  if (!registry) return null;
  const key = stripTrailingSep(cwd);
  for (const p of [cwd, key]) {
    if (registry[p]) return { name: registry[p]!, path: p, exact: true };
  }
  const paths = Object.keys(registry).sort((a, b) => b.length - a.length);
  for (const p of paths) {
    const base = stripTrailingSep(p);
    if (registry[p] && (key.startsWith(base + "/") || key.startsWith(base + sep))) {
      return { name: registry[p]!, path: p, exact: false };
    }
  }
  return null;
}

/** Steps 3/4 only: the name a cwd gets when nothing is registered. */
export function fallbackProjectName(cwd: string): { name: string; source: "repo-root" | "cwd" } {
  const root = findRepoRoot(cwd);
  if (root) {
    const name = normalizeProjectName(basename(repoIdentityRoot(root)));
    if (name) return { name, source: "repo-root" };
  }
  return { name: normalizeProjectName(legacyLastSegment(cwd)), source: "cwd" };
}

export function resolveProjectNameDetailed(cwd: string, opts: ResolveProjectNameOptions = {}): ProjectNameResolution {
  const hit = matchRegistry(cwd, opts.registry);
  const fb = hit ? null : fallbackProjectName(cwd);
  const base: ProjectNameResolution = hit
    ? { name: hit.name, source: hit.exact ? "registry" : "registry-prefix", registeredPath: hit.path, candidate: hit.name, legacyVerified: false }
    : { name: fb!.name, source: fb!.source, registeredPath: null, candidate: fb!.name, legacyVerified: false };

  const legacy = opts.legacyName?.trim() || null;
  const useLegacy = (verified: boolean): ProjectNameResolution =>
    ({ ...base, name: legacy!, source: "legacy", registeredPath: null, legacyVerified: verified });

  if (!legacy || legacy === base.name) return base;
  if (!base.name) return useLegacy(false); // nothing derivable (e.g. cwd "/") — keep the old name
  if (hit && opts.legacyScope !== "all") return base;

  const probe = opts.hasProjectData ?? (opts.dbPath ? (n: string) => projectHasData(n, opts.dbPath!) : null);
  if (!probe) return base; // no database to consult → nothing can be orphaned

  // Confirmed rows under the new name always win. Otherwise keep the legacy
  // name unless the probe confirmed it is empty: when the probe cannot tell
  // (null), keeping the old name is the choice that never orphans rows.
  const legacyHas = probe(legacy);
  if (legacyHas === false) return base;
  const candidateHas = probe(base.name);
  if (candidateHas === true) return base;
  return useLegacy(legacyHas === true && candidateHas === false);
}

/** Resolve `cwd` to a project name. See resolveProjectNameDetailed. */
export function resolveProjectName(cwd: string, opts: ResolveProjectNameOptions = {}): string {
  return resolveProjectNameDetailed(cwd, opts).name;
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** Parse a registry file; missing or malformed → {} (never throws). */
export function readRegistryFile(path: string): ProjectRegistry {
  try {
    if (!existsSync(path)) return {};
    const data = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: ProjectRegistry = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read the registry: the OpenLTM registry, plus any legacy entry it lacks.
 * The merge keeps entries that older slash-commands still write to the legacy
 * file visible. Read-only — never writes either file.
 */
export function loadProjectRegistry(registryPath: string, legacyRegistryPath: string | null = getLegacyRegistryPath()): ProjectRegistry {
  const current = readRegistryFile(registryPath);
  if (!legacyRegistryPath || legacyRegistryPath === registryPath) return current;
  return { ...readRegistryFile(legacyRegistryPath), ...current };
}

/**
 * One-time copy of the legacy registry to the OpenLTM location. Runs only when
 * the new file is missing; the legacy file is never modified. Idempotent.
 * Returns true when a copy happened.
 */
export function migrateLegacyRegistry(registryPath: string, legacyRegistryPath: string = getLegacyRegistryPath()): boolean {
  if (registryPath === legacyRegistryPath || existsSync(registryPath) || !existsSync(legacyRegistryPath)) return false;
  try {
    mkdirSync(dirname(registryPath), { recursive: true });
    copyFileSync(legacyRegistryPath, registryPath, fsConstants.COPYFILE_EXCL);
    return true;
  } catch {
    return false; // lost a race to another process, or unreadable legacy — both fine
  }
}

// ── Per-project context markdown ─────────────────────────────────────────────

export const CONTEXT_FILES = [
  "context-goals.md",
  "context-decisions.md",
  "context-progress.md",
  "context-gotchas.md",
  "context-summary.md",
] as const;

/** A name that is safe to use as a single directory segment. */
export function isSafeProjectDirName(name: string): boolean {
  return !!name && name !== "." && name !== ".." && !/[\\/\0]/.test(name);
}

export function hasContextFiles(dir: string): boolean {
  return CONTEXT_FILES.some((f) => existsSync(join(dir, f)));
}

/**
 * One-time copy of `<legacyProjectsDir>/<name>/context-*.md` into
 * `<projectsDir>/<name>/` when the new dir has none of them. Legacy files are
 * never modified or deleted (Claude Code owns that directory). Idempotent:
 * once any context file exists in the new dir, nothing is copied again.
 * Returns the copied file names.
 */
export function migrateLegacyContextFiles(name: string, projectsDir: string, legacyProjectsDir: string = getClaudeTranscriptsDir()): string[] {
  if (!isSafeProjectDirName(name)) return [];
  const target = join(projectsDir, name);
  const source = join(legacyProjectsDir, name);
  if (resolve(target) === resolve(source) || hasContextFiles(target)) return [];
  const present = CONTEXT_FILES.filter((f) => existsSync(join(source, f)));
  if (present.length === 0) return [];
  const copied: string[] = [];
  try {
    mkdirSync(target, { recursive: true });
    for (const f of present) {
      try {
        copyFileSync(join(source, f), join(target, f), fsConstants.COPYFILE_EXCL);
        copied.push(f);
      } catch { /* already there (concurrent migration) or unreadable — skip */ }
    }
  } catch { /* target not creatable — leave legacy in place, nothing lost */ }
  return copied;
}

// ── Continuity probe ─────────────────────────────────────────────────────────

/** Minimal read-only handle — satisfied by bun:sqlite and node:sqlite. */
export interface ProbeDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
  close(): void;
}

export type ProbeDbOpener = (dbPath: string) => ProbeDb;

let _nodeOpener: ProbeDbOpener | null | undefined;

/**
 * node:sqlite opener for Node hosts (OpenClaw). Bun hosts must inject their own
 * opener instead: opening a bun:sqlite handle before core's ensureCustomSqlite()
 * would lock the process out of the extension-enabled SQLite (no vec, no honker).
 */
function nodeOpener(): ProbeDbOpener | null {
  if (_nodeOpener !== undefined) return _nodeOpener;
  _nodeOpener = null;
  if (process.versions?.["bun"]) return null;
  const emit = process.emitWarning;
  try {
    // node:sqlite prints a one-time ExperimentalWarning on load; it is noise in
    // the host's log for a single read-only lookup, so drop just that one.
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      const msg = typeof warning === "string" ? warning : warning?.message;
      if (/sqlite/i.test(String(msg))) return;
      return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
    }) as typeof process.emitWarning;
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (path: string, opts: { readOnly: boolean }) => ProbeDb;
    };
    _nodeOpener = (p) => new DatabaseSync(p, { readOnly: true });
  } catch {
    _nodeOpener = null; // Node < 22.5 — callers treat "cannot check" as keep-legacy
  } finally {
    process.emitWarning = emit;
  }
  return _nodeOpener;
}

const PROBE_QUERIES = [
  "SELECT 1 FROM memories WHERE project_scope = ? LIMIT 1",
  "SELECT 1 FROM context_items WHERE project_name = ? LIMIT 1",
] as const;

/**
 * Does the database hold any memory or context item for `name`? One indexed
 * `SELECT 1 … LIMIT 1` per table on a short-lived read-only handle.
 * Missing database → false (never created here). Unopenable → null.
 */
export function projectHasData(name: string, dbPath: string, open: ProbeDbOpener | null = nodeOpener()): boolean | null {
  if (!name) return false;
  if (!dbPath || !existsSync(dbPath)) return false;
  if (!open) return null;
  let db: ProbeDb;
  try {
    db = open(dbPath);
  } catch {
    return null;
  }
  try {
    for (const sql of PROBE_QUERIES) {
      try {
        if (db.prepare(sql).get(name) != null) return true;
      } catch (err) {
        if (!/no such table/i.test(String(err))) return null;
      }
    }
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * Data dir for hosts that cannot import core's paths.ts (Node adapters):
 * LTM_DATA_DIR → CLAUDE_PLUGIN_DATA → directory of the database.
 */
export function dataDirFor(dbPath: string): string {
  return process.env["LTM_DATA_DIR"] || process.env["CLAUDE_PLUGIN_DATA"] || dirname(dbPath);
}
