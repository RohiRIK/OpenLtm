/**
 * PUT /api/memory/:id/ui body handling — title and user_note are scrubbed
 * (fail-closed) before the UPDATE.
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { applyMemoryUiUpdate, replaceMemoryTags } from "../memoryUiUpdate.js";
import { _forceScrubThrowForTesting, SCRUB_FAILED_PLACEHOLDER } from "@rohirik/openltm-core";
import { getSchemaPath } from "../../packages/openltm-core/src/paths.js";

const AWS = "AKIAIOSFODNN7EXAMPLE";
const SCHEMA = getSchemaPath();

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

describe("PUT /api/memory/:id/ui color + icon validation", () => {
  it.each(["#abc", "#A1B2C3", null])("accepts color %p", async (color) => {
    const { db, id } = freshDb();
    expect(await put(db, id, { color })).toEqual({ ok: true });
  });

  it.each(["red", "#abcd", "#12345g", "javascript:alert(1)", "#fff; background:url(x)", 7])("rejects color %p", async (color) => {
    const { db, id } = freshDb();
    const r = await put(db, id, { color, title: "should not apply" });
    expect(r.ok).toBe(false);
    const row = db.query<{ color: string | null; title: string | null }, [number]>("SELECT color, title FROM memories WHERE id=?").get(id)!;
    expect(row.color).toBeNull();
    expect(row.title).toBeNull();
  });

  it.each(["star", "alert-triangle", "🔥", null])("accepts icon %p", async (icon) => {
    const { db, id } = freshDb();
    expect(await put(db, id, { icon })).toEqual({ ok: true });
  });

  it.each(["", "x".repeat(33), "<svg onload=x>", "a b", `AKIA ${AWS}`, 3])("rejects icon %p", async (icon) => {
    const { db, id } = freshDb();
    expect((await put(db, id, { icon })).ok).toBe(false);
    expect(db.query<{ icon: string | null }, [number]>("SELECT icon FROM memories WHERE id=?").get(id)!.icon).toBeNull();
  });
});

describe("graph PUT /api/memory/:id tags scrub", () => {
  it("plant-secret tag name is stored redacted", () => {
    const { db, id } = freshDb();
    replaceMemoryTags(db, id, [`deploy-${AWS}`, "clean"]);
    const names = db.query<{ name: string }, [number]>(
      "SELECT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id WHERE mt.memory_id=?",
    ).all(id).map((r) => r.name);
    expect(names.join(",").toUpperCase()).not.toContain(AWS);
    expect(names).toContain("clean");
    expect(names.some((n) => n.includes("[redacted:aws-access-key]"))).toBe(true);
  });
});

describe("replaceMemoryTags transaction + normalisation", () => {
  const names = (db: Database, id: number) => db.query<{ name: string }, [number]>(
    "SELECT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id WHERE mt.memory_id=? ORDER BY t.name",
  ).all(id).map((r) => r.name);

  it("lowercases and trims like learn()'s attachTags", () => {
    const { db, id } = freshDb();
    replaceMemoryTags(db, id, ["  Infra ", "CI"]);
    expect(names(db, id)).toEqual(["ci", "infra"]);
  });

  it("a failure part-way rolls back: previous tags are kept", () => {
    const { db, id } = freshDb();
    replaceMemoryTags(db, id, ["old-a", "old-b"]);
    // A non-string sneaks past validation -> trim() throws mid-loop.
    expect(() => replaceMemoryTags(db, id, ["new-a", 42 as unknown as string])).toThrow();
    expect(names(db, id)).toEqual(["old-a", "old-b"]);
  });
});
