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

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Bot, Loader2, OctagonX, Square, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CourseCard from "@/components/CourseCard";
import { useSchedules } from "@/hooks/useSchedules";
import { apiUrl } from "@/lib/apiUrl";
import { ensureCatalogCourseCode } from "@/lib/catalogCourseCode";
import type { CourseCard as CourseCardType } from "@/store/atoms";
import { normalizeAgentApiPayload } from "@/lib/parseAgentPayload";
import type { ChatHistoryMessage, ScheduleCourseItem } from "@/types/schedules";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Course cards rendered below content for search-type responses */
  courseCards?: CourseCardType[];
  isError?: boolean;
  isStopped?: boolean;
  isStreaming?: boolean;
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
    preferenceAlignment?: "aligned" | "mismatch";
    preferenceMismatchReasons?: Array<"days" | "time_window">;
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

type StreamStatusStage =
  | "loading_context"
  | "calling_tools"
  | "generating_response"
  | "done";

interface StreamEventMap {
  status: { stage: StreamStatusStage };
  text_chunk: { text?: string };
  final: { stage?: "done"; response: AgentResponse };
  error: { error?: string };
}

const STREAM_STAGE_LABELS: Record<Exclude<StreamStatusStage, "done">, string> = {
  loading_context: "Loading schedule context…",
  calling_tools: "Looking up course and schedule data…",
  generating_response: "Generating response…",
};

const STREAM_RENDER_INTERVAL_MS = 24;

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(<(?:b|strong)>(.*?)<\/(?:b|strong)>)|(<(?:i|em)>(.*?)<\/(?:i|em)>)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${match.index}`;
    if (match[2]) {
      nodes.push(
        <code key={key} className="rounded bg-background/60 px-1 py-0.5 text-[0.85em]">
          {match[2]}
        </code>,
      );
    } else if (match[4] || match[6] || match[12]) {
      nodes.push(<strong key={key}>{match[4] ?? match[6] ?? match[12]}</strong>);
    } else if (match[8] || match[10] || match[14]) {
      nodes.push(<em key={key}>{match[8] ?? match[10] ?? match[14]}</em>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderParagraphLines(lines: string[], keyPrefix: string): ReactNode[] {
  return lines.flatMap((line, index) => {
    const inline = renderInlineMarkdown(line, `${keyPrefix}-line-${index}`);
    return index === lines.length - 1 ? inline : [...inline, <br key={`${keyPrefix}-br-${index}`} />];
  });
}

function ChatMarkdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listKind: "ordered" | "unordered" | null = null;
  let listStart = 1;
  let nextOrderedValue = 1;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const blockIndex = blocks.length;
    blocks.push(
      <p key={`p-${blockIndex}`}>
        {renderParagraphLines(paragraph, `p-${blockIndex}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const blockIndex = blocks.length;
    const children = listItems.map((item, index) => (
      <li key={`li-${blockIndex}-${index}`}>
        {renderInlineMarkdown(item, `li-${blockIndex}-${index}`)}
      </li>
    ));

    blocks.push(
      listKind === "ordered" ? (
        <ol key={`ol-${blockIndex}`} start={listStart} className="list-decimal space-y-1 pl-5">
          {children}
        </ol>
      ) : (
        <ul key={`ul-${blockIndex}`} className="list-disc space-y-1 pl-5">
          {children}
        </ul>
      ),
    );
    listItems = [];
    listKind = null;
    listStart = 1;
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const blockIndex = blocks.length;
      const level = heading[1].length;
      const className = level === 1
        ? "text-base font-semibold"
        : level === 2
          ? "text-sm font-semibold"
          : "text-sm font-medium";
      blocks.push(
        <p key={`h-${blockIndex}`} className={className}>
          {renderInlineMarkdown(heading[2].replace(/#+\s*$/, ""), `h-${blockIndex}`)}
        </p>,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listKind === "ordered") flushList();
      listKind = "unordered";
      listItems.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (listKind === "unordered") flushList();
      const explicitValue = Number(numbered[1]);
      const displayValue = explicitValue === 1 && nextOrderedValue > 1
        ? nextOrderedValue
        : explicitValue;
      if (listKind !== "ordered") listStart = displayValue;
      listKind = "ordered";
      listItems.push(numbered[2]);
      nextOrderedValue = displayValue + 1;
      continue;
    }

    flushList();
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}

function splitChunkForDisplay(text: string): string[] {
  if (text.length <= 6) return [text];

  const parts = text.match(/(\S+\s*|\s+)/g);
  if (!parts || parts.length === 0) return [text];
  return parts;
}

function parseSseBlocks(chunk: string): Array<{ event: keyof StreamEventMap; data: string }> {
  return chunk
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      const event = eventLine?.slice("event:".length).trim() as keyof StreamEventMap | undefined;
      const data = dataLines
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      return event ? { event, data } : null;
    })
    .filter((value): value is { event: keyof StreamEventMap; data: string } => value !== null);
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
        courseCode: ensureCatalogCourseCode(r.code ?? "N/A", r.sisOfferingName),
        courseTitle: r.title ?? "",
        instructor: "TBD",
        description: r.description ?? "",
        matchReasoning: r.matchExplanation,
        preferenceAlignment: r.preferenceAlignment,
        preferenceMismatchReasons: r.preferenceMismatchReasons,
        sisOfferingName: r.sisOfferingName,
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

// ── History conversion ────────────────────────────────────────────────────────

/** Convert a persisted DB message into the local ChatMessage shape.
 *  For assistant messages the metadata column stores the full AgentResponse
 *  object, so parseAgentResponse can reconstruct content and courseCards. */
function historyMessageToChatMessage(m: ChatHistoryMessage & { role: "user" | "assistant" }): ChatMessage {
  const base = { id: m.id, role: m.role };
  if (m.role !== "assistant") return { ...base, content: m.content };
  if (m.metadata && typeof m.metadata === "object" && "type" in m.metadata) {
    const { content, courseCards } = parseAgentResponse(m.metadata as unknown as AgentResponse);
    return { ...base, content, courseCards };
  }
  return { ...base, content: m.content };
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
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? "whitespace-pre-wrap" : ""} ${bubbleClass}`}
          data-testid={isUser ? "user-message" : msg.isStopped ? "stopped-message" : "assistant-message"}
        >
          {msg.isStopped && (
            <span className="inline-flex items-center gap-1 mr-1 not-italic">
              <OctagonX className="h-3 w-3" />
            </span>
          )}
          {isUser ? msg.content : <ChatMarkdown content={msg.content} />}
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
  /** Controlled set of course keys in this schedule — owned by SchedulePage as single source of truth. */
  scheduleCourseIds: Set<string>;
  onScheduleCourseIdsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Called after a course is added or removed via bookmark so the parent can refetch the schedule list. */
  onScheduleCoursesChanged?: () => void;
}

export default function ScheduleChat({
  scheduleId,
  scheduleName,
  scheduleCourseIds,
  onScheduleCourseIdsChange,
  onScheduleCoursesChanged,
}: ScheduleChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<Exclude<StreamStatusStage, "done"> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingDisplayedTextRef = useRef("");
  const pendingTextChunksRef = useRef<string[]>([]);
  const renderTimerRef = useRef<number | null>(null);
  const displayDrainResolversRef = useRef<Array<() => void>>([]);
  const { addCourse, removeCourse, getSchedule, getChatHistory } = useSchedules();

  // Hydrate scheduleCourseIds from the server so the bookmark toggle is correct
  // after a refresh or if the schedule was changed in another session.
  useEffect(() => {
    // When parent schedule courses are provided, treat them as source of truth.
    if (scheduleCourses !== undefined) return;
    if (!scheduleId) return;
    let cancelled = false;
    getSchedule(scheduleId)
      .then((data) => {
        if (cancelled) return;
        // Use composite key: courseCode + sisOfferingName + term (matches DB unique constraint)
        setScheduleCourseIds(new Set(data.courses.map((c) => `${c.courseCode}|${c.sisOfferingName}|${c.term}`)));
      })
      .catch(() => {/* silently ignore — UI degrades to optimistic-only */});
    return () => {
      cancelled = true;
    };
  }, [scheduleId, getSchedule, scheduleCourses]);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setHistoryLoading(true);
    getChatHistory(scheduleId)
      .then(({ messages }) => {
        if (!active) return;
        const renderable = messages.filter(
          (m): m is ChatHistoryMessage & { role: "user" | "assistant" } =>
            m.role === "user" || m.role === "assistant",
        );
        // Only apply history if the user hasn't already sent a message while
        // the async fetch was in-flight — otherwise we'd wipe out their turn.
        setMessages((prev) => prev.length === 0 ? renderable.map(historyMessageToChatMessage) : prev);
      })
      .catch(() => { /* silently fall back to empty — don't block chat */ })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [scheduleId, getChatHistory]);


  useEffect(() => {
    if (scheduleCourses === undefined) return;
    setScheduleCourseIds(
      new Set(scheduleCourses.map((c) => `${c.courseCode}|${c.sisOfferingName}|${c.term}`)),
    );
  }, [scheduleCourses]);

  // Auto-scroll when there is content to scroll to. Running scrollIntoView on the
  // empty state can scroll the window and collapse flex/full-height layouts in some browsers.
  useEffect(() => {
    if (messages.length === 0 && !loading) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      if (renderTimerRef.current !== null) {
        window.clearInterval(renderTimerRef.current);
      }
    };
  }, []);

  const appendMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const updateMessage = useCallback((id: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? updater(msg) : msg)));
  }, []);

  const ensureStreamingAssistantMessage = useCallback(() => {
    if (streamingMessageIdRef.current) return streamingMessageIdRef.current;

    const id = appendMessage({
      role: "assistant",
      content: "",
      isStreaming: true,
    });
    streamingMessageIdRef.current = id;
    return id;
  }, [appendMessage]);

  const resetStreamingState = useCallback(() => {
    streamingMessageIdRef.current = null;
    streamingDisplayedTextRef.current = "";
    setProgressStage(null);
  }, []);

  const notifyDisplayDrained = useCallback(() => {
    if (pendingTextChunksRef.current.length > 0) return;
    const resolvers = displayDrainResolversRef.current;
    displayDrainResolversRef.current = [];
    resolvers.forEach((resolve) => resolve());
  }, []);

  const stopChunkRenderer = useCallback(() => {
    if (renderTimerRef.current !== null) {
      window.clearInterval(renderTimerRef.current);
      renderTimerRef.current = null;
    }
  }, []);

  const startChunkRenderer = useCallback(() => {
    if (renderTimerRef.current !== null) return;

    renderTimerRef.current = window.setInterval(() => {
      const messageId = streamingMessageIdRef.current;
      const nextChunk = pendingTextChunksRef.current.shift();

      if (!messageId || nextChunk == null) {
        if (pendingTextChunksRef.current.length === 0) {
          stopChunkRenderer();
        }
        return;
      }

      updateMessage(messageId, (msg) => ({
        ...msg,
        content: `${msg.content}${nextChunk}`,
        isStreaming: true,
      }));
      streamingDisplayedTextRef.current += nextChunk;

      if (pendingTextChunksRef.current.length === 0) {
        stopChunkRenderer();
        notifyDisplayDrained();
      }
    }, STREAM_RENDER_INTERVAL_MS);
  }, [notifyDisplayDrained, stopChunkRenderer, updateMessage]);

  const queueStreamText = useCallback((text: string) => {
    if (!text) return;
    pendingTextChunksRef.current.push(...splitChunkForDisplay(text));
    startChunkRenderer();
  }, [startChunkRenderer]);

  const waitForDisplayQueueToDrain = useCallback(() => {
    if (pendingTextChunksRef.current.length === 0 && renderTimerRef.current === null) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      displayDrainResolversRef.current.push(resolve);
    });
  }, []);

  const flushPendingTextChunks = useCallback(() => {
    const messageId = streamingMessageIdRef.current;
    if (!messageId || pendingTextChunksRef.current.length === 0) return;

    const remaining = pendingTextChunksRef.current.join("");
    pendingTextChunksRef.current = [];
    stopChunkRenderer();

    updateMessage(messageId, (msg) => ({
      ...msg,
      content: `${msg.content}${remaining}`,
      isStreaming: true,
    }));
    streamingDisplayedTextRef.current += remaining;
    notifyDisplayDrained();
  }, [notifyDisplayDrained, stopChunkRenderer, updateMessage]);

  const completeStreamingMessage = useCallback(async (finalResponse: AgentResponse) => {
    const data = normalizeAgentApiPayload(finalResponse);
    const { content, courseCards } = parseAgentResponse(data);
    const messageId = ensureStreamingAssistantMessage();
    const displayedText = streamingDisplayedTextRef.current;
    const queuedText = pendingTextChunksRef.current.join("");
    const projectedText = `${displayedText}${queuedText}`;

    let remainingText = "";
    if (content.startsWith(projectedText)) {
      remainingText = content.slice(projectedText.length);
    } else if (!projectedText.startsWith(content)) {
      pendingTextChunksRef.current = [];
      stopChunkRenderer();
      streamingDisplayedTextRef.current = "";
      updateMessage(messageId, (msg) => ({
        ...msg,
        content: "",
        isStreaming: true,
      }));
      remainingText = content;
    }

    if (remainingText) {
      queueStreamText(remainingText);
    }

    await waitForDisplayQueueToDrain();

    updateMessage(messageId, (msg) => ({
      ...msg,
      content,
      courseCards,
      isStreaming: false,
    }));
    const added = data.scheduleChanges?.added ?? [];
    const removed = data.scheduleChanges?.removed ?? [];
    if (added.length > 0 || removed.length > 0) {
      onScheduleCourseIdsChange((prev) => {
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
    resetStreamingState();
  }, [
    ensureStreamingAssistantMessage,
    onScheduleCoursesChanged,
    queueStreamText,
    resetStreamingState,
    onScheduleCourseIdsChange,
    stopChunkRenderer,
    updateMessage,
    waitForDisplayQueueToDrain,
  ]);

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
        onScheduleCourseIdsChange((prev) => new Set([...prev, courseKey]));
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
        onScheduleCourseIdsChange((prev) => {
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
    setProgressStage("loading_context");

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

      const contentType = res.headers?.get?.("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const raw = (await res.json()) as AgentResponse;
        const data = normalizeAgentApiPayload(raw);
        const { content, courseCards } = parseAgentResponse(data);
        appendMessage({ role: "assistant", content, courseCards });
        const added = data.scheduleChanges?.added ?? [];
        const removed = data.scheduleChanges?.removed ?? [];
        if (added.length > 0 || removed.length > 0) {
          onScheduleCourseIdsChange((prev) => {
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
        resetStreamingState();
        return;
      }

      const body = res.body;
      if (!body) {
        throw new Error("Streaming response body is unavailable.");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsedBlocks = parseSseBlocks(`${block}\n\n`);
          for (const event of parsedBlocks) {
            const payload = JSON.parse(event.data) as StreamEventMap[keyof StreamEventMap];

            if (event.event === "status") {
              const statusPayload = payload as StreamEventMap["status"];
              if (statusPayload.stage !== "done") {
                setProgressStage(statusPayload.stage);
              }
              continue;
            }

            if (event.event === "text_chunk") {
              const textPayload = payload as StreamEventMap["text_chunk"];
              ensureStreamingAssistantMessage();
              queueStreamText(textPayload.text ?? "");
              continue;
            }

            if (event.event === "final") {
              const finalPayload = payload as StreamEventMap["final"];
              setProgressStage("generating_response");
              await completeStreamingMessage(finalPayload.response);
              continue;
            }

            if (event.event === "error") {
              const errorPayload = payload as StreamEventMap["error"];
              throw new Error(errorPayload.error ?? "Streaming request failed");
            }
          }
        }
      }

      if (buffer.trim()) {
        const trailingBlocks = parseSseBlocks(buffer);
        for (const event of trailingBlocks) {
          if (event.event !== "final") continue;
          const finalPayload = JSON.parse(event.data) as StreamEventMap["final"];
          await completeStreamingMessage(finalPayload.response);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        flushPendingTextChunks();
        const streamingMessageId = streamingMessageIdRef.current;
        if (streamingMessageId) {
          updateMessage(streamingMessageId, (msg) => ({
            ...msg,
            content: msg.content || "Response stopped.",
            isStopped: true,
            isStreaming: false,
          }));
        } else {
          appendMessage({ role: "assistant", content: "Response stopped.", isStopped: true });
        }
      } else {
        const msg = err instanceof Error ? err.message : "Request failed";
        setError(msg);
        const streamingMessageId = streamingMessageIdRef.current;
        if (streamingMessageId) {
          updateMessage(streamingMessageId, (message) => ({
            ...message,
            content: msg,
            isError: true,
            isStreaming: false,
          }));
        } else {
          appendMessage({ role: "assistant", content: msg, isError: true });
        }
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      abortRef.current = null;
      pendingTextChunksRef.current = [];
      stopChunkRenderer();
      if (streamingMessageIdRef.current !== null) {
        resetStreamingState();
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [
    completeStreamingMessage,
    ensureStreamingAssistantMessage,
    flushPendingTextChunks,
    input,
    loading,
    queueStreamText,
    resetStreamingState,
    scheduleId,
    stopChunkRenderer,
    updateMessage,
  ]);

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

  const hasVisibleStreamingAssistantMessage = messages.some(
    (msg) => msg.role === "assistant" && msg.isStreaming && msg.content.trim() !== "",
  );

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
        {historyLoading && (
          <div className="flex items-center justify-center h-full" data-testid="chat-history-loading">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!historyLoading && messages.length === 0 && !loading && (
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

        {loading && !hasVisibleStreamingAssistantMessage && (
          <div className="flex gap-2.5" data-testid="chat-loading">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground" data-testid="chat-progress-label">
                {progressStage ? STREAM_STAGE_LABELS[progressStage] : "Generating response…"}
              </span>
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
