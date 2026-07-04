import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import type { WeeklyScheduleEvent } from "@/types/schedules";

function makeEvent(overrides: Partial<WeeklyScheduleEvent>): WeeklyScheduleEvent {
  return {
    eventId: "event-default",
    eventType: "course",
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

  it("shows add buttons for each weekday when onAddEvent is provided", async () => {
    const user = userEvent.setup();
    const onAddEvent = vi.fn();

    render(<WeeklyScheduleGrid events={[]} loading={false} onAddEvent={onAddEvent} />);

    const tuesdayButton = screen.getByRole("button", { name: "Add custom event on Tuesday" });
    await user.click(tuesdayButton);

    expect(screen.getAllByRole("button", { name: /Add custom event on/i })).toHaveLength(5);
    expect(onAddEvent).toHaveBeenCalledWith("Tuesday");
  });

  it("renders custom events with custom title-first labeling", () => {
    render(
      <WeeklyScheduleGrid
        events={[
          makeEvent({
            eventId: "custom-1",
            eventType: "custom",
            courseCode: "Custom",
            courseTitle: "Gym",
            location: "Rec Center",
          }),
        ]}
        loading={false}
      />,
    );

    const event = screen.getByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("Gym");
    expect(event).toHaveAttribute("data-event-type", "custom");
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
    expect(event).toHaveTextContent("Data Structures");
    expect(event).toHaveAttribute("data-day", "Monday");
    expect(event).toHaveAttribute("data-top-px", "60");
    expect(event).toHaveAttribute("data-height-px", "90");
    expect(event).toHaveAttribute("data-overlap-columns", "1");
    expect(event).toHaveAttribute("data-overlap-column", "0");
    expect(event).toHaveAttribute("data-overlap-group", "0");
    expect(event).toHaveAttribute("role", "article");
    expect(event).toHaveAttribute("tabindex", "0");
    expect(event).toHaveAttribute("aria-label", "EN.601.226 Data Structures, 09:00 to 10:30, Malone 228");
    expect(event).toHaveClass("rounded-md");
    expect(screen.queryByTestId("weekly-grid-empty")).not.toBeInTheDocument();
  });

  it("allows the compact calendar to scroll when the full day is taller than its pane", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} compact />);

    const grid = screen.getByTestId("weekly-grid");
    expect(grid).toHaveClass("overflow-y-auto");
    expect(grid).toHaveClass("overflow-x-hidden");
  });

  it("uses a fixed 56px time column width in header and timeline rail", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    const headerRow = screen.getByTestId("weekly-grid-header-row");
    const timeRail = screen.getByTestId("weekly-grid-time-rail");

    expect(headerRow.getAttribute("style")).toContain("grid-template-columns: 56px repeat(5, minmax(0, 1fr));");
    expect(timeRail).toHaveStyle({ width: "56px" });
  });

  it("keeps weekday header and body columns on matching grid templates", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    const headerRow = screen.getByTestId("weekly-grid-header-row");
    const dayColumnsWrapper = screen.getByTestId("weekly-grid-day-columns");

    expect(headerRow.getAttribute("style")).toContain("grid-template-columns: 56px repeat(5, minmax(0, 1fr));");
    expect(dayColumnsWrapper.getAttribute("style")).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
  });

  it("positions weekday body columns directly after the time rail", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    const dayColumnsWrapper = screen.getByTestId("weekly-grid-day-columns");

    expect(dayColumnsWrapper).toHaveStyle({ left: "56px" });
  });

  it("top-aligns hour labels with each hour grid line", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    const label0800 = screen.getByText("08:00");
    const label0900 = screen.getByText("09:00");
    const label1000 = screen.getByText("10:00");

    expect(label0800).toHaveStyle({ top: "0px" });
    expect(label0900).toHaveStyle({ top: "60px" });
    expect(label1000).toHaveStyle({ top: "120px" });
  });

  it("keeps hour labels and day grid lines aligned in compact mode", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} compact />);

    const label0900 = screen.getByText("09:00");
    expect(label0900).toHaveStyle({ top: "30px" });

    const mondayBodyColumn = screen.getByTestId("weekly-grid-day-Monday");
    const lines = mondayBodyColumn.querySelectorAll(".border-t");
    const nineAmLine = Array.from(lines).find((line) => (line as HTMLElement).style.top === "30px");

    expect(nineAmLine).toBeDefined();
  });

  it("does not use translate-based centering for hour labels", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    const label0900 = screen.getByText("09:00");
    expect(label0900.className).not.toContain("-translate-y-1/2");
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
    expect(screen.getByTestId("weekly-grid-conflict-note")).toHaveTextContent(
      "2 calendar blocks overlap. Conflicting blocks are marked in amber.",
    );
    expect(screen.getAllByTestId("weekly-grid-conflict-badge")).toHaveLength(2);

    expect(eventC).toHaveAttribute("data-overlap-columns", "1");
    expect(eventC).toHaveAttribute("data-overlap-column", "0");
    expect(eventC).toHaveAttribute("data-overlap-group", "1");
    expect(eventC).toHaveAttribute("data-conflicted", "false");
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

    const dataStructures = rendered.find((node) => node.textContent?.includes("Data Structures"));
    const databases = rendered.find((node) => node.textContent?.includes("Databases"));

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

  it("omits incomplete course events from the calendar but keeps custom TBD events editable", () => {
    const events: WeeklyScheduleEvent[] = [
      makeEvent({
        eventId: "missing-time",
        eventType: "course",
        dayOfWeek: "Friday",
        startTime: null,
        endTime: null,
        courseCode: "EN.553.201",
        courseTitle: "Probability",
        location: null,
      }),
      makeEvent({
        eventId: "missing-everything",
        eventType: "custom",
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        courseCode: "",
        courseTitle: "",
        location: null,
      }),
      makeEvent({
        eventId: "weekend-time-tbd",
        eventType: "custom",
        dayOfWeek: "Saturday",
        startTime: null,
        endTime: null,
        courseCode: "Custom",
        courseTitle: "Untitled",
        location: null,
      }),
    ];

    render(<WeeklyScheduleGrid events={events} loading={false} />);

    const unscheduled = screen.getAllByTestId("weekly-grid-unscheduled-event");
    expect(unscheduled).toHaveLength(2);
    expect(screen.getByTestId("weekly-grid-unscheduled")).toHaveTextContent("Unscheduled / TBD");
    expect(screen.queryByTestId("weekly-grid-empty")).not.toBeInTheDocument();

    expect(screen.queryByText("EN.553.201")).not.toBeInTheDocument();
    expect(screen.queryByText("Probability")).not.toBeInTheDocument();
    expect(unscheduled[0]).toHaveTextContent("Course TBD");
    expect(unscheduled[0]).toHaveTextContent("Untitled course");
    expect(unscheduled[0]).toHaveTextContent("Day/Time TBD");
    expect(unscheduled[1]).toHaveTextContent("Saturday · Time TBD");
  });

  it("allows selecting unscheduled events when onEventSelect is provided", async () => {
    const user = userEvent.setup();
    const onEventSelect = vi.fn();
    const event = makeEvent({
      eventId: "custom-tbd",
      eventType: "custom",
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      courseCode: "Custom",
      courseTitle: "Study Block",
      location: null,
    });

    render(<WeeklyScheduleGrid events={[event]} loading={false} onEventSelect={onEventSelect} />);

    const unscheduled = screen.getByTestId("weekly-grid-unscheduled-event");
    expect(unscheduled).toHaveAttribute("role", "button");

    await user.click(unscheduled);
    expect(onEventSelect).toHaveBeenCalledWith(event);
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
    expect(event).toHaveTextContent("Untitled course");
    expect(event).toHaveAttribute("aria-label", "AS.030.205 Untitled course, 15:00 to 16:15, Location TBD");
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
    expect(event).toHaveAttribute("aria-label", "EN.601.000 Default Course, 09:00 to 10:00, Location TBD");
  });

  it("renders the expected visible hour labels", () => {
    render(<WeeklyScheduleGrid events={[]} loading={false} />);

    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();
  });

  it("keeps valid events in separate days independent from incomplete events", () => {
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
    expect(screen.queryByTestId("weekly-grid-unscheduled")).not.toBeInTheDocument();
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
  it("calls onEventSelect for click and keyboard activation", async () => {
    const user = userEvent.setup();
    const onEventSelect = vi.fn();
    const event = makeEvent({ eventId: "selectable" });

    render(<WeeklyScheduleGrid events={[event]} loading={false} onEventSelect={onEventSelect} />);

    const block = screen.getByTestId("weekly-grid-event");
    expect(block).toHaveAttribute("role", "button");

    await user.click(block);
    expect(onEventSelect).toHaveBeenCalledWith(event);

    onEventSelect.mockClear();
    block.focus();
    await user.keyboard("{Enter}");
    expect(onEventSelect).toHaveBeenCalledWith(event);
  });
});
