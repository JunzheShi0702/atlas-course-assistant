import { describe, expect, it, vi } from "vitest";
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
    expect(event).toHaveAttribute("role", "button");
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

    expect(eventC).toHaveAttribute("data-overlap-columns", "1");
    expect(eventC).toHaveAttribute("data-overlap-column", "0");
    expect(eventC).toHaveAttribute("data-overlap-group", "1");
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
    expect(screen.getByTestId("weekly-grid-dropped-note")).toHaveTextContent("1 event omitted");
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

  it("invokes onEventSelect when clicking an event block", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ eventId: "click-target", courseCode: "EN.601.226" });
    const onEventSelect = vi.fn();

    render(<WeeklyScheduleGrid events={[event]} loading={false} onEventSelect={onEventSelect} />);

    await user.click(screen.getByTestId("weekly-grid-event"));

    expect(onEventSelect).toHaveBeenCalledTimes(1);
    expect(onEventSelect).toHaveBeenCalledWith(event);
  });

  it("invokes onEventSelect via keyboard Enter and Space", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ eventId: "keyboard-target", courseCode: "EN.601.315" });
    const onEventSelect = vi.fn();

    render(<WeeklyScheduleGrid events={[event]} loading={false} onEventSelect={onEventSelect} />);

    const block = screen.getByTestId("weekly-grid-event");
    block.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onEventSelect).toHaveBeenCalledTimes(2);
    expect(onEventSelect).toHaveBeenNthCalledWith(1, event);
    expect(onEventSelect).toHaveBeenNthCalledWith(2, event);
  });

  it("does not invoke onEventSelect for non-activation keys", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ eventId: "keyboard-ignore", courseCode: "EN.601.220" });
    const onEventSelect = vi.fn();

    render(<WeeklyScheduleGrid events={[event]} loading={false} onEventSelect={onEventSelect} />);

    const block = screen.getByTestId("weekly-grid-event");
    block.focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("a");

    expect(onEventSelect).not.toHaveBeenCalled();
  });

  it("keeps rendering stable when no onEventSelect callback is provided", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ eventId: "no-callback", courseCode: "EN.601.229" });

    render(<WeeklyScheduleGrid events={[event]} loading={false} />);

    const block = screen.getByTestId("weekly-grid-event");
    await user.click(block);
    block.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("weekly-grid-event")).toHaveTextContent("EN.601.229");
  });
});
