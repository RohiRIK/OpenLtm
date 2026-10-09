/**
 * project.test.ts — the shared cwd → project_scope resolver.
 *
 * Covers normalization, the repo-root walk, the precedence chain, and the
 * continuity rule against real SQLite files (memories / context_items rows).
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeProjectName, findRepoRoot, repoIdentityRoot, resolveProjectName, resolveProjectNameDetailed,
  legacyClaudeSlug, legacyLastSegment, projectHasData, readRegistryFile, loadProjectRegistry,
  type ProjectDataProbe,
} from "../project.js";
import { createProjectDataProbe } from "../projectProbe.js";

const CORE_INDEX = join(import.meta.dir, "..", "index.ts");
const PROJECT_TS = join(import.meta.dir, "..", "project.ts");
const tempDirs: string[] = [];

function tmp(prefix = "openltm-project-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** Minimal DB with just the two tables the continuity probe reads. */
function seedDb(path: string, rows: { memories?: string[]; contextItems?: string[] } = {}): void {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE memories (id INTEGER PRIMARY KEY, project_scope TEXT); CREATE TABLE context_items (id INTEGER PRIMARY KEY, project_name TEXT);");
  for (const p of rows.memories ?? []) db.run("INSERT INTO memories (project_scope) VALUES (?)", [p]);
  for (const p of rows.contextItems ?? []) db.run("INSERT INTO context_items (project_name) VALUES (?)", [p]);
  db.close();
}

/** Fake probe from a fixed set of names that "have rows". */
const probeOf = (names: string[]): ProjectDataProbe => (n) => names.includes(n);

describe("normalizeProjectName", () => {
  it("lowercases, dashes non-alphanumeric runs, trims dashes", () => {
    expect(normalizeProjectName("OpenLtm")).toBe("openltm");
    expect(normalizeProjectName("My Cool_App.v2")).toBe("my-cool-app-v2");
    expect(normalizeProjectName("--weird--")).toBe("weird");
    expect(normalizeProjectName("-home-user-OpenLtm")).toBe("home-user-openltm");
    expect(normalizeProjectName("")).toBe("");
    expect(normalizeProjectName("___")).toBe("");
  });

  it("matches the legacy helpers' inputs", () => {
    expect(legacyLastSegment("/home/user/OpenLtm/")).toBe("OpenLtm");
    expect(legacyClaudeSlug("/home/user/OpenLtm")).toBe("-home-user-OpenLtm");
    expect(legacyClaudeSlug("/home/u/my.app")).toBe("-home-u-my-app");
  });
});

describe("findRepoRoot", () => {
  it("walks up to the nearest .git directory", () => {
    const root = join(tmp(), "MyRepo");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "a", "src"), { recursive: true });
    expect(findRepoRoot(join(root, "packages", "a", "src"))).toBe(root);
    expect(findRepoRoot(root)).toBe(root);
  });

  it("accepts a .git file (worktree/submodule) and stops at the nearest one", () => {
    const outer = join(tmp(), "outer");
    const inner = join(outer, "vendor", "sub");
    mkdirSync(join(outer, ".git"), { recursive: true });
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, ".git"), "gitdir: ../../.git/modules/sub\n");
    expect(findRepoRoot(join(inner))).toBe(inner);
    expect(repoIdentityRoot(inner)).toBe(inner); // submodule is its own project
  });

  it("maps a linked worktree back to its main repository", () => {
    const base = tmp();
    const main = join(base, "MainRepo");
    const wt = join(base, "wt-feature");
    mkdirSync(join(main, ".git", "worktrees", "wt-feature"), { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt-feature")}\n`);
    expect(findRepoRoot(wt)).toBe(wt);
    expect(repoIdentityRoot(wt)).toBe(main);
    expect(resolveProjectName(join(wt))).toBe("mainrepo");
  });

  it("returns null outside a repo and for relative input", () => {
    const dir = join(tmp(), "no-repo", "deep");
    mkdirSync(dir, { recursive: true });
    expect(findRepoRoot(dir)).toBeNull();
    expect(findRepoRoot("relative/path")).toBeNull();
    expect(findRepoRoot("")).toBeNull();
  });

  it("never treats the home directory as a repo root (dotfiles repos)", () => {
    // A throwaway HOME — getHomeDir() reads $HOME at call time.
    const home = tmp("openltm-fake-home-");
    const saved = { HOME: process.env["HOME"], USERPROFILE: process.env["USERPROFILE"] };
    process.env["HOME"] = home;
    process.env["USERPROFILE"] = home;
    mkdirSync(join(home, ".git"), { recursive: true });
    const proj = join(home, "code", "proj");
    mkdirSync(proj, { recursive: true });
    try {
      expect(findRepoRoot(proj)).toBeNull();
      expect(resolveProjectName(proj)).toBe("proj");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("resolveProjectName precedence", () => {
  const base = tmp();
  const repo = join(base, "Acme_Repo");
  const sub = join(repo, "services", "Api");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(sub, { recursive: true });

  it("1. registry exact match wins", () => {
    const r = resolveProjectNameDetailed(sub, { registry: { [sub]: "api-svc", [repo]: "acme" } });
    expect(r).toMatchObject({ name: "api-svc", source: "registry", registeredPath: sub });
  });

  it("2. registry longest-prefix match", () => {
    const r = resolveProjectNameDetailed(join(sub, "src"), { registry: { [repo]: "acme", [sub]: "api-svc", "/": "root" } });
    expect(r).toMatchObject({ name: "api-svc", source: "registry-prefix", registeredPath: sub });
    expect(resolveProjectName(join(repo, "docs"), { registry: { [repo]: "acme" } })).toBe("acme");
  });

  it("does not prefix-match a sibling with a shared name prefix", () => {
    expect(resolveProjectName(`${repo}-other`, { registry: { [repo]: "acme" } })).toBe("acme-repo-other");
  });

  it("3. repo root basename, normalized", () => {
    expect(resolveProjectNameDetailed(sub)).toMatchObject({ name: "acme-repo", source: "repo-root", registeredPath: null });
  });

  it("4. cwd basename, normalized, outside any repo", () => {
    const loose = join(base, "Loose Dir");
    mkdirSync(loose, { recursive: true });
    expect(resolveProjectNameDetailed(loose)).toMatchObject({ name: "loose-dir", source: "cwd" });
    // Non-path input (OpenCode may pass a project name) — no repo walk.
    expect(resolveProjectName("OpenLtm")).toBe("openltm");
  });

  it("falls back to the legacy name when nothing is derivable", () => {
    expect(resolveProjectNameDetailed("/", { legacyName: "-" })).toMatchObject({ name: "-", source: "legacy" });
  });
});

describe("continuity rule", () => {
  const base = tmp();
  const repo = join(base, "OpenLtm");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const slug = legacyClaudeSlug(repo);

  it("keeps the legacy name when only it has rows", () => {
    const r = resolveProjectNameDetailed(repo, { legacyName: slug, hasProjectData: probeOf([slug]) });
    expect(r).toMatchObject({ name: slug, source: "legacy", candidate: "openltm", legacyVerified: true });
  });

  it("switches to the new name when the legacy name has no rows", () => {
    expect(resolveProjectName(repo, { legacyName: slug, hasProjectData: probeOf([]) })).toBe("openltm");
  });

  it("prefers the new name once it has rows, even if legacy has too", () => {
    expect(resolveProjectName(repo, { legacyName: slug, hasProjectData: probeOf([slug, "openltm"]) })).toBe("openltm");
  });

  it("keeps legacy (unverified) when the probe cannot tell", () => {
    const r = resolveProjectNameDetailed(repo, { legacyName: "OpenLtm", hasProjectData: () => null });
    expect(r).toMatchObject({ name: "OpenLtm", source: "legacy", legacyVerified: false });
  });

  it("legacyScope 'fallback' never shadows a registry name; 'all' does", () => {
    const registry = { [repo]: "acme" };
    const probe = probeOf(["OpenLtm"]);
    expect(resolveProjectName(repo, { registry, legacyName: "OpenLtm", hasProjectData: probe })).toBe("acme");
    expect(resolveProjectName(repo, { registry, legacyName: "OpenLtm", legacyScope: "all", hasProjectData: probe })).toBe("OpenLtm");
    // ...but only while the registry name is unused.
    expect(resolveProjectName(repo, { registry, legacyName: "OpenLtm", legacyScope: "all", hasProjectData: probeOf(["OpenLtm", "acme"]) })).toBe("acme");
  });

  it("works against a real database via createProjectDataProbe", () => {
    const dbPath = join(tmp(), "openltm.db");
    seedDb(dbPath, { memories: ["OpenLtm"], contextItems: [slug] });
    const probe = createProjectDataProbe(dbPath);
    expect(resolveProjectName(repo, { legacyName: "OpenLtm", hasProjectData: probe })).toBe("OpenLtm"); // memories row
    expect(resolveProjectName(repo, { legacyName: slug, hasProjectData: probe })).toBe(slug); // context_items row
    expect(resolveProjectName(repo, { legacyName: "never-used", hasProjectData: probe })).toBe("openltm");
  });

  it("no database → nothing to orphan → new name", () => {
    const missing = join(tmp(), "absent.db");
    expect(resolveProjectName(repo, { legacyName: slug, hasProjectData: createProjectDataProbe(missing) })).toBe("openltm");
    expect(existsSync(missing)).toBe(false); // the probe never creates the DB
  });
});

describe("projectHasData", () => {
  const open = (p: string) => new Database(p, { readonly: true }) as never;

  it("true/false per table, false for a missing DB or missing tables", () => {
    const dbPath = join(tmp(), "probe.db");
    seedDb(dbPath, { memories: ["m-only"], contextItems: ["c-only"] });
    expect(projectHasData("m-only", dbPath, open)).toBe(true);
    expect(projectHasData("c-only", dbPath, open)).toBe(true);
    expect(projectHasData("nobody", dbPath, open)).toBe(false);
    expect(projectHasData("", dbPath, open)).toBe(false);
    expect(projectHasData("x", join(tmp(), "none.db"), open)).toBe(false);

    const empty = join(tmp(), "empty.db");
    new Database(empty, { create: true }).close();
    expect(projectHasData("x", empty, open)).toBe(false);
  });

  it("null when the DB cannot be opened, or no opener exists (Bun default)", () => {
    const dbPath = join(tmp(), "probe2.db");
    seedDb(dbPath);
    expect(projectHasData("x", dbPath, () => { throw new Error("locked"); })).toBeNull();
    expect(projectHasData("x", dbPath)).toBeNull(); // default opener is Node-only
  });
});

describe("registry files", () => {
  it("readRegistryFile tolerates missing/malformed files and drops non-string values", () => {
    const dir = tmp();
    expect(readRegistryFile(join(dir, "nope.json"))).toEqual({});
    writeFileSync(join(dir, "bad.json"), "{not json");
    expect(readRegistryFile(join(dir, "bad.json"))).toEqual({});
    writeFileSync(join(dir, "mixed.json"), JSON.stringify({ "/a": "a", "/b": 3, "/c": "" }));
    expect(readRegistryFile(join(dir, "mixed.json"))).toEqual({ "/a": "a" });
  });

  it("loadProjectRegistry merges legacy entries, new file wins", () => {
    const dir = tmp();
    writeFileSync(join(dir, "new.json"), JSON.stringify({ "/x": "new-x" }));
    writeFileSync(join(dir, "old.json"), JSON.stringify({ "/x": "old-x", "/y": "old-y" }));
    expect(loadProjectRegistry(join(dir, "new.json"), join(dir, "old.json"))).toEqual({ "/x": "new-x", "/y": "old-y" });
    expect(loadProjectRegistry(join(dir, "new.json"), null)).toEqual({ "/x": "new-x" });
  });
});

describe("deriveProjectFromCwd (Pi / OpenCode / bunx hook)", () => {
  /** Run in a child so DB_PATH / data dir are this test's, not the shared process's. */
  function derive(cwd: string, env: Record<string, string>): string {
    const out = spawnSync(process.execPath, ["-e", `
      const { deriveProjectFromCwd } = await import(${JSON.stringify(CORE_INDEX)});
      console.log(deriveProjectFromCwd(${JSON.stringify(cwd)}));
    `], { env: { ...process.env, ...env }, encoding: "utf-8" });
    if (out.status !== 0) throw new Error(out.stderr);
    return out.stdout.trim().split("\n").pop()!;
  }

  it("normalizes, honours the registry, and keeps a raw-segment name that holds rows", () => {
    const data = tmp();
    const dbPath = join(data, "openltm.db");
    const cwd = join(tmp(), "MyService");
    mkdirSync(cwd, { recursive: true });
    const env = { LTM_DB_PATH: dbPath, LTM_DATA_DIR: data, CLAUDE_PLUGIN_DATA: data };

    expect(derive(cwd, env)).toBe("myservice"); // no DB yet

    seedDb(dbPath, { memories: ["MyService"] });
    expect(derive(cwd, env)).toBe("MyService"); // continuity: old Pi/OpenCode rows

    mkdirSync(join(data, "projects"), { recursive: true });
    writeFileSync(join(data, "projects", "registry.json"), JSON.stringify({ [cwd]: "svc" }));
    expect(derive(cwd, env)).toBe("MyService"); // registry name unused yet → still legacy

    const db = new Database(dbPath);
    db.run("INSERT INTO memories (project_scope) VALUES ('svc')");
    db.close();
    expect(derive(cwd, env)).toBe("svc"); // shared name now has rows → unified
  });
});

// OpenClaw runs project.ts under Node (inlined into its bundle) and probes with node:sqlite.
const hasNode = spawnSync("node", ["--version"]).status === 0;
const nodeHasSqlite = hasNode && spawnSync("node", ["-e", "require('node:sqlite')"]).status === 0;
(nodeHasSqlite ? describe : describe.skip)("project.ts under Node (OpenClaw)", () => {
  it("loads without Bun and applies continuity through node:sqlite", () => {
    const dir = tmp();
    const outfile = join(dir, "project.mjs");
    const build = spawnSync(process.execPath, ["build", PROJECT_TS, "--target=node", "--format=esm", "--outfile", outfile], { encoding: "utf-8" });
    expect(build.status).toBe(0);

    const dbPath = join(dir, "openltm.db");
    seedDb(dbPath, { memories: ["MyTool"] });
    const cwd = join(dir, "MyTool");
    mkdirSync(cwd, { recursive: true });
    const script = `
      const m = await import(${JSON.stringify(pathToFileURL(outfile).href)});
      const opts = { legacyName: "MyTool", legacyScope: "all", dbPath: ${JSON.stringify(dbPath)} };
      console.log(JSON.stringify([m.resolveProjectName(${JSON.stringify(cwd)}, opts), m.resolveProjectName(${JSON.stringify(cwd)}, { ...opts, legacyName: "Other" })]));
    `;
    const run = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf-8" });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toEqual(["MyTool", "mytool"]);
    expect(run.stderr).not.toContain("ExperimentalWarning");
  });
});
