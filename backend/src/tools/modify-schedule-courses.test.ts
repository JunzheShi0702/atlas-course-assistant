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
});
