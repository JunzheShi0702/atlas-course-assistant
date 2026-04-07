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
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

function delayedSseResponse(
  immediateChunks: string[],
  delayedChunks: string[],
  delayMs: number,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of immediateChunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        setTimeout(() => {
          for (const chunk of delayedChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        }, delayMs);
      },
    }),
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

  it("renders streamed progress states and incremental assistant output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      delayedSseResponse(
        [
          'event: status\ndata: {"stage":"loading_context"}\n\n',
          'event: status\ndata: {"stage":"generating_response"}\n\n',
          'event: text_chunk\ndata: {"text":"You can "}\n\n',
        ],
        [
          'event: text_chunk\ndata: {"text":"rebalance this schedule."}\n\n',
          'event: final\ndata: {"stage":"done","response":{"type":"text","message":"You can rebalance this schedule."}}\n\n',
        ],
        250,
      ),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" />);

    await user.type(screen.getByTestId("chat-input"), "Help me rebalance this");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-progress-label")).toHaveTextContent(/generating response/i);
    });

    await waitFor(() => {
      expect(screen.getByText("You can rebalance this schedule.")).toBeInTheDocument();
    });
  });
});
