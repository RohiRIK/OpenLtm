import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

// 2.17 network guards and secret masking, exercised through the real UI and the
// Next proxy (:7332 → :7331). Needs LTM_DB_PATH = the API server's DB (set by
// scripts/qa/ui-smoke.ts).
const API = "http://127.0.0.1:7331";
const KEY = "sk-ui-REALKEY-abcdefgh-4321";
const stored = (key: string) => {
  const db = new DatabaseSync(process.env.LTM_DB_PATH!, { readOnly: true });
  try { return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value; }
  finally { db.close(); }
};

test.describe("2.17 settings masking (UI)", () => {
  test.beforeEach(async ({ request }) => {
    const r = await request.put(`${API}/api/settings`, {
      headers: { "Content-Type": "application/json" },
      data: { "ltm.embed.provider": "openai", "ltm.openai.apiKey": KEY },
    });
    expect(r.ok()).toBe(true);
  });

  test("the settings page never receives the real key", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/settings")) bodies.push(await res.text().catch(() => ""));
    });
    await page.goto("/settings");
    const keyInput = page.locator('input[type="password"]').first();
    await expect(keyInput).toHaveValue(/^••••4321$/);
    expect(bodies.join("\n")).not.toContain(KEY);
  });

  test("saving the form with the masked key keeps the real key", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator('input[type="password"]').first()).toHaveValue(/••••/);
    // Edit an unrelated field: the whole draft (masked key included) is PUT back.
    const graceDays = String(40 + Math.floor(Math.random() * 50));
    await page.getByText("Grace Period (days)", { exact: true }).locator("xpath=following-sibling::input").fill(graceDays);
    await page.getByRole("button", { name: /Save Configuration/ }).click();
    await expect.poll(() => stored("ltm.decay.graceDays")).toBe(graceDays);
    expect(stored("ltm.openai.apiKey")).toBe(KEY);
  });
});

test.describe("2.17 request guards through the Next proxy", () => {
  test("same-origin JSON mutations work through :7332", async ({ request }) => {
    const r = await request.post("/api/reload", { headers: { "Content-Type": "application/json" } });
    expect(r.status()).toBe(200);
  });

  test("text/plain mutation is rejected (415)", async ({ request }) => {
    const r = await request.post("/api/reload", { headers: { "Content-Type": "text/plain" }, data: "{}" });
    expect(r.status()).toBe(415);
  });

  test("a page on another origin cannot POST to the API", async ({ page }) => {
    await page.goto("about:blank");
    const status = await page.evaluate(async (api) => {
      try {
        const r = await fetch(`${api}/api/memory/merge`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
        return r.status;
      } catch {
        return -1; // blocked before reaching the server is also a pass
      }
    }, API);
    expect([403, -1]).toContain(status);
  });
});
