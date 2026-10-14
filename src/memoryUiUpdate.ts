/**
 * memoryUiUpdate.ts — body handling for PUT /api/memory/:id/ui (graph server).
 * Extracted so the route's write path is testable without starting a server.
 *
 * `title` and `user_note` are durable free text: they go through the same
 * fail-closed scrubOrRefuse as every other memory write (on scrub failure the
 * placeholder is stored, never the original).
 */
import type { Database } from "bun:sqlite";
import { scrubOrRefuse } from "@rohirik/openltm-core";

export type UiUpdateResult = { ok: true } | { ok: false; error: string };

function scrubText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return scrubOrRefuse(String(v)).scrubbed;
}

/** #rgb or #rrggbb. */
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** An icon name (letters, digits, - _) or a short emoji; at most 32 chars. */
const ICON_RE = /^[\p{L}\p{N}\p{Extended_Pictographic}_\-\u200d\ufe0f]+$/u;
export const ICON_MAX_LENGTH = 32;

export function applyMemoryUiUpdate(db: Database, id: number, body: Record<string, unknown>): UiUpdateResult {
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if ("hidden" in body)    { updates.push("hidden=?");    params.push(body.hidden ? 1 : 0); }
  if ("color" in body) {
    const c = body.color;
    if (c !== null && (typeof c !== "string" || !COLOR_RE.test(c))) {
      return { ok: false, error: "color must be #rgb or #rrggbb (or null)" };
    }
    updates.push("color=?"); params.push(c as string | null);
  }
  if ("icon" in body) {
    const i = body.icon;
    if (i !== null && (typeof i !== "string" || i.length === 0 || i.length > ICON_MAX_LENGTH || !ICON_RE.test(i))) {
      return { ok: false, error: `icon must be a name or emoji of at most ${ICON_MAX_LENGTH} characters (or null)` };
    }
    updates.push("icon=?"); params.push(i as string | null);
  }
  if ("user_note" in body) { updates.push("user_note=?"); params.push(scrubText(body.user_note)); }
  if ("title" in body)     { updates.push("title=?");     params.push(scrubText(body.title)); }
  if (updates.length === 0) return { ok: false, error: "No fields to update" };
  params.push(id);
  db.run(`UPDATE memories SET ${updates.join(", ")} WHERE id=?`, params);
  return { ok: true };
}

/**
 * Replace a memory's tags (graph PUT /api/memory/:id). Tag names are durable
 * text: scrubOrRefuse before they reach the tags table.
 */
export function replaceMemoryTags(db: Database, id: number, tags: string[]): void {
  // One transaction: a failure part-way never leaves the memory with no tags.
  db.transaction(() => {
    db.run("DELETE FROM memory_tags WHERE memory_id=?", [id]);
    for (const rawTag of tags) {
      // Scrub BEFORE lowercasing (secret patterns are case-sensitive), then
      // normalise like learn()'s attachTags.
      const tag = scrubOrRefuse(rawTag.trim()).scrubbed.toLowerCase();
      if (!tag) continue;
      db.run("INSERT OR IGNORE INTO tags(name) VALUES(?)", [tag]);
      const tagRow = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name=?").get(tag)!;
      db.run("INSERT OR IGNORE INTO memory_tags(memory_id,tag_id) VALUES(?,?)", [id, tagRow.id]);
    }
  })();
}
