import { expect, test } from "@playwright/test";

test.skip(process.env.FULL_STACK_E2E !== "1", "Set FULL_STACK_E2E=1 to run the backend-backed smoke test");

test("frontend dev server proxies real backend health and auth routes", async ({ page }) => {
  await page.goto("/login");

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/health");
    return {
      ok: response.ok,
      body: await response.json(),
    };
  });

  expect(health).toEqual({
    ok: true,
    body: { status: "ok", message: "Backend is running" },
  });

  const authStatus = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return response.status;
  });

  expect(authStatus).toBe(401);
});
