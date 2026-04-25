import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import type { WeeklyScheduleEvent } from "@/types/schedules";

describe("WeeklyScheduleGrid", () => {
  it("renders an empty-grid message when no events exist", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    expect(screen.getByTestId("weekly-grid-empty")).toHaveTextContent("No scheduled events yet.");
    expect(screen.queryByTestId("weekly-grid-event")).not.toBeInTheDocument();
  });

  it("renders loading state while weekly events are loading", () => {
    render(<WeeklyScheduleGrid events={[]} loading />);

    expect(screen.getByTestId("weekly-grid-loading")).toHaveTextContent("Loading weekly schedule...");
  });

  it("renders event chips in matching day/time cells", () => {
    const events: WeeklyScheduleEvent[] = [
      {
        eventId: "event-1",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    expect(screen.getByTestId("weekly-grid-event")).toHaveTextContent("EN.601.226");
    expect(screen.getByTestId("weekly-grid-event")).toHaveTextContent("Data Structures");
    expect(screen.queryByTestId("weekly-grid-empty")).not.toBeInTheDocument();
  });
});
