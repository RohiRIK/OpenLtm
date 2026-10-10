import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

// Every mutating action the UI performs, sent the way lib/api.ts sends it: from
// a loaded page (browser Origin), through the Next proxy (:7332 → :7331), past
// the 2.17 request guard — then checked in the database. Needs LTM_DB_PATH =
// the API server's DB (set by scripts/qa/ui-smoke.ts).
const db = () => new DatabaseSync(process.env.LTM_DB_PATH!);
function insert(content: string, status = "active"): number {
  const d = db();
  try {
    const key = `actions-${content}-${Math.random()}`;
    const r = d.prepare("INSERT INTO memories (content, category, importance, status, dedup_key, project_scope) VALUES (?, 'pattern', 3, ?, ?, 'ui-smoke')").run(content, status, key);
    return Number(r.lastInsertRowid);
  } finally { d.close(); }
}
function row(id: number): Record<string, unknown> | undefined {
  const d = db();
  try { return d.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Record<string, unknown> | undefined; }
  finally { d.close(); }
}

/** fetch() from the page, with the headers lib/api.ts uses for every mutation. */
async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  }, { method, path, body });
}

test.describe("2.17 UI actions through the Next proxy", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  });

  test("approve a pending memory", async ({ page }) => {
    const id = insert("actions: pending memory to approve", "pending");
    const r = await call(page, "POST", `/memory/${id}/approve`);
    expect(r.status).toBe(200);
    expect(row(id)?.status).toBe("active");
  });

  test("edit a memory — content is secret-scrubbed on the way in", async ({ page }) => {
    const id = insert("actions: memory to edit");
    const r = await call(page, "PUT", `/memory/${id}`, { content: "edited: deploy key AKIAIOSFODNN7EXAMPLE rotates monthly", importance: 4, tags: ["edited"] });
    expect(r.status).toBe(200);
    const after = row(id)!;
    expect(after.importance).toBe(4);
    expect(String(after.content)).toContain("edited: deploy key");
    expect(String(after.content)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("supersede one memory with another", async ({ page }) => {
    const older = insert("actions: older approach uses npm");
    const newer = insert("actions: newer approach uses bun");
    const r = await call(page, "POST", `/memory/${newer}/supersedes/${older}`);
    expect(r.status).toBe(200);
    expect(row(older)?.status).toBe("superseded");
  });

  test("merge two memories", async ({ page }) => {
    const keep = insert("actions: keep this memory");
    const gone = insert("actions: merge this one in");
    const r = await call(page, "POST", "/memory/merge", { keepId: keep, supersededId: gone, mergedContent: "actions: merged memory" });
    expect(r.status).toBe(200);
    expect(row(keep)?.content).toBe("actions: merged memory");
    expect(row(gone)?.status).not.toBe("active");
  });

  test("delete a memory", async ({ page }) => {
    const id = insert("actions: memory to delete");
    const r = await call(page, "DELETE", `/memory/${id}`);
    expect(r.status).toBe(200);
    expect(row(id)).toBeUndefined();
  });

  test("boost, recompute clusters, run the janitor, save config", async ({ page }) => {
    const id = insert("actions: memory to boost");
    expect((await call(page, "POST", `/memory/${id}/boost`)).status).toBe(200);
    expect((await call(page, "POST", "/clusters/recompute")).status).toBe(200);
    expect([200, 409]).toContain((await call(page, "POST", "/janitor/run")).status);
    expect((await call(page, "PUT", "/config", { ltm: { promptRecallLimit: 5 } })).status).toBe(200);
  });
});
