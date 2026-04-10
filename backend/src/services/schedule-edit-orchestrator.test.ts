import { describe, expect, it, vi } from "vitest";
import { handleScheduleEditMessage } from "./schedule-edit-orchestrator";

const baseContext = {
  scheduleName: "Main",
  scheduleTerm: "Spring 2026",
  courses: [
    {
      courseCode: "601.226",
      sisOfferingName: "EN.601.226",
      term: "Spring 2026",
      courseTitle: "Data Structures",
      credits: 4,
    },
  ],
  profile: null,
};

describe("handleScheduleEditMessage", () => {
  it("returns handled=false for non-edit messages", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "what classes are easy",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
      },
    );

    expect(out).toEqual({ handled: false });
  });

  it("handles clear edit messages with successful mutation", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add EN.520.433",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Intro Algorithms",
            description: "Algorithms",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
        ]),
        runModify: vi.fn().mockResolvedValue({
          ok: true,
          needsClarification: false,
          added: [
            {
              courseCode: "520.433",
              sisOfferingName: "EN.520.433",
              term: "Spring 2026",
            },
          ],
          removed: [],
          failed: [],
        }),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("text");
    expect(out.payload.scheduleChanges.added).toHaveLength(1);
  });

  it("captures unquoted titles for add requests", async () => {
    const searchCandidates = vi.fn().mockResolvedValue([
      {
        courseId: "en-601-226-spring-2026",
        code: "601.226",
        title: "Data Structures",
        description: "Core data structures",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      },
    ]);

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add data structures",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        parseWithLlm: vi.fn().mockResolvedValue({
          operation: "add",
          addRefs: [{ raw: "data structures", courseTitle: "data structures" }],
          dropRefs: [],
        }),
        searchCandidates,
        runModify: vi.fn().mockResolvedValue({
          ok: true,
          needsClarification: false,
          added: [
            {
              courseCode: "601.226",
              sisOfferingName: "EN.601.226",
              term: "Spring 2026",
            },
          ],
          removed: [],
          failed: [],
        }),
      },
    );

    expect(out.handled).toBe(true);
    expect(searchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ courseTitle: "data structures" }),
      "Spring 2026",
    );
  });

  it("resolves clear unquoted add titles without LLM parsing", async () => {
    const parseWithLlm = vi.fn();
    const searchCandidates = vi.fn().mockResolvedValue([
      {
        courseId: "en-601-226-spring-2026",
        code: "601.226",
        title: "Data Structures",
        description: "Core data structures",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      },
    ]);

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add data structures",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        parseWithLlm,
        searchCandidates,
        runModify: vi.fn().mockResolvedValue({
          ok: true,
          needsClarification: false,
          added: [
            {
              courseCode: "601.226",
              sisOfferingName: "EN.601.226",
              term: "Spring 2026",
            },
          ],
          removed: [],
          failed: [],
        }),
      },
    );

    expect(out.handled).toBe(true);
    expect(parseWithLlm).not.toHaveBeenCalled();
    expect(searchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ courseTitle: "data structures" }),
      "Spring 2026",
    );
  });

  it("resolves clear unquoted drop titles without LLM parsing", async () => {
    const parseWithLlm = vi.fn();
    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [],
      removed: [
        {
          courseCode: "601.226",
          sisOfferingName: "EN.601.226",
          term: "Spring 2026",
        },
      ],
      failed: [],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "drop data structures",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        parseWithLlm,
        runModify,
      },
    );

    expect(out.handled).toBe(true);
    expect(parseWithLlm).not.toHaveBeenCalled();
    expect(runModify).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "drop",
        dropCourses: [expect.objectContaining({ courseCode: "601.226" })],
      }),
    );
  });

  it("auto-selects a high-confidence add match when multiple candidates exist", async () => {
    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [
        {
          courseCode: "601.226",
          sisOfferingName: "EN.601.226",
          term: "Spring 2026",
        },
      ],
      removed: [],
      failed: [],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add data structures",
      },
      {
        loadContext: vi.fn().mockResolvedValue({
          ok: true,
          context: {
            ...baseContext,
            courses: [],
          },
        }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "Core data structures",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
          {
            courseId: "en-601-435-spring-2026",
            code: "601.435",
            title: "Databases",
            description: "Database systems",
            sisOfferingName: "EN.601.435",
            term: "Spring 2026",
          },
        ]),
        runModify,
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("text");
    expect(runModify).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "add",
        addCourses: [expect.objectContaining({ courseCode: "601.226" })],
      }),
    );
  });

  it("returns search candidates for ambiguous requests", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: 'add "data"',
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Data Intensive Systems",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ]),
        runModify: vi.fn().mockImplementation(async (input) => ({
          ok: false,
          needsClarification: input.preflightFailures.some((f) => f.reasonCode === "ambiguous_reference"),
          added: [],
          removed: [],
          failed: input.preflightFailures,
        })),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("search");
    if (out.payload.type !== "search") return;
    expect(out.payload.results.length).toBeGreaterThan(1);
  });

  it("supports replace phrasing with 'to' connector", async () => {
    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [
        { courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" },
      ],
      removed: [
        { courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" },
      ],
      failed: [],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "swap EN.601.226 to EN.520.433",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Intro Algorithms",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
        ]),
        runModify,
      },
    );

    expect(out.handled).toBe(true);
    expect(runModify).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "replace",
        dropCourses: [expect.objectContaining({ courseCode: "601.226" })],
        addCourses: [expect.objectContaining({ courseCode: "520.433" })],
      }),
    );
  });

  it("supports replace phrasing with 'drop ... and add ...'", async () => {
    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [
        { courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" },
      ],
      removed: [
        { courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" },
      ],
      failed: [],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "drop principles of data science and add process control",
      },
      {
        loadContext: vi.fn().mockResolvedValue({
          ok: true,
          context: {
            ...baseContext,
            courses: [
              ...baseContext.courses,
              {
                courseCode: "601.229",
                sisOfferingName: "EN.601.229",
                term: "Spring 2026",
                courseTitle: "Principles of Data Science",
                credits: 4,
              },
            ],
          },
        }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Process Control",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
        ]),
        runModify,
      },
    );

    expect(out.handled).toBe(true);
    expect(runModify).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "replace",
        dropCourses: [expect.objectContaining({ courseCode: "601.229" })],
        addCourses: [expect.objectContaining({ courseCode: "520.433" })],
      }),
    );
  });

  it("supports common replace/add-drop phrasing variants", async () => {
    const messages = [
      "replace principles of data science with process control",
      "swap principles of data science for process control",
      "switch principles of data science to process control",
      "replace principles of data science by process control",
      "remove principles of data science, add process control",
      "drop principles of data science then add process control",
      "drop principles of data science & add process control",
      "add process control and drop principles of data science",
      "take process control instead of principles of data science",
    ];

    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [{ courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" }],
      removed: [{ courseCode: "601.229", sisOfferingName: "EN.601.229", term: "Spring 2026" }],
      failed: [],
    });

    const context = {
      ...baseContext,
      courses: [
        ...baseContext.courses,
        {
          courseCode: "601.229",
          sisOfferingName: "EN.601.229",
          term: "Spring 2026",
          courseTitle: "Principles of Data Science",
          credits: 4,
        },
      ],
    };

    const searchCandidates = vi.fn().mockImplementation(async (ref: { courseTitle?: string }) => {
      const title = ref.courseTitle?.toLowerCase() ?? "";
      if (title.includes("process control")) {
        return [
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Process Control",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
        ];
      }
      return [];
    });

    for (const message of messages) {
      const out = await handleScheduleEditMessage(
        {
          userId: "user-1",
          scheduleId: "sched-1",
          message,
        },
        {
          loadContext: vi.fn().mockResolvedValue({ ok: true, context }),
          searchCandidates,
          runModify,
        },
      );

      expect(out.handled).toBe(true);
    }

    expect(runModify).toHaveBeenCalledTimes(messages.length);
    for (const call of runModify.mock.calls) {
      const input = call[0] as {
        operation: string;
        addCourses: Array<{ courseCode: string }>;
        dropCourses: Array<{ courseCode: string }>;
      };
      expect(input.operation).toBe("replace");
      expect(input.addCourses).toEqual([expect.objectContaining({ courseCode: "520.433" })]);
      expect(input.dropCourses).toEqual([expect.objectContaining({ courseCode: "601.229" })]);
    }
  });

  it("calls LLM parser only once when merge and fallback both need it", async () => {
    const parseWithLlm = vi.fn().mockResolvedValue({
      operation: "replace",
      addRefs: [{ raw: "EN.520.433", courseCode: "520.433" }],
      dropRefs: [{ raw: "EN.601.226", courseCode: "601.226" }],
    });

    const runModify = vi.fn().mockResolvedValue({
      ok: true,
      needsClarification: false,
      added: [{ courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" }],
      removed: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
      failed: [],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "replace this with that",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        parseWithLlm,
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Intro Algorithms",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
          },
        ]),
        runModify,
      },
    );

    expect(out.handled).toBe(true);
    expect(parseWithLlm).toHaveBeenCalledTimes(1);
  });

  it("returns term_mismatch when user asks for another term", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add EN.520.433 in Fall 2026",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        runModify: vi.fn().mockImplementation(async (input) => ({
          ok: false,
          needsClarification: false,
          added: [],
          removed: [],
          failed: input.preflightFailures,
        })),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.scheduleChanges.failed.some((f) => f.reasonCode === "term_mismatch")).toBe(true);
  });

  it("returns fuzzy in-schedule candidates for drop typos", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "drop data structers",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        parseWithLlm: vi.fn().mockResolvedValue({
          operation: "drop",
          addRefs: [],
          dropRefs: [{ raw: "data structers", courseTitle: "data structers" }],
        }),
        runModify: vi.fn().mockImplementation(async (input) => ({
          ok: false,
          needsClarification: input.preflightFailures.some((f) => f.reasonCode === "ambiguous_reference"),
          added: [],
          removed: [],
          failed: input.preflightFailures,
        })),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("search");
    expect(out.payload.scheduleChanges.failed.some((f) => f.reasonCode === "ambiguous_reference")).toBe(true);
    if (out.payload.type !== "search") return;
    expect(out.payload.message).toBe("I couldn't find an exact in-schedule match. Did you mean one of these?");
    expect(out.payload.results[0]).toMatchObject({
      code: "601.226",
      sisOfferingName: "EN.601.226",
      term: "Spring 2026",
    });
  });

  it("returns specific failure message when no changes were applied", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add linear algebra to my schedule",
      },
      {
        loadContext: vi.fn().mockResolvedValue({ ok: true, context: baseContext }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "Core data structures",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ]),
        runModify: vi.fn().mockImplementation(async (input) => ({
          ok: false,
          needsClarification: false,
          added: [],
          removed: [],
          failed: input.preflightFailures,
        })),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("text");
    expect(out.payload.message).toBe("That course is already in this schedule.");
  });

  it("surfaces ambiguous candidates returned by runModify failures", async () => {
    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add linear algebra",
      },
      {
        loadContext: vi.fn().mockResolvedValue({
          ok: true,
          context: {
            ...baseContext,
            courses: [],
          },
        }),
        searchCandidates: vi.fn().mockResolvedValue([
          {
            courseId: "as-110-201-spring-2026",
            code: "110.201",
            title: "Linear Algebra",
            description: "",
            sisOfferingName: "AS.110.201",
            term: "Spring 2026",
          },
        ]),
        runModify: vi.fn().mockResolvedValue({
          ok: false,
          needsClarification: true,
          added: [],
          removed: [],
          failed: [
            {
              action: "add",
              reasonCode: "ambiguous_reference",
              message: "I found multiple matching courses. Please choose one.",
              candidates: [
                {
                  courseCode: "AS.110.201",
                  sisOfferingName: "AS.110.201",
                  term: "Spring 2026",
                },
                {
                  courseCode: "AS.110.212",
                  sisOfferingName: "AS.110.212",
                  term: "Spring 2026",
                },
              ],
            },
          ],
        }),
      },
    );

    expect(out.handled).toBe(true);
    if (!out.handled) return;
    expect(out.payload.type).toBe("search");
    if (out.payload.type !== "search") return;
    expect(out.payload.message).toBe("I found multiple matching courses. Please choose one.");
    expect(out.payload.results).toHaveLength(2);
    expect(out.payload.results[0]).toMatchObject({
      code: "AS.110.201",
      sisOfferingName: "AS.110.201",
      term: "Spring 2026",
    });
  });
});
