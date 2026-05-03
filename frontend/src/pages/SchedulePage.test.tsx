import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SchedulePage from "./SchedulePage";

const {
  mockGetSchedule,
  mockDeleteSchedule,
  mockRemoveCourse,
  mockCreateCustomEvent,
  mockUpdateCustomEvent,
  mockDeleteCustomEvent,
  mockRunScheduleAudit,
  mockGetWeeklyEvents,
} = vi.hoisted(() => ({
  mockGetSchedule: vi.fn(),
  mockDeleteSchedule: vi.fn(),
  mockRemoveCourse: vi.fn(),
  mockCreateCustomEvent: vi.fn(),
  mockUpdateCustomEvent: vi.fn(),
  mockDeleteCustomEvent: vi.fn(),
  mockRunScheduleAudit: vi.fn(),
  mockGetWeeklyEvents: vi.fn(),
}));

vi.mock("@/hooks/useSchedules", () => ({
  useSchedules: () => ({
    getSchedule: mockGetSchedule,
    deleteSchedule: mockDeleteSchedule,
    removeCourse: mockRemoveCourse,
    createCustomEvent: mockCreateCustomEvent,
    updateCustomEvent: mockUpdateCustomEvent,
    deleteCustomEvent: mockDeleteCustomEvent,
    runScheduleAudit: mockRunScheduleAudit,
  }),
}));

vi.mock("@/components/Header", () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/ScheduleChat", () => ({
  default: () => <div data-testid="schedule-chat">Schedule Chat</div>,
}));

vi.mock("@/lib/schedule-event-provider", () => ({
  scheduleEventProvider: {
    getWeeklyEvents: mockGetWeeklyEvents,
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/schedules/sched-1"]}>
      <Routes>
        <Route path="/schedules/:id" element={<SchedulePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SchedulePage weekly schedule main tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSchedule.mockResolvedValue({
      id: "sched-1",
      name: "Spring Plan",
      term: "Spring 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      courses: [
        {
          courseCode: "EN.601.226",
          sisOfferingName: "EN.601.226",
          term: "Spring 2026",
          courseTitle: "Data Structures",
        },
      ],
      latestAudit: null,
    });
    mockDeleteSchedule.mockResolvedValue(undefined);
    mockRemoveCourse.mockResolvedValue(undefined);
    mockCreateCustomEvent.mockResolvedValue(undefined);
    mockUpdateCustomEvent.mockResolvedValue(undefined);
    mockDeleteCustomEvent.mockResolvedValue(undefined);
    mockRunScheduleAudit.mockResolvedValue({ result: {} });
    mockGetWeeklyEvents.mockResolvedValue([]);
  });

  it("loads weekly events using the schedule event provider", async () => {
    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });
  });

  it("shows a loading state while weekly events are being fetched", async () => {
    mockGetWeeklyEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([]), 1000);
        }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("weekly-grid-loading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("weekly-grid-panel")).toBeInTheDocument();
  }, 15000);

  it("renders both chat and weekly calendar on page load", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("schedule-chat")).toBeInTheDocument();
    });
    expect(screen.getByTestId("weekly-grid-panel")).toBeInTheDocument();
  });

  it("renders an empty non-editable grid scaffold", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("weekly-grid")).toBeInTheDocument();
    });
    expect(screen.getByTestId("weekly-grid-empty")).toHaveTextContent("No scheduled events yet.");
  });

  it("displays chat panel and weekly grid simultaneously", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("schedule-chat")).toBeInTheDocument();
    });
    expect(screen.getByTestId("weekly-grid-panel")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-grid")).toBeInTheDocument();
  });

  it("allows resizing the desktop schedule panes with drag handles", async () => {
    renderPage();

    const leftPane = await screen.findByTestId("schedule-page-content");
    const resizeHandle = screen.getByRole("separator", { name: "Resize calendar and chat panes" });

    expect(screen.getByRole("separator", { name: "Resize calendar and course list" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize chat and audit panes" })).toBeInTheDocument();

    fireEvent.pointerDown(resizeHandle, { clientX: 480 });
    fireEvent.pointerMove(window, { clientX: 560 });
    fireEvent.pointerUp(window);

    expect(leftPane).toHaveStyle({ width: "560px" });
  });

  it("falls back to empty weekly grid when event provider rejects", async () => {
    mockGetWeeklyEvents.mockRejectedValueOnce(new Error("provider down"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    expect(screen.getByText("Unable to load weekly schedule events right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry loading events" })).toBeInTheDocument();
    expect(screen.getByTestId("weekly-grid-empty")).toHaveTextContent("No scheduled events yet.");
  });

  it("renders weekly event content from provider data", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "monday-1",
        eventType: "course",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const event = await screen.findByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("Data Structures");
  });

  it("creates a custom event from the weekly schedule controls and reloads weekly events", async () => {
    mockCreateCustomEvent.mockResolvedValueOnce({
      eventId: "custom-1",
      eventType: "custom",
      dayOfWeek: "Tuesday",
      startTime: "18:00",
      endTime: "19:00",
      courseCode: "Custom",
      courseTitle: "Gym",
      location: "Rec Center",
    });

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add custom event" }));

    await user.type(screen.getByPlaceholderText("Club meeting"), "Gym");
    await user.selectOptions(screen.getByLabelText("Day"), "Tuesday");
    const startInput = screen.getByLabelText("Start");
    await user.clear(startInput);
    await user.type(startInput, "18:00");
    const endInput = screen.getByLabelText("End");
    await user.clear(endInput);
    await user.type(endInput, "19:00");
    await user.type(screen.getByPlaceholderText("Homewood campus"), "Rec Center");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateCustomEvent).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({
          title: "Gym",
          dayOfWeek: "Tuesday",
          startTime: "18:00",
          endTime: "19:00",
          location: "Rec Center",
        }),
      );
    });
    expect(mockGetWeeklyEvents).toHaveBeenCalledTimes(2);
  }, 15000);

  it("creates a custom event using form defaults when only title is provided", async () => {
    mockCreateCustomEvent.mockResolvedValueOnce({
      eventId: "custom-tbd",
      eventType: "custom",
      dayOfWeek: "Monday",
      startTime: "09:00",
      endTime: "10:00",
      courseCode: "Custom",
      courseTitle: "Study Block",
      location: null,
    });

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add custom event" }));

    await user.type(screen.getByPlaceholderText("Club meeting"), "Study Block");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateCustomEvent).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({
          title: "Study Block",
          dayOfWeek: "Monday",
          startTime: "09:00",
          endTime: "10:00",
          location: null,
        }),
      );
    });
  });

  it("edits and deletes custom events from the weekly event dialog", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "custom-1",
        eventType: "custom",
        dayOfWeek: "Tuesday",
        startTime: "18:00",
        endTime: "19:00",
        courseCode: "Custom",
        courseTitle: "Gym",
        location: "Rec Center",
      },
    ]).mockResolvedValueOnce([
      {
        eventId: "custom-1",
        eventType: "custom",
        dayOfWeek: "Thursday",
        startTime: "20:00",
        endTime: "21:00",
        courseCode: "Custom",
        courseTitle: "Gym",
        location: "Rec Center",
      },
    ]).mockResolvedValueOnce([]);
    mockUpdateCustomEvent.mockResolvedValueOnce({
      eventId: "custom-1",
      eventType: "custom",
      dayOfWeek: "Thursday",
      startTime: "20:00",
      endTime: "21:00",
      courseCode: "Custom",
      courseTitle: "Gym",
      location: "Rec Center",
    });

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("weekly-grid-event"));

    expect(screen.getByRole("heading", { name: "Gym" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const startInput = screen.getByLabelText("Start");
    const endInput = screen.getByLabelText("End");
    await user.selectOptions(screen.getByDisplayValue("Tuesday"), "Thursday");
    await user.clear(endInput);
    await user.type(endInput, "21:00");
    await user.clear(startInput);
    await user.type(startInput, "20:00");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdateCustomEvent).toHaveBeenCalledWith(
        "sched-1",
        "custom-1",
        expect.objectContaining({
          dayOfWeek: "Thursday",
          startTime: "20:00",
          endTime: "21:00",
        }),
      );
    });

    mockDeleteCustomEvent.mockResolvedValueOnce(undefined);

    await user.click(await screen.findByTestId("weekly-grid-event"));
    await user.click(within(screen.getByTestId("weekly-event-dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteCustomEvent).toHaveBeenCalledWith("sched-1", "custom-1");
    });
  }, 15000);

  it("opens and edits a TBD custom event from the unscheduled section", async () => {
    mockGetWeeklyEvents
      .mockResolvedValueOnce([
        {
          eventId: "custom-tbd",
          eventType: "custom",
          dayOfWeek: null,
          startTime: null,
          endTime: null,
          courseCode: "Custom",
          courseTitle: "Study Block",
          location: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          eventId: "custom-tbd",
          eventType: "custom",
          dayOfWeek: "Friday",
          startTime: "14:00",
          endTime: "15:00",
          courseCode: "Custom",
          courseTitle: "Study Block",
          location: "Brody",
        },
      ]);
    mockUpdateCustomEvent.mockResolvedValueOnce({
      eventId: "custom-tbd",
      eventType: "custom",
      dayOfWeek: "Friday",
      startTime: "14:00",
      endTime: "15:00",
      courseCode: "Custom",
      courseTitle: "Study Block",
      location: "Brody",
    });

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    const unscheduled = await screen.findByTestId("weekly-grid-unscheduled-event");
    await user.click(unscheduled);

    expect(screen.getByRole("heading", { name: "Study Block" })).toBeInTheDocument();
    expect(screen.getByTestId("weekly-event-dialog-time")).toHaveTextContent("Time TBD");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await user.selectOptions(screen.getByLabelText("Day"), "Friday");
    const startInput = screen.getByLabelText("Start");
    const endInput = screen.getByLabelText("End");
    await user.clear(startInput);
    await user.type(startInput, "14:00");
    await user.clear(endInput);
    await user.type(endInput, "15:00");
    await user.type(screen.getByPlaceholderText("Homewood campus"), "Brody");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdateCustomEvent).toHaveBeenCalledWith(
        "sched-1",
        "custom-tbd",
        expect.objectContaining({
          dayOfWeek: "Friday",
          startTime: "14:00",
          endTime: "15:00",
          location: "Brody",
        }),
      );
    });
  }, 15000);

  it("shows a custom event save error without closing the editor", async () => {
    mockCreateCustomEvent.mockRejectedValueOnce(new Error("bad custom event"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add custom event" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add custom event" })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Club meeting"), "Gym");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateCustomEvent).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("bad custom event") ?? screen.queryByText("Could not save custom event"),
      ).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.getByRole("heading", { name: "Add custom event" })).toBeInTheDocument();
  }, 15000);

  it("opens weekly event details dialog when clicking a rendered block", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "monday-1",
        eventType: "course",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("weekly-grid-event"));

    const dialog = screen.getByTestId("weekly-event-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "EN.601.226" })).toBeInTheDocument();
    expect(screen.getByTestId("weekly-event-dialog-course-title")).toHaveTextContent("Data Structures");
    expect(screen.getByTestId("weekly-event-dialog-day")).toHaveTextContent("Monday");
    expect(screen.getByTestId("weekly-event-dialog-time")).toHaveTextContent("09:00 - 10:00");
    expect(screen.getByTestId("weekly-event-dialog-location")).toHaveTextContent("Malone 228");
  }, 10000);

  it("opens weekly event details dialog via keyboard activation", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "monday-1",
        eventType: "course",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();

    const event = await screen.findByTestId("weekly-grid-event");
    await act(async () => {
      event.focus();
    });
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("weekly-event-dialog")).toBeInTheDocument();
  });

  it("closes weekly event details dialog via overlay click, close button, and Escape", async () => {
    mockGetWeeklyEvents.mockResolvedValue([
      {
        eventId: "monday-1",
        eventType: "course",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();

    const event = await screen.findByTestId("weekly-grid-event");
    await user.click(event);
    expect(screen.getByTestId("weekly-event-dialog")).toBeInTheDocument();

    await user.click(screen.getByTestId("weekly-event-dialog-overlay"));
    expect(screen.queryByTestId("weekly-event-dialog")).not.toBeInTheDocument();

    await user.click(event);
    expect(screen.getByTestId("weekly-event-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close weekly event details" }));
    expect(screen.queryByTestId("weekly-event-dialog")).not.toBeInTheDocument();

    await user.click(event);
    expect(screen.getByTestId("weekly-event-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("weekly-event-dialog")).not.toBeInTheDocument();
  });

  it("closes weekly event details dialog via footer Close button", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "monday-1",
        eventType: "course",
        dayOfWeek: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.226",
        courseTitle: "Data Structures",
        location: "Malone 228",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("weekly-grid-event"));

    expect(screen.getByTestId("weekly-event-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("weekly-event-dialog")).not.toBeInTheDocument();
  });

  it("shows 404-specific weekly events error messaging", async () => {
    mockGetWeeklyEvents.mockRejectedValueOnce(new Error("HTTP 404"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    expect(screen.getByText("Weekly schedule data was not found for this schedule.")).toBeInTheDocument();
  });

  it("shows 403-specific weekly events error messaging", async () => {
    mockGetWeeklyEvents.mockRejectedValueOnce(new Error("HTTP 403"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    expect(
      screen.getByText("You do not have permission to view weekly events for this schedule."),
    ).toBeInTheDocument();
  });

  it("shows 401-specific weekly events error messaging", async () => {
    mockGetWeeklyEvents.mockRejectedValueOnce(new Error("HTTP 401"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    expect(
      screen.getByText("Your session expired. Please sign in again to view weekly events."),
    ).toBeInTheDocument();
  });

  it("retries weekly events load and renders events after failure", async () => {
    mockGetWeeklyEvents
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce([
        {
          eventId: "retry-event",
          eventType: "course",
          dayOfWeek: "Tuesday",
          startTime: "11:00",
          endTime: "12:00",
          courseCode: "EN.601.315",
          courseTitle: "Databases",
          location: "Hackerman 122",
        },
      ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledTimes(1);
    });

    const user = userEvent.setup();

    expect(screen.getByText("Unable to load weekly schedule events right now.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry loading events" }));

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText("Unable to load weekly schedule events right now.")).not.toBeInTheDocument();
    const event = await screen.findByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("Databases");
  });
});
