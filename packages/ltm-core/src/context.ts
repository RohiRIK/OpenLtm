/**
 * context.ts — Per-project context items (goals, decisions, progress, gotchas)
 * Replaces the 4 per-project Markdown context files.
 * Used by: PreCompact, UpdateContext, Cleanup, SessionStart hooks.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getDb, DB_PATH } from "./shared-db.js";
import { learn } from "./db.js";

export { DB_PATH };
const CLAUDE_DIR   = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

export type ContextType = "goal" | "decision" | "progress" | "gotcha";

export interface ContextItem {
  id: number;
  project_name: string;
  type: ContextType;
  content: string;
  session_id: string | null;
  permanent: number;
  memory_id?: number;
  created_at: string;
}


/** Budget-capped section for context-summary.md output. */
function section(label: string, items: ContextItem[], budget: number): string {
  if (items.length === 0) return "";
  const lines = items.map(i => i.content);
  const available = Math.max(0, budget - 2); // header(1) + trailing blank
  if (lines.length <= available) {
    return [`${label}`, ...lines, ""].join("\n");
  }
  const kept = lines.slice(-available);
  return [`${label}`, ...kept, `… (${lines.length - available} more not shown)`, ""].join("\n");
}

/**
 * Add a context item for a project.
 * - goal: one row per project (delete+insert to maintain uniqueness)
 * - decision/gotcha: permanent=1, append only
 * - progress: permanent=0, dedup by session_id
 * @param skipExport  Skip regenerating context-summary.md (use during bulk imports)
 */
export function addItem(
  project: string,
  type: ContextType,
  content: string,
  sessionId?: string,
  skipExport = false
): void {
  const db = getDb();

  if (type === "goal") {
    db.transaction(() => {
      db.run(`DELETE FROM context_items WHERE type='goal' AND project_name=?`, [project]);
      db.run(
        `INSERT INTO context_items (project_name, type, content, session_id, permanent)
         VALUES (?, 'goal', ?, ?, 0)`,
        [project, content, sessionId ?? null]
      );
    })();
  } else if (type === "decision" || type === "gotcha") {
    db.run(
      `INSERT INTO context_items (project_name, type, content, session_id, permanent)
       VALUES (?, ?, ?, ?, 1)`,
      [project, type, content, sessionId ?? null]
    );
  } else {
    // progress — dedup by session_id
    if (sessionId) {
      const existing = db.query<{ id: number }, [string, string]>(
        `SELECT id FROM context_items WHERE type='progress' AND project_name=? AND session_id=? LIMIT 1`
      ).get(project, sessionId);
      if (existing) return;
    }
    db.run(
      `INSERT INTO context_items (project_name, type, content, session_id, permanent)
       VALUES (?, 'progress', ?, ?, 0)`,
      [project, content, sessionId ?? null]
    );
  }

  if (!skipExport) exportContextMarkdown(project);
}

/**
 * Retrieve context items for a project, optionally filtered by type.
 */
export function getItems(
  project: string,
  type?: ContextType,
  limit?: number
): ContextItem[] {
  const db = getDb();

  if (type === "progress") {
    const cap = limit ?? 20;
    return db.query<ContextItem, [string]>(
      `SELECT * FROM context_items WHERE type='progress' AND project_name=?
       ORDER BY id DESC LIMIT ${cap}`
    ).all(project).reverse();
  }

  if (type) {
    return db.query<ContextItem, [string, string]>(
      `SELECT * FROM context_items WHERE type=? AND project_name=? ORDER BY id ASC`
    ).all(type, project);
  }

  return db.query<ContextItem, [string]>(
    `SELECT * FROM context_items WHERE project_name=? ORDER BY id ASC`
  ).all(project);
}

/**
 * Trim progress items to last N for a project.
 */
export function trimProgress(project: string, max = 20): void {
  getDb().run(
    `DELETE FROM context_items WHERE type='progress' AND project_name=? AND id NOT IN
     (SELECT id FROM context_items WHERE type='progress' AND project_name=? ORDER BY id DESC LIMIT ?)`,
    [project, project, max]
  );
}

/**
 * Export context-summary.md for a project from DB contents.
 * Keeps the file as a human-readable snapshot and backward-compat fallback.
 */
export function exportContextMarkdown(project: string): void {
  const projectDir = join(PROJECTS_DIR, project);
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const summary = [
    `# ${project} | ${date}\n`,
    section("GOAL:",     getItems(project, "goal"),         10),
    section("PROGRESS:", getItems(project, "progress", 20), 20),
    section("DEC:",      getItems(project, "decision"),     15),
    section("WATCH:",    getItems(project, "gotcha"),       15),
  ].join("");

  writeFileSync(join(projectDir, "context-summary.md"), summary);
}

/**
 * Promote a decision or gotcha context_item into global LTM memories.
 * Returns the new memory id, or null if the item is not promotable.
 */
export function promote(itemId: number): number | null {
  const db = getDb();
  const item = db.query<ContextItem, [number]>(
    "SELECT * FROM context_items WHERE id = ?"
  ).get(itemId);
  if (!item || !["decision", "gotcha"].includes(item.type)) return null;
  const category = item.type === "decision" ? "architecture" : "gotcha";
  const importance = item.type === "gotcha" ? 4 : 3;
  const result = learn({
    content: item.content,
    category,
    importance,
    project_scope: item.project_name,
    source: "context_item",
  });
  db.prepare("UPDATE context_items SET memory_id = ? WHERE id = ?").run(result.id, itemId);
  return result.id;
}
