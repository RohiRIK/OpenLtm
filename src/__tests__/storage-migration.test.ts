/**
 * storage-migration.test.ts — OpenLTM state moved out of ~/.claude/projects/.
 *
 * Legacy registry + context markdown are copied (never moved or edited) into
 * <dataDir>/projects/ on first access, the copy is idempotent, the Claude hooks
 * keep pre-existing project names (continuity), and config.json is read from
 * LTM_CONFIG_PATH → <dataDir>/config.json → legacy ~/.claude/config.json.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveProject, registerPath, getProjectsDir, getRegistryPath,
  PROJECTS_DIR, REGISTRY_PATH, CLAUDE_TRANSCRIPTS_DIR,
} from "../../hooks/lib/resolveProject.js";
import { getConfigPath, migrateLegacyContextFiles, migrateLegacyRegistry } from "@rohirik/openltm-core";
import { readConfigSync } from "../config.js";
import { getDbPath } from "../paths.js";

const ENV_KEYS = ["HOME", "USERPROFILE", "LTM_DATA_DIR", "CLAUDE_PLUGIN_DATA", "LTM_DB_PATH", "LTM_CONFIG_PATH"] as const;

let root: string;
let home: string;
let data: string;
let legacyProjects: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  root = mkdtempSync(join(tmpdir(), "openltm-storage-"));
  home = join(root, "home");
  data = join(root, "data");
  legacyProjects = join(home, ".claude", "projects");
  mkdirSync(legacyProjects, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LTM_DATA_DIR = data;
  process.env.CLAUDE_PLUGIN_DATA = data;
  process.env.LTM_DB_PATH = join(data, "openltm.db");
  delete process.env.LTM_CONFIG_PATH;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

/** A fake repo dir (findRepoRoot only needs a `.git` entry). */
function makeRepo(name: string): string {
  const dir = join(root, "code", name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function seedDb(rows: { memories?: string[]; contextItems?: string[] }): void {
  mkdirSync(data, { recursive: true });
  const db = new Database(process.env.LTM_DB_PATH!, { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, project_scope TEXT); CREATE TABLE IF NOT EXISTS context_items (id INTEGER PRIMARY KEY, project_name TEXT);");
  for (const p of rows.memories ?? []) db.run("INSERT INTO memories (project_scope) VALUES (?)", [p]);
  for (const p of rows.contextItems ?? []) db.run("INSERT INTO context_items (project_name) VALUES (?)", [p]);
  db.close();
}

/** Bytes + mtime of every file under a dir — proves legacy files are untouched. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = `${statSync(p).mtimeMs}:${readFileSync(p, "utf-8")}`;
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

describe("storage location", () => {
  it("import-time PROJECTS_DIR / REGISTRY_PATH are OpenLTM's, never Claude's transcript dir", () => {
    expect(PROJECTS_DIR).not.toBe(CLAUDE_TRANSCRIPTS_DIR);
    expect(REGISTRY_PATH).toBe(join(PROJECTS_DIR, "registry.json"));
    expect(CLAUDE_TRANSCRIPTS_DIR.endsWith(join(".claude", "projects"))).toBe(true);
  });

  it("registry and context dirs live under the data dir", () => {
    expect(getProjectsDir()).toBe(join(data, "projects"));
    expect(getRegistryPath()).toBe(join(data, "projects", "registry.json"));
    const repo = makeRepo("fresh-repo");
    expect(resolveProject(repo).projectDir).toBe(join(data, "projects", "fresh-repo"));
  });

  it("falls back to CLAUDE_PLUGIN_DATA, then the DB's directory", () => {
    delete process.env.LTM_DATA_DIR;
    process.env.CLAUDE_PLUGIN_DATA = join(root, "plugin");
    expect(getRegistryPath()).toBe(join(root, "plugin", "projects", "registry.json"));
    delete process.env.CLAUDE_PLUGIN_DATA;
    process.env.LTM_DB_PATH = join(root, "elsewhere", "x.db");
    expect(getProjectsDir()).toBe(join(root, "elsewhere", "projects"));
  });

  it("registerPath writes only the new registry", () => {
    registerPath("/work/app", "app");
    expect(JSON.parse(readFileSync(join(data, "projects", "registry.json"), "utf-8"))).toEqual({ "/work/app": "app" });
    expect(existsSync(join(legacyProjects, "registry.json"))).toBe(false);
  });
});

describe("legacy registry migration", () => {
  it("copies the legacy registry on first access and leaves it untouched", () => {
    const repo = makeRepo("legacy-app");
    writeFileSync(join(legacyProjects, "registry.json"), JSON.stringify({ [repo]: "my-legacy-name" }));
    const before = snapshot(legacyProjects);

    const r = resolveProject(repo);
    expect(r).toMatchObject({ name: "my-legacy-name", isNew: false, registeredPath: repo, source: "registry" });
    expect(JSON.parse(readFileSync(getRegistryPath(), "utf-8"))).toEqual({ [repo]: "my-legacy-name" });
    expect(snapshot(legacyProjects)).toEqual(before);
  });

  it("is idempotent — never overwrites the new registry", () => {
    writeFileSync(join(legacyProjects, "registry.json"), JSON.stringify({ "/a": "from-legacy" }));
    expect(migrateLegacyRegistry(getRegistryPath(), join(legacyProjects, "registry.json"))).toBe(true);
    writeFileSync(getRegistryPath(), JSON.stringify({ "/a": "edited-in-new" }));
    expect(migrateLegacyRegistry(getRegistryPath(), join(legacyProjects, "registry.json"))).toBe(false);
    resolveProject("/a/sub");
    expect(JSON.parse(readFileSync(getRegistryPath(), "utf-8"))).toEqual({ "/a": "edited-in-new" });
    expect(resolveProject("/a/sub").name).toBe("edited-in-new");
  });

  it("still sees entries written to the legacy file after migration (older slash-commands)", () => {
    writeFileSync(join(legacyProjects, "registry.json"), JSON.stringify({ "/one": "one" }));
    resolveProject("/one");
    writeFileSync(join(legacyProjects, "registry.json"), JSON.stringify({ "/one": "one", "/two": "two" }));
    expect(resolveProject("/two").name).toBe("two");
  });
});

describe("legacy context file migration", () => {
  it("copies context-*.md for the resolved name; legacy stays byte-identical", () => {
    const repo = makeRepo("ctx-app");
    writeFileSync(join(legacyProjects, "registry.json"), JSON.stringify({ [repo]: "ctx-app" }));
    mkdirSync(join(legacyProjects, "ctx-app"), { recursive: true });
    writeFileSync(join(legacyProjects, "ctx-app", "context-goals.md"), "ship it\n");
    writeFileSync(join(legacyProjects, "ctx-app", "context-gotchas.md"), "watch out\n");
    writeFileSync(join(legacyProjects, "ctx-app", "notes.txt"), "not ours\n");
    const before = snapshot(legacyProjects);

    const { projectDir } = resolveProject(repo);
    expect(readFileSync(join(projectDir, "context-goals.md"), "utf-8")).toBe("ship it\n");
    expect(readFileSync(join(projectDir, "context-gotchas.md"), "utf-8")).toBe("watch out\n");
    expect(existsSync(join(projectDir, "notes.txt"))).toBe(false);
    expect(snapshot(legacyProjects)).toEqual(before);
  });

  it("is idempotent — skips once the new dir has any context file", () => {
    mkdirSync(join(legacyProjects, "p"), { recursive: true });
    writeFileSync(join(legacyProjects, "p", "context-progress.md"), "legacy\n");
    const projects = join(data, "projects");
    expect(migrateLegacyContextFiles("p", projects, legacyProjects)).toEqual(["context-progress.md"]);
    writeFileSync(join(projects, "p", "context-progress.md"), "newer\n");
    writeFileSync(join(legacyProjects, "p", "context-goals.md"), "late legacy\n");
    expect(migrateLegacyContextFiles("p", projects, legacyProjects)).toEqual([]);
    expect(readFileSync(join(projects, "p", "context-progress.md"), "utf-8")).toBe("newer\n");
  });

  it("refuses unsafe names", () => {
    expect(migrateLegacyContextFiles("..", join(data, "projects"), legacyProjects)).toEqual([]);
    expect(migrateLegacyContextFiles("a/b", join(data, "projects"), legacyProjects)).toEqual([]);
  });
});

describe("Claude hook names: continuity + isNew", () => {
  it("fresh repo → normalized repo-root name, isNew, nothing written to the legacy dir", () => {
    const repo = makeRepo("Fresh_Repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    const r = resolveProject(join(repo, "src"));
    expect(r).toMatchObject({ name: "fresh-repo", isNew: true, registeredPath: null, source: "repo-root" });
    expect(readdirSync(legacyProjects)).toEqual([]);
  });

  it("existing repo with rows under the new name is not new", () => {
    const repo = makeRepo("busy-repo");
    seedDb({ memories: ["busy-repo"] });
    expect(resolveProject(repo)).toMatchObject({ name: "busy-repo", isNew: false, source: "repo-root" });
  });

  it("keeps the old full-path slug when only it has DB rows, and registers it", () => {
    const repo = makeRepo("OpenLtm");
    const slug = repo.replace(/\//g, "-").replace(/\./g, "-");
    seedDb({ contextItems: [slug] });

    const r = resolveProject(repo);
    expect(r).toMatchObject({ name: slug, isNew: false, registeredPath: repo, source: "legacy" });
    expect(JSON.parse(readFileSync(getRegistryPath(), "utf-8"))).toEqual({ [repo]: slug });
    // Stable afterwards: resolved through the registry.
    expect(resolveProject(repo)).toMatchObject({ name: slug, source: "registry" });
  });

  it("keeps the slug when OpenLTM context files sit in Claude's dir for it (no DB), and copies them", () => {
    const repo = makeRepo("md-only");
    const slug = repo.replace(/\//g, "-").replace(/\./g, "-");
    mkdirSync(join(legacyProjects, slug), { recursive: true });
    writeFileSync(join(legacyProjects, slug, "context-progress.md"), "✓ old session\n");
    writeFileSync(join(legacyProjects, slug, "abc.jsonl"), "{}\n"); // Claude transcript — not ours
    const before = snapshot(legacyProjects);

    const r = resolveProject(repo);
    expect(r).toMatchObject({ name: slug, isNew: false, source: "legacy" });
    expect(readFileSync(join(r.projectDir, "context-progress.md"), "utf-8")).toBe("✓ old session\n");
    expect(existsSync(join(r.projectDir, "abc.jsonl"))).toBe(false);
    expect(snapshot(legacyProjects)).toEqual(before);
  });

  it("an unrelated Claude transcript dir alone does not pin the slug", () => {
    const repo = makeRepo("transcripts-only");
    const slug = repo.replace(/\//g, "-").replace(/\./g, "-");
    mkdirSync(join(legacyProjects, slug), { recursive: true });
    writeFileSync(join(legacyProjects, slug, "session.jsonl"), "{}\n");
    expect(resolveProject(repo)).toMatchObject({ name: "transcripts-only", isNew: true });
  });

  it("uses the new name once it has rows, even if the slug has some too", () => {
    const repo = makeRepo("both");
    const slug = repo.replace(/\//g, "-").replace(/\./g, "-");
    seedDb({ memories: [slug, "both"] });
    expect(resolveProject(repo)).toMatchObject({ name: "both", isNew: false, source: "repo-root" });
    expect(existsSync(getRegistryPath())).toBe(false);
  });
});

describe("config.json read order", () => {
  const writeJson = (p: string, v: unknown) => {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(v));
  };

  it("defaults to <dataDir>/config.json when nothing exists", () => {
    expect(getConfigPath()).toBe(join(data, "config.json"));
    expect(readConfigSync()).toEqual({});
  });

  it("falls back to legacy ~/.claude/config.json when it is the only one", () => {
    writeJson(join(home, ".claude", "config.json"), { ltm: { injectTopN: 3 } });
    expect(getConfigPath()).toBe(join(home, ".claude", "config.json"));
    expect(readConfigSync().ltm?.injectTopN).toBe(3);
  });

  it("<dataDir>/config.json beats legacy", () => {
    writeJson(join(home, ".claude", "config.json"), { ltm: { injectTopN: 3 } });
    writeJson(join(data, "config.json"), { ltm: { injectTopN: 9 } });
    expect(getConfigPath()).toBe(join(data, "config.json"));
    expect(readConfigSync().ltm?.injectTopN).toBe(9);
  });

  it("LTM_CONFIG_PATH beats both (even before it exists)", () => {
    writeJson(join(data, "config.json"), { ltm: { injectTopN: 9 } });
    process.env.LTM_CONFIG_PATH = join(root, "custom.json");
    expect(getConfigPath()).toBe(join(root, "custom.json"));
    writeJson(join(root, "custom.json"), { ltm: { injectTopN: 1 } });
    expect(readConfigSync().ltm?.injectTopN).toBe(1);
  });

  it("getDbPath reads ltm.dbPath from the resolved config", () => {
    delete process.env.LTM_DB_PATH;
    delete process.env.CLAUDE_PLUGIN_DATA;
    process.env.LTM_CONFIG_PATH = join(root, "cfg.json");
    writeJson(join(root, "cfg.json"), { ltm: { dbPath: "/srv/ltm/custom.db" } });
    expect(getDbPath()).toBe("/srv/ltm/custom.db");
  });
});
