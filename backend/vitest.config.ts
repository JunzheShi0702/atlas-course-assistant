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
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: ["src/**/*.test.ts", "src/scripts/**", "src/demo.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  server: {
    deps: {
      // Avoid transforming/loading scripts and demo (Playwright scraper is heavy)
      exclude: ["**/scripts/**", "**/demo.ts"],
    },
  },
});
