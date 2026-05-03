import { defineConfig, devices } from "@playwright/test";

const webServer = process.env.FULL_STACK_E2E === "1"
  ? [
      {
        command: "cd ../backend && npm run dev",
        url: "http://127.0.0.1:3001/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
      {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    ]
  : {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    };

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer,
});
