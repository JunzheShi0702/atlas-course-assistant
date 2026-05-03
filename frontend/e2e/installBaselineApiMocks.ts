import type { Page } from "@playwright/test";

/** Default API stubs so `/api/*` never hits Vite→backend proxy during e2e (no backend on :3001). */
export async function installBaselineApiMocks(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/program-list",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schoolNa: "N/A",
          kriegerSchoolLabel: "Krieger School of Arts & Sciences",
          whitingSchoolLabel: "Whiting School of Engineering",
          programs: [],
        }),
      });
    },
  );

  await page.route((url) => url.pathname === "/api/user/memories", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ memories: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route((url) => /^\/api\/courses\/.+\/details$/.test(url.pathname), async (route) => {
    const match = new URL(route.request().url()).pathname.match(/^\/api\/courses\/(.+)\/details$/);
    const rawId = match?.[1] ?? "";
    let courseId = rawId;
    try {
      courseId = decodeURIComponent(rawId);
    } catch {
      /* keep raw segment */
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId,
        details: {
          offeringName: "SYN",
          sectionName: "",
          title: "E2E stub course title",
          description: "Synthetic SIS-style details returned by Playwright baseline mocks.",
          schoolName: "",
          department: "",
          level: "",
          timeOfDay: "",
          daysOfWeek: "",
          location: "",
          instructors: [],
          status: "",
        },
      }),
    });
  });
}
