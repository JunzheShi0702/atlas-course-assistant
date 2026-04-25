import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SchedulePage from "./SchedulePage";

const {
  mockGetSchedule,
  mockDeleteSchedule,
  mockRemoveCourse,
  mockRunScheduleAudit,
  mockGetWeeklyEvents,
} = vi.hoisted(() => ({
  mockGetSchedule: vi.fn(),
  mockDeleteSchedule: vi.fn(),
  mockRemoveCourse: vi.fn(),
  mockRunScheduleAudit: vi.fn(),
  mockGetWeeklyEvents: vi.fn(),
}));

vi.mock("@/hooks/useSchedules", () => ({
  useSchedules: () => ({
    getSchedule: mockGetSchedule,
    deleteSchedule: mockDeleteSchedule,
    removeCourse: mockRemoveCourse,
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
  mockScheduleEventProvider: {
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

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Weekly Schedule" }));

    expect(screen.getByTestId("weekly-grid-loading")).toBeInTheDocument();
  });

  it("opens the page on chat tab by default", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Weekly Schedule" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("schedule-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-grid")).not.toBeInTheDocument();
  });

  it("renders weekly tab with an empty non-editable grid scaffold", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Weekly Schedule" })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Weekly Schedule" }));

    expect(screen.getByRole("tab", { name: "Weekly Schedule" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("weekly-grid")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-grid-empty")).toHaveTextContent("No scheduled events yet.");
    expect(screen.getByTestId("weekly-grid-metadata")).toHaveTextContent("Read-only scaffold");
  });

  it("switches between weekly and chat tabs", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Chat" }));

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Weekly Schedule" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("weekly-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("schedule-chat")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Weekly Schedule" }));

    expect(screen.getByRole("tab", { name: "Weekly Schedule" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("weekly-grid")).toBeInTheDocument();
  });

  it("falls back to empty weekly grid when event provider rejects", async () => {
    mockGetWeeklyEvents.mockRejectedValueOnce(new Error("provider down"));

    renderPage();

    await waitFor(() => {
      expect(mockGetWeeklyEvents).toHaveBeenCalledWith("sched-1");
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Weekly Schedule" }));

    expect(screen.getByTestId("weekly-grid-empty")).toHaveTextContent("No scheduled events yet.");
  });

  it("renders weekly event content from provider data", async () => {
    mockGetWeeklyEvents.mockResolvedValueOnce([
      {
        eventId: "monday-1",
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
    await user.click(screen.getByRole("tab", { name: "Weekly Schedule" }));

    const event = await screen.findByTestId("weekly-grid-event");
    expect(event).toHaveTextContent("EN.601.226");
    expect(event).toHaveTextContent("Data Structures");
    expect(event).toHaveTextContent("Malone 228");
  });
});
