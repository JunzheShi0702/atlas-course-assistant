import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CourseList from "./CourseList";
import type { ScheduleDetail, WeeklyScheduleEvent } from "@/types/schedules";

const schedule: ScheduleDetail = {
  id: "sched-1",
  name: "Spring Plan",
  term: "Spring 2026",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  latestAudit: null,
  courses: [
    {
      courseCode: "EN.553.201",
      sisOfferingName: "EN.553.201",
      term: "Spring 2026",
      courseTitle: "Probability",
    },
  ],
};

function renderCourseList(weeklyEvents: WeeklyScheduleEvent[]) {
  render(
    <CourseList
      schedule={schedule}
      loadError={null}
      weeklyEvents={weeklyEvents}
      shortlistStatuses={{
        "EN.553.201|EN.553.201|Spring 2026": {
          loading: false,
          outcome: "fulfilled",
        },
      }}
      onOpenCourseInfo={vi.fn()}
      onRemoveCourse={vi.fn()}
      courseColorMap={{}}
    />,
  );
}

describe("CourseList", () => {
  it("shows a compact TBD pill for courses without meeting time", () => {
    renderCourseList([
      {
        eventId: "course-tbd",
        eventType: "course",
        dayOfWeek: "Friday",
        startTime: null,
        endTime: null,
        courseCode: "EN.553.201",
        courseTitle: "Probability",
        location: null,
      },
    ]);

    expect(screen.getByTestId("course-list-tbd-pill")).toHaveTextContent("Time TBD");
  });

  it("does not show TBD pills for fully scheduled courses", () => {
    renderCourseList([
      {
        eventId: "course-scheduled",
        eventType: "course",
        dayOfWeek: "Friday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.553.201",
        courseTitle: "Probability",
        location: "Shaffer",
      },
    ]);

    expect(screen.queryByTestId("course-list-tbd-pill")).not.toBeInTheDocument();
  });
});
