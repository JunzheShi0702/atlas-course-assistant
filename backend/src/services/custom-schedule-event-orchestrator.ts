import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { pool } from "../pool";
import { weeklyCalendarDaySchema, weeklyCalendarTimeSchema } from "../types/database";

const customEventIntentSchema = z.object({
  operation: z.enum(["none", "create", "update", "delete"]),
  targetTitle: z.string().trim().nullable(),
  title: z.string().trim().nullable(),
  dayOfWeek: weeklyCalendarDaySchema.nullable(),
  startTime: weeklyCalendarTimeSchema.nullable(),
  endTime: weeklyCalendarTimeSchema.nullable(),
  location: z.string().trim().nullable(),
});

type CustomEventIntent = z.infer<typeof customEventIntentSchema>;

type CustomEventPayload = {
  type: "text";
  message: string;
  scheduleRefreshRequired?: boolean;
};

export type CustomEventHandledResult =
  | { handled: false }
  | { handled: true; payload: CustomEventPayload };

type RecentScheduleChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function looksLikeCustomEventRequest(message: string): boolean {
  const text = message.toLowerCase();
  const hasAction = /\b(add|create|make|schedule|move|edit|update|change|delete|remove|cancel|reschedule)\b/.test(text);
  const hasEventHint =
    /\b(event|meeting|shift|block|study|gym|work|office hours|club|practice|appointment|custom)\b/.test(text)
    || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text);
  const hasCourseCode = /\b(?:[a-z]{2}\.)?\d{3}\.\d{3}\b/i.test(message);
  return hasAction && hasEventHint && !hasCourseCode;
}

function hasValidRange(startTime: string, endTime: string): boolean {
  return startTime < endTime;
}

function formatCustomEventSchedule(dayOfWeek: string | null, startTime: string | null, endTime: string | null): string {
  if (dayOfWeek && startTime && endTime) {
    return `on ${dayOfWeek} from ${startTime} to ${endTime}`;
  }
  if (dayOfWeek) {
    return `on ${dayOfWeek} with time TBA`;
  }
  if (startTime && endTime) {
    return `with time ${startTime} to ${endTime} and day TBA`;
  }
  return "with day and time TBA";
}

function findWeekday(text: string): z.infer<typeof weeklyCalendarDaySchema> | null {
  const match = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (!match) return null;
  const day = match[1].toLowerCase();
  return `${day[0].toUpperCase()}${day.slice(1)}` as z.infer<typeof weeklyCalendarDaySchema>;
}

function to24HourTime(hoursRaw: string, minutesRaw: string | undefined, meridiem: "am" | "pm"): string | null {
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw ?? "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
    return null;
  }

  let normalizedHours = hours % 12;
  if (meridiem === "pm") normalizedHours += 12;
  return `${String(normalizedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseLooseTimeRange(text: string): { startTime: string; endTime: string } | null {
  const match = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (!match) return null;

  const contextMeridiem: "am" | "pm" | null = /\bafternoon|evening|night|tonight\b/i.test(text)
    ? "pm"
    : /\bmorning\b/i.test(text)
      ? "am"
      : null;

  const endMeridiem = (match[6]?.toLowerCase() as "am" | "pm" | undefined) ?? contextMeridiem ?? null;
  const startMeridiem =
    (match[3]?.toLowerCase() as "am" | "pm" | undefined)
    ?? endMeridiem
    ?? contextMeridiem;

  if (!startMeridiem || !endMeridiem) return null;

  const startTime = to24HourTime(match[1], match[2], startMeridiem);
  const endTime = to24HourTime(match[4], match[5], endMeridiem);
  if (!startTime || !endTime) return null;

  return { startTime, endTime };
}

function sanitizeTitle(value: string | null | undefined): string | null {
  const normalized = (value ?? "")
    .replace(/^[\s,.;:-]+/, "")
    .replace(/[\s,.;:-]+$/, "")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function previousAssistantAskedForCreateDetails(messages: RecentScheduleChatMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) return false;
  return /custom event title|provide both a start and end time|leave both as TBA/i.test(lastAssistant.content);
}

function previousUserMentionedTba(messages: RecentScheduleChatMessage[]): boolean {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  return lastUser ? /\b(tba|unknown|flexible)\b/i.test(lastUser.content) : false;
}

function normalizeCreateTitle(rawTitle: string | null, followUpMode: boolean): string | null {
  const withoutPrefixes = sanitizeTitle(
    rawTitle
      ?.replace(/^(?:add|create|make|schedule)\s+/i, "")
      .replace(/^(?:a|an|new)\s+/i, "")
      .replace(/^custom\s+/i, "")
      .replace(/^event\s+/i, "")
      .replace(/^to\s+the\s+schedule\s*/i, ""),
  );

  if (!withoutPrefixes) {
    return null;
  }

  const withoutSchedulingSuffixes = sanitizeTitle(
    withoutPrefixes
      .replace(/\bwith\s+(?:day|date|time)(?:\s+and\s+(?:day|date|time))?\s+(?:tba|unknown|flexible)\b.*$/i, "")
      .replace(/\b(?:day|date|time)(?:\s+and\s+(?:day|date|time))?\s+(?:tba|unknown|flexible)\b.*$/i, ""),
  );

  if (!withoutSchedulingSuffixes) {
    return null;
  }

  if (followUpMode) {
    return withoutSchedulingSuffixes;
  }

  return /^(?:event|custom event|new event|event for me|something|thing|stuff)$/i.test(withoutSchedulingSuffixes)
    ? null
    : withoutSchedulingSuffixes;
}

function parseDeterministicCreateIntent(
  message: string,
  opts?: { recentMessages?: RecentScheduleChatMessage[] },
): CustomEventIntent | null {
  const text = message.trim();
  if (!text) return null;

  const recentMessages = opts?.recentMessages ?? [];
  const followUpMode = previousAssistantAskedForCreateDetails(recentMessages);
  const hasAction = /\b(add|create|make|schedule)\b/i.test(text);
  const hasNonCreateAction = /\b(move|edit|update|change|delete|remove|cancel|reschedule)\b/i.test(text);
  const hasEventCue =
    /\b(event|meeting|shift|block|study|gym|work|office hours|club|practice|appointment|custom|lab)\b/i.test(text)
    || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
  const hasTbaPhrase = /\b(tba|unknown|flexible)\b/i.test(text);
  const timeRange = parseLooseTimeRange(text);
  const looksLikeExistingEventReference = /\b(?:the|my|this|that)\s+[\w\s-]*\bevent\b/i.test(text);

  if (!followUpMode && hasNonCreateAction) {
    return null;
  }

  if (!followUpMode && looksLikeExistingEventReference && !/\b(?:new|custom)\s+event\b/i.test(text)) {
    return null;
  }

  if (!followUpMode && !(hasAction && hasEventCue && (Boolean(timeRange) || hasTbaPhrase))) {
    return null;
  }

  const titleFromCallIt = text.match(/\b(?:call|name)\s+it\s+(.+)$/i)?.[1];
  const titleFromComma = text.includes(",") ? text.split(",")[0] : null;
  const dayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const titleBeforeDay = dayMatch ? text.slice(0, dayMatch.index).replace(/\bon\b\s*$/i, "") : null;
  const titleCandidate = sanitizeTitle(
    titleFromCallIt
    ?? titleFromComma
    ?? titleBeforeDay
    ?? (!followUpMode && (hasTbaPhrase || Boolean(timeRange)) ? text : null)
    ?? (followUpMode ? text : null),
  );

  const title = normalizeCreateTitle(titleCandidate, followUpMode);
  const dayOfWeek = hasTbaPhrase && /\b(day|date)\b/i.test(text) ? null : findWeekday(text);
  const wantsTbaTime = hasTbaPhrase && /\b(time|date|day)\b/i.test(text) && !timeRange;
  const location = sanitizeTitle(text.match(/\b(?:at|in)\s+([a-z][\w\s.-]*)$/i)?.[1]) ?? null;

  if (!title) {
    return {
      operation: "create",
      targetTitle: null,
      title: null,
      dayOfWeek,
      startTime: wantsTbaTime ? null : timeRange?.startTime ?? null,
      endTime: wantsTbaTime ? null : timeRange?.endTime ?? null,
      location,
    };
  }

  const shouldUseTbaFromPriorContext = previousUserMentionedTba(recentMessages) && followUpMode && !timeRange && !dayOfWeek;

  return {
    operation: "create",
    targetTitle: null,
    title,
    dayOfWeek: shouldUseTbaFromPriorContext ? null : dayOfWeek,
    startTime: shouldUseTbaFromPriorContext ? null : (wantsTbaTime ? null : timeRange?.startTime ?? null),
    endTime: shouldUseTbaFromPriorContext ? null : (wantsTbaTime ? null : timeRange?.endTime ?? null),
    location,
  };
}

async function parseCustomEventIntent(message: string): Promise<CustomEventIntent> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: customEventIntentSchema,
    system: [
      "Extract schedule custom-event operations from the user's message.",
      "Use operation=none if the message is not about a non-course custom event.",
      "Custom events are things like work shifts, gym, club meetings, study blocks, appointments, or personal blocks.",
      "Return dayOfWeek only as full English names like Monday.",
      "Return startTime/endTime in 24-hour HH:mm format when the user provides them.",
      "If the user says the day or time is TBA, unknown, flexible, or wants it cleared, return null for those fields.",
      "For update/delete, targetTitle should name the existing event the user is referring to.",
    ].join(" "),
    prompt: message,
    temperature: 0,
  });
  return object;
}

export async function handleCustomScheduleEventMessage(input: {
  userId: string;
  scheduleId: string;
  message: string;
  recentMessages?: RecentScheduleChatMessage[];
}): Promise<CustomEventHandledResult> {
  const deterministicCreateIntent = parseDeterministicCreateIntent(input.message, {
    recentMessages: input.recentMessages,
  });

  if (!looksLikeCustomEventRequest(input.message) && !deterministicCreateIntent) {
    return { handled: false };
  }

  const { rows: scheduleRows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [input.scheduleId],
  );
  if (scheduleRows.length === 0) {
    return {
      handled: true,
      payload: { type: "text", message: "I couldn't find that schedule." },
    };
  }
  if (scheduleRows[0].user_id !== input.userId) {
    return {
      handled: true,
      payload: { type: "text", message: "You do not have permission to edit that schedule." },
    };
  }

  const intent = deterministicCreateIntent ?? await parseCustomEventIntent(input.message);
  if (intent.operation === "none") {
    return { handled: false };
  }

  if (intent.operation === "create") {
    if (!intent.title) {
      return {
        handled: true,
        payload: {
          type: "text",
          message:
            "Please tell me the custom event title so I can add it. Try something like \"add a lab event Monday 3pm - 6pm\" or \"add a study block with day and time TBA.\"",
        },
      };
    }
    const hasPartialTime = (intent.startTime === null) !== (intent.endTime === null);
    if (hasPartialTime) {
      return {
        handled: true,
        payload: {
          type: "text",
          message:
            "Please provide both a start and end time, or leave both as TBA. Try something like \"add a lab event Monday 3pm - 6pm.\"",
        },
      };
    }
    if (intent.startTime && intent.endTime && !hasValidRange(intent.startTime, intent.endTime)) {
      return {
        handled: true,
        payload: { type: "text", message: "The custom event end time needs to be later than the start time." },
      };
    }
    await pool.query(
      `INSERT INTO schedule_custom_events
         (schedule_id, title, day_of_week, start_time, end_time, location)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.scheduleId,
        intent.title,
        intent.dayOfWeek,
        intent.startTime,
        intent.endTime,
        intent.location?.trim() || null,
      ],
    );
    return {
      handled: true,
      payload: {
        type: "text",
        message: `Added custom event "${intent.title}" ${formatCustomEventSchedule(
          intent.dayOfWeek,
          intent.startTime,
          intent.endTime,
        )}.`,
        scheduleRefreshRequired: true,
      },
    };
  }

  const lookupTitle = intent.targetTitle?.trim() || intent.title?.trim();
  if (!lookupTitle) {
    return {
      handled: true,
      payload: {
        type: "text",
        message: `Please tell me which custom event you want to ${intent.operation}.`,
      },
    };
  }

  const { rows: matchedRows } = await pool.query<{
    id: string;
    title: string;
    day_of_week: string;
    start_time: string;
    end_time: string;
    location: string | null;
  }>(
    `SELECT id, title, day_of_week, start_time, end_time, location
     FROM schedule_custom_events
     WHERE schedule_id = $1 AND LOWER(title) = LOWER($2)
     ORDER BY day_of_week, start_time`,
    [input.scheduleId, lookupTitle],
  );

  if (matchedRows.length === 0) {
    return {
      handled: true,
      payload: {
        type: "text",
        message: `I couldn't find a custom event named "${lookupTitle}" in this schedule.`,
      },
    };
  }
  if (matchedRows.length > 1) {
    return {
      handled: true,
      payload: {
        type: "text",
        message: `I found multiple custom events named "${lookupTitle}". Please clarify which one by including the day or time.`,
      },
    };
  }

  const existing = matchedRows[0];
  if (intent.operation === "delete") {
    await pool.query(`DELETE FROM schedule_custom_events WHERE id = $1`, [existing.id]);
    return {
      handled: true,
      payload: {
        type: "text",
        message: `Removed custom event "${existing.title}".`,
        scheduleRefreshRequired: true,
      },
    };
  }

  const nextTitle = intent.title?.trim() || existing.title;
  const clearDay = /\b(day|date)\b.*\b(tba|unknown|clear|remove)\b|\bmake\b.*\bday\b.*\b(tba|unknown)\b/i.test(input.message);
  const clearTime = /\b(time|start time|end time)\b.*\b(tba|unknown|clear|remove)\b|\bmake\b.*\btime\b.*\b(tba|unknown)\b/i.test(input.message);
  const nextDay = clearDay ? null : (intent.dayOfWeek ?? existing.day_of_week);
  const nextStart = clearTime ? null : (intent.startTime ?? existing.start_time);
  const nextEnd = clearTime ? null : (intent.endTime ?? existing.end_time);
  const nextLocation = intent.location === null ? existing.location : (intent.location.trim() || null);

  if ((nextStart === null) !== (nextEnd === null)) {
    return {
      handled: true,
      payload: { type: "text", message: "Please provide both a start and end time, or leave both as TBA." },
    };
  }
  if (nextStart && nextEnd && !hasValidRange(nextStart, nextEnd)) {
    return {
      handled: true,
      payload: { type: "text", message: "The updated custom event end time needs to be later than the start time." },
    };
  }

  await pool.query(
    `UPDATE schedule_custom_events
     SET title = $2,
         day_of_week = $3,
         start_time = $4,
         end_time = $5,
         location = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [existing.id, nextTitle, nextDay, nextStart, nextEnd, nextLocation],
  );

  return {
    handled: true,
    payload: {
      type: "text",
      message: `Updated custom event "${nextTitle}" ${formatCustomEventSchedule(
        nextDay,
        nextStart,
        nextEnd,
      )}.`,
      scheduleRefreshRequired: true,
    },
  };
}
