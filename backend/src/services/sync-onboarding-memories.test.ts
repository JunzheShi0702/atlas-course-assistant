import { describe, it, expect, vi, beforeEach } from "vitest";
import { replaceOnboardingMemoriesFromProfile } from "./sync-onboarding-memories";

const query = vi.fn();

const pool = { query } as unknown as import("pg").Pool;

const USER = "00000000-0000-0000-0000-0000000000aa";

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

function callsParams() {
  return query.mock.calls
    .filter((c) => String(c[0]).toLowerCase().includes("insert into user_memories"))
    .map((c) => c[1] as unknown[]);
}

describe("replaceOnboardingMemoriesFromProfile", () => {
  it("deletes onboarding rows then inserts profile fields and derived fields", async () => {
    await replaceOnboardingMemoriesFromProfile(pool, USER, {
      graduation_month: 5,
      graduation_year: 2026,
      degrees: ["Computer Science (major)", "Mathematics (minor)"],
      school: "Whiting School of Engineering",
      raw_goals_text: "I want to research robotics.",
      raw_workload_text: "Prefer a balanced term.",
      raw_preferences_text: "No Friday classes.",
      derived_memories: {
        goals: ["grad_school"],
        workloadTolerance: "medium",
        timePreferences: ["no_friday"],
        notes: ["likes projects"],
      },
    });

    expect(query.mock.calls[0][0]).toContain("DELETE FROM user_memories");
    expect(query.mock.calls[0][1]).toEqual([USER]);

    const inserts = callsParams();
    expect(inserts).toContainEqual([USER, "Whiting School of Engineering", "preference"]);
    expect(inserts).toContainEqual([USER, "Graduation: May 2026", "preference"]);
    expect(inserts).toContainEqual([USER, "Computer Science (major)", "goal"]);
    expect(inserts).toContainEqual([USER, "Mathematics (minor)", "goal"]);
    // Verbatim survey prose is not duplicated in user_memories (stays on user_profiles only).
    expect(inserts).not.toContainEqual([USER, "I want to research robotics.", "goal"]);
    expect(inserts).not.toContainEqual([USER, "Prefer a balanced term.", "preference"]);
    expect(inserts).not.toContainEqual([USER, "No Friday classes.", "constraint"]);
    expect(inserts).toContainEqual([USER, "grad_school", "goal"]);
    expect(inserts).toContainEqual([USER, "workload_tolerance: medium", "preference"]);
    expect(inserts).toContainEqual([USER, "no_friday", "constraint"]);
    expect(inserts).toContainEqual([USER, "likes projects", "preference"]);
  });

  it("skips empty optional fields and workload when derived unspecified", async () => {
    await replaceOnboardingMemoriesFromProfile(pool, USER, {
      graduation_month: null,
      graduation_year: null,
      degrees: [],
      school: null,
      raw_goals_text: null,
      raw_workload_text: null,
      raw_preferences_text: null,
      derived_memories: {
        goals: [],
        workloadTolerance: "unspecified",
        timePreferences: [],
        notes: [],
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("only deletes when profile and derived are empty", async () => {
    await replaceOnboardingMemoriesFromProfile(pool, USER, {
      graduation_month: undefined,
      graduation_year: undefined,
      degrees: undefined,
      school: undefined,
      raw_goals_text: undefined,
      raw_workload_text: undefined,
      raw_preferences_text: undefined,
      derived_memories: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
