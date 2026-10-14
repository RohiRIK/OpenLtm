/**
 * PreCompact snapshot egress: context_items text is scrubbed before it is
 * written to context-summary.md (asserted on the hook's real output file).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { initSandboxDb, makeSandbox, markOnboarded, runHook, type Sandbox } from "./hookHarness";
import { newSnapshotStats, scrubSnapshotLines, writeSnapshotUnlessAllDropped } from "../../../hooks/lib/snapshotLines.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { _forceScrubThrowForTesting } from "@rohirik/openltm-core";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function findSummary(root: string): string | null {
  if (!existsSync(root)) return null;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) { const f = findSummary(p); if (f) return f; }
    else if (e.name === "context-summary.md") return p;
  }
  return null;
}

describe("PreCompact snapshot scrub (handler)", () => {
  let sb: Sandbox;
  let cwd: string;

  beforeEach(() => {
    sb = makeSandbox("precompact-scrub");
    cwd = join(sb.base, "code", "ledger-app");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    markOnboarded(sb);
    initSandboxDb(sb);
  });
  afterEach(() => sb.cleanup());

  it("planted secret in context_items never reaches context-summary.md", async () => {
    const db = new Database(sb.dbPath);
    for (const type of ["goal", "decision", "gotcha", "progress"]) {
      db.run(
        `INSERT INTO context_items (project_name, type, content, permanent, status) VALUES ('ledger-app', ?, ?, 1, 'active')`,
        [type, `${type}: CI deploy key ${AWS_KEY} lives in the runner env`],
      );
    }
    db.close();
    const r = await runHook("PreCompact.ts", { cwd, session_id: "s1" }, sb);
    expect(r.exitCode).toBe(0);
    const file = findSummary(sb.data) ?? findSummary(sb.home);
    expect(file).not.toBeNull();
    const text = readFileSync(file!, "utf-8");
    expect(text).toContain("[REDACTED:aws-access-key]");
    expect(text).not.toContain(AWS_KEY);
  }, 30_000);
});

describe("scrubSnapshotLines", () => {
  it("redacts secrets in every line", () => {
    const out = scrubSnapshotLines([`key ${AWS_KEY}`, "clean line"]);
    expect(out.join("\n")).not.toContain(AWS_KEY);
    expect(out).toContain("clean line");
  });

  it("forced scrub throw: lines are omitted, never written raw", () => {
    _forceScrubThrowForTesting(true);
    try {
      const out = scrubSnapshotLines([`key ${AWS_KEY}`, "another"]);
      expect(out).toEqual([]);
    } finally {
      _forceScrubThrowForTesting(false);
    }
  });
});

describe("PreCompact keeps the previous summary when every line is dropped", () => {
  it("all lines fail to scrub -> previous context-summary.md is untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "precompact-keep-"));
    const path = join(dir, "context-summary.md");
    writeFileSync(path, "PREVIOUS SUMMARY");
    try {
      const stats = newSnapshotStats();
      _forceScrubThrowForTesting(true);
      let lines: string[];
      try {
        lines = scrubSnapshotLines([`goal ${AWS_KEY}`, "progress"], stats);
      } finally {
        _forceScrubThrowForTesting(false);
      }
      expect(lines).toEqual([]);
      expect(stats).toEqual({ input: 2, kept: 0 });
      expect(writeSnapshotUnlessAllDropped(path, "# Context Summary\n", stats)).toBe(false);
      expect(readFileSync(path, "utf-8")).toBe("PREVIOUS SUMMARY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes when some lines survive, and when there was nothing to scrub", () => {
    const dir = mkdtempSync(join(tmpdir(), "precompact-write-"));
    const path = join(dir, "context-summary.md");
    writeFileSync(path, "PREVIOUS SUMMARY");
    try {
      const stats = newSnapshotStats();
      scrubSnapshotLines(["kept line"], stats);
      expect(writeSnapshotUnlessAllDropped(path, "NEW", stats)).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("NEW");
      expect(writeSnapshotUnlessAllDropped(path, "EMPTY PROJECT", newSnapshotStats())).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("EMPTY PROJECT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("first run with every line dropped still writes (no previous file to keep)", () => {
    const dir = mkdtempSync(join(tmpdir(), "precompact-first-"));
    const path = join(dir, "context-summary.md");
    try {
      expect(writeSnapshotUnlessAllDropped(path, "SKELETON", { input: 3, kept: 0 })).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("SKELETON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
