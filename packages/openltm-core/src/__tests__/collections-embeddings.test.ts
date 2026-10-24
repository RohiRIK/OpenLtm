/** Record vectors and hybrid record recall (collections/embeddings.ts). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { EmbeddingProvider } from "../providers/embeddingProvider.js";

const dbPath = `/tmp/test-openltm-collections-emb-${process.pid}-${Date.now()}.db`;

let core: typeof import("../index.js");
let emb: typeof import("../collections/embeddings.js");
let embeddings: typeof import("../embeddings.js");
let db: Database;
const seen: string[] = [];

/** A fake provider: one dimension per keyword, so similarity is predictable. */
const WORDS = ["database", "web", "hypervisor"];
const fake: EmbeddingProvider = {
  name: "llamacpp",
  model: "fake-model",
  dim: WORDS.length,
  available: async () => true,
  generate: async (text: string) => {
    seen.push(text);
    const t = text.toLowerCase();
    return new Float32Array(WORDS.map((w) => (t.includes(w) ? 1 : 0.01)));
  },
};

beforeAll(async () => {
  core = await import("../index.js");
  emb = await import("../collections/embeddings.js");
  embeddings = await import("../embeddings.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
  embeddings._setEmbeddingProviderForTesting(fake);
}, 30_000);

beforeEach(() => {
  db.exec("DELETE FROM records; DELETE FROM collections;");
  seen.length = 0;
  emb._setRecordSemanticSearchForTesting(null);
});

afterAll(() => {
  embeddings._setEmbeddingProviderForTesting(null);
  db.close();
  try { unlinkSync(dbPath); } catch { /* gone */ }
});

function hosts() {
  core.defineCollection({
    name: "hosts", description: "Machines", key_field: "host",
    fields: [{ name: "host", type: "string", required: true }, { name: "notes", type: "text" }],
  });
}

describe("record embeddings", () => {
  it("embeds the scrubbed search text, and a later put clears the vector", async () => {
    hosts();
    const { record } = core.putRecord({ collection: "hosts", data: { host: "db1", notes: "postgres database" } });
    expect(await emb.embedRecord(record.id)).toBe(true);
    expect(seen[0]).toBe("hosts\ndb1\ndb1\npostgres database");
    const row = db.query<{ embedding: Buffer | null; embedding_model: string | null }, [number]>(
      "SELECT embedding, embedding_model FROM records WHERE id=?").get(record.id)!;
    expect(row.embedding_model).toBe("fake-model");
    expect(row.embedding!.byteLength).toBe(WORDS.length * 4);
    core.putRecord({ collection: "hosts", data: { host: "db1", notes: "now a web box" } });
    const after = db.query<{ embedding: Buffer | null }, [number]>("SELECT embedding FROM records WHERE id=?").get(record.id)!;
    expect(after.embedding).toBeNull();
  });

  it("backfills records with no vector for the current model", async () => {
    hosts();
    core.putRecord({ collection: "hosts", data: { host: "a1" } });
    core.putRecord({ collection: "hosts", data: { host: "a2" } });
    db.run("UPDATE records SET embedding=NULL, embedding_model=NULL");
    expect(await emb.backfillRecordEmbeddings(db)).toBe(2);
    expect(await emb.backfillRecordEmbeddings(db)).toBe(0);
  });

  it("recall finds a record by meaning when FTS has no matching word", async () => {
    hosts();
    const { record } = core.putRecord({ collection: "hosts", data: { host: "pve1", notes: "proxmox hypervisor" } });
    core.putRecord({ collection: "hosts", data: { host: "w1", notes: "nginx web" } });
    await emb.backfillRecordEmbeddings(db);
    expect(core.searchRecords("which hypervisor box").map((r) => r.key)).toEqual(["pve1"]);
    const hits = await emb.recallRecords("virtualisation hypervisor", { limit: 3 });
    expect(hits[0]!.id).toBe(record.id);
    // A query FTS cannot match at all still reaches the record through its vector.
    expect(core.searchRecords("hypervisorish")).toEqual([]);
    const semanticOnly = await emb.recallRecords("hypervisorish", { limit: 1 });
    expect(semanticOnly.map((r) => r.key)).toEqual(["pve1"]);
  });

  it("falls back to FTS when the vector search fails or is off", async () => {
    hosts();
    core.putRecord({ collection: "hosts", data: { host: "db1", notes: "postgres" } });
    emb._setRecordSemanticSearchForTesting(async () => { throw new Error("provider down"); });
    expect((await emb.recallRecords("postgres")).map((r) => r.key)).toEqual(["db1"]);
  });
});
