import { expect, test } from "./fixtures";

test("shows a public landing page with a start-planning CTA at / for anonymous visitors", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: /plan a better semester with grounded ai feedback/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /start planning/i })).toBeVisible();
});

test("redirects authenticated users visiting / to /schedules", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "student@jhu.edu",
        name: "Student",
      }),
    });
  });
  await page.route("**/api/user/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        school: "Whiting School of Engineering",
        degrees: "Computer Science (major)",
      }),
    });
  });
  await page.route("**/api/schedules", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schedules: [] }),
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/schedules$/);
  await expect(page.getByRole("heading", { name: "My Schedules" })).toBeVisible();
});

test("redirects to landing page when unauthenticated", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });

  await page.goto("/schedules");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /start planning/i })).toBeVisible();
});

test("redirects to onboarding when user has no saved profile", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "student@jhu.edu",
        name: "Student",
      }),
    });
  });
  await page.route("**/api/user/profile", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Profile not found" }),
    });
  });

  await page.goto("/schedules");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("shows schedules dashboard when authenticated and profile exists", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "student@jhu.edu",
        name: "Student",
      }),
    });
  });
  await page.route("**/api/user/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        school: "Whiting School of Engineering",
        degrees: "Computer Science (major)",
      }),
    });
  });
  await page.route("**/api/schedules", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schedules: [] }),
    });
  });

  await page.goto("/schedules");
  await expect(page).toHaveURL(/\/schedules$/);
  await expect(page.getByRole("heading", { name: "My Schedules" })).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
});
