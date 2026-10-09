import { test, expect } from "@playwright/test";

const API = "http://localhost:7331";

// ── App shell ────────────────────────────────────────────────────────────────

test.describe("OpenLTM app shell", () => {
  test("1. / redirects to the projects landing, which lists every project", async ({ page, request }) => {
    const projects = (await (await request.get(`${API}/api/health/projects`)).json()) as Array<{ project: string }>;
    await page.goto("/");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    // The project list populates after data load
    await expect(page.getByRole("heading", { name: "All projects", level: 2 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(`${projects.length} total`)).toBeVisible();
  });

  test("2. top nav exposes all primary nav items", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("banner").getByRole("navigation");
    for (const label of ["Projects", "Graph", "Inbox", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("3. backend status chip renders vec + live badges", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel(/Vector search (on|off)/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel(/Live updates (on|off)/)).toBeVisible();
  });
});

// ── Route navigation (via sidebar) ───────────────────────────────────────────

test.describe("navigation", () => {
  test("4. graph route renders force-graph canvas", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Graph" }).click();
    await expect(page).toHaveURL(/\/graph$/);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 15000 });
  });

  test("4b. graph screen has no duplicate chrome (retired StatsBar/FilterBar/ProjectList)", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 15000 });
    // Old FilterBar in-graph search is retired (search lives on /search + ⌘K)
    await expect(page.getByPlaceholder("Search memories…")).toHaveCount(0);
    // Old StatsBar top bar is retired — its inline "context items" / "relations" labels must be gone
    await expect(page.getByText(/\d+\s+context items/)).toHaveCount(0);
    await expect(page.getByText(/\d+\s+relations/)).toHaveCount(0);
    // The single shadcn toolbar (Filters) is the only graph chrome
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
  });

  test("5. project page loads for a real project", async ({ page, request }) => {
    const projects = (await (await request.get(`${API}/api/health/projects`)).json()) as Array<{ project: string }>;
    test.skip(projects.length === 0, "no projects in this DB");
    const name = projects[0]!.project;
    await page.goto(`/projects/${encodeURIComponent(name)}`);
    await expect(page.getByRole("heading", { name: name.split("/").pop()!, level: 1 })).toBeVisible({ timeout: 15000 });
  });

  test("6. project memories route loads", async ({ page, request }) => {
    const projects = (await (await request.get(`${API}/api/health/projects`)).json()) as Array<{ project: string }>;
    test.skip(projects.length === 0, "no projects in this DB");
    await page.goto(`/projects/${encodeURIComponent(projects[0]!.project)}/memories`);
    await expect(page.getByRole("heading", { name: "Memories", level: 1 })).toBeVisible({ timeout: 15000 });
  });

  test("7. inbox route loads", async ({ page }) => {
    await page.goto("/pending");
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  });

  test("8. every settings section loads", async ({ page }) => {
    for (const section of ["behavior", "health", "advanced", "about"]) {
      await page.goto(`/settings/${section}`);
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
    }
  });

  test("9. settings route loads", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });
});

// ── Command palette ──────────────────────────────────────────────────────────

test.describe("command palette", () => {
  test("10. ⌘K opens palette and navigates", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder("Search or type a command...");
    await expect(input).toBeVisible({ timeout: 3000 });
    await page.getByRole("option", { name: "Global Graph" }).click();
    await expect(page).toHaveURL(/\/graph$/);
  });

  test("10b. palette keyword search finds a stored memory", async ({ page, request }) => {
    const hits = (await (await request.get(`${API}/api/search/all?q=bun`)).json()) as Array<{ content: string }>;
    test.skip(hits.length === 0, "no memory mentions bun in this DB");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search or type a command...").fill("bun");
    await page.getByRole("button", { name: "Keyword" }).click();
    await expect(page.getByRole("option").filter({ hasText: hits[0]!.content.slice(0, 40) }).first()).toBeVisible({ timeout: 5000 });
  });

  test("11. Escape dismisses palette", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder("Search or type a command...");
    await expect(input).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(input).not.toBeVisible({ timeout: 2000 });
  });
});

// ── Backend API integration ──────────────────────────────────────────────────

test.describe("API", () => {
  test("12. /api/stats returns memories > 0", async ({ request }) => {
    const res = await request.get(`${API}/api/stats`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { memories: number };
    expect(json.memories).toBeGreaterThan(0);
  });

  test("13. /api/capabilities returns vec/honker/live shape", async ({ request }) => {
    const res = await request.get(`${API}/api/capabilities`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("vec");
    expect(json).toHaveProperty("honker");
    expect(json).toHaveProperty("live");
  });

  test("14. /api/memory/:id/similar returns scored neighbours", async ({ request }) => {
    const graph = (await (await request.get(`${API}/api/graph`)).json()) as {
      nodes: Array<{ id: number }>;
    };
    const seed = graph.nodes.find((n) => n.id > 0);
    expect(seed).toBeDefined();
    const res = await request.get(`${API}/api/memory/${seed!.id}/similar?limit=3`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as Array<{ id: number; content: string; similarity: number }>;
    expect(Array.isArray(json)).toBe(true);
    // Source memory must never appear in its own neighbour list
    expect(json.every((n) => n.id !== seed!.id)).toBe(true);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty("similarity");
      expect(json[0]).toHaveProperty("content");
    }
  });

  test("15. /api/search/all returns FTS results", async ({ request }) => {
    const res = await request.get(`${API}/api/search/all?q=bun`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as unknown[];
    expect(Array.isArray(json)).toBe(true);
  });

  // The UI's live-update socket: allowed from the UI's own (loopback) origin…
  const wsOpens = (page: import("@playwright/test").Page) =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket("ws://localhost:7331");
          const t = setTimeout(() => {
            ws.close();
            resolve(false);
          }, 5000);
          ws.onopen = () => {
            clearTimeout(t);
            ws.close();
            resolve(true);
          };
          ws.onerror = () => {
            clearTimeout(t);
            resolve(false);
          };
        }),
    );

  test("16. WebSocket connects to API server from the UI origin", async ({ page }) => {
    await page.goto("/");
    expect(await wsOpens(page)).toBe(true);
  });

  // …and refused from an opaque ("null") origin, which the Origin guard rejects.
  test("16b. WebSocket from a null origin is refused", async ({ page }) => {
    await page.goto("about:blank");
    expect(await wsOpens(page)).toBe(false);
  });
});
