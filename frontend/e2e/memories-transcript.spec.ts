import { expect, test, type Page } from "@playwright/test";

const USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "student@jhu.edu",
  name: "Student",
};

async function mockAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(USER),
    });
  });
  await page.route("**/api/user/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ school: "WSE", degrees: "CS (major)" }),
    });
  });
}

test("transcript review blocks save until ambiguous rows are resolved", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __ATLAS_TEST_TRANSCRIPT_CODES?: string[] }).__ATLAS_TEST_TRANSCRIPT_CODES = [
      "AS.030.101",
      "EN.500.112",
    ];
  });

  await mockAuthenticatedSession(page);

  let memories = [
    {
      id: "m1",
      text: "AS.110.201",
      type: "course_history",
      source: "course_history",
      confidence: 1,
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ];

  await page.route("**/api/user/memories", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ memories }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/user/memories/transcript/process", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reviewedEntries: [
          {
            rawCode: "AS.030.101",
            canonicalCode: "AS.030.101",
            status: "matched",
            options: ["AS.030.101"],
          },
          {
            rawCode: "EN.500.112",
            canonicalCode: "EN.500.112",
            status: "ambiguous",
            options: ["EN.500.112", "EN.500.113"],
          },
        ],
      }),
    });
  });

  await page.route("**/api/user/memories/transcript/save", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const selected = body?.reviewedEntries?.[1]?.selectedCourseCode;
    expect(selected).toBe("EN.500.113");
    memories = [
      ...memories,
      {
        id: "m2",
        text: "AS.030.101",
        type: "course_history",
        source: "course_history",
        confidence: 1,
        createdAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "m3",
        text: "EN.500.113",
        type: "course_history",
        source: "course_history",
        confidence: 1,
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        savedCount: 2,
        savedCourseCodes: ["AS.030.101", "EN.500.113"],
      }),
    });
  });

  await page.goto("/memories");
  await page.getByRole("button", { name: "Course History 1 course" }).click();
  await page.getByTestId("transcript-upload-button").click();
  await page.getByTestId("transcript-file-input").setInputFiles({
    name: "fake-transcript.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fake pdf contents"),
  });

  await expect(page.getByTestId("transcript-review-dialog")).toBeVisible();
  await expect(page.getByTestId("transcript-save-button")).toBeDisabled();

  await page.getByTestId("transcript-option-1").selectOption("EN.500.113");
  await expect(page.getByTestId("transcript-save-button")).toBeEnabled();
  await page.getByTestId("transcript-save-button").click();

  await expect(page.getByTestId("transcript-review-dialog")).not.toBeVisible();
  await expect(page.getByText("AS.030.101")).toBeVisible();
  await expect(page.getByText("EN.500.113")).toBeVisible();
});

