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
    expect(inserts).toContainEqual([USER, "Whiting School of Engineering", "preference", 1]);
    expect(inserts).toContainEqual([USER, "Graduation: May 2026", "preference", 1]);
    expect(inserts).toContainEqual([USER, "Computer Science (primary major)", "goal", 1]);
    expect(inserts).toContainEqual([USER, "Mathematics (minor)", "goal", 1]);
    // Verbatim survey prose is not duplicated in user_memories (stays on user_profiles only).
    expect(inserts).not.toContainEqual([USER, "I want to research robotics.", "goal"]);
    expect(inserts).not.toContainEqual([USER, "Prefer a balanced term.", "preference"]);
    expect(inserts).not.toContainEqual([USER, "No Friday classes.", "constraint"]);
    // Legacy string-array derived_memories → default confidence 0.7 per extracted row
    expect(inserts).toContainEqual([USER, "grad_school", "goal", 0.7]);
    expect(inserts).toContainEqual([USER, "workload_tolerance: medium", "preference", 0.7]);
    expect(inserts).toContainEqual([USER, "no_friday", "constraint", 0.7]);
    expect(inserts).toContainEqual([USER, "likes projects", "preference", 0.7]);
  });

  it("uses 100% confidence for preset-only derived rows and model confidence otherwise", async () => {
    await replaceOnboardingMemoriesFromProfile(pool, USER, {
      graduation_month: null,
      graduation_year: null,
      degrees: [],
      school: null,
      raw_goals_text: null,
      raw_workload_text: null,
      raw_preferences_text: null,
      derived_memories: {
        goals: [{ value: "chip_goal", confidence: 0.2, fromSelectedChoice: true }],
        workloadTolerance: "heavy",
        workloadFromSelectedChoiceOnly: true,
        workloadConfidence: 0.1,
        timePreferences: [{ value: "no_friday", confidence: 0.9, fromSelectedChoice: false }],
        notes: [],
      },
    });
    const inserts = callsParams();
    expect(inserts).toContainEqual([USER, "chip_goal", "goal", 1]);
    expect(inserts).toContainEqual([USER, "workload_tolerance: heavy", "preference", 1]);
    expect(inserts).toContainEqual([USER, "no_friday", "constraint", 0.9]);
  });

  it("replaces (major) with (primary major) on first degree only", async () => {
    await replaceOnboardingMemoriesFromProfile(pool, USER, {
      graduation_month: null,
      graduation_year: null,
      degrees: ["Biology (MAJOR)", "Chemistry (minor)"],
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
    const inserts = callsParams();
    expect(inserts).toContainEqual([USER, "Biology (primary major)", "goal", 1]);
    expect(inserts).toContainEqual([USER, "Chemistry (minor)", "goal", 1]);
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
