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

async function mockWeeklyEvents(
  page: Page,
  events: unknown[] = [],
  scheduleId = "sched-1",
) {
  await page.route(`**/api/schedules/${scheduleId}/events`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events }),
    });
  });
}

async function mockScheduleChat(
  page: Page,
  scheduleId = "sched-1",
) {
  await page.route(`**/api/schedules/${scheduleId}/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rollingSummary: "", messages: [] }),
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
  await mockWeeklyEvents(page);
  await mockScheduleChat(page);

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
  await expect(page.getByRole("tab", { name: "Weekly Schedule" })).toBeVisible();

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
  await mockWeeklyEvents(page);
  await mockScheduleChat(page);

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
  await expect(page.getByRole("tab", { name: "Weekly Schedule" })).toBeVisible();

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
  await mockWeeklyEvents(page);
  await mockScheduleChat(page);

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

test("surfaces summary source data through course summary flow", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockWeeklyEvents(page);
  await mockScheduleChat(page);

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
        type: "search",
        results: [
          {
            courseId: "en-601-226-spring-2026",
            code: "EN.601.226",
            title: "Data Structures",
            description: "Core data structures and algorithm analysis.",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
      }),
    });
  });

  await page.route("**/api/courses/EN.601.226/eval-summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hasData: true,
        summaryText: "Students report strong overall quality with moderate workload.",
        sourceData: [
          {
            term: "Spring 2025",
            instructor: "Dr. Ada",
            metricName: "overall_quality",
            metricLabel: "Overall Quality",
            metricValue: 4.6,
            respondentCount: 20,
          },
          {
            term: "Spring 2025",
            instructor: "Dr. Ada",
            metricName: "work_load",
            metricLabel: "Workload",
            metricValue: 3.2,
            respondentCount: 20,
          },
        ],
        sourceDataMeta: {
          totalDataPoints: 2,
          returnedDataPoints: 2,
          truncated: false,
        },
      }),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByTestId("chat-input").fill("find data structures");
  await page.getByTestId("send-button").click();

  const courseHeading = page.getByRole("heading", { name: "EN.601.226 Data Structures" });
  await expect(courseHeading).toBeVisible();
  await courseHeading.click();

  await page.getByRole("button", { name: "Summarize course evals" }).click();
  await expect(
    page.getByText("Students report strong overall quality with moderate workload."),
  ).toBeVisible();
  await expect(page.getByText("Source datapoints shown: 2 of 2")).toBeVisible();

  // Open the raw-data modal and verify the table mirrors API sourceData rows.
  await page.getByTestId("raw-eval-data-button").click();
  const rawDataModal = page.getByTestId("raw-eval-data-modal");
  await expect(rawDataModal).toBeVisible();
  await expect(rawDataModal.getByRole("heading", { name: "Raw Evaluation Data" })).toBeVisible();
  await expect(rawDataModal.getByRole("cell", { name: "Overall Quality" })).toBeVisible();
  await expect(rawDataModal.getByRole("cell", { name: "Workload" })).toBeVisible();
  await expect(rawDataModal.getByRole("cell", { name: "4.60" })).toBeVisible();
  await expect(rawDataModal.getByRole("cell", { name: "3.20" })).toBeVisible();

  // Misuse path: clicking the overlay should dismiss the raw data modal.
  await rawDataModal.click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("raw-eval-data-modal")).not.toBeVisible();

  // Re-open and close via keyboard to verify Escape dismiss behavior.
  await page.getByTestId("raw-eval-data-button").click();
  await expect(page.getByTestId("raw-eval-data-modal")).toBeVisible();
  await expect(page.getByTestId("raw-eval-data-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("raw-eval-data-modal")).not.toBeVisible();

  // Hide and re-show summary to ensure source-data state persists without row duplication.
  await page.getByRole("button", { name: "Hide course eval summary" }).click();
  await page.getByRole("button", { name: "Show course eval summary" }).click();
  await expect(page.getByText("Source datapoints shown: 2 of 2")).toBeVisible();
  await page.getByTestId("raw-eval-data-button").click();
  await expect(page.getByTestId("raw-eval-data-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Close raw data" }).click();
  await expect(page.getByTestId("raw-eval-data-modal")).not.toBeVisible();
});

test("disables raw evaluation data access when summary has no source rows", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockWeeklyEvents(page);
  await mockScheduleChat(page);

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
        type: "search",
        results: [
          {
            courseId: "en-601-999-spring-2026",
            code: "EN.601.999",
            title: "Imaginary Course",
            description: "Synthetic course used for no-data validation.",
            sisOfferingName: "EN.601.999",
            term: "Spring 2026",
          },
        ],
      }),
    });
  });

  await page.route("**/api/courses/EN.601.999/eval-summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hasData: false,
        summaryText: "No evaluation data found for this course.",
        sourceData: [],
        sourceDataMeta: {
          totalDataPoints: 0,
          returnedDataPoints: 0,
          truncated: false,
        },
      }),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByTestId("chat-input").fill("find EN.601.999");
  await page.getByTestId("send-button").click();

  const courseHeading = page.getByRole("heading", { name: "EN.601.999 Imaginary Course" });
  await expect(courseHeading).toBeVisible();
  await courseHeading.click();

  await page.getByRole("button", { name: "Summarize course evals" }).click();
  await expect(page.getByText("No evaluation data found for this course.")).toBeVisible();
  await expect(page.getByTestId("raw-eval-data-button")).toBeDisabled();
  await expect(page.getByText("Raw evaluation data is not available for this summary.")).toBeVisible();
});

test("loads weekly events and opens details dialog from calendar block", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockScheduleChat(page);

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

  await mockWeeklyEvents(page, [
    {
      eventId: "monday-1",
      dayOfWeek: "Monday",
      startTime: "09:00",
      endTime: "10:00",
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
      location: "Malone 228",
    },
  ]);

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByRole("tab", { name: "Weekly Schedule" }).click();
  const eventBlock = page.getByTestId("weekly-grid-event").first();
  await expect(eventBlock).toBeVisible();
  await expect(eventBlock).toContainText("EN.601.226");

  await eventBlock.click();
  const dialog = page.getByTestId("weekly-event-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "EN.601.226" })).toBeVisible();
  await expect(page.getByTestId("weekly-event-dialog-course-title")).toContainText("Data Structures");
  await expect(page.getByTestId("weekly-event-dialog-day")).toContainText("Monday");
  await expect(page.getByTestId("weekly-event-dialog-time")).toContainText("09:00 - 10:00");
  await expect(page.getByTestId("weekly-event-dialog-location")).toContainText("Malone 228");

  await page.getByRole("button", { name: "Close weekly event details" }).click();
  await expect(page.getByTestId("weekly-event-dialog")).not.toBeVisible();
});

test("retries weekly events after fetch failure and opens details dialog", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockScheduleChat(page);

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

  let eventsCallCount = 0;
  await page.route("**/api/schedules/sched-1/events", async (route) => {
    eventsCallCount += 1;
    if (eventsCallCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary failure" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          {
            eventId: "retry-event",
            dayOfWeek: "Tuesday",
            startTime: "11:00",
            endTime: "12:00",
            courseCode: "EN.601.315",
            courseTitle: "Databases",
            location: "Hackerman 122",
          },
        ],
      }),
    });
  });

  await page.goto("/schedules/sched-1");
  await expect(page.getByTestId("schedule-page-content")).toBeVisible();

  await page.getByRole("tab", { name: "Weekly Schedule" }).click();
  await expect(page.getByText("Unable to load weekly schedule events right now.")).toBeVisible();
  await page.getByRole("button", { name: "Retry loading events" }).click();

  const eventBlock = page.getByTestId("weekly-grid-event").first();
  await expect(eventBlock).toBeVisible();
  await expect(eventBlock).toContainText("EN.601.315");

  await eventBlock.click();
  await expect(page.getByTestId("weekly-event-dialog")).toBeVisible();
  await expect(page.getByTestId("weekly-event-dialog-course-title")).toContainText("Databases");
  await expect(page.getByTestId("weekly-event-dialog-time")).toContainText("11:00 - 12:00");
});
