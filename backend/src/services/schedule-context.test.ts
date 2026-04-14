import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db");

import { pool } from "../db";
import {
  loadScheduleContextForAgent,
  buildScheduleContextBlock,
  loadUserMemoryContextForAgent,
  buildUserMemoriesOnlyBlock,
  formatAuditMemoryContext,
} from "./schedule-context";

const mockQuery = vi.mocked(pool.query);

const USER = "user-uuid-1";
const SCHEDULE = "schedule-uuid-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadScheduleContextForAgent", () => {
  it("returns not_found when schedule does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const out = await loadScheduleContextForAgent(USER, SCHEDULE);
    expect(out).toEqual({ ok: false, error: "not_found" });
  });

  it("returns forbidden when schedule belongs to another user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: SCHEDULE, name: "A", term: "Spring 2026", user_id: "other-user" },
      ],
    } as never);

    const out = await loadScheduleContextForAgent(USER, SCHEDULE);
    expect(out).toEqual({ ok: false, error: "forbidden" });
  });

  it("allows dev-prefixed app id when schedule row stores the same prefixed user_id", async () => {
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: SCHEDULE, name: "Dev plan", term: "Spring 2026", user_id: devId },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const out = await loadScheduleContextForAgent(devId, SCHEDULE);
    expect(out.ok).toBe(true);
    expect(mockQuery.mock.calls[2]?.[1]).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("allows dev-prefixed app id when schedule row has canonical uuid", async () => {
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    const bare = "00000000-0000-0000-0000-000000000001";
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: SCHEDULE, name: "Dev plan", term: "Spring 2026", user_id: bare },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const out = await loadScheduleContextForAgent(devId, SCHEDULE);
    expect(out.ok).toBe(true);
  });

  it("returns context with courses and profile when owner matches", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: SCHEDULE, name: "My plan", term: "Spring 2026", user_id: USER },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.226",
            sis_offering_name: "EN.601.226.01",
            term: "Spring 2026",
            title: "Data Structures",
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            school: "WSE",
            degrees: ["B.S. CS"],
            raw_goals_text: "Grad school",
            raw_workload_text: "Light",
            raw_preferences_text: "Mornings",
            derived_memories: { focus: "ML" },
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const out = await loadScheduleContextForAgent(USER, SCHEDULE);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.context.scheduleName).toBe("My plan");
    expect(out.context.courses).toHaveLength(1);
    expect(out.context.courses[0].courseCode).toBe("EN.601.226");
    expect(out.context.profile?.school).toBe("WSE");
    expect(out.context.canonicalMemories).toEqual([]);
  });

  it("returns null profile when no user_profiles row", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: SCHEDULE, name: "P", term: "Spring 2026", user_id: USER },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const out = await loadScheduleContextForAgent(USER, SCHEDULE);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.context.profile).toBeNull();
  });
});

describe("buildScheduleContextBlock", () => {
  it("mentions empty schedule state", () => {
    const s = buildScheduleContextBlock({
      scheduleName: "S",
      scheduleTerm: "Spring 2026",
      courses: [],
      profile: null,
      canonicalMemories: [],
    });
    expect(s).toContain("none yet");
  });

  it("lists course rows and tool guidance", () => {
    const s = buildScheduleContextBlock({
      scheduleName: "S",
      scheduleTerm: "Spring 2026",
      courses: [
        {
          courseCode: "AS.050.105",
          sisOfferingName: "AS.050.105.01",
          term: "Spring 2026",
          courseTitle: "",
        },
      ],
      profile: null,
      canonicalMemories: [],
    });
    expect(s).toContain("AS.050.105");
    expect(s).toContain("getCourseEvalSummary");
  });

  it("prefers canonical user_memories over legacy derived_memories JSON", () => {
    const s = buildScheduleContextBlock({
      scheduleName: "S",
      scheduleTerm: "Spring 2026",
      courses: [],
      profile: {
        school: "WSE",
        degrees: null,
        rawGoalsText: null,
        rawWorkloadText: null,
        rawPreferencesText: null,
        derivedMemories: { legacy: true },
      },
      canonicalMemories: [
        { memory_text: "Avoid Friday labs", memory_type: "constraint", source: "chat" },
      ],
    });
    expect(s).toContain("canonical store");
    expect(s).toContain("Avoid Friday labs");
    expect(s).not.toContain("legacy JSON");
  });
});

describe("buildUserMemoriesOnlyBlock", () => {
  it("returns empty string when no memories and no derived JSON", () => {
    expect(
      buildUserMemoriesOnlyBlock({ canonicalMemories: [], profile: null }),
    ).toBe("");
  });

  it("includes LONG-TERM header and canonical lines when memories exist", () => {
    const s = buildUserMemoriesOnlyBlock({
      canonicalMemories: [
        { memory_text: "No Friday labs", memory_type: "constraint", source: "manual" },
      ],
      profile: null,
    });
    expect(s).toContain("LONG-TERM USER CONTEXT");
    expect(s).toContain("No Friday labs");
    expect(s).toContain("[constraint] (manual)");
  });
});

describe("formatAuditMemoryContext", () => {
  it("returns explicit empty state when no canonical rows and no legacy JSON", () => {
    expect(formatAuditMemoryContext([], null)).toBe("No structured long-term memories stored.");
  });

  it("prefers canonical memories over legacy derived JSON when both could apply", () => {
    const s = formatAuditMemoryContext(
      [{ memory_text: "From DB", memory_type: "preference", source: "manual" }],
      {
        school: null,
        degrees: null,
        rawGoalsText: null,
        rawWorkloadText: null,
        rawPreferencesText: null,
        derivedMemories: { legacy: true },
      },
    );
    expect(s).toContain("From DB");
    expect(s).toContain("canonical store");
    expect(s).not.toContain("legacy JSON");
  });
});

describe("loadUserMemoryContextForAgent", () => {
  it("loads profile and canonical memories in parallel", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            school: "KSAS",
            degrees: null,
            raw_goals_text: null,
            raw_workload_text: null,
            raw_preferences_text: null,
            derived_memories: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ memory_text: "Prefer small seminars", memory_type: "preference", source: "chat" }],
      } as never);

    const out = await loadUserMemoryContextForAgent(USER);
    expect(out.profile?.school).toBe("KSAS");
    expect(out.canonicalMemories).toHaveLength(1);
    expect(out.canonicalMemories[0].memory_text).toBe("Prefer small seminars");
  });

  it("returns empty canonical memories when the database returns no memory rows", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            school: null,
            degrees: null,
            raw_goals_text: null,
            raw_workload_text: null,
            raw_preferences_text: null,
            derived_memories: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const out = await loadUserMemoryContextForAgent(USER);
    expect(out.canonicalMemories).toEqual([]);
  });
});
