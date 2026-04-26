import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleChat from "./ScheduleChat";

const mockAddCourse = vi.fn();
const mockRemoveCourse = vi.fn();
const mockGetSchedule = vi.fn();
const mockGetChatHistory = vi.fn();

vi.mock("@/hooks/useSchedules", () => ({
  useSchedules: () => ({
    addCourse: mockAddCourse,
    removeCourse: mockRemoveCourse,
    getSchedule: mockGetSchedule,
    getChatHistory: mockGetChatHistory,
  }),
}));

vi.mock("@/components/CourseCard", () => ({
  default: ({
    course,
    onAddToSchedule,
    onRemoveFromSchedule,
    isInSchedule,
    selectionMode,
    onSelectOption,
    isTaken,
  }: {
    course: { courseTitle: string };
    onAddToSchedule: (course: { courseTitle: string }) => void;
    onRemoveFromSchedule: (course: { courseTitle: string }) => void;
    isInSchedule: boolean;
    selectionMode?: boolean;
    onSelectOption?: () => void;
    isTaken?: boolean;
  }) => (
    <div data-testid="mock-course-card">
      <span>{course.courseTitle}</span>
      {isTaken ? <span data-testid="mock-course-taken-label">Taken</span> : null}
      {selectionMode ? (
        <button onClick={onSelectOption}>Select</button>
      ) : (
        <>
          <button onClick={() => onAddToSchedule(course)} disabled={isInSchedule}>
            Add
          </button>
          <button onClick={() => onRemoveFromSchedule(course)}>Remove</button>
        </>
      )}
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

function immediateSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  } as Response;
}

describe("ScheduleChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mockGetSchedule.mockResolvedValue({ courses: [] });
    mockGetChatHistory.mockResolvedValue({ rollingSummary: "", messages: [] });
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
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

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
  }, 15000);

  it("renders redaction footnote in smaller muted text", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "The instructor is clear and organized.",
        redactionNote: "Note: 1 source sentence was redacted due to inappropriate content.",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "How is this professor?");
    await user.click(screen.getByTestId("send-button"));

    expect(await screen.findByText("The instructor is clear and organized.")).toBeInTheDocument();
    const note = await screen.findByText(/source sentence was redacted/i);
    expect(note).toBeInTheDocument();
    expect(note.className).toContain("text-[11px]");
    expect(note.className).toContain("text-muted-foreground/70");
  });

  it("shows a custom-event hint in the chat UI", async () => {
    render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleName="Main Plan"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("chat-custom-event-tip")).toHaveTextContent("add a lab event Monday 3pm - 6pm");
    expect(screen.getByPlaceholderText(/add a lab event monday 3pm - 6pm/i)).toBeInTheDocument();
  });

  it("renders cross-term metrics responses in chat", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "Across all terms, EN.601.226 has workload 3.40, difficulty 3.90, overall quality 4.20 (72 respondents).",
      }),
    );

    const user = userEvent.setup();
    render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleName="Main Plan"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "How hard is EN.601.226 overall?");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText(/Across all terms/i)).toBeInTheDocument();
      expect(screen.getByText(/72 respondents/i)).toBeInTheDocument();
    });
  });

  it("renders term-specific metrics responses in chat", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "For Spring 2026, EN.601.226 has workload 3.25, difficulty 3.75, overall quality 4.10 (40 respondents).",
      }),
    );

    const user = userEvent.setup();
    render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleName="Main Plan"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "How hard is EN.601.226 in Spring 2026?");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText(/For Spring 2026/i)).toBeInTheDocument();
      expect(screen.getByText(/40 respondents/i)).toBeInTheDocument();
    });
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
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} onScheduleCoursesChanged={onScheduleCoursesChanged} />);

    await user.type(screen.getByTestId("chat-input"), "swap EN.601.226 with EN.520.433");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("Updated your schedule.")).toBeInTheDocument();
    });
    expect(onScheduleCoursesChanged).toHaveBeenCalledTimes(1);
  });

  it("refreshes schedule when the agent requests a schedule refresh without course diffs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "Added your gym block.",
        scheduleRefreshRequired: true,
      }),
    );

    const onScheduleCoursesChanged = vi.fn();
    const onScheduleCourseIdsChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={onScheduleCourseIdsChange}
        onScheduleCoursesChanged={onScheduleCoursesChanged}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "add gym on Tuesday from 18:00 to 19:00");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("Added your gym block.")).toBeInTheDocument();
    });
    expect(onScheduleCoursesChanged).toHaveBeenCalledTimes(1);
    expect(onScheduleCourseIdsChange).not.toHaveBeenCalled();
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
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
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
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      }),
    );
    expect(onScheduleCoursesChanged).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockRemoveCourse).toHaveBeenCalledWith(
      "sched-1",
      expect.objectContaining({
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      }),
    );
  });

  it("renders assistant markdown without showing raw emphasis markers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "Focus on **Data Structures** and *time management*.\n\n- **Review workload:** compare evals\n- <b>Use office hours</b>",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Any advice?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    expect(assistantMessage).toHaveTextContent("Data Structures");
    expect(assistantMessage).toHaveTextContent("time management");
    expect(assistantMessage).toHaveTextContent("Review workload:");
    expect(assistantMessage).toHaveTextContent("Use office hours");
    expect(assistantMessage.textContent).not.toContain("**");
    expect(assistantMessage.textContent).not.toContain("<b>");
    expect(assistantMessage.querySelector("strong")).toHaveTextContent("Data Structures");
    expect(assistantMessage.querySelector("em")).toHaveTextContent("time management");
    expect(assistantMessage.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders assistant headings and numbered lists without raw markdown prefixes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "### Alignment with Career Goals:\n\n1. Data Structures\n2. Databases\n\n### Conclusion:\n\nThis schedule fits well.",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Does this align?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    expect(assistantMessage).toHaveTextContent("Alignment with Career Goals:");
    expect(assistantMessage).toHaveTextContent("Conclusion:");
    expect(assistantMessage.textContent).not.toContain("###");
    expect(assistantMessage.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("splits heading inline dash metrics into bullet list items", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "### Professor David Hovemeyer Overview - Overall Rating: 4.2 - Difficulty: 3.4",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "how is prof hovemeyer?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    expect(assistantMessage).toHaveTextContent("Professor David Hovemeyer Overview");
    expect(assistantMessage.textContent).not.toContain("Overview - Overall Rating:");
    const listItems = assistantMessage.querySelectorAll("ul li");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("Overall Rating: 4.2");
    expect(listItems[1]).toHaveTextContent("Difficulty: 3.4");
  });

  it("renders headings when model omits space after ###", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message: "###Professor David Hovemeyer Overview\n\nHelpful and organized.",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "how is prof hovemeyer?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    expect(assistantMessage).toHaveTextContent("Professor David Hovemeyer Overview");
    expect(assistantMessage.textContent).not.toContain("###Professor");
  });

  it("promotes list-prefixed headings into proper headings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "- ### Relevant Comments\n- \"Great professor! Very caring and knowledgeable.\" (Rating: 5, CS, 2024)",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "how is prof hovemeyer?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    expect(assistantMessage).toHaveTextContent("Relevant Comments");
    expect(assistantMessage.textContent).not.toContain("- ### Relevant Comments");
    const headingNode = assistantMessage.querySelector("h3.text-sm.font-medium");
    expect(headingNode).toBeTruthy();
  });

  it("renders markdown links as anchors inside list items", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "- [CSF Feedback](https://www.reddit.com/r/jhu/comments/itm3qk/csf/) - Hovemeyer is praised for answering questions effectively.\n- [Automata Thread](https://www.reddit.com/r/jhu/comments/example/automata/)",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "How is Hovemeyer?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    const links = assistantMessage.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("CSF Feedback");
    expect(links[0]).toHaveAttribute("href", "https://www.reddit.com/r/jhu/comments/itm3qk/csf/");
    expect(assistantMessage.textContent).not.toContain("[CSF Feedback](");
  });

  it("normalizes malformed bullets and dangling emphasis markers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "-First item with stray marker *\n-Second item with **dangling bold** and trailing **\n1.First numbered",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "format this");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    const unorderedItems = assistantMessage.querySelectorAll("ul li");
    expect(unorderedItems).toHaveLength(2);
    expect(unorderedItems[0]).toHaveTextContent("First item with stray marker");
    expect(assistantMessage.textContent).not.toContain("-First item");
    expect(assistantMessage.textContent).not.toContain(" trailing **");
    expect(assistantMessage.querySelectorAll("ol li")).toHaveLength(1);
  });

  it("does not italicize malformed dash-wrapped emphasis segments", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "- *Automata Theory or Compilers*\n- *- Students discuss which course to take while mentioning Hovemeyer's teaching style. -*",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "how is prof. hovemeyer?");
    await user.click(screen.getByTestId("send-button"));

    const assistantMessage = await screen.findByTestId("assistant-message");
    const emNodes = assistantMessage.querySelectorAll("em");
    expect(emNodes).toHaveLength(1);
    expect(emNodes[0]).toHaveTextContent("Automata Theory or Compilers");
    expect(assistantMessage).toHaveTextContent(
      "- Students discuss which course to take while mentioning Hovemeyer's teaching style. -",
    );
  });

  it("continues numbering when ordered items are separated by detail bullets", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "text",
        message:
          "1. **Introduction to Data Analysis**\n- Offering: AS.110.125\n\n1. **Numbers, Not Noise**\n- Offering: AS.110.131\n\n1. **Mathematics of Data Science**\n- Offering: AS.110.205",
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Show courses");
    await user.click(screen.getByTestId("send-button"));

    const orderedLists = (await screen.findByTestId("assistant-message")).querySelectorAll("ol");
    expect(orderedLists).toHaveLength(3);
    expect(orderedLists[0].getAttribute("start")).toBe("1");
    expect(orderedLists[1].getAttribute("start")).toBe("2");
    expect(orderedLists[2].getAttribute("start")).toBe("3");
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
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Help me rebalance this");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-progress-label")).toHaveTextContent(/generating response/i);
    });

    await waitFor(() => {
      expect(screen.getByText("You can rebalance this schedule.")).toBeInTheDocument();
    });
  });

  it("does not dump a large final response before queued chunks render", async () => {
    const fullResponse = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.";
    vi.mocked(fetch).mockResolvedValueOnce(
      immediateSseResponse([
        'event: status\ndata: {"stage":"loading_context"}\n\n',
        'event: status\ndata: {"stage":"generating_response"}\n\n',
        `event: text_chunk\ndata: ${JSON.stringify({ text: fullResponse })}\n\n`,
        `event: final\ndata: ${JSON.stringify({ stage: "done", response: { type: "text", message: fullResponse } })}\n\n`,
      ]),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Stream this slowly");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      const text = screen.getByTestId("assistant-message").textContent ?? "";
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(fullResponse);
    });
    expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("assistant-message")).toHaveTextContent(fullResponse);
    });
  });

  it("does not duplicate queued text when final arrives before display catches up", async () => {
    const fullResponse =
      "Your current schedule includes Data Structures, Databases, and Intro Algorithms. This schedule aligns well with your goals.";
    vi.mocked(fetch).mockResolvedValueOnce(
      immediateSseResponse([
        'event: status\ndata: {"stage":"generating_response"}\n\n',
        `event: text_chunk\ndata: ${JSON.stringify({ text: fullResponse })}\n\n`,
        `event: final\ndata: ${JSON.stringify({ stage: "done", response: { type: "text", message: fullResponse } })}\n\n`,
      ]),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleName="Main Plan" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "Give me details");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-message")).toHaveTextContent(fullResponse);
    });
    const renderedText = screen.getByTestId("assistant-message").textContent ?? "";
    expect(renderedText.match(/Your current schedule/g)).toHaveLength(1);
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
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "add intro to poetry to my schedule");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("I found multiple candidate courses. Please choose one.")).toBeInTheDocument();
    });
  });

  it("uses backend-provided message for empty search results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        type: "search",
        message: "No exact matches for those constraints.",
        results: [],
      }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "find impossible combo");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("No exact matches for those constraints.")).toBeInTheDocument();
    });
  });

  it("supports multi-select clarification submissions for add disambiguation", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          type: "clarification",
          question: "Which courses should I add?",
          slotKey: "addTarget",
          options: [
            {
              id: "1",
              label: "Data Structures",
              courseCode: "EN.601.226",
              sisOfferingName: "EN.601.226",
              term: "Spring 2026",
            },
            {
              id: "2",
              label: "Computer Systems Fundamentals",
              courseCode: "EN.601.229",
              sisOfferingName: "EN.601.229",
              term: "Spring 2026",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          type: "text",
          message: "Added 2 courses.",
        }),
      );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await user.type(screen.getByTestId("chat-input"), "add multiple classes");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("Which courses should I add?")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm selected (0)" })).toBeInTheDocument();
    });

    const selectButtons = screen.getAllByRole("button", { name: "Select" });
    await user.click(selectButtons[0]);
    await user.click(selectButtons[1]);
    await user.click(screen.getByRole("button", { name: "Confirm selected (2)" }));

    await waitFor(() => {
      expect(screen.getByText("Added 2 courses.")).toBeInTheDocument();
    });

    const secondCall = vi.mocked(fetch).mock.calls[1];
    const secondRequestBody = JSON.parse(String(secondCall?.[1]?.body));
    expect(secondRequestBody.clarificationSelection.slotKey).toBe("addTarget");
    expect(Array.isArray(secondRequestBody.clarificationSelection.choices)).toBe(true);
    expect(secondRequestBody.clarificationSelection.choices).toHaveLength(2);
  });

  it("updates chat course-card added state when parent scheduleCourseIds prop changes", async () => {
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

    const user = userEvent.setup();
    const { rerender } = render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleCourseIds={new Set(["EN.601.226|EN.601.226|Spring 2026"])}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "show me data structures");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-course-card")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    rerender(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    });
  });

  it("marks course cards as taken when course history contains the course code", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          type: "search",
          results: [
            {
              courseId: "as-110-304-spring-2026",
              code: "110.304",
              title: "Elementary Number Theory",
              description: "Number theory fundamentals",
              sisOfferingName: "AS.110.304",
              term: "Spring 2026",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          memories: [
            {
              id: "m1",
              text: "AS.110.304",
              type: "course_history",
              source: "manual",
              confidence: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );

    const user = userEvent.setup();
    render(
      <ScheduleChat
        scheduleId="sched-1"
        scheduleCourseIds={new Set()}
        onScheduleCourseIdsChange={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("chat-input"), "show me number theory");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-course-card")).toBeInTheDocument();
      expect(screen.getByTestId("mock-course-taken-label")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Chat history loading (Issue #198)
// ---------------------------------------------------------------------------

describe("ScheduleChat — history loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mockGetSchedule.mockResolvedValue({ courses: [] });
    mockGetChatHistory.mockResolvedValue({ rollingSummary: "", messages: [] });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows empty state when history is empty", async () => {
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-empty-state")).toBeInTheDocument();
    });
  });

  it("renders prior messages in chronological order", async () => {
    mockGetChatHistory.mockResolvedValueOnce({
      rollingSummary: "",
      messages: [
        { id: "m1", role: "user",      content: "first question", responseType: null, metadata: {}, createdAt: "" },
        { id: "m2", role: "assistant", content: "first answer",   responseType: "text", metadata: { type: "text", message: "first answer" }, createdAt: "" },
      ],
    });

    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("first question")).toBeInTheDocument();
      expect(screen.getByText("first answer")).toBeInTheDocument();
    });

    const userMsgs = screen.getAllByTestId("user-message");
    const asstMsgs = screen.getAllByTestId("assistant-message");
    expect(userMsgs).toHaveLength(1);
    expect(asstMsgs).toHaveLength(1);
  });

  it("reconstructs course cards for search-type assistant messages", async () => {
    mockGetChatHistory.mockResolvedValueOnce({
      rollingSummary: "",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: JSON.stringify({ type: "search", results: [{ courseId: "en-601-226-spring-2026", code: "601.226", title: "Data Structures", description: "", sisOfferingName: "EN.601.226", term: "Spring 2026" }] }),
          responseType: "search",
          metadata: { type: "search", results: [{ courseId: "en-601-226-spring-2026", code: "601.226", title: "Data Structures", description: "", sisOfferingName: "EN.601.226", term: "Spring 2026" }] },
          createdAt: "",
        },
      ],
    });

    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("mock-course-card")).toBeInTheDocument();
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });
  });

  it("falls back to empty state when history load fails", async () => {
    mockGetChatHistory.mockRejectedValueOnce(new Error("network error"));

    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-empty-state")).toBeInTheDocument();
    });
  });

  it("appends new message after loaded history", async () => {
    mockGetChatHistory.mockResolvedValueOnce({
      rollingSummary: "",
      messages: [
        { id: "m1", role: "user", content: "prior question", responseType: null, metadata: {}, createdAt: "" },
      ],
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ type: "text", message: "new answer" }),
    );

    const user = userEvent.setup();
    render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("prior question")).toBeInTheDocument();
    });

    await user.type(screen.getByTestId("chat-input"), "follow-up");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByText("new answer")).toBeInTheDocument();
    });

    // Both prior and new messages visible
    expect(screen.getByText("prior question")).toBeInTheDocument();
  });

  it("clears old schedule messages and loads new history when scheduleId changes", async () => {
    mockGetChatHistory.mockResolvedValueOnce({
      rollingSummary: "",
      messages: [
        { id: "m1", role: "user", content: "schedule one message", responseType: null, metadata: {}, createdAt: "" },
      ],
    });
    mockGetChatHistory.mockResolvedValueOnce({
      rollingSummary: "",
      messages: [
        { id: "m2", role: "user", content: "schedule two message", responseType: null, metadata: {}, createdAt: "" },
      ],
    });

    const { rerender } = render(<ScheduleChat scheduleId="sched-1" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("schedule one message")).toBeInTheDocument();
    });

    rerender(<ScheduleChat scheduleId="sched-2" scheduleCourseIds={new Set()} onScheduleCourseIdsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("schedule two message")).toBeInTheDocument();
      expect(screen.queryByText("schedule one message")).not.toBeInTheDocument();
    });
  });
});
