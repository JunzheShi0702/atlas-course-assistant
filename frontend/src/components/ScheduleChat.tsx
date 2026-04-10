/**
 * ScheduleChat — schedule-aware chat panel (#121 / #124)
 *
 * Adapts the existing Atlas chat flow for a specific schedule page.
 * Sends { message, scheduleId } to POST /api/agent and renders responses
 * as user/assistant message bubbles — including full CourseCard components
 * for search results (matching the home page experience).
 *
 * Stop button (#124): AbortController.abort() cancels the in-flight fetch (client
 * only); loading clears, a "stopped" bubble is shown, and the textarea refocuses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Loader2, OctagonX, Square, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CourseCard from "@/components/CourseCard";
import { useSchedules } from "@/hooks/useSchedules";
import { apiUrl } from "@/lib/apiUrl";
import type { CourseCard as CourseCardType } from "@/store/atoms";
import { normalizeAgentApiPayload } from "@/lib/parseAgentPayload";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Course cards rendered below content for search-type responses */
  courseCards?: CourseCardType[];
  isError?: boolean;
  isStopped?: boolean;
}

interface AgentResponse {
  type: "text" | "search" | "summary" | "details" | "error";
  message?: string;
  error?: string;
  summaryText?: string;
  results?: Array<{
    courseId?: string;
    code?: string;
    title?: string;
    description?: string;
    sisOfferingName?: string;
    term?: string;
    matchExplanation?: string;
  }>;
  course?: { title?: string; offeringName?: string; instructors?: string[] };
  scheduleChanges?: {
    operation?: "add" | "drop" | "replace";
    added?: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
    removed?: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
    failed?: Array<{
      action: "add" | "drop";
      reasonCode: string;
      message: string;
      candidates?: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
    }>;
  };
}

function parseAgentResponse(data: AgentResponse): {
  content: string;
  courseCards?: CourseCardType[];
} {
  switch (data.type) {
    case "search": {
      if (!data.results?.length) {
        return {
          content:
            data.message ?? "No courses found for that query. Please try refining or expanding your search.",
        };
      }
      const cards: CourseCardType[] = data.results.slice(0, 5).map((r) => ({
        id: r.courseId ?? r.code ?? "",
        courseCode: r.code ?? "N/A",
        courseTitle: r.title ?? "",
        instructor: "TBD",
        description: r.description ?? "",
        matchReasoning: r.matchExplanation,
        sisOfferingName: r.sisOfferingName ?? r.code,
        term: r.term ?? "Spring 2026",
      }));
      return { content: data.message ?? "Here are some courses I found:", courseCards: cards };
    }
    case "text":
      return { content: data.message ?? "" };
    case "error":
      return { content: data.error ?? "Something went wrong." };
    case "summary":
      return { content: data.summaryText ?? data.message ?? "No summary available." };
    case "details": {
      if (data.course) {
        const { title, offeringName, instructors } = data.course;
        const parts = [title ?? offeringName];
        if (instructors?.length) parts.push(`Instructor: ${instructors.join(", ")}`);
        return { content: parts.filter(Boolean).join("\n") };
      }
      return { content: "No details found." };
    }
    default:
      return { content: data.message ?? "" };
  }
}

// ── Message bubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage;
  scheduleCourseIds: Set<string>;
  onAddToSchedule: (course: CourseCardType) => void;
  onRemoveFromSchedule: (course: CourseCardType) => void;
}

function MessageBubble({
  msg,
  scheduleCourseIds,
  onAddToSchedule,
  onRemoveFromSchedule,
}: MessageBubbleProps) {
  const isUser = msg.role === "user";

  const bubbleClass = isUser
    ? "rounded-tr-sm bg-primary text-primary-foreground"
    : msg.isError
      ? "rounded-tl-sm bg-destructive/10 text-destructive border border-destructive/20"
      : msg.isStopped
        ? "rounded-tl-sm bg-muted/60 text-muted-foreground border border-border italic"
        : "rounded-tl-sm bg-muted text-foreground";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Content column */}
      <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"} max-w-[90%]`}>
        {/* Text bubble */}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${bubbleClass}`}
          data-testid={isUser ? "user-message" : msg.isStopped ? "stopped-message" : "assistant-message"}
        >
          {msg.isStopped && (
            <span className="inline-flex items-center gap-1 mr-1 not-italic">
              <OctagonX className="h-3 w-3" />
            </span>
          )}
          {msg.content}
        </div>

        {/* Course cards — only for assistant search results */}
        {!isUser && msg.courseCards && msg.courseCards.length > 0 && (
          <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-3" data-testid="chat-course-cards">
            {msg.courseCards.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onAddToSchedule={onAddToSchedule}
                onRemoveFromSchedule={onRemoveFromSchedule}
                isInSchedule={scheduleCourseIds.has(`${course.courseCode}|${course.sisOfferingName}|${course.term}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ScheduleChatProps {
  scheduleId: string;
  scheduleName?: string;
  /** Called after a course is added or removed via bookmark so the parent can refetch the schedule list. */
  onScheduleCoursesChanged?: () => void;
}

export default function ScheduleChat({
  scheduleId,
  scheduleName,
  onScheduleCoursesChanged,
}: ScheduleChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** IDs of courses already added to this schedule (for the bookmark toggle) */
  const [scheduleCourseIds, setScheduleCourseIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { addCourse, removeCourse, getSchedule } = useSchedules();

  // Hydrate scheduleCourseIds from the server so the bookmark toggle is correct
  // after a refresh or if the schedule was changed in another session.
  useEffect(() => {
    if (!scheduleId) return;
    getSchedule(scheduleId)
      .then((data) => {
        // Use composite key: courseCode + sisOfferingName + term (matches DB unique constraint)
        setScheduleCourseIds(new Set(data.courses.map((c) => `${c.courseCode}|${c.sisOfferingName}|${c.term}`)));
      })
      .catch(() => {/* silently ignore — UI degrades to optimistic-only */});
  }, [scheduleId, getSchedule]);

  // Auto-scroll on new messages / loading state
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const appendMessage = (msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    ]);
  };

  // ── Add / remove from schedule ──────────────────────────────────────────────

  const handleAddToSchedule = useCallback(
    async (course: CourseCardType) => {
      if (!course.sisOfferingName || !course.term) return;
      
      const courseKey = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
      
      // Prevent duplicate addition
      if (scheduleCourseIds.has(courseKey)) {
        return;
      }
      
      try {
        await addCourse(scheduleId, {
          courseCode: course.courseCode,
          sisOfferingName: course.sisOfferingName,
          term: course.term,
          courseTitle: course.courseTitle,
          credits: course.credits,
        });
        setScheduleCourseIds((prev) => new Set([...prev, courseKey]));
        onScheduleCoursesChanged?.();
      } catch (err) {
        console.error("Failed to add course to schedule:", err);
      }
    },
    [scheduleId, addCourse, onScheduleCoursesChanged, scheduleCourseIds],
  );

  const handleRemoveFromSchedule = useCallback(
    async (course: CourseCardType) => {
      if (!course.sisOfferingName || !course.term) return;
      
      const courseKey = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
      
      try {
        await removeCourse(scheduleId, {
          courseCode: course.courseCode,
          sisOfferingName: course.sisOfferingName,
          term: course.term,
        });
        setScheduleCourseIds((prev) => {
          const next = new Set(prev);
          next.delete(courseKey);
          return next;
        });
        onScheduleCoursesChanged?.();
      } catch (err) {
        console.error("Failed to remove course from schedule:", err);
      }
    },
    [scheduleId, removeCourse, onScheduleCoursesChanged],
  );

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    appendMessage({ role: "user", content: text });
    setLoading(true);

    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    const timeoutId = window.setTimeout(() => {
      abortRef.current?.abort();
    }, 120_000);

    try {
      const res = await fetch(apiUrl("/api/agent"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, scheduleId }),
        signal,
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) errMsg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }

      const raw = (await res.json()) as AgentResponse;
      const data = normalizeAgentApiPayload(raw);
      const { content, courseCards } = parseAgentResponse(data);
      appendMessage({ role: "assistant", content, courseCards });
      const added = data.scheduleChanges?.added ?? [];
      const removed = data.scheduleChanges?.removed ?? [];
      if (added.length > 0 || removed.length > 0) {
        setScheduleCourseIds((prev) => {
          const next = new Set(prev);
          for (const course of added) {
            next.add(`${course.courseCode}|${course.sisOfferingName}|${course.term}`);
          }
          for (const course of removed) {
            next.delete(`${course.courseCode}|${course.sisOfferingName}|${course.term}`);
          }
          return next;
        });
        onScheduleCoursesChanged?.();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        appendMessage({ role: "assistant", content: "Response stopped.", isStopped: true });
      } else {
        const msg = err instanceof Error ? err.message : "Request failed";
        setError(msg);
        appendMessage({ role: "assistant", content: msg, isError: true });
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      abortRef.current = null;
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [input, loading, scheduleId]);

  /**
   * Cancel the in-flight request at the network level.
   * AbortController.abort() rejects the fetch Promise with an AbortError,
   * which is caught above to render the "stopped" bubble and re-enable input.
   */
  const stopResponse = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
  }, []);

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === "Escape" && loading) {
      e.preventDefault();
      stopResponse();
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="schedule-chat">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-sm font-medium">Chat</p>
        <p className="text-xs text-muted-foreground">
          Ask about{" "}
          {scheduleName ? `your ${scheduleName} schedule` : "this schedule"} —
          workload, alternatives, planning
        </p>
      </div>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        data-testid="chat-message-list"
      >
        {messages.length === 0 && !loading && (
          <div
            className="flex flex-col items-center justify-center h-full gap-2 text-center py-12"
            data-testid="chat-empty-state"
          >
            <Bot className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">
              Ask about this schedule
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-48">
              Try: "Is this workload manageable?" or "Suggest lighter
              alternatives"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            scheduleCourseIds={scheduleCourseIds}
            onAddToSchedule={handleAddToSchedule}
            onRemoveFromSchedule={handleRemoveFromSchedule}
          />
        ))}

        {loading && (
          <div className="flex gap-2.5" data-testid="chat-loading">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && !loading && (
        <div className="shrink-0 mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about workload, alternatives, planning…"
            rows={1}
            disabled={loading}
            className="min-h-10 max-h-32 resize-none text-sm leading-relaxed py-2.5"
            data-testid="chat-input"
          />

          {loading ? (
            <Button
              size="icon"
              variant="outline"
              onClick={stopResponse}
              className="h-10 w-10 shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
              aria-label="Stop response"
              title="Stop response (Esc)"
              data-testid="stop-button"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim()}
              className="h-10 w-10 shrink-0"
              aria-label="Send message"
              data-testid="send-button"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
