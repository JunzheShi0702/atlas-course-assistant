import { test as base, expect } from "@playwright/test";
import { installBaselineApiMocks } from "./installBaselineApiMocks";

/** Playwright tests with baseline `/api` stubs (avoids proxy to missing backend during e2e). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await installBaselineApiMocks(page);
    await use(page);
  },
});

export { expect };
