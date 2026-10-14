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

export function applyMemoryUiUpdate(db: Database, id: number, body: Record<string, unknown>): UiUpdateResult {
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if ("hidden" in body)    { updates.push("hidden=?");    params.push(body.hidden ? 1 : 0); }
  if ("color" in body)     { updates.push("color=?");     params.push((body.color as string | null) ?? null); }
  if ("icon" in body)      { updates.push("icon=?");      params.push((body.icon as string | null) ?? null); }
  if ("user_note" in body) { updates.push("user_note=?"); params.push(scrubText(body.user_note)); }
  if ("title" in body)     { updates.push("title=?");     params.push(scrubText(body.title)); }
  if (updates.length === 0) return { ok: false, error: "No fields to update" };
  params.push(id);
  db.run(`UPDATE memories SET ${updates.join(", ")} WHERE id=?`, params);
  return { ok: true };
}
