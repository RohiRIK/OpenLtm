import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-collections-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

let core: typeof import("../index.js");
let db: Database;

const releaseFields = [
  { name: "version", type: "string", required: true },
  { name: "tagged", type: "boolean" },
  { name: "prs", type: "string[]" },
  { name: "notes", type: "text" },
  { name: "channel", type: "enum", values: ["npm", "clawhub"] },
  { name: "downloads", type: "integer", searchable: false },
];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

beforeEach(() => {
  db.run("DELETE FROM records");
  db.run("DELETE FROM collections");
  db.run("DELETE FROM settings WHERE key LIKE 'collections.%'");
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) try { unlinkSync(`${dbPath}${suffix}`); } catch {}
});

function defineReleases(extra: Partial<import("../index.js").DefineCollectionInput> = {}) {
  return core.defineCollection({
    name: "releases", description: "One row per OpenLtm release", fields: releaseFields, key_field: "version", ...extra,
  });
}

describe("defineCollection", () => {
  it("stores a collection as a row with agent-observation origin by default", () => {
    const c = defineReleases();
    expect(c.name).toBe("releases");
    expect(c.version).toBe(1);
    expect(c.origin).toBe("agent-observation");
    expect(c.fields).toHaveLength(releaseFields.length);
    const tables = db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%releases%'").get()!;
    expect(tables.n).toBe(0); // no DDL: a type is a row, not a table
  });

  it("rejects bad names, reserved fields, and injection-shaped identifiers", () => {
    expect(codeOf(() => core.defineCollection({ name: "Bad-Name", description: "x", fields: releaseFields }))).toBe("invalid_name");
    expect(codeOf(() => core.defineCollection({ name: "x; DROP TABLE memories", description: "x", fields: releaseFields }))).toBe("invalid_name");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "id", type: "string" }] }))).toBe("invalid_fields");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "a.b", type: "string" }] }))).toBe("invalid_fields");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "a'", type: "string" }] }))).toBe("invalid_fields");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "kind", type: "enum" }] }))).toBe("invalid_fields");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "kind", type: "blob" }] }))).toBe("invalid_fields");
  });

  it("validates the key field", () => {
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "label", type: "string" }], key_field: "label" }))).toBe("invalid_key_field");
    expect(codeOf(() => core.defineCollection({ name: "things", description: "x", fields: [{ name: "label", type: "string", required: true }], key_field: "nope" }))).toBe("invalid_key_field");
  });

  it("returns the existing type instead of creating a near-duplicate", () => {
    defineReleases();
    expect(codeOf(() => core.defineCollection({ name: "release", description: "dup", fields: releaseFields, key_field: "version" }))).toBe("similar_exists");
    expect(codeOf(() => core.defineCollection({ name: "releases", description: "dup", fields: releaseFields }))).toBe("exists");
    const forced = core.defineCollection({ name: "release", description: "really different", fields: releaseFields, force: true });
    expect(forced.name).toBe("release");
  });

  it("refuses secrets in a definition", () => {
    expect(codeOf(() => core.defineCollection({ name: "keys", description: `use ${AWS_KEY}`, fields: releaseFields }))).toBe("secret_refused");
  });

  it("enforces the collection limit (settings override)", () => {
    db.run("INSERT INTO settings(key, value) VALUES ('collections.max_collections', '1')");
    defineReleases();
    expect(codeOf(() => core.defineCollection({ name: "servers", description: "hosts", fields: [{ name: "host", type: "string" }] }))).toBe("limit");
  });

  it("scopes a collection to a project; a project one shadows a global one", () => {
    core.defineCollection({ name: "servers", description: "global hosts", fields: [{ name: "host", type: "string", required: true }], key_field: "host" });
    core.defineCollection({ name: "servers", description: "project hosts", fields: [{ name: "host", type: "string", required: true }], key_field: "host", project: "alpha", force: true });
    expect(core.resolveCollection("servers", "alpha")!.description).toBe("project hosts");
    expect(core.resolveCollection("servers", "beta")!.description).toBe("global hosts");
    expect(core.listCollections({ project: "beta" }).map((c) => c.project_scope)).toEqual([null]);
  });
});

describe("putRecord / getRecord", () => {
  beforeEach(() => { defineReleases(); });

  it("inserts, then upserts by key", () => {
    const a = core.putRecord({ collection: "releases", data: { version: "2.21.0", tagged: false } });
    expect(a.created).toBe(true);
    expect(a.record.key).toBe("2.21.0");
    const b = core.putRecord({ collection: "releases", data: { version: "2.21.0", tagged: true } });
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(b.record.data).toEqual({ version: "2.21.0", tagged: true });
  });

  it("merge updates one field and null removes one", () => {
    core.putRecord({ collection: "releases", data: { version: "2.20.0", tagged: true, notes: "first" } });
    const m = core.putRecord({ collection: "releases", data: { version: "2.20.0", notes: null, downloads: 5 }, merge: true });
    expect(m.record.data).toEqual({ version: "2.20.0", tagged: true, downloads: 5 });
  });

  it("rejects unknown fields, wrong types and missing required fields", () => {
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", extra: 1 } }))).toBe("invalid_record");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", tagged: "yes" } }))).toBe("invalid_record");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { tagged: true } }))).toBe("invalid_record");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", channel: "pypi" } }))).toBe("invalid_record");
    expect(codeOf(() => core.putRecord({ collection: "nope", data: {} }))).toBe("unknown_collection");
  });

  it("refuses a secret anywhere in a record, including inside lists", () => {
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", notes: `key ${AWS_KEY}` } }))).toBe("secret_refused");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", prs: ["#1", AWS_KEY] } }))).toBe("secret_refused");
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM records").get()!.n).toBe(0);
  });

  it("enforces the record size and count limits", () => {
    db.run("INSERT INTO settings(key, value) VALUES ('collections.max_record_bytes', '100')");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1", notes: "x".repeat(200) } }))).toBe("limit");
    db.run("DELETE FROM settings WHERE key LIKE 'collections.%'");
    db.run("INSERT INTO settings(key, value) VALUES ('collections.max_records', '2')");
    core.putRecord({ collection: "releases", data: { version: "1" } });
    core.putRecord({ collection: "releases", data: { version: "2" } });
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "3" } }))).toBe("limit");
    // An upsert of an existing key is not a new record.
    expect(core.putRecord({ collection: "releases", data: { version: "2", tagged: true } }).created).toBe(false);
  });

  it("archives and restores a record by put", () => {
    core.putRecord({ collection: "releases", data: { version: "9" } });
    expect(core.archiveRecord("releases", { key: "9" }).status).toBe("archived");
    expect(core.getRecord("releases", { key: "9" })!.status).toBe("archived");
    expect(core.putRecord({ collection: "releases", data: { version: "9" } }).record.status).toBe("active");
  });

  it("records origin and flags authority-like records", () => {
    const r = core.putRecord({ collection: "releases", data: { version: "5" }, origin: "owner-statement" });
    expect(r.record.origin).toBe("owner-statement");
    expect(r.record.authority_note).toBeUndefined();
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "6" }, origin: "boss" as never }))).toBe("invalid_origin");
    core.defineCollection({ name: "deploy_approvals", description: "past approvals", fields: [{ name: "target", type: "string", required: true }], key_field: "target" });
    const a = core.putRecord({ collection: "deploy_approvals", data: { target: "prod" } });
    expect(a.record.authority_note).toBe(core.AUTHORITY_NOTE);
  });

  it("refuses writes to an archived collection", () => {
    core.setCollectionStatus("releases", null, "archived");
    expect(codeOf(() => core.putRecord({ collection: "releases", data: { version: "1" } }))).toBe("archived");
  });
});

describe("evolveCollection", () => {
  beforeEach(() => {
    defineReleases();
    core.putRecord({ collection: "releases", data: { version: "1", notes: "alpha", downloads: 3 } });
  });

  it("allows additive changes and bumps the version", () => {
    const res = core.evolveCollection({ name: "releases", fields: [...releaseFields, { name: "commit", type: "string" }] });
    expect(res.collection.version).toBe(2);
    expect(core.putRecord({ collection: "releases", data: { version: "2", commit: "abc" } }).record.schema_version).toBe(2);
    expect(core.getRecord("releases", { key: "1" })!.schema_version).toBe(1);
  });

  it("refuses breaking changes without allowBreaking", () => {
    const withoutNotes = releaseFields.filter((f) => f.name !== "notes");
    expect(codeOf(() => core.evolveCollection({ name: "releases", fields: withoutNotes }))).toBe("breaking_change");
    expect(codeOf(() => core.evolveCollection({ name: "releases", fields: [...releaseFields, { name: "owner", type: "string", required: true }] }))).toBe("breaking_change");
    expect(codeOf(() => core.evolveCollection({ name: "releases", fields: releaseFields.map((f) => f.name === "channel" ? { ...f, values: ["npm"] } : f) }))).toBe("breaking_change");
  });

  it("owner breaking change strips removed fields and revalidates every record", () => {
    const withoutNotes = releaseFields.filter((f) => f.name !== "notes");
    const res = core.evolveCollection({ name: "releases", fields: withoutNotes, allowBreaking: true });
    expect(res.rewritten).toBe(1);
    expect(core.getRecord("releases", { key: "1" })!.data).toEqual({ version: "1", downloads: 3 });
  });

  it("an owner type change that stored records cannot satisfy changes nothing", () => {
    const asText = releaseFields.map((f) => f.name === "downloads" ? { ...f, type: "string" } : f);
    expect(codeOf(() => core.evolveCollection({ name: "releases", fields: asText, allowBreaking: true }))).toBe("records_invalid");
    expect(core.resolveCollection("releases")!.version).toBe(1);
  });

  it("making a field searchable reindexes the records", () => {
    expect(core.queryRecords({ collection: "releases", text: "3" }).count).toBe(0);
    core.evolveCollection({ name: "releases", fields: releaseFields.map((f) => f.name === "downloads" ? { ...f, searchable: true } : f) });
    expect(core.queryRecords({ collection: "releases", text: "3" }).count).toBe(1);
  });
});

describe("queryRecords", () => {
  beforeEach(() => {
    defineReleases();
    core.putRecord({ collection: "releases", data: { version: "2.19.0", tagged: true, prs: ["#49", "#51"], downloads: 10, channel: "npm", notes: "porter stemming" } });
    core.putRecord({ collection: "releases", data: { version: "2.20.0", tagged: true, prs: ["#55"], downloads: 30, channel: "clawhub" } });
    core.putRecord({ collection: "releases", data: { version: "2.21.0", tagged: false, prs: ["#60"], downloads: 0 } });
  });

  const keys = (r: { records: { key: string | null }[] }) => r.records.map((x) => x.key).sort();

  it("filters with every operator", () => {
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "tagged", op: "eq", value: false }] }))).toEqual(["2.21.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "tagged", op: "neq", value: false }] }))).toEqual(["2.19.0", "2.20.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "downloads", op: "gt", value: 5 }] }))).toEqual(["2.19.0", "2.20.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "downloads", op: "lte", value: 10 }] }))).toEqual(["2.19.0", "2.21.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "channel", op: "in", value: ["npm", "clawhub"] }] }))).toEqual(["2.19.0", "2.20.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "prs", op: "contains", value: "#55" }] }))).toEqual(["2.20.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "prs", op: "in", value: ["#49", "#60"] }] }))).toEqual(["2.19.0", "2.21.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "notes", op: "contains", value: "PORTER" }] }))).toEqual(["2.19.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "channel", op: "exists" }] }))).toEqual(["2.19.0", "2.20.0"]);
    expect(keys(core.queryRecords({ collection: "releases", where: [{ field: "key", op: "eq", value: "2.20.0" }] }))).toEqual(["2.20.0"]);
  });

  it("orders and limits", () => {
    const r = core.queryRecords({ collection: "releases", order_by: "downloads", order: "desc", limit: 2 });
    expect(r.records.map((x) => x.key)).toEqual(["2.20.0", "2.19.0"]);
    expect(core.queryRecords({ collection: "releases", limit: 10_000 }).count).toBe(3);
  });

  it("full-text search inside a collection", () => {
    expect(keys(core.queryRecords({ collection: "releases", text: "stemming" }))).toEqual(["2.19.0"]);
  });

  it("rejects undefined fields, wrong value types and SQL-shaped input without running it", () => {
    expect(codeOf(() => core.queryRecords({ collection: "releases", where: [{ field: "nope", op: "eq", value: 1 }] }))).toBe("invalid_query");
    expect(codeOf(() => core.queryRecords({ collection: "releases", where: [{ field: "version') OR 1=1 --", op: "eq", value: 1 }] }))).toBe("invalid_query");
    expect(codeOf(() => core.queryRecords({ collection: "releases", where: [{ field: "downloads", op: "gt", value: "5" }] }))).toBe("invalid_query");
    expect(codeOf(() => core.queryRecords({ collection: "releases", where: [{ field: "prs", op: "eq", value: "#55" }] }))).toBe("invalid_query");
    expect(codeOf(() => core.queryRecords({ collection: "releases", where: [{ field: "tagged", op: "drop" as never, value: 1 }] }))).toBe("invalid_query");
    expect(codeOf(() => core.queryRecords({ collection: "releases", order_by: "1; DROP TABLE records" }))).toBe("invalid_query");
    // A value is always bound, never interpolated.
    expect(core.queryRecords({ collection: "releases", where: [{ field: "version", op: "eq", value: "x' OR '1'='1" }] }).count).toBe(0);
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM records").get()!.n).toBe(3);
  });

  it("hides archived records unless asked", () => {
    core.archiveRecord("releases", { key: "2.21.0" });
    expect(core.queryRecords({ collection: "releases" }).count).toBe(2);
    expect(core.queryRecords({ collection: "releases", include_archived: true }).count).toBe(3);
  });
});

describe("searchRecords", () => {
  it("searches across active collections visible from the project", () => {
    core.defineCollection({ name: "servers", description: "hosts", fields: [{ name: "host", type: "string", required: true }, { name: "role", type: "string" }], key_field: "host" });
    core.defineCollection({ name: "secret_lab", description: "project only", fields: [{ name: "host", type: "string", required: true }], key_field: "host", project: "alpha", force: true });
    core.putRecord({ collection: "servers", data: { host: "pve1", role: "proxmox hypervisor" } });
    core.putRecord({ collection: "secret_lab", project: "alpha", data: { host: "proxmox-lab" } });
    expect(core.searchRecords("proxmox", { project: "beta" }).map((h) => h.key)).toEqual(["pve1"]);
    expect(core.searchRecords("proxmox", { project: "alpha" }).map((h) => h.key).sort()).toEqual(["proxmox-lab", "pve1"]);
    core.setCollectionStatus("servers", null, "archived");
    expect(core.searchRecords("proxmox", { project: "beta" })).toEqual([]);
  });
});

describe("collectionIndexLines", () => {
  it("lists visible collections with counts for session injection", () => {
    expect(core.collectionIndexLines("p")).toEqual([]);
    defineReleases();
    core.putRecord({ collection: "releases", data: { version: "1" } });
    const lines = core.collectionIndexLines("p");
    expect(lines[0]).toContain("collections");
    expect(lines[1]).toBe("- releases[version] (1 record): One row per OpenLtm release");
  });

  it("caps the list", () => {
    for (const n of ["alpha_hosts", "beta_tools", "gamma_links"]) {
      core.defineCollection({ name: n, description: n, fields: [{ name: `${n}_v`, type: "string" }], force: true });
    }
    const lines = core.collectionIndexLines(null, 2);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("1 more");
  });
});
