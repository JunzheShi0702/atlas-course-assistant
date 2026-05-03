import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ScheduleAudit from "./ScheduleAudit";
import type { ScheduleDetail } from "@/types/schedules";

const schedule: ScheduleDetail = {
  id: "sched-1",
  name: "Spring Plan",
  term: "Spring 2026",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  courses: [],
  latestAudit: {
    id: "audit-1",
    createdAt: new Date().toISOString(),
    result: {
      narrativeSummary: "Looks manageable.",
    },
  },
};

describe("ScheduleAudit", () => {
  it("renders audit recommendations when present", () => {
    render(
      <ScheduleAudit
        hasAudit
        auditError={null}
        schedule={schedule}
        runningAudit={false}
        onRunAudit={vi.fn()}
        auditView={{
          workloadRange: "14-18 hrs/week",
          narrative: "Looks manageable.",
          missingData: null,
          goalAlignment: null,
          findings: [],
          recommendations: [
            {
              courseCode: "EN.601.320",
              sisOfferingName: "EN.601.320",
              term: "Spring 2026",
              title: "Parallel Programming",
            },
          ],
        }}
        alignmentBullets={{ matches: [], conflicts: [] }}
      />,
    );

    expect(screen.getByText("Recommendations")).toBeInTheDocument();
    expect(screen.getByText("EN.601.320 Parallel Programming")).toBeInTheDocument();
  });
});
