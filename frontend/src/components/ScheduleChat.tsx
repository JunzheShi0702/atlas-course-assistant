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
import { ArrowUp, Bot, ChevronDown, ExternalLink, Loader2, OctagonX, Square, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CourseCard from "@/components/CourseCard";
import { useSchedules } from "@/hooks/useSchedules";
import { apiUrl } from "@/lib/apiUrl";
import { ensureCatalogCourseCode } from "@/lib/catalogCourseCode";
import { resolveCourseId } from "@/lib/courseId";
import { useAtomValue } from "jotai";
import { currentUserAtom, type CourseCard as CourseCardType } from "@/store/atoms";
import { normalizeAgentApiPayload } from "@/lib/parseAgentPayload";
import type { ChatHistoryMessage } from "@/types/schedules";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Course cards rendered below content for search-type responses */
  courseCards?: CourseCardType[];
  clarification?: {
    slotKey?: string;
    options: ClarificationOption[];
  };
  /** Source buttons rendered below text responses (Reddit threads, RMP profile) */
  sources?: Array<{ label: string; url: string; year?: number }>;
  redactionNote?: string;
  isError?: boolean;
  isStopped?: boolean;
  isStreaming?: boolean;
}

type ClarificationOption = {
      id?: string;
      courseId?: string;
      label: string;
      value?: string;
      description?: string;
      courseCode?: string;
      code?: string;
      title?: string;
      sisOfferingName?: string;
      term?: string;
};

interface AgentResponse {
  type: "text" | "search" | "summary" | "details" | "clarification" | "error";
  message?: string;
  error?: string;
  summaryText?: string;
  question?: string;
  slotKey?: string;
  options?: Array<{
    id?: string;
    courseId?: string;
    label?: string;
    value?: string;
    description?: string;
    courseCode?: string;
    code?: string;
    title?: string;
    sisOfferingName?: string;
    term?: string;
  }>;
  results?: Array<{
    courseId?: string;
    code?: string;
    title?: string;
    description?: string;
    sisOfferingName?: string;
    term?: string;
    credits?: number;
    matchType?: "exact" | "constraint" | "semantic" | "hybrid";
    constraintAlignment?: "aligned" | "mismatch" | "unknown";
    constraintMismatchReasons?: Array<
      | "days"
      | "time_window"
      | "school"
      | "level"
      | "department"
      | "credits"
      | "writing_intensive"
      | "course_number"
      | "instructor"
    >;
    matchExplanation?: string;
    preferenceAlignment?: "aligned" | "mismatch";
    preferenceMismatchReasons?: Array<"days" | "time_window">;
  }>;
  sources?: Array<{ label: string; url: string; year?: number }>;
  redactionNote?: string;
  course?: {
    title?: string;
    offeringName?: string;
    instructors?: string[];
    daysOfWeek?: string;
    timeOfDay?: string;
    location?: string;
    status?: string;
    prerequisites?: string;
  };
  /** Multiple distinct offerings (parallel getSisCourseDetails), e.g. IFP part I vs part II */
  courses?: Array<NonNullable<AgentResponse["course"]>>;
  scheduleChanges?: {
    operation?: "add" | "drop" | "replace";
    added?: Array<{
      courseCode: string;
      sisOfferingName: string;
      term: string;
      courseTitle?: string;
      credits?: number;
    }>;
    removed?: Array<{
      courseCode: string;
      sisOfferingName: string;
      term: string;
      courseTitle?: string;
      credits?: number;
    }>;
    failed?: Array<{
      action: "add" | "drop";
      reasonCode: string;
      message: string;
      candidates?: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
    }>;
  };
  scheduleRefreshRequired?: boolean;
}

type StreamStatusStage =
  | "loading_context"
  | "calling_tools"
  | "generating_response"
  | "validating_response"
  | "repairing_response"
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
  validating_response: "Validating response…",
  repairing_response: "Repairing response format…",
};

const STREAM_RENDER_INTERVAL_MS = 24;

function normalizeCourseCode(value: string, sisOfferingName?: string): string {
  return ensureCatalogCourseCode(value, sisOfferingName).trim().toUpperCase();
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  const nodes: ReactNode[] = [];
  let linkLastIndex = 0;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkPattern.exec(text)) !== null) {
    if (linkMatch.index > linkLastIndex) {
      nodes.push(...renderInlineMarkdownWithoutLinks(text.slice(linkLastIndex, linkMatch.index), `${keyPrefix}-seg-${linkLastIndex}`));
    }
    const href = linkMatch[2];
    const label = linkMatch[1];
    nodes.push(
      <a
        key={`${keyPrefix}-link-${linkMatch.index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:no-underline"
      >
        {label}
      </a>,
    );
    linkLastIndex = linkPattern.lastIndex;
  }

  if (linkLastIndex < text.length) {
    nodes.push(...renderInlineMarkdownWithoutLinks(text.slice(linkLastIndex), `${keyPrefix}-seg-tail`));
  }

  return nodes;
}

function renderInlineMarkdownWithoutLinks(text: string, keyPrefix: string): ReactNode[] {
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
      const emphasisText = match[8] ?? match[10] ?? match[14];
      const trimmed = emphasisText.trim();
      // Guard against malformed model output like "*- ... -*" which should be plain text, not italic.
      if (/^-[\s\S]*-$/.test(trimmed)) {
        nodes.push(emphasisText);
      } else {
        nodes.push(<em key={key}>{emphasisText}</em>);
      }
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
  const normalizedContent = content
    // When models emit headings inline after list prose ("... - ### Heading"),
    // split them onto their own line so heading parsing can run.
    .replace(/([^\n])\s*-\s*(#{1,3}\s*[^\n]+)/g, "$1\n$2")
    // Also support inline heading markers written as "... ### Heading" / "... # Heading".
    .replace(/([^\n])\s+\.\.\.\s+(#{1,3}\s*[^\n]+)/g, "$1\n$2");
  const lines = normalizedContent.split(/\r?\n/);
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

  const normalizeMarkdownLine = (line: string): string => {
    let normalized = line.replace(/\\([*_`[\]-])/g, "$1");
    normalized = normalized.replace(/^(\s{0,3}#{1,3})(?=\S)/, "$1 ");
    // Promote malformed heading bullets like "- ### Relevant ..." back to headings.
    normalized = normalized.replace(/^\s*[-*]\s+(#{1,3}\s*\S.*)$/, "$1");
    normalized = normalized.replace(/^(\s*[-*])(?=\S)/, "$1 ");
    normalized = normalized.replace(/^(\s*\d+\.)(?=\S)/, "$1 ");
    // Remove trailing dangling emphasis tokens without touching valid markdown pairs.
    normalized = normalized.replace(/\s\*+\s*$/g, "");
    return normalized;
  };

  const pushHeading = (marker: string, body: string) => {
    const blockIndex = blocks.length;
    const level = marker.length;
    const className = level === 1
      ? "text-base font-semibold"
      : level === 2
        ? "text-sm font-semibold"
        : "text-sm font-medium";
    const headingText = body
      .replace(/^#+\s*/, "")
      .replace(/#+\s*$/, "")
      .trim();
    const headingParts = headingText
      .split(/\s+-\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const canSplitIntoList = headingParts.length > 1 && headingParts.slice(1).every((part) => part.includes(":"));
    const headingContent = renderInlineMarkdown(
      canSplitIntoList ? headingParts[0] : headingText,
      `h-${blockIndex}`,
    );
    if (level === 1) {
      blocks.push(<h1 key={`h-${blockIndex}`} className={className}>{headingContent}</h1>);
    } else if (level === 2) {
      blocks.push(<h2 key={`h-${blockIndex}`} className={className}>{headingContent}</h2>);
    } else {
      blocks.push(<h3 key={`h-${blockIndex}`} className={className}>{headingContent}</h3>);
    }
    if (canSplitIntoList) {
      const listBlockIndex = blocks.length;
      blocks.push(
        <ul key={`h-list-${listBlockIndex}`} className="list-disc space-y-1 pl-5">
          {headingParts.slice(1).map((item, index) => (
            <li key={`h-list-${listBlockIndex}-${index}`}>
              {renderInlineMarkdown(item, `h-list-${listBlockIndex}-${index}`)}
            </li>
          ))}
        </ul>,
      );
    }
  };

  for (const line of lines) {
    const normalizedLine = normalizeMarkdownLine(line);
    if (!/^\s{0,3}#{1,3}\s+/.test(normalizedLine)) {
      const inlineHeading = normalizedLine.match(/^(.*?)(#{1,3}\s+.+)$/);
      if (inlineHeading) {
        const prefix = inlineHeading[1].replace(/[-.\s]+$/, "").trim();
        const headingPart = inlineHeading[2];
        if (prefix) {
          const prefixBullet = prefix.match(/^\s*[-*]\s+(.+)$/);
          if (prefixBullet) {
            flushParagraph();
            if (listKind === "ordered") flushList();
            listKind = "unordered";
            listItems.push(prefixBullet[1]);
            flushList();
          } else {
            flushList();
            paragraph.push(prefix);
          }
        }
        const parsedHeading = headingPart.match(/^(#{1,3})\s+(.+)$/);
        if (parsedHeading) {
          flushParagraph();
          flushList();
          pushHeading(parsedHeading[1], parsedHeading[2]);
          continue;
        }
      }
    }
    const heading = normalizedLine.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      pushHeading(heading[1], heading[2]);
      continue;
    }

    const bullet = normalizedLine.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const embeddedHeading = bullet[1].match(/^(.*?)(#{1,3})\s+(.+)$/);
      if (embeddedHeading) {
        flushParagraph();
        if (listKind === "ordered") flushList();
        listKind = "unordered";
        const beforeHeading = embeddedHeading[1].replace(/[-.\s]+$/, "").trim();
        if (beforeHeading) {
          listItems.push(beforeHeading);
        }
        flushList();
        pushHeading(embeddedHeading[2], embeddedHeading[3]);
        continue;
      }
      flushParagraph();
      if (listKind === "ordered") flushList();
      listKind = "unordered";
      listItems.push(bullet[1]);
      continue;
    }

    const numbered = normalizedLine.match(/^\s*(\d+)\.\s+(.+)$/);
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
    if (normalizedLine.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(normalizedLine);
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

function buildCourseCardsFromScheduleAdded(
  added: Array<{
    courseCode: string;
    sisOfferingName: string;
    term: string;
    courseTitle?: string;
    credits?: number;
  }>,
): CourseCardType[] {
  return added.map((row, index) => {
    const courseCode = ensureCatalogCourseCode(row.courseCode, row.sisOfferingName);
    const id =
      resolveCourseId({
        sisOfferingName: row.sisOfferingName,
        term: row.term,
      }) ?? `schedule-added-${courseCode}-${row.term}-${index}`;
    return {
      id,
      courseCode,
      courseTitle: row.courseTitle?.trim() ?? "",
      instructor: "TBD",
      description: "",
      sisOfferingName: row.sisOfferingName,
      term: row.term,
      ...(typeof row.credits === "number" && Number.isFinite(row.credits) ? { credits: row.credits } : {}),
    };
  });
}

/** When the backend applies schedule edits, replace verbose copy with a short acknowledgement and show added rows as search-style course cards. */
function mergeScheduleChangePresentation(
  data: AgentResponse,
  parsed: {
    content: string;
    courseCards?: CourseCardType[];
    clarification?: ChatMessage["clarification"];
    sources?: Array<{ label: string; url: string; year?: number }>;
    redactionNote?: string;
  },
): typeof parsed {
  const added = data.scheduleChanges?.added ?? [];
  const removed = data.scheduleChanges?.removed ?? [];
  const failed = data.scheduleChanges?.failed ?? [];

  if (added.length === 0 && removed.length === 0) {
    return parsed;
  }

  const segments: string[] = [];
  if (added.length > 0) {
    const codes = added.map((r) => ensureCatalogCourseCode(r.courseCode, r.sisOfferingName));
    segments.push(
      codes.length === 1
        ? `Added ${codes[0]} to your schedule.`
        : `Added ${codes.length} courses to your schedule: ${codes.join(", ")}.`,
    );
  }
  if (removed.length > 0) {
    const codes = removed.map((r) => ensureCatalogCourseCode(r.courseCode, r.sisOfferingName));
    segments.push(
      codes.length === 1
        ? `Removed ${codes[0]} from your schedule.`
        : `Removed ${codes.length} courses from your schedule: ${codes.join(", ")}.`,
    );
  }

  let content = segments.join(" ");
  if (failed.length > 0) {
    const failText = failed
      .map((f) => (typeof f.message === "string" ? f.message.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (failText) {
      content = `${content} ${failText}`;
    }
  }

  return {
    ...parsed,
    content,
    courseCards: added.length > 0 ? buildCourseCardsFromScheduleAdded(added) : undefined,
  };
}

function parseAgentResponseCore(data: AgentResponse): {
  content: string;
  courseCards?: CourseCardType[];
  clarification?: ChatMessage["clarification"];
  sources?: Array<{ label: string; url: string; year?: number }>;
  redactionNote?: string;
} {
  switch (data.type) {
    case "search": {
      if (!data.results?.length) {
        return {
          content:
            data.message ?? "No courses found for that query. Please try refining or expanding your search.",
          sources: data.sources,
          redactionNote: data.redactionNote,
        };
      }
      const cards: CourseCardType[] = data.results.slice(0, 5).map((r, index) => ({
        id:
          resolveCourseId({
            courseId: r.courseId,
            sisOfferingName: r.sisOfferingName,
            term: r.term,
          }) ?? r.code ?? `row-${index}`,
        courseCode: ensureCatalogCourseCode(r.code ?? "N/A", r.sisOfferingName),
        courseTitle: r.title ?? "",
        instructor: "TBD",
        description: r.description ?? "",
        matchType: r.matchType,
        constraintAlignment: r.constraintAlignment,
        constraintMismatchReasons: r.constraintMismatchReasons,
        matchReasoning: r.matchExplanation,
        preferenceAlignment: r.preferenceAlignment,
        preferenceMismatchReasons: r.preferenceMismatchReasons,
        sisOfferingName: r.sisOfferingName,
        term: r.term ?? "Spring 2026",
        ...(typeof r.credits === "number" && Number.isFinite(r.credits) ? { credits: r.credits } : {}),
      }));
      return { content: data.message ?? "Here are some courses I found:", courseCards: cards, sources: data.sources, redactionNote: data.redactionNote };
    }
    case "text": {
      if (data.results?.length) {
        const cards: CourseCardType[] = data.results.slice(0, 5).map((r, index) => ({
          id:
            resolveCourseId({
              courseId: r.courseId,
              sisOfferingName: r.sisOfferingName,
              term: r.term,
            }) ?? r.code ?? `row-${index}`,
          courseCode: ensureCatalogCourseCode(r.code ?? "N/A", r.sisOfferingName),
          courseTitle: r.title ?? "",
          instructor: "TBD",
          description: r.description ?? "",
          matchType: r.matchType,
          constraintAlignment: r.constraintAlignment,
          constraintMismatchReasons: r.constraintMismatchReasons,
          matchReasoning: r.matchExplanation,
          preferenceAlignment: r.preferenceAlignment,
          preferenceMismatchReasons: r.preferenceMismatchReasons,
          sisOfferingName: r.sisOfferingName,
          term: r.term ?? "Spring 2026",
        }));
        return { content: data.message ?? "", courseCards: cards, sources: data.sources, redactionNote: data.redactionNote };
      }
      return { content: data.message ?? "", sources: data.sources, redactionNote: data.redactionNote };
    }
    case "error":
      return { content: data.error ?? "Something went wrong." };
    case "summary":
      return {
        content: data.summaryText ?? data.message ?? "No summary available.",
        sources: data.sources,
        redactionNote: data.redactionNote,
      };
    case "details": {
      const rows: NonNullable<AgentResponse["course"]>[] =
        Array.isArray(data.courses) && data.courses.length > 0
          ? data.courses
          : data.course
            ? [data.course]
            : [];
      if (rows.length === 0) return { content: "No details found." };

      function formatOfferingRow(course: NonNullable<AgentResponse["course"]>): string {
        const { title, offeringName, instructors, daysOfWeek, timeOfDay, location, status, prerequisites } = course;
        const head =
          typeof title === "string" && title.trim() !== ""
            ? title.trim()
            : typeof offeringName === "string"
              ? offeringName.trim()
              : "";
        const parts =
          typeof offeringName === "string" && offeringName.trim() !== "" && offeringName.trim() !== head
            ? [head, offeringName.trim()]
            : [head];
        if (instructors?.length) parts.push(`Instructor: ${instructors.join(", ")}`);
        if (daysOfWeek) parts.push(`Days: ${daysOfWeek}`);
        if (timeOfDay) parts.push(`Time: ${timeOfDay}`);
        if (location) parts.push(`Location: ${location}`);
        if (status) parts.push(`Status: ${status}`);
        if (prerequisites) parts.push(`Prerequisites: ${prerequisites}`);
        return parts.filter(Boolean).join("\n");
      }

      return {
        content: rows.map(formatOfferingRow).join("\n\n---\n\n"),
      };
    }
    case "clarification": {
      const options = (data.options ?? [])
        .filter((o): o is {
          id?: string;
          courseId?: string;
          label: string;
          value?: string;
          description?: string;
          courseCode?: string;
          code?: string;
          title?: string;
          sisOfferingName?: string;
          term?: string;
        } => typeof o?.label === "string" && o.label.trim() !== "");
      return {
        content: data.question ?? data.message ?? "Please choose an option:",
        clarification: {
          slotKey: data.slotKey,
          options,
        },
      };
    }
    default:
      return { content: data.message ?? "", sources: data.sources, redactionNote: data.redactionNote };
  }
}

function parseAgentResponse(data: AgentResponse): ReturnType<typeof parseAgentResponseCore> {
  return mergeScheduleChangePresentation(data, parseAgentResponseCore(data));
}

// ── History conversion ────────────────────────────────────────────────────────

/** Convert a persisted DB message into the local ChatMessage shape.
 *  For assistant messages the metadata column stores the full AgentResponse
 *  object, so parseAgentResponse (including schedule-change cards) can reconstruct content and courseCards. */
function historyMessageToChatMessage(m: ChatHistoryMessage & { role: "user" | "assistant" }): ChatMessage {
  const base = { id: m.id, role: m.role };
  if (m.role !== "assistant") return { ...base, content: m.content };
  if (m.metadata && typeof m.metadata === "object" && "type" in m.metadata) {
    const { content, courseCards, clarification, sources, redactionNote } = parseAgentResponse(
      m.metadata as unknown as AgentResponse,
    );
    return { ...base, content, courseCards, clarification, sources, redactionNote };
  }
  return { ...base, content: m.content };
}

// ── Sources panel ────────────────────────────────────────────────────────────

const ALLOWED_SOURCE_HOSTS = new Set(["reddit.com", "www.reddit.com", "ratemyprofessors.com", "www.ratemyprofessors.com"]);

function sanitizeSourceUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    if (!ALLOWED_SOURCE_HOSTS.has(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function SourcesPanel({ sources }: { sources: Array<{ label: string; url: string; year?: number }> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="flex -space-x-1.5">
          {sources.slice(0, 4).map((s) => (
            <div
              key={s.url}
              className="h-4 w-4 rounded-full border border-background bg-muted flex items-center justify-center"
            >
              <ExternalLink className="h-2 w-2" />
            </div>
          ))}
        </div>
        <span>Sources</span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {sources.map((source) => {
            const safeUrl = sanitizeSourceUrl(source.url);
            if (!safeUrl) return null;
            const hostname = new URL(safeUrl).hostname.replace(/^www\./, "");
            return (
              <a
                key={safeUrl}
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground hover:bg-accent transition-colors max-w-xs"
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{source.label}</span>
                  <span className="text-muted-foreground truncate text-[10px]">{hostname}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage;
  scheduleCourseIds: Set<string>;
  takenCourseCodes: Set<string>;
  hasLoadedTakenCourseHistory: boolean;
  onAddToSchedule: (course: CourseCardType) => void;
  onRemoveFromSchedule: (course: CourseCardType) => void;
  onClarificationOptionsSubmit: (slotKey: string | undefined, options: ClarificationOption[]) => void;
  disableOptionSelect?: boolean;
  userPicture?: string | null;
}

function MessageBubble({
  msg,
  scheduleCourseIds,
  takenCourseCodes,
  hasLoadedTakenCourseHistory,
  onAddToSchedule,
  onRemoveFromSchedule,
  onClarificationOptionsSubmit,
  disableOptionSelect,
  userPicture,
}: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const [selectedClarificationKeys, setSelectedClarificationKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedClarificationKeys(new Set());
  }, [msg.id, msg.clarification?.slotKey]);

  const toOptionKey = useCallback((option: ClarificationOption, idx: number) => (
    option.id
      ?? `${option.sisOfferingName ?? option.courseCode ?? option.code ?? option.label}-${option.term ?? "term-unknown"}-${idx}`
  ), []);

  const bubbleClass = isUser
    ? "rounded-tr-sm bg-primary text-primary-foreground"
    : msg.isError
      ? "rounded-tl-sm bg-destructive/10 text-destructive border border-destructive/20"
      : msg.isStopped
        ? "rounded-tl-sm bg-muted/60 text-muted-foreground border border-border italic"
        : "rounded-tl-sm bg-muted text-foreground";

  return (
    <div className={`flex w-full min-w-0 items-start gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full overflow-hidden">
        {isUser ? (
          userPicture ? (
            <img src={userPicture} alt="You" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
              <User className="h-3.5 w-3.5" />
            </div>
          )
        ) : (
          <img src="/botAvatar.ico" alt="Assistant" className="h-full w-full object-cover" />
        )}
      </div>

      {/* Content column — assistant fills chat list width so course cards match scroll area; user stays capped */}
      <div
        className={`flex min-w-0 flex-col gap-2 ${isUser ? "max-w-[90%] items-end" : "flex-1 items-stretch"}`}
      >
        {/* Text bubble */}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? "whitespace-pre-wrap" : "w-full max-w-2xl"} ${bubbleClass}`}
          data-testid={isUser ? "user-message" : msg.isStopped ? "stopped-message" : "assistant-message"}
        >
          {msg.isStopped && (
            <span className="inline-flex items-center gap-1 mr-1 not-italic">
              <OctagonX className="h-3 w-3" />
            </span>
          )}
          {isUser ? msg.content : <ChatMarkdown content={msg.content} />}
        </div>

        {!isUser && typeof msg.redactionNote === "string" && msg.redactionNote.trim() !== "" && (
          <p className="text-[11px] text-muted-foreground/70 px-1">
            {msg.redactionNote}
          </p>
        )}

        {/* Course cards — only for assistant search results */}
        {!isUser && msg.courseCards && msg.courseCards.length > 0 && (
          <div className="flex w-full flex-col gap-1.5" data-testid="chat-course-cards">
            {msg.courseCards.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onAddToSchedule={onAddToSchedule}
                onRemoveFromSchedule={onRemoveFromSchedule}
                isInSchedule={scheduleCourseIds.has(`${course.courseCode}|${course.sisOfferingName}|${course.term}`)}
                isTaken={takenCourseCodes.has(normalizeCourseCode(course.courseCode, course.sisOfferingName))}
                takenCourseCodes={takenCourseCodes}
                hasLoadedTakenCourseHistory={hasLoadedTakenCourseHistory}
              />
            ))}
          </div>
        )}

        {/* Sources panel — collapsible list, always rendered after course cards */}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <SourcesPanel sources={msg.sources} />
        )}

        {!isUser && msg.clarification && msg.clarification.options.length > 0 && (
          <div className="w-full space-y-2" data-testid="chat-clarification-options">
            <div className="flex w-full min-w-0 flex-col gap-1.5">
              {msg.clarification.options.map((option, idx) => {
                const optionKey = toOptionKey(option, idx);
                const isSelected = selectedClarificationKeys.has(optionKey);
                return (
                  <div
                    key={optionKey}
                    className={`w-full min-w-0 ${isSelected ? "rounded-lg ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}
                  >
                    <CourseCard
                      course={{
                        id: option.courseId ?? optionKey,
                        courseCode: ensureCatalogCourseCode(
                          option.courseCode ?? option.code ?? "N/A",
                          option.sisOfferingName,
                        ),
                        courseTitle: option.title ?? option.label,
                        instructor: "TBD",
                        description: option.description ?? "",
                        sisOfferingName: option.sisOfferingName,
                        term: option.term,
                      }}
                      selectionMode
                      selectionSelected={isSelected}
                      onSelectOption={() => {
                        if (disableOptionSelect) return;
                        setSelectedClarificationKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(optionKey)) next.delete(optionKey);
                          else next.add(optionKey);
                          return next;
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={disableOptionSelect || selectedClarificationKeys.size === 0}
                onClick={() => {
                  if (disableOptionSelect) return;
                  const selectedOptions = msg.clarification?.options.filter((option, idx) =>
                    selectedClarificationKeys.has(toOptionKey(option, idx)));
                  if (!selectedOptions || selectedOptions.length === 0) return;
                  onClarificationOptionsSubmit(msg.clarification?.slotKey, selectedOptions);
                }}
              >
                Confirm selected ({selectedClarificationKeys.size})
              </Button>
            </div>
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
  scheduleCourseIds,
  onScheduleCourseIdsChange,
  onScheduleCoursesChanged,
}: ScheduleChatProps) {
  const currentUser = useAtomValue(currentUserAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<Exclude<StreamStatusStage, "done"> | null>(null);
  const [takenCourseCodes, setTakenCourseCodes] = useState<Set<string>>(new Set());
  const [hasLoadedTakenCourseHistory, setHasLoadedTakenCourseHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingDisplayedTextRef = useRef("");
  const pendingTextChunksRef = useRef<string[]>([]);
  const renderTimerRef = useRef<number | null>(null);
  const displayDrainResolversRef = useRef<Array<() => void>>([]);
  const { addCourse, removeCourse, getChatHistory } = useSchedules();

  const loadTakenCourseHistory = useCallback(async () => {
    if (hasLoadedTakenCourseHistory) return;
    try {
      const response = await fetch(apiUrl("/api/user/memories"), {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        setHasLoadedTakenCourseHistory(true);
        return;
      }
      const payload = await response.json() as {
        memories?: Array<{ text?: string; type?: string }>;
      };
      const takenCodes = new Set(
        (payload.memories ?? [])
          .filter((memory) => memory.type === "course_history")
          .map((memory) => memory.text?.trim() ?? "")
          .filter((text) => text.length > 0)
          .map((text) => normalizeCourseCode(text)),
      );
      setTakenCourseCodes(takenCodes);
      setHasLoadedTakenCourseHistory(true);
    } catch {
      setHasLoadedTakenCourseHistory(true);
    }
  }, [hasLoadedTakenCourseHistory]);

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
    if (hasLoadedTakenCourseHistory) return;
    const hasCourseCards = messages.some((message) => (message.courseCards?.length ?? 0) > 0);
    if (!hasCourseCards) return;
    void loadTakenCourseHistory();
  }, [hasLoadedTakenCourseHistory, loadTakenCourseHistory, messages]);


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
    const { content, courseCards, clarification, sources, redactionNote } = parseAgentResponse(data);
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
      clarification,
      sources,
      redactionNote,
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
    } else if (data.scheduleRefreshRequired) {
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
      if (scheduleCourseIds.has(courseKey)) return;

      // Optimistic add
      onScheduleCourseIdsChange((prev) => new Set([...prev, courseKey]));

      try {
        await addCourse(scheduleId, {
          courseCode: course.courseCode,
          sisOfferingName: course.sisOfferingName,
          term: course.term,
          courseTitle: course.courseTitle,
          credits: course.credits,
        });
        onScheduleCoursesChanged?.();
      } catch (err) {
        // Roll back optimistic add
        onScheduleCourseIdsChange((prev) => {
          const next = new Set(prev);
          next.delete(courseKey);
          return next;
        });
        console.error("Failed to add course to schedule:", err);
      }
    },
    [scheduleId, addCourse, onScheduleCourseIdsChange, onScheduleCoursesChanged, scheduleCourseIds],
  );

  const handleRemoveFromSchedule = useCallback(
    async (course: CourseCardType) => {
      if (!course.sisOfferingName || !course.term) return;
      const courseKey = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
      if (!scheduleCourseIds.has(courseKey)) return;

      // Optimistic remove
      onScheduleCourseIdsChange((prev) => {
        const next = new Set(prev);
        next.delete(courseKey);
        return next;
      });

      try {
        await removeCourse(scheduleId, {
          courseCode: course.courseCode,
          sisOfferingName: course.sisOfferingName,
          term: course.term,
        });
        onScheduleCoursesChanged?.();
      } catch (err) {
        // Roll back optimistic remove
        onScheduleCourseIdsChange((prev) => new Set([...prev, courseKey]));
        console.error("Failed to remove course from schedule:", err);
      }
    },
    [scheduleId, removeCourse, onScheduleCourseIdsChange, onScheduleCoursesChanged, scheduleCourseIds],
  );

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (inputOverride?: {
    text?: string;
    appendUserMessage?: boolean;
    clarificationSelection?: {
      slotKey?: string;
      choice?: ClarificationOption;
      choices?: ClarificationOption[];
    };
  }) => {
    const text = (inputOverride?.text ?? input).trim();
    if (!text || loading) return;

    if (!inputOverride?.text) setInput("");
    setError(null);
    if (inputOverride?.appendUserMessage !== false) {
      appendMessage({ role: "user", content: text });
    }
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
        body: JSON.stringify({
          message: text,
          scheduleId,
          ...(inputOverride?.clarificationSelection
            ? { clarificationSelection: inputOverride.clarificationSelection }
            : {}),
        }),
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
        const { content, courseCards, clarification, sources, redactionNote } = parseAgentResponse(data);
        appendMessage({ role: "assistant", content, courseCards, clarification, sources, redactionNote });
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
        } else if (data.scheduleRefreshRequired) {
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

  const handleClarificationOptionsSubmit = useCallback(
    (slotKey: string | undefined, options: ClarificationOption[]) => {
      if (!options.length || loading) return;
      setMessages((prev) => prev.filter((msg) => msg.role !== "assistant" || !msg.clarification));
      setInput("");
      void sendMessage({
        text: options.map((option) => option.value ?? option.label).join(", "),
        appendUserMessage: false,
        clarificationSelection: {
          slotKey,
          choices: options,
        },
      });
    },
    [loading, sendMessage],
  );

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
      void sendMessage({});
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
            <p className="text-xs text-muted-foreground/70 max-w-64" data-testid="chat-custom-event-tip">
              You can also say: "add a lab event Monday 3pm - 6pm"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            scheduleCourseIds={scheduleCourseIds}
            takenCourseCodes={takenCourseCodes}
            hasLoadedTakenCourseHistory={hasLoadedTakenCourseHistory}
            onAddToSchedule={handleAddToSchedule}
            onRemoveFromSchedule={handleRemoveFromSchedule}
            onClarificationOptionsSubmit={handleClarificationOptionsSubmit}
            disableOptionSelect={loading}
            userPicture={currentUser?.picture}
          />
        ))}

        {loading && !hasVisibleStreamingAssistantMessage && (
          <div className="flex gap-2.5" data-testid="chat-loading">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <img src="/botAvatar.ico" alt="Assistant" className="h-full w-full object-cover" />
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
            placeholder='Ask about workload or say "add a lab event Monday 3pm - 6pm"'
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
              onClick={() => { void sendMessage(); }}
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
