import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleChat from "./ScheduleChat";

const mockAddCourse = vi.fn();
const mockRemoveCourse = vi.fn();
const mockGetSchedule = vi.fn();

vi.mock("@/hooks/useSchedules", () => ({
  useSchedules: () => ({
    addCourse: mockAddCourse,
    removeCourse: mockRemoveCourse,
    getSchedule: mockGetSchedule,
  }),
}));

vi.mock("@/components/CourseCard", () => ({
  default: ({
    course,
    onAddToSchedule,
    onRemoveFromSchedule,
    isInSchedule,
  }: {
    course: { courseTitle: string };
    onAddToSchedule: (course: { courseTitle: string }) => void;
    onRemoveFromSchedule: (course: { courseTitle: string }) => void;
    isInSchedule: boolean;
  }) => (
    <div data-testid="mock-course-card">
      <span>{course.courseTitle}</span>
      <button onClick={() => onAddToSchedule(course)} disabled={isInSchedule}>
        Add
      </button>
      <button onClick={() => onRemoveFromSchedule(course)}>Remove</button>
    </div>
  ),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("ScheduleChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mockGetSchedule.mockResolvedValue({ courses: [] });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("sends a chat message and renders assistant text response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "You can balance this schedule by swapping one heavy course.",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" />);

    await user.type(screen.getByTestId("chat-input"), "How heavy is this?");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText(/balance this schedule/i)).toBeInTheDocument();
    });

    const sendCall = vi.mocked(fetch).mock.calls[0];
    expect(sendCall?.[0]).toBe("/api/agent");
    expect(sendCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(String(sendCall?.[1]?.body)).toContain('"scheduleId":"sched-1"');
  });

  it("refreshes schedule when scheduleChanges include added/removed courses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "Updated your schedule.",
        scheduleChanges: {
          operation: "replace",
          added: [{ courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" }],
          removed: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
          failed: [],
        },
      }),
    );

    const onScheduleCoursesChanged = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" onScheduleCoursesChanged={onScheduleCoursesChanged} />);

    await user.type(screen.getByTestId("chat-input"), "swap EN.601.226 with EN.520.433");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("Updated your schedule.")).toBeInTheDocument();
    });
    expect(onScheduleCoursesChanged).toHaveBeenCalledTimes(1);
  });

  it("renders returned course cards and supports add/remove actions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "search",
        results: [
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "Core data structures",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
      }),
    );

    const onScheduleCoursesChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ScheduleChat
        scheduleId="sched-1"
        onScheduleCoursesChanged={onScheduleCoursesChanged}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "show me data structures");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-course-card")).toBeInTheDocument();
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(mockAddCourse).toHaveBeenCalledWith(
      "sched-1",
      expect.objectContaining({
        courseCode: "601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      }),
    );
    expect(onScheduleCoursesChanged).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockRemoveCourse).toHaveBeenCalledWith(
      "sched-1",
      expect.objectContaining({
        courseCode: "601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      }),
    );
  });

  it("uses backend-provided search message when present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "search",
        message: "I found multiple candidate courses. Please choose one.",
        results: [
          {
            courseId: "as-220-105-spring-2026",
            code: "AS.220.105",
            title: "Introduction to Poetry",
            description: "Poetry fundamentals",
            sisOfferingName: "AS.220.105",
            term: "Spring 2026",
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" />);

    await user.type(screen.getByTestId("chat-input"), "add intro to poetry to my schedule");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("I found multiple candidate courses. Please choose one.")).toBeInTheDocument();
    });
  });
});
