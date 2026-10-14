/**
 * PUT /api/memory/:id/ui body handling — title and user_note are scrubbed
 * (fail-closed) before the UPDATE.
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { applyMemoryUiUpdate } from "../memoryUiUpdate.js";
import { _forceScrubThrowForTesting, SCRUB_FAILED_PLACEHOLDER } from "@rohirik/openltm-core";

const AWS = "AKIAIOSFODNN7EXAMPLE";
const SCHEMA = join(import.meta.dir, "..", "..", "packages", "openltm-core", "src", "schema.sql");

function freshDb(): { db: Database; id: number } {
  const db = new Database(":memory:");
  db.exec(readFileSync(SCHEMA, "utf-8"));
  const id = Number(db.run(
    `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
     VALUES ('ui note body', 'pattern', 3, 1, 'active', 'ui-1')`,
  ).lastInsertRowid);
  return { db, id };
}

async function put(db: Database, id: number, body: unknown) {
  const req = new Request(`http://localhost:7331/api/memory/${id}/ui`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return applyMemoryUiUpdate(db, id, (await req.json()) as Record<string, unknown>);
}

describe("PUT /api/memory/:id/ui scrub", () => {
  it("AKIA title and user_note are stored redacted", async () => {
    const { db, id } = freshDb();
    expect(await put(db, id, { title: `deploy ${AWS}`, user_note: `note ${AWS}` })).toEqual({ ok: true });
    const row = db.query<{ title: string; user_note: string }, [number]>("SELECT title, user_note FROM memories WHERE id=?").get(id)!;
    expect(row.title).not.toContain(AWS);
    expect(row.user_note).not.toContain(AWS);
    expect(row.title).toContain("[REDACTED:aws-access-key]");
  });

  it("forced scrub throw stores the placeholder, never the original", async () => {
    const { db, id } = freshDb();
    _forceScrubThrowForTesting(true);
    try {
      await put(db, id, { title: `deploy ${AWS}` });
    } finally {
      _forceScrubThrowForTesting(false);
    }
    const row = db.query<{ title: string }, [number]>("SELECT title FROM memories WHERE id=?").get(id)!;
    expect(row.title).toBe(SCRUB_FAILED_PLACEHOLDER);
  });

  it("null clears and no fields is a 400-style error", async () => {
    const { db, id } = freshDb();
    expect(await put(db, id, { title: null })).toEqual({ ok: true });
    expect(await put(db, id, {})).toEqual({ ok: false, error: "No fields to update" });
  });
});
