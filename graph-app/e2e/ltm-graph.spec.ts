import { test, expect } from "@playwright/test";

const API = "http://localhost:7331";

// ── App shell ────────────────────────────────────────────────────────────────

test.describe("OpenLTM app shell", () => {
  test("1. projects landing renders heading + stat cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    // Stat cards populate after data load
    await expect(page.getByText("Total memories")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Active projects")).toBeVisible();
  });

  test("2. sidebar exposes all primary nav items", async ({ page }) => {
    await page.goto("/");
    for (const label of ["Projects", "Graph", "Search", "Health", "Inbox", "Config", "Settings"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
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

  test("5. search route loads", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  });

  test("6. health route loads", async ({ page }) => {
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "Memory Health", level: 1 })).toBeVisible();
  });

  test("7. inbox route loads", async ({ page }) => {
    await page.goto("/pending");
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  });

  test("8. config route loads", async ({ page }) => {
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "Config", level: 1 })).toBeVisible();
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
    await page.keyboard.press("Meta+k");
    const input = page.getByPlaceholder("Jump to a screen or search…");
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill("Graph");
    await page.getByRole("option", { name: "Graph" }).click();
    await expect(page).toHaveURL(/\/graph$/);
  });

  test("11. Escape dismisses palette", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    const input = page.getByPlaceholder("Jump to a screen or search…");
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

  test("16. WebSocket connects to API server", async ({ page }) => {
    const connected = await page.evaluate(
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
    expect(connected).toBe(true);
  });
});
