import { describe, expect, it } from "vitest";
import { modifyScheduleCourses } from "./modify-schedule-courses";

describe("modifyScheduleCourses (#186 classify-only)", () => {
  it("validates add operation without mutating", async () => {
    const out = await modifyScheduleCourses({
      scheduleId: "sched-1",
      operation: "add",
      addCourses: [
        {
          courseCode: "601.226",
          sisOfferingName: "EN.601.226",
          term: "Spring 2026",
        },
      ],
    });

    expect(out).toEqual({
      ok: true,
      needsClarification: false,
      added: [],
      removed: [],
      failed: [],
    });
  });

  it("requests clarification for ambiguous replace refs", async () => {
    const out = await modifyScheduleCourses({
      scheduleId: "sched-1",
      operation: "replace",
      addCourses: [{ courseCode: "", sisOfferingName: "", term: "Spring 2026" }],
      dropCourses: [{ courseCode: "", sisOfferingName: "", term: "Spring 2026" }],
    });

    expect(out.ok).toBe(false);
    expect(out.needsClarification).toBe(true);
    expect(out.failed.some((f) => f.reasonCode === "ambiguous_reference")).toBe(true);
  });

  it("returns invalid_input when required lists are missing", async () => {
    const out = await modifyScheduleCourses({
      scheduleId: "sched-1",
      operation: "replace",
      addCourses: [],
      dropCourses: [],
    });

    expect(out.ok).toBe(false);
    expect(out.needsClarification).toBe(false);
    expect(out.failed.map((f) => f.reasonCode)).toEqual([
      "invalid_input",
      "invalid_input",
    ]);
  });

  it("maps add callback false -> already_in_schedule", async () => {
    const out = await modifyScheduleCourses(
      {
        scheduleId: "sched-1",
        operation: "add",
        addCourses: [
          {
            courseCode: "601.226",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
      },
      {
        addCourse: async () => ({ added: false }),
      },
    );

    expect(out.ok).toBe(false);
    expect(out.failed[0]?.reasonCode).toBe("already_in_schedule");
  });

  it("maps drop callback false -> not_in_schedule", async () => {
    const out = await modifyScheduleCourses(
      {
        scheduleId: "sched-1",
        operation: "drop",
        dropCourses: [
          {
            courseCode: "601.226",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
      },
      {
        dropCourse: async () => ({ removed: false }),
      },
    );

    expect(out.ok).toBe(false);
    expect(out.failed[0]?.reasonCode).toBe("not_in_schedule");
  });

  it("supports partial success for replace", async () => {
    const out = await modifyScheduleCourses(
      {
        scheduleId: "sched-1",
        operation: "replace",
        addCourses: [
          {
            courseCode: "601.226",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
        dropCourses: [
          {
            courseCode: "553.291",
            sisOfferingName: "AS.553.291",
            term: "Spring 2026",
          },
        ],
      },
      {
        addCourse: async () => ({ added: true }),
        dropCourse: async () => ({ removed: false }),
      },
    );

    expect(out.ok).toBe(false);
    expect(out.added).toHaveLength(1);
    expect(out.removed).toHaveLength(0);
    expect(out.failed.some((f) => f.reasonCode === "not_in_schedule")).toBe(true);
  });
});
