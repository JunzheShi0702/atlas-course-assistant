import { describe, expect, it, vi } from "vitest";
import { runAuditWithQualityGate } from "./audit-quality-gate";
import type { ScheduleAgentContext } from "./schedule-context";
import type {
  ScheduleAuditFinding,
  ScheduleAuditIncompleteCheck,
  ScheduleAuditResult,
} from "../types/database";
import type { AuditEvalMetrics } from "../types/eval-summary";

const context: ScheduleAgentContext = {
  scheduleName: "Spring 2026",
  scheduleTerm: "Spring 2026",
  courses: [
    {
      courseCode: "EN.601.226",
      sisOfferingName: "EN.601.226",
      term: "Spring 2026",
      courseTitle: "Data Structures",
      credits: 3,
    },
  ],
  profile: {
    school: "Whiting School of Engineering",
    degrees: ["B.S. Computer Science"],
    rawGoalsText: "Software engineering",
    rawWorkloadText: "Balanced",
    rawPreferencesText: "I prefer morning classes.",
    derivedMemories: null,
  },
  canonicalMemories: [],
};

const evalsByCourse: Record<string, AuditEvalMetrics | null> = {
  "EN.601.226": {
    overallQuality: 4.2,
    teachingEffectiveness: 4.1,
    difficulty: 4.0,
    workload: 4.1,
    feedbackQuality: 3.9,
    sampleSize: 22,
    sectionCount: 1,
  },
};

const findings: ScheduleAuditFinding[] = [
  {
    category: "workload",
    severity: "warning",
    title: "Weekly workload estimate",
    summary: "The projected workload is moderately heavy.",
    evidence: ["Deterministic estimate"],
  },
];

const incompleteChecks: ScheduleAuditIncompleteCheck[] = [
  {
    category: "prerequisites",
    status: "failed",
    errorCode: "check_execution_failed",
    message: "The prerequisite check could not complete, so prerequisite findings may be incomplete.",
  },
];

const draft: ScheduleAuditResult = {
  narrativeSummary: "Draft summary",
  workloadRange: { min: 10, max: 14 },
  goalAlignment: {
    score: 4,
    rationale: "Looks aligned.",
    alignedGoals: ["Software engineering"],
    conflicts: [],
  },
  recommendations: [],
};

describe("runAuditWithQualityGate", () => {
  it("passes through the initial audit when the evaluator passes", async () => {
    const generateAudit = vi.fn<[(string | undefined)?], Promise<ScheduleAuditResult>>()
      .mockResolvedValue(draft);
    const evaluateAudit = vi.fn<[ScheduleAuditResult], Promise<{ passed: boolean; issues: never[] }>>()
      .mockResolvedValue({ passed: true, issues: [] });

    const result = await runAuditWithQualityGate(
      {
        context,
        evalsByCourse,
        findings,
        incompleteChecks,
        missingEvaluationData: ["EN.553.171"],
      },
      { generateAudit, evaluateAudit },
    );

    expect(result.resolution).toBe("pass");
    expect(generateAudit).toHaveBeenCalledTimes(1);
    expect(result.result.findings).toEqual(findings);
    expect(result.result.incompleteChecks).toEqual(incompleteChecks);
    expect(result.result.missingEvaluationData).toEqual(["EN.553.171"]);
  });

  it("regenerates exactly once when the first evaluation fails and the second passes", async () => {
    const generateAudit = vi.fn<[(string | undefined)?], Promise<ScheduleAuditResult>>()
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        narrativeSummary: "Revised summary",
      });
    const evaluateAudit = vi.fn()
      .mockResolvedValueOnce({
        passed: false,
        issues: [{ type: "unsupported_claim", message: "The response makes a specific recommendation that is not grounded in the provided schedule signals." }],
      })
      .mockResolvedValueOnce({ passed: true, issues: [] });

    const result = await runAuditWithQualityGate(
      {
        context,
        evalsByCourse,
        findings,
      },
      { generateAudit, evaluateAudit },
    );

    expect(result.resolution).toBe("regenerated");
    expect(generateAudit).toHaveBeenCalledTimes(2);
    expect(generateAudit.mock.calls[1][0]).toContain("[unsupported_claim]");
    expect(result.result.narrativeSummary).toBe("Revised summary");
  });

  it("falls back to a safe audit response after a second evaluator failure", async () => {
    const generateAudit = vi.fn<[(string | undefined)?], Promise<ScheduleAuditResult>>()
      .mockResolvedValue(draft);
    const evaluateAudit = vi.fn()
      .mockResolvedValueOnce({
        passed: false,
        issues: [{ type: "contradiction", message: "The summary conflicts with the workload estimate." }],
      })
      .mockResolvedValueOnce({
        passed: false,
        issues: [{ type: "missed_constraint", message: "The draft still misses a required hard constraint about morning-only classes." }],
      });

    const result = await runAuditWithQualityGate(
      {
        context,
        evalsByCourse,
        findings,
        incompleteChecks,
      },
      { generateAudit, evaluateAudit },
    );

    expect(result.resolution).toBe("fallback");
    expect(generateAudit).toHaveBeenCalledTimes(2);
    expect(result.result.recommendations).toEqual([]);
    expect(result.result.goalAlignment?.score).toBeNull();
    expect(result.result.narrativeSummary).toContain("conservative audit summary based on deterministic schedule signals");
    expect(result.result.findings).toEqual(findings);
    expect(result.result.incompleteChecks).toEqual(incompleteChecks);
  });

  it("falls back instead of throwing when gate infrastructure throws", async () => {
    const generateAudit = vi.fn<[(string | undefined)?], Promise<ScheduleAuditResult>>()
      .mockResolvedValue(draft);
    const evaluateAudit = vi.fn<[ScheduleAuditResult], Promise<never>>()
      .mockRejectedValue(new Error("quality gate unavailable"));

    const result = await runAuditWithQualityGate(
      {
        context,
        evalsByCourse,
        findings,
      },
      { generateAudit, evaluateAudit },
    );

    expect(result.resolution).toBe("fallback");
    expect(generateAudit).toHaveBeenCalledTimes(1);
    expect(result.result.recommendations).toEqual([]);
    expect(result.result.narrativeSummary).toContain("conservative audit summary based on deterministic schedule signals");
    expect(result.result.findings).toEqual(findings);
  });

  it("does not fail on generic unsupported-claim feedback without a concrete hallucination", async () => {
    const generateAudit = vi.fn<[(string | undefined)?], Promise<ScheduleAuditResult>>()
      .mockResolvedValue(draft);
    const evaluateAudit = vi.fn()
      .mockResolvedValue({
        passed: false,
        issues: [{ type: "unsupported_claim", message: "The summary may overstate confidence slightly." }],
      });

    const result = await runAuditWithQualityGate(
      {
        context,
        evalsByCourse,
        findings,
      },
      { generateAudit, evaluateAudit },
    );

    expect(result.resolution).toBe("pass");
    expect(generateAudit).toHaveBeenCalledTimes(1);
    expect(result.result.narrativeSummary).toBe("Draft summary");
  });
});
