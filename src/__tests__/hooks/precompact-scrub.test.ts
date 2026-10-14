/**
 * PreCompact snapshot egress: context_items text is scrubbed before it is
 * written to context-summary.md (asserted on the hook's real output file).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { initSandboxDb, makeSandbox, markOnboarded, runHook, type Sandbox } from "./hookHarness";
import { scrubSnapshotLines } from "../../../hooks/lib/snapshotLines.js";
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
