/**
 * SessionStart compact index (#30/#33), staged-conflict banner (#35) and egress
 * scrubbing (#31) — asserted on the hook's real output, not its source text.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "fs";
import { join } from "path";
import { applyInjectTopN } from "../../../hooks/lib/injectTopN.js";
import { initSandboxDb, makeSandbox, markOnboarded, runHook, seedMemory, writeConfig, type Sandbox } from "./hookHarness";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

describe("SessionStart compact index (behaviour)", () => {
  let sb: Sandbox;
  let cwd: string;

  beforeEach(() => {
    sb = makeSandbox("ss-compact");
    cwd = join(sb.base, "code", "ledger-app");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    markOnboarded(sb);
    initSandboxDb(sb);
  });
  afterEach(() => sb.cleanup());

  const index = (stdout: string) => stdout.split("\n").filter((l) => /^- \[\d+\] /.test(l));
  const start = async (source = "resume") => (await runHook("SessionStart.ts", { cwd, session_id: "s1", source }, sb)).stdout;

  it("lists id + title (or a clipped, scrubbed snippet), never the full body", async () => {
    const titled = seedMemory(sb, { content: "Ledger totals are summed in integer cents to avoid float rounding drift across invoices", importance: 4 });
    new Database(sb.dbPath).run("UPDATE memories SET title = ? WHERE id = ?", ["Ledger totals in integer cents", titled]);
    const long = seedMemory(sb, { content: `Deploy key for the ledger CI runner is ${AWS_KEY} and it rotates monthly via the vault job ${"x".repeat(120)}`, importance: 4 });
    await start("startup");
    const out = await start();

    expect(out).toContain("LTM index (use MCP get <id> for full memory):");
    const lines = index(out);
    expect(lines).toContain(`- [${titled}] Ledger totals in integer cents`);
    const longLine = lines.find((l) => l.startsWith(`- [${long}] `))!;
    expect(longLine.endsWith("…")).toBe(true);
    expect(longLine.length).toBeLessThanOrEqual(`- [${long}] `.length + 81);
    expect(out).not.toContain(AWS_KEY);
  }, 30_000);

  it("caps the index at injectTopN with globals limited to a third", async () => {
    for (let i = 0; i < 10; i++) seedMemory(sb, { content: `global ledger convention number ${i}`, importance: 4 });
    for (let i = 0; i < 10; i++) seedMemory(sb, { content: `project ledger note number ${i}`, importance: 3, project: "ledger-app" });
    writeConfig(sb, { ltm: { injectTopN: 3 } });
    await start("startup");
    const out = await start();
    const lines = index(out);
    expect(lines.length).toBe(3);
    expect(lines.filter((l) => l.includes("global ledger")).length).toBe(1);
  }, 30_000);

  it("lists pending staged conflicts with a scrubbed term", async () => {
    const older = seedMemory(sb, { content: "ledger exports use CSV", importance: 4 });
    const newer = seedMemory(sb, { content: "ledger exports use Parquet", importance: 4 });
    const db = new Database(sb.dbPath);
    const staging = Number(db.run("INSERT INTO memory_conflict_staging (older_id, newer_id, term) VALUES (?, ?, ?)", [older, newer, `csv vs parquet ${AWS_KEY}`]).lastInsertRowid);
    db.close();
    await start("startup");
    const out = await start();
    expect(out).toContain("Pending review (ltm conflict accept|reject <stagingId>):");
    expect(out).toContain(`- staging #${staging}: [${older}] vs [${newer}]`);
    expect(out).not.toContain(AWS_KEY);
  }, 30_000);
});

describe("applyInjectTopN", () => {
  it("honors injectTopN when compacting", () => {
    const globals = Array.from({ length: 10 }, (_, i) => ({ id: i, content: `g${i}` }));
    const scoped = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, content: `s${i}` }));
    const capped = applyInjectTopN(globals, scoped, 3);
    expect(capped.globals.length + capped.scoped.length).toBe(3);
  });
});
