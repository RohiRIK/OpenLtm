import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.pw\.ts$/,
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://localhost:7332",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use a preinstalled Chromium when the bundled revision isn't present (CI images, sandboxes).
        ...(process.env.PLAYWRIGHT_CHROMIUM ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } } : {}),
      },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:7332",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
