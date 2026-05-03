/**
 * Limits queryCourseMetrics to schedule courses (+ user-typed dotted codes)
 * during schedule-attached chats so models cannot hallucinate schedule rows.
 */

import type { ScheduleCourseRow } from "../services/schedule-context";
import { resolveEvalCourseCode } from "../tools/get-course-eval-summary";
import { extractAllDottedCourseCodesFromMessage } from "./search-text";

/** Merge resolved schedule codes + codes explicitly dotted in `message`; empty input yields undefined (no guard). */
export async function buildCourseMetricsGuardAllowlistResolved(
  message: string,
  scheduleCourses: ScheduleCourseRow[],
): Promise<string[] | undefined> {
  if (scheduleCourses.length === 0) {
    return undefined;
  }

  const fromSchedule = await Promise.all(scheduleCourses.map((c) => resolveEvalCourseCode(c.courseCode)));
  const dottedInMessage = extractAllDottedCourseCodesFromMessage(message);
  const fromExplicit =
    dottedInMessage.length > 0
      ? await Promise.all(dottedInMessage.map((code) => resolveEvalCourseCode(code)))
      : [];

  return [...new Set([...fromSchedule, ...fromExplicit])];
}
