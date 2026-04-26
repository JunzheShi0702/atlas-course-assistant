import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

import {
  searchRateMyProfessor,
  bestProfessorMatch,
  mapRmpNodeToResult,
  type RmpEdge,
  type RmpTeacherNode,
} from "./search-rate-my-professor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<RmpTeacherNode> = {}): RmpTeacherNode {
  return {
    id: btoa("Teacher-1108355"),
    firstName: "John",
    lastName: "Falzone",
    department: "Computer Science",
    school: { name: "Johns Hopkins University" },
    avgRating: 4.2,
    avgDifficulty: 3.1,
    wouldTakeAgainPercent: 85,
    numRatings: 42,
    teacherRatingTags: [
      { tagName: "Clear grading criteria", tagCount: 10 },
      { tagName: "Caring", tagCount: 8 },
      { tagName: "Helpful", tagCount: 7 },
    ],
    ratings: {
      edges: [
        { node: { date: "2024-05-01", class: "CS101", comment: "Great professor!", helpfulRating: 5 } },
      ],
    },
    ...overrides,
  };
}

function makeEdge(node: RmpTeacherNode): RmpEdge {
  return { node };
}

function mockOkResponse(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

// ── bestProfessorMatch ────────────────────────────────────────────────────────

describe("bestProfessorMatch", () => {
  it("returns null for empty edges", () => {
    expect(bestProfessorMatch([], "Smith")).toBeNull();
  });

  it("returns exact last name match (case-insensitive)", () => {
    const a = makeEdge(makeNode({ lastName: "Smith" }));
    const b = makeEdge(makeNode({ lastName: "Smithson" }));
    expect(bestProfessorMatch([a, b], "smith")).toBe(a);
  });

  it("falls back to prefix match when no exact match", () => {
    const a = makeEdge(makeNode({ lastName: "Smithson" }));
    expect(bestProfessorMatch([a], "smith")).toBe(a);
  });

  it("prefers exact match over prefix match", () => {
    const exact = makeEdge(makeNode({ lastName: "Falzone" }));
    const prefix = makeEdge(makeNode({ lastName: "Falzoner" }));
    expect(bestProfessorMatch([prefix, exact], "Falzone")).toBe(exact);
  });

  it("returns null when no last name matches", () => {
    const a = makeEdge(makeNode({ lastName: "Johnson" }));
    expect(bestProfessorMatch([a], "Falzone")).toBeNull();
  });

  it("filters to JHU professors before matching", () => {
    const jhu = makeEdge(makeNode({ lastName: "Smith", school: { name: "Johns Hopkins University" } }));
    const other = makeEdge(makeNode({ lastName: "Smith", school: { name: "Harvard University" } }));
    expect(bestProfessorMatch([other, jhu], "smith")).toBe(jhu);
  });

  it("falls back to all edges if no JHU professors found", () => {
    const nonJhu = makeEdge(makeNode({ lastName: "Smith", school: { name: "Harvard University" } }));
    expect(bestProfessorMatch([nonJhu], "smith")).toBe(nonJhu);
  });
});

// ── mapRmpNodeToResult ────────────────────────────────────────────────────────

describe("mapRmpNodeToResult", () => {
  it("maps all fields correctly", () => {
    const node = makeNode();
    const result = mapRmpNodeToResult(node);
    expect(result.found).toBe(true);
    expect(result.name).toBe("John Falzone");
    expect(result.overallRating).toBe(4.2);
    expect(result.difficulty).toBe(3.1);
    expect(result.wouldTakeAgainPercent).toBe(85);
    expect(result.numRatings).toBe(42);
  });

  it("constructs profileUrl from Base64 id", () => {
    const node = makeNode({ id: btoa("Teacher-1108355") });
    const result = mapRmpNodeToResult(node);
    expect(result.profileUrl).toBe("https://www.ratemyprofessors.com/professor/1108355");
  });

  it("maps wouldTakeAgainPercent -1 to null", () => {
    const node = makeNode({ wouldTakeAgainPercent: -1 });
    const result = mapRmpNodeToResult(node);
    expect(result.wouldTakeAgainPercent).toBeNull();
  });

  it("caps topTags at 5", () => {
    const node = makeNode({
      teacherRatingTags: Array.from({ length: 8 }, (_, i) => ({
        tagName: `Tag${i}`,
        tagCount: i,
      })),
    });
    const result = mapRmpNodeToResult(node);
    expect(result.topTags).toHaveLength(5);
  });

  it("caps recentComments at 3", () => {
    const node = makeNode({
      ratings: {
        edges: Array.from({ length: 6 }, (_, i) => ({
          node: { date: "2024-01-01", class: "CS101", comment: `Comment ${i}`, helpfulRating: 5 },
        })),
      },
    });
    const result = mapRmpNodeToResult(node);
    expect(result.recentComments).toHaveLength(3);
  });

  it("includes parsed year for each recent comment", () => {
    const node = makeNode({
      ratings: {
        edges: [
          {
            node: {
              date: "2023-11-09",
              class: "CS101",
              comment: "Helpful",
              helpfulRating: 4,
            },
          },
        ],
      },
    });
    const result = mapRmpNodeToResult(node);
    expect(result.recentComments[0]?.year).toBe(2023);
  });

  it("sets year to null when comment date is not parseable", () => {
    const node = makeNode({
      ratings: {
        edges: [
          {
            node: {
              date: "unknown",
              class: "CS101",
              comment: "N/A",
              helpfulRating: 3,
            },
          },
        ],
      },
    });
    const result = mapRmpNodeToResult(node);
    expect(result.recentComments[0]?.year).toBeNull();
  });
});

// ── searchRateMyProfessor ─────────────────────────────────────────────────────

describe("searchRateMyProfessor", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("returns found:true with correct data for a matching professor", async () => {
    const node = makeNode();
    mockOkResponse({ data: { newSearch: { teachers: { edges: [makeEdge(node)] } } } });
    const result = await searchRateMyProfessor("Falzone");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.name).toBe("John Falzone");
      expect(result.profileUrl).toContain("ratemyprofessors.com/professor/");
    }
  });

  it("returns found:false when edges array is empty", async () => {
    mockOkResponse({ data: { newSearch: { teachers: { edges: [] } } } });
    const result = await searchRateMyProfessor("Nobody");
    expect(result.found).toBe(false);
  });

  it("returns found:false when no name matches", async () => {
    const node = makeNode({ lastName: "Johnson" });
    mockOkResponse({ data: { newSearch: { teachers: { edges: [makeEdge(node)] } } } });
    const result = await searchRateMyProfessor("Falzone");
    expect(result.found).toBe(false);
  });

  it("returns found:false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await searchRateMyProfessor("Falzone");
    expect(result.found).toBe(false);
    expect((result as { message: string }).message).toContain("unavailable");
  });

  it("returns found:false on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    const result = await searchRateMyProfessor("Falzone");
    expect(result.found).toBe(false);
  });

  it("returns found:false when GraphQL errors are present", async () => {
    mockOkResponse({ errors: [{ message: "Some GraphQL error" }] });
    const result = await searchRateMyProfessor("Falzone");
    expect(result.found).toBe(false);
  });
});
