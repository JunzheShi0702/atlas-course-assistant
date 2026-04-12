import { describe, expect, it } from "vitest";

import {
  groundRecommendations,
  rankRecommendationCandidates,
  type AuditRecommendationCandidate,
} from "./audit-recommendations";

const candidates: AuditRecommendationCandidate[] = [
  {
    courseCode: "EN.601.300",
    sisOfferingName: "EN.601.300",
    term: "Spring 2026",
    title: "Software Engineering",
    overallQuality: 4.6,
    workload: 3.1,
    difficulty: 3.4,
    respondentCount: 40,
  },
  {
    courseCode: "EN.601.320",
    sisOfferingName: "EN.601.320",
    term: "Spring 2026",
    title: "Parallel Programming",
    overallQuality: 4.6,
    workload: 2.9,
    difficulty: 3.6,
    respondentCount: 24,
  },
  {
    courseCode: "EN.601.330",
    sisOfferingName: "EN.601.330",
    term: "Spring 2026",
    title: "Compilers",
    overallQuality: null,
    workload: null,
    difficulty: null,
    respondentCount: 0,
  },
];

describe("rankRecommendationCandidates", () => {
  it("prefers higher-quality and lighter candidates first", () => {
    expect(rankRecommendationCandidates(candidates).map((candidate) => candidate.sisOfferingName)).toEqual([
      "EN.601.320",
      "EN.601.300",
      "EN.601.330",
    ]);
  });
});

describe("groundRecommendations", () => {
  it("keeps only real candidate offerings in the returned recommendation shape", () => {
    expect(
      groundRecommendations(
        ["EN.601.320", "EN.999.999", "EN.601.300"],
        candidates,
      ),
    ).toEqual([
      {
        courseCode: "EN.601.320",
        sisOfferingName: "EN.601.320",
        term: "Spring 2026",
        title: "Parallel Programming",
      },
      {
        courseCode: "EN.601.300",
        sisOfferingName: "EN.601.300",
        term: "Spring 2026",
        title: "Software Engineering",
      },
    ]);
  });
});
