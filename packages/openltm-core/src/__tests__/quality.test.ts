import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-quality-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

type Core = typeof import("../index.js");
let core: Core;

beforeAll(async () => {
  const mod = await import("../index.js");
  core = mod;
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await mod.runPendingMigrations(db);
  mod._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("similarity — isNearDuplicate", () => {
  it("treats an elaboration as a duplicate", () => {
    expect(
      core.isNearDuplicate(
        "docker hub rate limits unauthenticated pulls",
        "docker hub rate limits unauthenticated pulls at 100 per 6 hours",
      ),
    ).toBe(true);
  });

  it("does not merge deliberate siblings that differ by a word", () => {
    expect(
      core.isNearDuplicate("Phase4 high importance sort check", "Phase4 low importance sort check"),
    ).toBe(false);
  });

  it("does not merge memories differing only by a short marker", () => {
    expect(core.isNearDuplicate("concurrent audit 123 -A", "concurrent audit 123 -B")).toBe(false);
  });

  it("does not merge unrelated content", () => {
    expect(core.isNearDuplicate("docker hub rate limits", "use bun instead of npm")).toBe(false);
  });

  it("is a no-op on very short strings", () => {
    expect(core.isNearDuplicate("ok", "okay")).toBe(false);
  });
});

describe("hygiene — isOperationalNoise", () => {
  it("flags runtime chatter", () => {
    expect(core.isOperationalNoise("ok")).toBe(true);
    expect(core.isOperationalNoise("done")).toBe(true);
    expect(core.isOperationalNoise("process took 320ms")).toBe(true);
    expect(core.isOperationalNoise("exit status 0")).toBe(true);
  });

  it("keeps anything that states a durable rule", () => {
    expect(core.isOperationalNoise("Always use bun, never npm, for scripts")).toBe(false);
    expect(core.isOperationalNoise("Avoid running migrations on the live host")).toBe(false);
  });

  it("keeps normal knowledge that merely looks operational", () => {
    expect(
      core.isOperationalNoise("The graph server batches debounced WAL writes every 3 seconds"),
    ).toBe(false);
  });
});

describe("hygiene — learn() noise downgrade", () => {
  it("clamps importance for operational noise but still stores it", () => {
    const result = core.learn({ content: "background process completed", category: "pattern", importance: 5, skipExport: true });
    expect(result.action).toBe("created");
    const row = core.getDb()
      .query<{ importance: number }, [number]>("SELECT importance FROM memories WHERE id=?")
      .get(result.id);
    expect(row?.importance).toBeLessThanOrEqual(2);
  });
});

describe("hygiene — near-duplicate reinforcement", () => {
  it("reinforces an elaboration instead of creating a second row", () => {
    const first = core.learn({
      content: "Infisical holds the homelab database credentials for every service",
      category: "architecture",
      importance: 4,
      project_scope: "hygiene-project",
      skipExport: true,
    });
    const second = core.learn({
      content: "Infisical holds the homelab database credentials for every service including Traefik",
      category: "architecture",
      importance: 4,
      project_scope: "hygiene-project",
      skipExport: true,
    });
    expect(second.action).toBe("reinforced");
    expect(second.id).toBe(first.id);
  });

  it("keeps parallel siblings separate", () => {
    const a = core.learn({ content: "rank probe alpha variant", category: "pattern", importance: 3, skipExport: true });
    const b = core.learn({ content: "rank probe beta variant", category: "pattern", importance: 3, skipExport: true });
    expect(b.action).toBe("created");
    expect(b.id).not.toBe(a.id);
  });
});

describe("recall v2 — ranking", () => {
  it("ranks a project-scoped memory above a stronger global", () => {
    const global = core.learn({
      content: "ranking scoped preference — always verify the compose file before deploy",
      category: "preference",
      importance: 5,
      skipExport: true,
    });
    const scoped = core.learn({
      content: "ranking scoped preference for this project only",
      category: "preference",
      importance: 3,
      project_scope: "ranking-project",
      skipExport: true,
    });

    const rows = [global.id, scoped.id].map((id) =>
      core.getDb()
        .query<never, [number]>("SELECT * FROM memories WHERE id=?")
        .get(id),
    );
    const ranked = core.rankRecallResults(rows as never[], { limit: 2, project: "ranking-project" });
    expect(ranked[0]!.id).toBe(scoped.id);
  });

  it("demotes a stale memory without dropping it", () => {
    const fresh = { id: 1, importance: 3, recall_count: 0, decay_score: 1, stale_flagged_at: null } as never;
    const stale = { id: 2, importance: 3, recall_count: 0, decay_score: 1, stale_flagged_at: "2026-01-01" } as never;
    const ranked = core.rankRecallResults([stale, fresh], { limit: 2 });
    expect(ranked.map((m) => m.id)).toEqual([1, 2]);
  });

  it("is deterministic for identical input", () => {
    const rows = [
      { id: 3, importance: 2, recall_count: 1, decay_score: 0.5, stale_flagged_at: null },
      { id: 1, importance: 2, recall_count: 1, decay_score: 0.5, stale_flagged_at: null },
      { id: 2, importance: 2, recall_count: 1, decay_score: 0.5, stale_flagged_at: null },
    ] as never[];
    const first = core.rankRecallResults(rows, { limit: 3 }).map((m) => m.id);
    const second = core.rankRecallResults([...rows].reverse(), { limit: 3 }).map((m) => m.id);
    expect(first).toEqual(second);
    expect(first).toEqual([1, 2, 3]);
  });

  it("progressively demotes near-duplicate clusters without dropping them", () => {
    const base = { importance: 3, recall_count: 0, decay_score: 1, stale_flagged_at: null, project_scope: null };
    const rows = [
      { ...base, id: 1, content: "alpha duplicate probe entry" },
      { ...base, id: 2, content: "alpha duplicate probe entry for the deploy path" },
      { ...base, id: 3, content: "completely separate unrelated statement about typography" },
    ] as never[];
    const ranked = core.rankRecallResults(rows, { limit: 3 }).map((m) => m.id);
    // The near-duplicate (2) is demoted below the unrelated memory (3) but is
    // still returned, and the cluster's best member (1) stays on top.
    expect(ranked).toEqual([1, 3, 2]);
  });

  it("honours explicit sort_by requests", () => {
    const rows = [
      { id: 1, created_at: "2026-01-01", importance: 3, recall_count: 0, decay_score: 1, stale_flagged_at: null },
      { id: 2, created_at: "2026-06-01", importance: 3, recall_count: 0, decay_score: 1, stale_flagged_at: null },
    ] as never[];
    expect(core.rankRecallResults(rows, { limit: 2, sortBy: "created" }).map((m) => m.id)).toEqual([2, 1]);
  });
});

describe("prefill v2 — quotas and dedupe", () => {
  it("respects per-category quotas and fills leftover slots", () => {
    for (let i = 0; i < 6; i++) {
      core.learn({
        content: `quota gotcha number ${i} about the staging deploy pipeline failing intermittently`,
        category: "gotcha",
        importance: 3,
        project_scope: "quota-project",
        skipExport: true,
      });
    }
    core.learn({
      content: "quota decision: staging deploys are frozen on fridays",
      category: "architecture",
      importance: 3,
      project_scope: "quota-project",
      skipExport: true,
    });

    const { scoped, globals, report } = core.selectPrefillMemories("quota-project", {
      maxMemories: 4,
      quotas: { gotcha: 1, architecture: 1 },
    });

    const categories = scoped.map((m) => m.category);
    expect(categories.filter((c) => c === "gotcha").length).toBeLessThanOrEqual(2); // 1 quota + 1 fill
    expect(categories).toContain("architecture");
    expect(scoped.length).toBeLessThanOrEqual(4);
    expect(report.selected).toBe(scoped.length + globals.length);
  });

  it("suppresses near-duplicate entries from the block", () => {
    core.learn({
      content: "dedupe probe: the wiki docs are generated and must never be hand edited",
      category: "constraint",
      importance: 4,
      project_scope: "dedupe-project",
      skipExport: true,
    });
    core.learn({
      content: "dedupe probe: the wiki docs are generated and must never be hand edited at all",
      category: "constraint",
      importance: 4,
      project_scope: "dedupe-project",
      skipExport: true,
    });

    const { scoped, report } = core.selectPrefillMemories("dedupe-project", { maxMemories: 6 });
    const texts = scoped.map((m) => m.content);
    expect(new Set(texts).size).toBe(texts.length);
    expect(report.suppressedDuplicates).toBeGreaterThanOrEqual(0);
  });

  it("puts the project section before the global section", () => {
    const block = core.buildPrefillContext({
      project: "order-project",
      maxMemories: 6,
      maxLines: 24,
    });
    const projectIdx = block.indexOf("Project (order-project):");
    const globalIdx = block.indexOf("Global:");
    if (projectIdx !== -1 && globalIdx !== -1) {
      expect(projectIdx).toBeLessThan(globalIdx);
    }
  });

  it("respects the shared host budget", () => {
    expect(core.PREFILL_DEFAULTS).toEqual({ maxMemories: 10, maxLines: 18 });
  });
});
