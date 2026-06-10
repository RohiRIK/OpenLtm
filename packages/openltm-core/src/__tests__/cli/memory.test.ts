/**
 * memory.test.ts — unit tests for packages/openltm-core/src/cli/memory.ts
 *
 * RED phase: written before implementation. Defines the contract for the
 * `ltm memory <learn|recall|forget|relate|context>` CLI surface that gives
 * headless/CLI agents a direct path to LTM without the agent TUI.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";

// ── Arg parsing (pure) ────────────────────────────────────────────────────────

describe("cli/memory — parseMemoryArgs", () => {
  it("parses learn with all flags", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs([
      "learn",
      "--text", "Use WAL mode for SQLite",
      "--title", "SQLite WAL",
      "--category", "pattern",
      "--importance", "4",
      "--project", "homelab",
      "--tags", "sqlite,db",
      "--json",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command).toBe("learn");
    expect(parsed.options["text"]).toBe("Use WAL mode for SQLite");
    expect(parsed.options["title"]).toBe("SQLite WAL");
    expect(parsed.options["category"]).toBe("pattern");
    expect(parsed.options["importance"]).toBe(4);
    expect(parsed.options["project"]).toBe("homelab");
    expect(parsed.options["tags"]).toEqual(["sqlite", "db"]);
    expect(parsed.json).toBe(true);
  });

  it("learn without --text is a usage error", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["learn", "--category", "pattern"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("--text");
  });

  it("learn rejects invalid category", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["learn", "--text", "x", "--category", "bogus"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("category");
  });

  it("learn rejects importance outside 1-5", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["learn", "--text", "x", "--importance", "9"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("importance");
  });

  it("parses recall with query/limit/project", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["recall", "--query", "docker", "--limit", "5", "--project", "homelab"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command).toBe("recall");
    expect(parsed.options["query"]).toBe("docker");
    expect(parsed.options["limit"]).toBe(5);
  });

  it("forget requires numeric --id", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    expect(parseMemoryArgs(["forget"]).ok).toBe(false);
    expect(parseMemoryArgs(["forget", "--id", "abc"]).ok).toBe(false);
    const parsed = parseMemoryArgs(["forget", "--id", "12", "--reason", "stale"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.options["id"]).toBe(12);
  });

  it("relate requires --from --to --type with valid relationship", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    expect(parseMemoryArgs(["relate", "--from", "1"]).ok).toBe(false);
    expect(parseMemoryArgs(["relate", "--from", "1", "--to", "2", "--type", "nope"]).ok).toBe(false);
    const parsed = parseMemoryArgs(["relate", "--from", "1", "--to", "2", "--type", "supports"]);
    expect(parsed.ok).toBe(true);
  });

  it("context requires --project", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    expect(parseMemoryArgs(["context"]).ok).toBe(false);
    expect(parseMemoryArgs(["context", "--project", "homelab"]).ok).toBe(true);
  });

  it("unknown memory subcommand is a usage error", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["destroy-everything"]);
    expect(parsed.ok).toBe(false);
  });

  it("no subcommand is a usage error", async () => {
    const { parseMemoryArgs } = await import("../../cli/memory.js");
    expect(parseMemoryArgs([]).ok).toBe(false);
  });
});

// ── Round-trip against temp DB ────────────────────────────────────────────────

describe("cli/memory — runMemoryCommand round-trip", () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ltm-cli-test-"));
    const dbPath = join(dir, "test.db");
    const { initDb, _setDbForTesting } = await import("../../shared-db.js");
    const db = await initDb({ dbPath });
    _setDbForTesting(db as Database);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("learn then recall returns the stored memory", async () => {
    const { parseMemoryArgs, runMemoryCommand } = await import("../../cli/memory.js");
    const learnParsed = parseMemoryArgs([
      "learn", "--text", "CLI round trip memory about traefik routing", "--category", "gotcha", "--json",
    ]);
    expect(learnParsed.ok).toBe(true);
    if (!learnParsed.ok) return;
    const learnRes = await runMemoryCommand(learnParsed);
    expect(learnRes.exitCode).toBe(0);
    const learnOut = JSON.parse(learnRes.output);
    expect(typeof learnOut.id).toBe("number");
    expect(["created", "reinforced"]).toContain(learnOut.action);

    const recallParsed = parseMemoryArgs(["recall", "--query", "traefik routing", "--json"]);
    expect(recallParsed.ok).toBe(true);
    if (!recallParsed.ok) return;
    const recallRes = await runMemoryCommand(recallParsed);
    expect(recallRes.exitCode).toBe(0);
    const rows = JSON.parse(recallRes.output);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r: { id: number }) => r.id === learnOut.id)).toBe(true);
  });

  it("forget removes the memory", async () => {
    const { parseMemoryArgs, runMemoryCommand } = await import("../../cli/memory.js");
    const learnParsed = parseMemoryArgs(["learn", "--text", "Temporary memory to forget immediately", "--category", "pattern", "--json"]);
    if (!learnParsed.ok) throw new Error("parse failed");
    const learnRes = await runMemoryCommand(learnParsed);
    const { id } = JSON.parse(learnRes.output);

    const forgetParsed = parseMemoryArgs(["forget", "--id", String(id), "--reason", "test", "--json"]);
    if (!forgetParsed.ok) throw new Error("parse failed");
    const forgetRes = await runMemoryCommand(forgetParsed);
    expect(forgetRes.exitCode).toBe(0);
    expect(JSON.parse(forgetRes.output).ok).toBe(true);
  });

  it("relate links two memories", async () => {
    const { parseMemoryArgs, runMemoryCommand } = await import("../../cli/memory.js");
    const a = JSON.parse((await runMemoryCommand(parseMemoryArgs(["learn", "--text", "Memory A for relate test", "--category", "pattern", "--json"]) as never)).output);
    const b = JSON.parse((await runMemoryCommand(parseMemoryArgs(["learn", "--text", "Memory B for relate test", "--category", "pattern", "--json"]) as never)).output);
    const parsed = parseMemoryArgs(["relate", "--from", String(a.id), "--to", String(b.id), "--type", "related_to", "--json"]);
    if (!parsed.ok) throw new Error("parse failed");
    const res = await runMemoryCommand(parsed);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.output).ok).toBe(true);
  });

  it("context returns globals and scoped arrays", async () => {
    const { parseMemoryArgs, runMemoryCommand } = await import("../../cli/memory.js");
    const parsed = parseMemoryArgs(["context", "--project", "ltm-cli-test", "--json"]);
    if (!parsed.ok) throw new Error("parse failed");
    const res = await runMemoryCommand(parsed);
    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.output);
    expect(Array.isArray(out.globals)).toBe(true);
    expect(Array.isArray(out.scoped)).toBe(true);
  });
});
