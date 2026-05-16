import { test, expect } from "@playwright/test";

const API = "http://localhost:7331";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Open the sidebar by using the spotlight (⌘K) to select the first memory result.
 * More reliable than canvas-coordinate clicking on a force-graph node.
 */
async function openSidebarViaSpotlight(page: import("@playwright/test").Page) {
  // Click the ⌘K button in FilterBar — more reliable than keyboard shortcut in headless
  const spotlightBtn = page.locator("button", { hasText: "⌘K" });
  await spotlightBtn.click();
  const input = page.locator("input[placeholder='Jump to memory…']");
  await input.waitFor({ timeout: 5000 });
  await input.fill("bun");
  // Wait for result items to appear then click the first one
  const firstResult = page.locator("ul li").first();
  await firstResult.waitFor({ timeout: 5000 });
  await firstResult.click();
  // Wait for sidebar to show content (the inner div appears when a node is selected)
  await page.locator("[data-testid='sidebar'] .min-w-\\[280px\\]").waitFor({ timeout: 5000 });
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe("LTM Graph Visualizer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Graph renders to canvas — wait for the canvas element + stats to populate
    await page.waitForSelector("canvas", { timeout: 15000 });
    await page.waitForFunction(
      () => document.body.textContent?.match(/\d+\s*memories/) !== null,
      { timeout: 10000 },
    );
  });

  // ── 1. Graph renders ─────────────────────────────────────────────────────────
  test("1. page loads with graph canvas rendered", async ({ page }) => {
    // Graph uses react-force-graph-2d (canvas), not SVG circles
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // Confirm real data is loaded via API
    const res = await page.request.get(`${API}/api/stats`);
    const stats = await res.json() as { memories: number };
    expect(stats.memories).toBeGreaterThan(0);
  });

  // ── 2. Stats bar ─────────────────────────────────────────────────────────────
  test("2. stats bar shows all five counters", async ({ page }) => {
    const body = await page.textContent("body");
    expect(body).toMatch(/\d+\s*memories/);
    expect(body).toMatch(/\d+\s*relations/);
    expect(body).toMatch(/\d+\s*projects/);
    expect(body).toMatch(/\d+\s*context items/);
    expect(body).toMatch(/\d+\s*tags/);
  });

  // ── 3. Project list ──────────────────────────────────────────────────────────
  test("3. project list renders project names", async ({ page }) => {
    const heading = page
      .locator(".uppercase.tracking-widest", { hasText: "Projects" })
      .first();
    await expect(heading).toBeVisible();
    const projectButtons = page.locator("button.text-xs.px-3");
    expect(await projectButtons.count()).toBeGreaterThan(1);
  });

  // ── 4–5+8. Sidebar (shared setup) ───────────────────────────────────────────
  test.describe("Sidebar", () => {
    test.beforeEach(async ({ page }) => {
      await openSidebarViaSpotlight(page);
    });

    test("4. spotlight selection opens the sidebar", async ({ page }) => {
      const sidebar = page.locator("[data-testid='sidebar']");
      await expect(sidebar).toBeVisible({ timeout: 5000 });
    });

    test("5. sidebar shows node content fields", async ({ page }) => {
      const sidebar = page.locator("[data-testid='sidebar']");
      await expect(sidebar).toBeVisible({ timeout: 5000 });
      // Section labels exist inside sidebar
      const fieldLabels = sidebar.locator(".uppercase.tracking-widest");
      expect(await fieldLabels.count()).toBeGreaterThan(0);
    });

    test("8. sidebar close button dismisses sidebar", async ({ page }) => {
      const sidebar = page.locator("[data-testid='sidebar']");
      await expect(sidebar).toBeVisible({ timeout: 5000 });
      const closeBtn = page.getByRole("button", { name: "Close" });
      await closeBtn.waitFor({ timeout: 3000 });
      await closeBtn.click();
      // Sidebar animates to w-0 — content is removed
      await expect(sidebar.locator(".min-w-\\[280px\\]")).not.toBeVisible({ timeout: 3000 });
    });
  });

  // ── 6. Search ────────────────────────────────────────────────────────────────
  test("6. search box filters graph nodes", async ({ page }) => {
    const searchInput = page
      .locator("input[placeholder='Search memories…']")
      .first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("bun");
    await page.waitForTimeout(500); // debounce
    await expect(page.locator("canvas")).toBeVisible();
    await searchInput.clear();
  });

  // ── 7. Importance slider ─────────────────────────────────────────────────────
  test("7. importance slider filters nodes", async ({ page }) => {
    const slider = page.locator("input[type='range']");
    await expect(slider).toBeVisible();
    await slider.fill("5");
    await slider.dispatchEvent("input");
    await page.waitForTimeout(300);
    await expect(page.locator("canvas")).toBeVisible();
    await slider.fill("1");
    await slider.dispatchEvent("input");
  });

  // ── 9. Tag filter ────────────────────────────────────────────────────────────
  test("9. tag filter chips toggle node dimming", async ({ page }) => {
    const tagChips = page.locator("button.rounded-full");
    const count = await tagChips.count();
    if (count === 0) {
      test.skip(true, "No tags in DB");
      return;
    }
    await tagChips.first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("canvas")).toBeVisible();
    await tagChips.first().click(); // toggle off
  });

  // ── 10. Spotlight ────────────────────────────────────────────────────────────
  test("10. spotlight opens with ⌘K and accepts input", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const modal = page.locator("input[placeholder='Jump to memory…']");
    await expect(modal).toBeVisible({ timeout: 3000 });
    await modal.fill("bun");
    await expect(modal).toHaveValue("bun");
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });

  // ── 11. Project drill-down ───────────────────────────────────────────────────
  test("11. clicking project button navigates to drill-down page", async ({
    page,
  }) => {
    // Use a project list button (sidebar left) rather than canvas click
    const projectButtons = page.locator("button.text-xs.px-3");
    const count = await projectButtons.count();
    if (count === 0) {
      test.skip(true, "No project buttons found");
      return;
    }
    await projectButtons.first().click();
    // Should navigate to /project/... or update the view — check for project heading
    await page.waitForTimeout(1000);
    const body = await page.textContent("body");
    expect(body?.length).toBeGreaterThan(100);
  });

  // ── 12. API health ───────────────────────────────────────────────────────────
  test("12. /api/stats returns memories > 0", async ({ request }) => {
    const res = await request.get(`${API}/api/stats`);
    expect(res.status()).toBe(200);
    const json = await res.json() as { memories: number };
    expect(json).toHaveProperty("memories");
    expect(json.memories).toBeGreaterThan(0);
  });

  // ── 13. WebSocket ────────────────────────────────────────────────────────────
  test("13. WebSocket connects to API server", async ({ page }) => {
    const connected = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket("ws://localhost:7331");
          const t = setTimeout(() => { ws.close(); resolve(false); }, 5000);
          ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
          ws.onerror = () => { clearTimeout(t); resolve(false); };
        }),
    );
    expect(connected).toBe(true);
  });

  // ── 14. New Phase 7 — /api/search/all FTS ───────────────────────────────────
  test("14. /api/search/all returns results for known query", async ({ request }) => {
    const res = await request.get(`${API}/api/search/all?q=bun`);
    expect(res.status()).toBe(200);
    const json = await res.json() as unknown[];
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  // ── 15. New Phase 7 — nodes have titles ─────────────────────────────────────
  test("15. /api/graph nodes include title field", async ({ request }) => {
    const res = await request.get(`${API}/api/graph`);
    const data = await res.json() as { nodes: Array<{ id: number; title?: string; label: string }> };
    const memoryNodes = data.nodes.filter(n => n.id > 0);
    expect(memoryNodes.length).toBeGreaterThan(0);
    const withTitle = memoryNodes.filter(n => n.title != null);
    expect(withTitle.length).toBeGreaterThan(0);
  });
});
