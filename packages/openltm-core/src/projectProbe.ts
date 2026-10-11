/**
 * projectProbe.ts — Bun-side continuity probe for project.ts.
 *
 * Kept out of project.ts because it imports bun:sqlite, and project.ts must stay
 * loadable under Node (the OpenClaw adapter inlines it).
 *
 * ensureCustomSqlite() runs before the read-only handle opens: Bun allows the
 * SQLite library to be swapped only before the first Database is created, and a
 * hook resolves its project before it touches the main DB. Probing first with
 * the bundled SQLite would silently disable sqlite-vec and Honker for the rest
 * of that process.
 */
import { Database } from "bun:sqlite";
import { ensureCustomSqlite } from "./extensions.js";
import { projectHasData, type ProbeDb, type ProjectDataProbe } from "./project.js";

function openReadonly(dbPath: string): ProbeDb {
  ensureCustomSqlite();
  return new Database(dbPath, { readonly: true }) as unknown as ProbeDb;
}

/** Probe `dbPath` (read-only, never created) for rows under a project name. */
export function createProjectDataProbe(dbPath: string): ProjectDataProbe {
  return (name) => projectHasData(name, dbPath, openReadonly);
}
