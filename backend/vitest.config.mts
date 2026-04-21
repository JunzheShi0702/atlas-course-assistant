import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/scripts/**", "**/demo.ts"],
    env: {
      OPENAI_API_KEY: "test",
    },
  },
  server: {
    deps: {
      // Avoid transforming/loading scripts and demo (Playwright scraper is heavy)
      exclude: ["**/scripts/**", "**/demo.ts"],
    },
  },
});
