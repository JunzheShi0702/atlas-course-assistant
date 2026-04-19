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
      body: JSON.stringify({
        school: "Whiting School of Engineering",
        degrees: "Computer Science (major)",
      }),
    });
  });
}

test("creates a schedule from dashboard and navigates to schedule page", async ({ page }) => {
  await mockAuthenticatedSession(page);

  const schedules: Array<{
    id: string;
    name: string;
    term: string;
    createdAt: string;
    updatedAt: string;
  }> = [];

  await page.route("**/api/schedules**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { pathname } = url;
    const method = req.method();

    if (pathname === "/api/schedules" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schedules }),
      });
      return;
    }

    if (pathname === "/api/schedules" && method === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      const created = {
        id: "sched-1",
        name: body.name,
        term: body.term,
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      };
      schedules.unshift(created);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(created),
      });
      return;
    }

    const detailMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (detailMatch && method === "GET") {
      const schedule = schedules.find((s) => s.id === detailMatch[1]);
      if (!schedule) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Schedule not found" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...schedule,
          courses: [],
          latestAudit: null,
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/schedules");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByRole("button", { name: "New schedule" }).click();
  await page.locator("#schedule-name").fill("My Spring Plan");
  await page.getByRole("button", { name: "Create schedule" }).click();

  await expect(page).toHaveURL(/\/schedules\/sched-1$/);
  await expect(page.getByRole("heading", { name: "My Spring Plan" })).toBeVisible();
});

test("deletes a schedule from dashboard", async ({ page }) => {
  await mockAuthenticatedSession(page);

  let schedules = [
    {
      id: "sched-1",
      name: "Delete Me",
      term: "Spring 2026",
      createdAt: "2026-03-29T12:00:00.000Z",
      updatedAt: "2026-03-29T12:00:00.000Z",
    },
  ];

  await page.route("**/api/schedules**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { pathname } = url;
    const method = req.method();

    if (pathname === "/api/schedules" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schedules }),
      });
      return;
    }

    const deleteMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") {
      schedules = schedules.filter((s) => s.id !== deleteMatch[1]);
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fallback();
  });

  await page.goto("/schedules");
  await expect(page.getByTestId("schedules-grid")).toBeVisible();
  await expect(page.getByTestId("schedule-card")).toHaveCount(1);

  await page.getByTestId("schedule-card").first().hover();
  await page.getByTestId("delete-schedule-btn").first().click();
  await expect(page.getByTestId("delete-dialog")).toBeVisible();
  await page.getByTestId("confirm-delete-btn").click();

  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("schedule-card")).toHaveCount(0);
});

test("runs schedule audit and sends a chat message on schedule page", async ({ page }) => {
  await mockAuthenticatedSession(page);

  let auditReady = false;
  const scheduleDetail = {
    id: "sched-1",
    name: "Audit Plan",
    term: "Spring 2026",
    createdAt: "2026-03-29T12:00:00.000Z",
    updatedAt: "2026-03-29T12:00:00.000Z",
    courses: [
      {
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
        courseTitle: "Data Structures",
      },
    ],
  };

  await page.route("**/api/schedules/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { pathname } = url;
    const method = req.method();

    if (pathname === "/api/schedules/sched-1" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...scheduleDetail,
          latestAudit: auditReady
            ? {
                id: "audit-1",
                createdAt: "2026-03-29T13:00:00.000Z",
                result: {
                  workloadRange: { min: 14, max: 20 },
                  feasibilityLabel: "moderate",
                  narrativeSummary: "Looks manageable with one lighter elective.",
                  goalAlignment: {
                    score: 4.1,
                    rationale: "The plan supports the student's systems interests while staying manageable.",
                    alignedGoals: ["systems depth"],
                    conflicts: ["limited room for electives"],
                  },
                  recommendations: [
                    {
                      courseCode: "EN.601.320",
                      sisOfferingName: "EN.601.320",
                      term: "Spring 2026",
                      title: "Parallel Programming",
                    },
                  ],
                },
              }
            : null,
        }),
      });
      return;
    }

    if (pathname === "/api/schedules/sched-1/audit" && method === "POST") {
      auditReady = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            workloadRange: { min: 14, max: 20 },
            feasibilityLabel: "moderate",
            narrativeSummary: "Looks manageable with one lighter elective.",
            goalAlignment: {
              score: 4.1,
              rationale: "The plan supports the student's systems interests while staying manageable.",
              alignedGoals: ["systems depth"],
              conflicts: ["limited room for electives"],
            },
            recommendations: [
              {
                courseCode: "EN.601.320",
                sisOfferingName: "EN.601.320",
                term: "Spring 2026",
                title: "Parallel Programming",
              },
            ],
          },
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/agent", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "text",
        message: "You can keep this plan if you balance with one lighter class.",
      }),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByRole("button", { name: "Run workload audit" }).first().click();
  await expect(page.getByText("Looks manageable with one lighter elective.")).toBeVisible();
  await expect(page.getByText("Goal Alignment")).toBeVisible();
  await expect(page.getByText("The plan supports the student's systems interests while staying manageable.")).toBeVisible();
  await expect(page.getByText("Parallel Programming")).toBeVisible();

  await page.getByTestId("chat-input").fill("Is this schedule too hard?");
  await page.getByTestId("send-button").click();
  await expect(
    page.getByText("You can keep this plan if you balance with one lighter class."),
  ).toBeVisible();
});

test("shows clarification prompt for ambiguous schedule edit command", async ({ page }) => {
  await mockAuthenticatedSession(page);

  await page.route("**/api/schedules/sched-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "sched-1",
        name: "Spring Plan",
        term: "Spring 2026",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
        courses: [],
        latestAudit: null,
      }),
    });
  });

  await page.route("**/api/agent", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "text",
        message:
          "Please clarify which course to remove and which course to add (course code or exact title + term for each).",
      }),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByTestId("chat-input").fill("swap it for something easier");
  await page.getByTestId("send-button").click();
  await expect(
    page.getByText(
      "Please clarify which course to remove and which course to add (course code or exact title + term for each).",
    ),
  ).toBeVisible();
});

test("shows cross-term and term-specific metrics responses in chat", async ({ page }) => {
  await mockAuthenticatedSession(page);

  await page.route("**/api/schedules/sched-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "sched-1",
        name: "Spring Plan",
        term: "Spring 2026",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
        courses: [],
        latestAudit: null,
      }),
    });
  });

  await page.route("**/api/agent", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const message = String(body.message ?? "").toLowerCase();

    const response = message.includes("overall")
      ? {
          type: "text",
          message:
            "Across all terms, EN.601.226 has workload 3.40, difficulty 3.90, overall quality 4.20 (72 respondents).",
        }
      : {
          type: "text",
          message:
            "For Spring 2026, EN.601.226 has workload 3.25, difficulty 3.75, overall quality 4.10 (40 respondents).",
        };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByTestId("chat-input").fill("How hard is EN.601.226 overall?");
  await page.getByTestId("send-button").click();
  await expect(page.getByText(/Across all terms, EN\.601\.226/)).toBeVisible();

  await page.getByTestId("chat-input").fill("How hard is EN.601.226 in Spring 2026?");
  await page.getByTestId("send-button").click();
  await expect(page.getByText(/For Spring 2026, EN\.601\.226/)).toBeVisible();
});
