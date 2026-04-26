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
}): Promise<CustomEventHandledResult> {
  if (!looksLikeCustomEventRequest(input.message)) {
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

  const intent = await parseCustomEventIntent(input.message);
  if (intent.operation === "none") {
    return { handled: false };
  }

  if (intent.operation === "create") {
    if (!intent.title || !intent.dayOfWeek || !intent.startTime || !intent.endTime) {
      return {
        handled: true,
        payload: {
          type: "text",
          message: "Please tell me the custom event title, day, start time, and end time so I can add it.",
        },
      };
    }
    if (!hasValidRange(intent.startTime, intent.endTime)) {
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
        message: `Added custom event "${intent.title}" on ${intent.dayOfWeek} from ${intent.startTime} to ${intent.endTime}.`,
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
  const nextDay = intent.dayOfWeek || existing.day_of_week;
  const nextStart = intent.startTime || existing.start_time;
  const nextEnd = intent.endTime || existing.end_time;
  const nextLocation = intent.location === undefined ? existing.location : (intent.location.trim() || null);

  if (!hasValidRange(nextStart, nextEnd)) {
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
      message: `Updated custom event "${nextTitle}" to ${nextDay} from ${nextStart} to ${nextEnd}.`,
      scheduleRefreshRequired: true,
    },
  };
}
