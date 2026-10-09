/**
 * recall-quality.test.ts — golden-query eval for recall().
 *
 * Seeds ~20 realistic memories (with high-importance distractors that share
 * words with the queries) in a temp DB, then asks natural-language questions
 * and asserts the expected memory lands in the top 3. Runs with embeddings
 * disabled (FTS + stopword path). Hybrid ranking is covered with a
 * deterministic fake semantic retriever injected through the test seam, and
 * the RRF merge is tested as a pure function.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MemoryCategory } from "../db.js";

type Core = typeof import("../index.js");
type Db = typeof import("../db.js");
let core: Core;
let dbMod: Db;

const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-recall-quality-"));
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const savedProvider = process.env.LTM_EMBED_PROVIDER;

const SEED: Array<{ key: string; content: string; category: MemoryCategory; importance: number }> = [
  { key: "migrations", category: "architecture", importance: 3, content: "Database migrations live in migrations/NNN_name.sql and run through runPendingMigrations; never edit a migration after it has shipped, add a new one." },
  { key: "wal", category: "architecture", importance: 5, content: "The SQLite database runs in WAL mode with busy_timeout=5000 so hooks and the MCP server can write concurrently." },
  { key: "bun", category: "preference", importance: 4, content: "Use bun instead of npm or yarn for every script, install and test run in this repo." },
  { key: "stdout", category: "gotcha", importance: 5, content: "The MCP server talks over stdio, so never write to stdout with console.log; log to stderr instead." },
  { key: "llamacpp", category: "architecture", importance: 3, content: "Embeddings default to a local llama.cpp server running bge-m3; when that server is down recall silently falls back to full-text search." },
  { key: "release", category: "workflow", importance: 4, content: "Release flow: bump versions in every manifest, add a CHANGELOG entry, then push a vX.Y.Z tag to trigger the publish workflow." },
  { key: "oidc", category: "constraint", importance: 3, content: "npm packages publish through OIDC trusted publishing, so no NPM_TOKEN secret is stored in the repository." },
  { key: "ports", category: "architecture", importance: 2, content: "The graph app is a Vite and React frontend served on port 7332; the API server listens on 7331." },
  { key: "decay", category: "pattern", importance: 3, content: "Memory decay halves relevance every 90 days for importance 3; importance 5 memories never decay." },
  { key: "scrub", category: "pattern", importance: 4, content: "Secrets are scrubbed from memory content before any write, using regex detectors for API keys and tokens." },
  { key: "hook-timeout", category: "constraint", importance: 3, content: "Hooks must finish within the Claude Code hook timeout; heavy work goes to the durable Honker queue instead." },
  { key: "test-home", category: "gotcha", importance: 4, content: "Tests must never touch the real ~/.claude directory; point LTM_DB_PATH and CLAUDE_PLUGIN_DATA at a temp dir." },
  { key: "registry", category: "architecture", importance: 3, content: "Project names come from ~/.claude/projects/registry.json, matched by the longest path prefix of the cwd." },
  { key: "pure-fns", category: "preference", importance: 2, content: "Prefer small pure functions with explicit return types over classes in the core package." },
  { key: "context-items", category: "architecture", importance: 3, content: "Context items (goals, decisions, gotchas, progress) are stored per project in the context_items table." },
  { key: "typecheck", category: "workflow", importance: 3, content: "Typecheck with bunx tsc --noEmit before committing; CI fails on any type error." },
  { key: "docker", category: "workflow", importance: 2, content: "Docker images are built for linux/amd64 and linux/arm64 using buildx in the release pipeline." },
  { key: "gemini-rate", category: "constraint", importance: 2, content: "Rate limits: the Gemini embedding API allows 1500 requests per minute on the free tier." },
  { key: "degrade", category: "pattern", importance: 4, content: "Error handling: wrap provider calls in try/catch and degrade to a no-op instead of throwing from hooks." },
  { key: "janitor", category: "workflow", importance: 3, content: "The janitor merges near-duplicate memories and archives deprecated ones on a nightly schedule." },
];

const GOLDEN: Array<{ query: string; expect: string }> = [
  { query: "how do we handle database migrations", expect: "migrations" },
  { query: "should I use npm or yarn to run scripts?", expect: "bun" },
  { query: "why can't I log to stdout from the MCP server", expect: "stdout" },
  { query: "what happens when the embedding server is down", expect: "llamacpp" },
  { query: "how do we publish a new release", expect: "release" },
  { query: "where do project names come from", expect: "registry" },
  { query: "how do we keep secrets out of stored memory", expect: "scrub" },
  { query: "how should tests avoid touching the real home directory", expect: "test-home" },
];

const ids = new Map<string, number>();

beforeAll(async () => {
  process.env.LTM_EMBED_PROVIDER = "disabled";
  core = await import("../index.js");
  dbMod = await import("../db.js");
  const db = new Database(join(tmpRoot, "openltm.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
  for (const m of SEED) {
    const res = core.learn({ content: m.content, category: m.category, importance: m.importance, skipExport: true });
    expect(res.action).toBe("created");
    ids.set(m.key, res.id);
  }
}, 30_000);

afterEach(() => {
  dbMod._setRecallSemanticSearchForTesting(null);
});

afterAll(() => {
  if (savedProvider === undefined) delete process.env.LTM_EMBED_PROVIDER;
  else process.env.LTM_EMBED_PROVIDER = savedProvider;
  rmSync(tmpRoot, { recursive: true, force: true });
});

const keyOf = (id: number) => [...ids].find(([, v]) => v === id)?.[0] ?? `#${id}`;

describe("recall golden queries — embeddings disabled (FTS + stopwords)", () => {
  for (const { query, expect: expected } of GOLDEN) {
    it(`"${query}" → ${expected} in top 3`, async () => {
      const results = await core.recall({ query, limit: 10 });
      const top3 = results.slice(0, 3).map((m) => keyOf(m.id));
      expect(top3).toContain(expected);
    });
  }

  it("ranks every golden answer first on average (MRR ≥ 0.8)", async () => {
    let rr = 0;
    for (const { query, expect: expected } of GOLDEN) {
      const results = await core.recall({ query, limit: 10 });
      const pos = results.findIndex((m) => m.id === ids.get(expected));
      rr += pos === -1 ? 0 : 1 / (pos + 1);
    }
    expect(rr / GOLDEN.length).toBeGreaterThanOrEqual(0.8);
  });

  it("does not let stopwords pull in unrelated high-importance memories", async () => {
    const results = await core.recall({ query: "how do we handle database migrations", limit: 10 });
    expect(results.map((m) => keyOf(m.id))).not.toContain("stdout");
  });

  it("explainer.ftsRank is relative to the best FTS hit (best = 1)", async () => {
    const results = await core.recall({ query: "database migrations", limit: 5 });
    const best = results.find((m) => m.id === ids.get("migrations"))!;
    expect(best.explainer!.ftsRank).toBe(1);
    for (const m of results) {
      if (m.explainer!.ftsRank !== null) {
        expect(m.explainer!.ftsRank).toBeGreaterThan(0);
        expect(m.explainer!.ftsRank).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("buildFtsQuery", () => {
  it("drops stopwords and short tokens, quotes and ORs the rest", () => {
    expect(dbMod.buildFtsQuery("how do we handle the DB migrations?")).toBe('"handle"* OR "db" OR "migration"*');
  });

  it("de-duplicates terms case-insensitively", () => {
    expect(dbMod.buildFtsQuery("Bun bun BUN")).toBe('"bun"');
  });

  it("falls back to the original tokens when only stopwords remain", () => {
    expect(dbMod.buildFtsQuery("how do we")).toBe('"how" OR "do" OR "we"');
  });

  it("returns null when nothing searchable is left", () => {
    expect(dbMod.buildFtsQuery("?? !!")).toBeNull();
  });

  it("escapes embedded quotes and keeps FTS5 operators inert", async () => {
    const raw = 'NEAR(alpha) title:beta ab"cd AND or -x';
    expect(dbMod.buildFtsQuery(raw)).toBe('"near(alpha" OR "title:beta" OR "ab""cd"');
    // FTS5 must accept it — no syntax error from reserved words or column filters.
    expect(Array.isArray(await core.recall({ query: raw, limit: 3 }))).toBe(true);
  });
});

describe("reciprocalRankFusion", () => {
  it("computes Σ 1/(k + rank) across lists", () => {
    const fused = dbMod.reciprocalRankFusion([
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 3 }, { id: 1 }],
    ], 60);
    expect(fused.get(1)).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(fused.get(2)).toBeCloseTo(1 / 62, 12);
    expect(fused.get(3)).toBeCloseTo(1 / 63 + 1 / 61, 12);
  });

  it("puts a doc found by both retrievers above single-list hits", () => {
    const fused = dbMod.reciprocalRankFusion([
      [{ id: 10 }, { id: 20 }],
      [{ id: 30 }, { id: 20 }],
    ]);
    const order = [...fused].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order[0]).toBe(20);
  });

  it("gives exact score ties a shared rank", () => {
    const fused = dbMod.reciprocalRankFusion([[{ id: 1, score: -3 }, { id: 2, score: -3 }, { id: 3, score: -1 }]]);
    expect(fused.get(1)).toBe(fused.get(2));
    expect(fused.get(3)).toBeCloseTo(1 / 63, 12);
  });

  it("counts a repeated id once per list (best rank)", () => {
    const fused = dbMod.reciprocalRankFusion([[{ id: 1 }, { id: 1 }]]);
    expect(fused.get(1)).toBeCloseTo(1 / 61, 12);
  });

  it("fuseRecallRankings scales so a top hit of one retriever = 1", () => {
    const rel = dbMod.fuseRecallRankings([[{ id: 1 }], [{ id: 1 }, { id: 2 }]]);
    expect(rel.get(1)).toBeCloseTo(2, 12);
    expect(rel.get(2)).toBeCloseTo(61 / 62, 12);
  });
});

describe("hybrid recall — deterministic fake semantic retriever", () => {
  it("surfaces a memory with no keyword overlap through the semantic list", async () => {
    // "persistence layer schema evolution" shares no token with the migrations memory.
    const fts = await core.recall({ query: "persistence layer schema evolution", limit: 5 });
    expect(fts.map((m) => m.id)).not.toContain(ids.get("migrations"));

    let calls = 0;
    dbMod._setRecallSemanticSearchForTesting(async () => {
      calls++;
      return [{ id: ids.get("migrations")!, similarity: 0.91 }];
    });
    const hybrid = await core.recall({ query: "persistence layer schema evolution", limit: 5 });
    expect(calls).toBe(1);
    expect(hybrid[0]!.id).toBe(ids.get("migrations")!);
    expect(hybrid[0]!.explainer!.semanticScore).toBe(0.91);
  });

  it("runs semantic search even when FTS alone fills the limit", async () => {
    let calls = 0;
    dbMod._setRecallSemanticSearchForTesting(async () => { calls++; return []; });
    const results = await core.recall({ query: "memories", limit: 1 });
    expect(results.length).toBe(1);
    expect(calls).toBe(1);
  });

  it("a hit from both retrievers outranks a stronger FTS-only hit", async () => {
    // FTS ranks "release" first for this query; semantic agrees on "docker" only.
    const ftsOnly = await core.recall({ query: "release pipeline", limit: 5 });
    expect(ftsOnly[0]!.id).toBe(ids.get("docker")!); // docker memory matches both words

    dbMod._setRecallSemanticSearchForTesting(async () => [
      { id: ids.get("release")!, similarity: 0.88 },
      { id: ids.get("typecheck")!, similarity: 0.6 },
    ]);
    const hybrid = await core.recall({ query: "release pipeline", limit: 5 });
    expect(hybrid[0]!.id).toBe(ids.get("release")!);
  });

  it("semantic: false skips the embedding search entirely", async () => {
    let calls = 0;
    dbMod._setRecallSemanticSearchForTesting(async () => { calls++; return [{ id: ids.get("janitor")!, similarity: 0.99 }]; });
    const results = await core.recall({ query: "database migrations", limit: 5, semantic: false });
    expect(calls).toBe(0);
    expect(results.map((m) => m.id)).not.toContain(ids.get("janitor"));
  });

  it("a failing embedding search degrades to exactly the FTS-only result", async () => {
    const query = "how do we handle database migrations";
    const ftsOnly = (await core.recall({ query, limit: 10, semantic: false })).map((m) => m.id);
    dbMod._setRecallSemanticSearchForTesting(async () => { throw new Error("provider down"); });
    const degraded = (await core.recall({ query, limit: 10 })).map((m) => m.id);
    expect(degraded).toEqual(ftsOnly);
  });

  it("semantic hits still respect project / category filters", async () => {
    dbMod._setRecallSemanticSearchForTesting(async () => [{ id: ids.get("docker")!, similarity: 0.95 }]);
    const results = await core.recall({ query: "zzzunmatchedterm", category: "gotcha", limit: 5 });
    expect(results).toEqual([]);
  });
});
