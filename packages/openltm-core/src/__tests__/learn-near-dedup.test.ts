import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-near-dedup-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

let core: typeof import("../index.js");
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("learn near-dedup #16", () => {
  it("exact match reinforces with matched_by exact", () => {
    const a = core.learn({
      content: "Always prefer Bun over npm for scripts in this repo",
      category: "preference",
      importance: 4,
      skipExport: true,
    });
    const b = core.learn({
      content: "Always prefer Bun over npm for scripts in this repo",
      category: "preference",
      importance: 4,
      skipExport: true,
    });
    expect(b.action).toBe("reinforced");
    expect(b.id).toBe(a.id);
    expect(b.matched_by).toBe("exact");
  });

  it("containment elaboration reinforces", () => {
    const a = core.learn({
      content: "docker hub rate limits unauthenticated pulls",
      category: "gotcha",
      importance: 3,
      skipExport: true,
    });
    const b = core.learn({
      content: "docker hub rate limits unauthenticated pulls at 100 per 6 hours",
      category: "gotcha",
      importance: 3,
      skipExport: true,
    });
    expect(b.action).toBe("reinforced");
    expect(b.id).toBe(a.id);
    expect(b.matched_by === "containment" || b.matched_by === "jaccard").toBe(true);
  });

  it("does not silently merge deliberate siblings", () => {
    const a = core.learn({
      content: "Phase4 high importance sort check marker",
      category: "pattern",
      importance: 3,
      skipExport: true,
    });
    const b = core.learn({
      content: "Phase4 low importance sort check marker",
      category: "pattern",
      importance: 3,
      skipExport: true,
    });
    // Must not reinforce into one memory
    expect(b.action).toBe("created");
    expect(b.id).not.toBe(a.id);
  });

  // Each pair differs by a marker, number, or polarity word that tokenize()
  // drops or that Jaccard scores as a near-match — the second fact must survive.
  for (const [first, second] of [
    ["For the cache layer we chose plan A over the others", "For the cache layer we chose plan B over the others"],
    ["Set the retry count to 3 for the outbound webhook sender", "Set the retry count to 5 for the outbound webhook sender"],
    ["Do not run the janitor dedup pass against the production memory database during business hours",
     "Do run the janitor dedup pass against the production memory database during business hours"],
    ["Always enable the write queue for hook writers that share the sqlite database with the MCP server process today",
     "Never enable the write queue for hook writers that share the sqlite database with the MCP server process today"],
    ["To fix the flaky janitor test increase the polling interval used by the background scheduler loop",
     "To fix the flaky janitor test reduce the polling interval used by the background scheduler loop"],
    ["The embedding provider client uses the sync request path for every backfill batch it sends to the server",
     "The embedding provider client uses the async request path for every backfill batch it sends to the server"],
    ["Hook timeout for the session start handler is 30s in the plugin manifest",
     "Hook timeout for the session start handler is 30ms in the plugin manifest"],
    ["Run the release workflow on node 18 runners for the publish job", "Run the release workflow on node 20 runners for the publish job"],
  ]) {
    it(`keeps meaningfully different facts apart: "${second.slice(0, 40)}…"`, () => {
      const a = core.learn({ content: first, category: "pattern", skipExport: true });
      const b = core.learn({ content: second, category: "pattern", skipExport: true });
      expect(b.action).toBe("created");
      expect(b.id).not.toBe(a.id);
    });
  }
});
