import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import type { WeeklyScheduleEvent } from "@/types/schedules";

function makeEvent(overrides: Partial<WeeklyScheduleEvent>): WeeklyScheduleEvent {
  return {
    eventId: "event-default",
    dayOfWeek: "Monday",
    startTime: "09:00",
    endTime: "10:00",
    courseCode: "EN.601.000",
    courseTitle: "Default Course",
    location: "Default Hall",
    ...overrides,
  };
}

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
    const events: WeeklyScheduleEvent[] = [makeEvent({
      eventId: "event-1",
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
      startTime: "09:00",
      endTime: "10:30",
      location: "Malone 228",
    })];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const event = screen.getByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("EN.601.226");
    expect(event).toHaveTextContent("Data Structures");
    expect(event).toHaveTextContent("Malone 228");
    expect(event).toHaveAttribute("data-day", "Monday");
    expect(event).toHaveAttribute("data-top-px", "60");
    expect(event).toHaveAttribute("data-height-px", "90");
    expect(event).toHaveAttribute("data-overlap-columns", "1");
    expect(event).toHaveAttribute("data-overlap-column", "0");
    expect(event).toHaveAttribute("data-overlap-group", "0");
    expect(event).toHaveAttribute("role", "article");
    expect(event).toHaveAttribute("tabindex", "0");
    expect(event).toHaveAttribute("aria-label", "EN.601.226 Data Structures, 09:00 to 10:30, Malone 228");
    expect(screen.getByTestId("weekly-grid-event-time")).toHaveTextContent("09:00 - 10:30");
    expect(screen.getByTestId("weekly-grid-metadata")).toHaveTextContent("1 rendered");
    expect(screen.queryByTestId("weekly-grid-empty")).not.toBeInTheDocument();
  });

  it("lays out overlapping events deterministically and keeps non-overlaps full width", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "event-a",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      }),
      makeEvent({
        eventId: "event-b",
        startTime: "09:30",
        endTime: "10:30",
        courseCode: "EN.601.315",
        courseTitle: "Databases",
        location: "Hackerman 122",
      }),
      makeEvent({
        eventId: "event-c",
        startTime: "11:00",
        endTime: "12:00",
        courseCode: "EN.601.433",
        courseTitle: "Algorithms",
        location: "Clark 110",
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const eventA = rendered.find((node) => node.getAttribute("data-event-id") === "event-a");
    const eventB = rendered.find((node) => node.getAttribute("data-event-id") === "event-b");
    const eventC = rendered.find((node) => node.getAttribute("data-event-id") === "event-c");

    expect(eventA).toBeDefined();
    expect(eventB).toBeDefined();
    expect(eventC).toBeDefined();

    expect(eventA).toHaveAttribute("data-overlap-columns", "2");
    expect(eventA).toHaveAttribute("data-overlap-column", "0");
    expect(eventA).toHaveAttribute("data-overlap-group", "0");
    expect(eventB).toHaveAttribute("data-overlap-columns", "2");
    expect(eventB).toHaveAttribute("data-overlap-column", "1");
    expect(eventB).toHaveAttribute("data-overlap-group", "0");
    expect(eventA).toHaveAttribute("data-conflicted", "true");
    expect(eventB).toHaveAttribute("data-conflicted", "true");

    expect(eventC).toHaveAttribute("data-overlap-columns", "1");
    expect(eventC).toHaveAttribute("data-overlap-column", "0");
    expect(eventC).toHaveAttribute("data-overlap-group", "1");
    expect(eventC).toHaveAttribute("data-conflicted", "false");
    expect(screen.getAllByTestId("weekly-grid-conflict-icon")).toHaveLength(2);
  });

  it("marks only the conflicting session when the same course has mixed conflict states", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "course-a-mon",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:15",
        courseCode: "EN.601.226",
      }),
      makeEvent({
        eventId: "mixed-conflict-mon",
        dayOfWeek: "Monday",
        startTime: "09:30",
        endTime: "10:20",
        courseCode: "EN.625.411",
        courseTitle: "Real-Time Systems",
      }),
      makeEvent({
        eventId: "mixed-conflict-wed",
        dayOfWeek: "Wednesday",
        startTime: "11:00",
        endTime: "12:15",
        courseCode: "EN.625.411",
        courseTitle: "Real-Time Systems",
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const mondayConflict = rendered.find((node) => node.getAttribute("data-event-id") === "mixed-conflict-mon");
    const wednesdayClear = rendered.find((node) => node.getAttribute("data-event-id") === "mixed-conflict-wed");

    expect(mondayConflict).toHaveAttribute("data-conflicted", "true");
    expect(wednesdayClear).toHaveAttribute("data-conflicted", "false");
  });

  it("keeps overlapping instances separate when duplicate eventIds appear", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "shared-id",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
      }),
      makeEvent({
        eventId: "shared-id",
        startTime: "09:15",
        endTime: "10:15",
        courseCode: "EN.601.315",
        courseTitle: "Databases",
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    expect(rendered).toHaveLength(2);

    const dataStructures = rendered.find((node) => node.textContent?.includes("EN.601.226"));
    const databases = rendered.find((node) => node.textContent?.includes("EN.601.315"));

    expect(dataStructures).toHaveAttribute("data-overlap-columns", "2");
    expect(databases).toHaveAttribute("data-overlap-columns", "2");
    expect(dataStructures).toHaveAttribute("data-overlap-column", "0");
    expect(databases).toHaveAttribute("data-overlap-column", "1");
  });

  it("clamps events to the visible day window and still renders them", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "early", startTime: "06:30", endTime: "08:15", location: "A" }),
      makeEvent({ eventId: "late", startTime: "20:30", endTime: "22:30", location: "B" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const early = rendered.find((node) => node.getAttribute("data-event-id") === "early");
    const late = rendered.find((node) => node.getAttribute("data-event-id") === "late");

    expect(early).toBeDefined();
    expect(late).toBeDefined();
    expect(early).toHaveAttribute("data-top-px", "0");
    expect(early).toHaveAttribute("data-height-px", "24");
    expect(late).toHaveAttribute("data-top-px", "750");
    expect(late).toHaveAttribute("data-height-px", "30");
  });

  it("drops invalid events and reports omitted count", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "ok", dayOfWeek: "Tuesday" }),
      makeEvent({ eventId: "bad-day", dayOfWeek: "Sunday" }),
      makeEvent({ eventId: "bad-time", startTime: "xx:yy" }),
      makeEvent({ eventId: "reverse", startTime: "10:00", endTime: "09:00" }),
      makeEvent({ eventId: "outside", startTime: "22:00", endTime: "23:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveAttribute("data-event-id", "ok");
    expect(screen.getByTestId("weekly-grid-dropped-note")).toHaveTextContent(
      "4 events omitted due to invalid or out-of-range time data.",
    );
  });

  it("renders incomplete events in an unscheduled section instead of dropping them", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "missing-time",
        dayOfWeek: "Friday",
        startTime: null,
        endTime: null,
        courseCode: "EN.553.201",
        courseTitle: "Probability",
        location: null,
      }),
      makeEvent({
        eventId: "missing-everything",
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        courseCode: "",
        courseTitle: "",
        location: null,
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const unscheduled = screen.getAllByTestId("weekly-grid-unscheduled-event");
    expect(unscheduled).toHaveLength(2);
    expect(screen.getByTestId("weekly-grid-unscheduled")).toHaveTextContent("Unscheduled / TBA");
    expect(screen.getByTestId("weekly-grid-metadata")).toHaveTextContent("2 rendered");
    expect(screen.queryByTestId("weekly-grid-empty")).not.toBeInTheDocument();

    expect(unscheduled[0]).toHaveTextContent("EN.553.201");
    expect(unscheduled[0]).toHaveTextContent("Probability");
    expect(unscheduled[0]).toHaveTextContent("Friday");
    expect(unscheduled[0]).toHaveTextContent("Time TBA");
    expect(unscheduled[0]).toHaveTextContent("Location TBA");

    expect(unscheduled[1]).toHaveTextContent("Course TBA");
    expect(unscheduled[1]).toHaveTextContent("Untitled course");
    expect(unscheduled[1]).toHaveTextContent("Day/Time TBA");
  });

  it("renders scheduled blocks even when non-time fields are missing", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "missing-details",
        dayOfWeek: "Tuesday",
        startTime: "15:00",
        endTime: "16:15",
        courseCode: "AS.030.205",
        courseTitle: "",
        location: null,
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const event = screen.getByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("AS.030.205");
    expect(event).toHaveTextContent("Untitled course");
    expect(event).toHaveTextContent("15:00 - 16:15");
    expect(event).toHaveTextContent("Location TBA");
    expect(screen.queryByTestId("weekly-grid-unscheduled-event")).not.toBeInTheDocument();
  });

  it("reuses a lane when events touch but do not overlap", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "first", startTime: "09:00", endTime: "10:00" }),
      makeEvent({ eventId: "second", startTime: "10:00", endTime: "11:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const first = rendered.find((node) => node.getAttribute("data-event-id") === "first");
    const second = rendered.find((node) => node.getAttribute("data-event-id") === "second");

    expect(first).toHaveAttribute("data-overlap-columns", "1");
    expect(second).toHaveAttribute("data-overlap-columns", "1");
    expect(first).toHaveAttribute("data-overlap-column", "0");
    expect(second).toHaveAttribute("data-overlap-column", "0");
  });

  it("uses deterministic eventId ordering when time ranges tie", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "zeta", startTime: "09:00", endTime: "10:00" }),
      makeEvent({ eventId: "alpha", startTime: "09:00", endTime: "10:00" }),
      makeEvent({ eventId: "middle", startTime: "09:00", endTime: "10:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen
      .getAllByTestId("weekly-grid-event")
      .map((node) => node.getAttribute("data-event-id"));

    expect(rendered).toEqual(["alpha", "middle", "zeta"]);
  });

  it("applies minimum height to very short valid events", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "short", startTime: "09:00", endTime: "09:10" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    expect(screen.getByTestId("weekly-grid-event")).toHaveAttribute("data-height-px", "24");
  });

  it("shows fallback location label when location is empty", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "noloc", location: "   " }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const event = screen.getByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("Location TBA");
    expect(event).toHaveAttribute("aria-label", "EN.601.000 Default Course, 09:00 to 10:00, Location TBA");
  });

  it("renders the expected visible hour labels", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();
  });

  it("keeps valid events in separate days independent from dropped events", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "mon", dayOfWeek: "Monday", startTime: "09:00", endTime: "10:00" }),
      makeEvent({ eventId: "wed", dayOfWeek: "Wednesday", startTime: "13:00", endTime: "14:00" }),
      makeEvent({ eventId: "invalid", dayOfWeek: null }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    expect(rendered).toHaveLength(2);
    const ids = rendered.map((node) => node.getAttribute("data-event-id"));
    expect(ids).toContain("mon");
    expect(ids).toContain("wed");
    expect(screen.getByTestId("weekly-grid-unscheduled")).toHaveTextContent("Unscheduled / TBA");
  });

  it("renders a full-day-window block when event exactly matches visible range", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "full-window", startTime: "08:00", endTime: "21:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const event = screen.getByTestId("weekly-grid-event");
    expect(event).toHaveAttribute("data-top-px", "0");
    expect(event).toHaveAttribute("data-height-px", "780");
    expect(event).toHaveAttribute("data-overlap-columns", "1");
  });

  it("allocates three deterministic lanes for triple-overlap cluster", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "a", startTime: "09:00", endTime: "11:00" }),
      makeEvent({ eventId: "b", startTime: "09:15", endTime: "10:30" }),
      makeEvent({ eventId: "c", startTime: "09:30", endTime: "10:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const a = rendered.find((node) => node.getAttribute("data-event-id") === "a");
    const b = rendered.find((node) => node.getAttribute("data-event-id") === "b");
    const c = rendered.find((node) => node.getAttribute("data-event-id") === "c");

    expect(a).toHaveAttribute("data-overlap-columns", "3");
    expect(b).toHaveAttribute("data-overlap-columns", "3");
    expect(c).toHaveAttribute("data-overlap-columns", "3");

    expect(a).toHaveAttribute("data-overlap-column", "0");
    expect(b).toHaveAttribute("data-overlap-column", "1");
    expect(c).toHaveAttribute("data-overlap-column", "2");
  });

  it("does not show dropped-note metadata when all events are valid", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "valid-1", dayOfWeek: "Tuesday", startTime: "10:00", endTime: "11:00" }),
      makeEvent({ eventId: "valid-2", dayOfWeek: "Thursday", startTime: "14:00", endTime: "15:00" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    expect(screen.queryByTestId("weekly-grid-dropped-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("weekly-grid-metadata")).toHaveTextContent("2 rendered");
  });

  it("applies focused and unfocused visual states to rendered blocks", async () => {
    const user = userEvent.setup();
    const events: WeeklyScheduleEvent[] = [
      makeEvent({ eventId: "focus-a", courseCode: "EN.601.226" }),
      makeEvent({ eventId: "focus-b", startTime: "11:00", endTime: "12:00", courseCode: "EN.601.315" }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const rendered = screen.getAllByTestId("weekly-grid-event");
    const first = rendered.find((node) => node.getAttribute("data-event-id") === "focus-a");
    const second = rendered.find((node) => node.getAttribute("data-event-id") === "focus-b");

    expect(first).toHaveAttribute("data-visual-state", "unfocused");
    expect(second).toHaveAttribute("data-visual-state", "unfocused");
    expect(first).toHaveAttribute("data-dimmed", "false");
    expect(second).toHaveAttribute("data-dimmed", "false");

    await user.click(first!);

    expect(first).toHaveAttribute("data-visual-state", "focused");
    expect(first).toHaveAttribute("data-dimmed", "false");
    expect(second).toHaveAttribute("data-visual-state", "unfocused");
    expect(second).toHaveAttribute("data-dimmed", "false");

    await user.tab();

    expect(first).toHaveAttribute("data-visual-state", "unfocused");
    expect(first).toHaveAttribute("data-dimmed", "false");
    expect(second).toHaveAttribute("data-visual-state", "focused");
    expect(second).toHaveAttribute("data-dimmed", "false");
  });
});
