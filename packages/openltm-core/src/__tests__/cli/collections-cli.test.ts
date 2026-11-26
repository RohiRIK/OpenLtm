import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, rmSync, mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "ltm-collections-cli-"));
const dbPath = join(dir, "openltm.db");
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "schema.sql");
let cli: typeof import("../../cli/collections.js");

beforeAll(async () => {
  const core = await import("../../index.js");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
  cli = await import("../../cli/collections.js");
}, 30_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fields = JSON.stringify([{ name: "host", type: "string", required: true }, { name: "port", type: "integer" }]);

describe("ltm collection / record", () => {
  it("define writes an owner-statement collection; put defaults to owner-statement", async () => {
    const def = await cli.runCollectionCommand(["define", "cli_hosts", "--description", "Hosts", "--fields", fields, "--key", "host"]);
    expect(def.exitCode).toBe(0);
    expect(JSON.parse(def.output).collection.origin).toBe("owner-statement");
    const put = await cli.runRecordCommand(["put", "cli_hosts", "--data", '{"host":"a","port":1}']);
    expect(JSON.parse(put.output).record.origin).toBe("owner-statement");
  });

  it("usage errors exit 1, refusals exit 2", async () => {
    expect((await cli.runCollectionCommand(["define", "x"])).exitCode).toBe(1);
    expect((await cli.runRecordCommand(["put", "cli_hosts", "--data", "{not json"])).exitCode).toBe(1);
    expect((await cli.runRecordCommand(["put", "cli_hosts", "--data", '{"host":"b","bad":1}'])).exitCode).toBe(2);
    expect((await cli.runRecordCommand(["put", "cli_hosts", "--data", '{"host":"c"}', "--origin", "boss"])).exitCode).toBe(1);
  });

  it("evolve refuses a breaking change unless --allow-breaking, which backs up first", async () => {
    const narrow = JSON.stringify([{ name: "host", type: "string", required: true }]);
    expect((await cli.runCollectionCommand(["evolve", "cli_hosts", "--fields", narrow])).exitCode).toBe(2);
    const ok = await cli.runCollectionCommand(["evolve", "cli_hosts", "--fields", narrow, "--allow-breaking"]);
    expect(ok.exitCode).toBe(0);
    const out = JSON.parse(ok.output) as { backup: string; rewritten: number };
    expect(out.rewritten).toBe(1);
    expect(existsSync(out.backup)).toBe(true);
    expect(JSON.parse((await cli.runRecordCommand(["get", "cli_hosts", "a"])).output).record.data).toEqual({ host: "a" });
  });

  it("archive and restore a collection; export prints JSON lines", async () => {
    expect((await cli.runCollectionCommand(["archive", "cli_hosts"])).exitCode).toBe(0);
    expect((await cli.runRecordCommand(["put", "cli_hosts", "--data", '{"host":"z"}'])).exitCode).toBe(2);
    expect((await cli.runCollectionCommand(["restore", "cli_hosts"])).exitCode).toBe(0);
    const exported = await cli.runRecordCommand(["export", "cli_hosts"]);
    expect(exported.output.split("\n").map((l) => JSON.parse(l).key)).toEqual(["a"]);
  });
});
