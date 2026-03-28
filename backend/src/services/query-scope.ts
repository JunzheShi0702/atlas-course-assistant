/**
 * Pre-flight classifier: whether the user message belongs to Atlas (JHU courses/schedules).
 * Out-of-scope messages skip the main agent and receive a fixed redirect response.
 */

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const OUT_OF_SCOPE_REDIRECT_MESSAGE =
  "I’m Atlas—I only help with JHU courses and schedules (finding classes, sections, instructors, and course evaluations). Ask me something in that area and I’d be happy to help!";

const scopeSchema = z.object({
  inScope: z.boolean(),
});

const CLASSIFIER_SYSTEM = `You classify user messages for Atlas, a JHU undergraduate course and schedule assistant.

ALMOST ALWAYS inScope: true when the message could plausibly be about picking, finding, comparing, or understanding college courses, schedules, professors, majors, requirements, credits, or registration—even if the user does not say "JHU", "Hopkins", or a department name. Topic searches ("classes about X", "easy stats", "intro to Y") are in scope. Typos and very short queries are in scope if they might be course-related.

IN SCOPE (inScope: true) — examples (not exhaustive):
- Any search for classes/courses/sections by topic, title, code, professor, time, or school
- Course evals, workload, difficulty, prerequisites, majors/minors, degree planning
- Schedule building, conflicts, add/drop, SIS, terms (Spring/Fall), KSAS/WSE
- Greetings or thanks that may lead into course questions ("hi", "thanks")
- How to use this app's search or schedules

OUT OF SCOPE (inScope: false) — only when clearly NOT about courses/scheduling at all:
- Obvious general trivia, news, weather, sports, politics, recipes, travel with no course angle
- Pure coding/math homework help with no course-selection intent
- Random keyboard mash or content with zero link to academics

When even slightly unsure, respond inScope: true.`;

/**
 * Fast path: skip the classifier LLM when the message clearly looks like a course/schedule query.
 * Reduces false "out of scope" denials on valid but short or informal phrasing.
 */
function looksPlausiblyCourseRelated(message: string): boolean {
  const s = message.toLowerCase();
  if (/\b(en|as|ns|ph)\.\d{3}\.\d{3}\b/i.test(message)) return true;
  if (/\b(?:spring|fall)\s*20\d{2}\b/i.test(s)) return true;
  if (
    /\b(?:class|classes|course|courses|section|sections|schedule|schedules|professor|instructor|prof|sis|prerequisite|prereq|major|minor|credit|credits|semester|enroll|registration|catalog|department|dept|ksas|wse|krieger|whiting|jhu|hopkins)\b/.test(
      s,
    )
  ) {
    return true;
  }
  if (/\b(?:monday|tuesday|wednesday|thursday|friday|weekday|mwf|tth)\b/i.test(s)) {
    return true;
  }
  return false;
}

export async function isQueryInProductScope(message: string): Promise<boolean> {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  if (looksPlausiblyCourseRelated(trimmed)) {
    return true;
  }

  try {
    const { output: classified } = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({
        schema: scopeSchema,
      }),
      system: CLASSIFIER_SYSTEM,
      prompt: `User message:\n"""${trimmed}"""`,
      temperature: 0,
    });
    if (!classified) {
      return true;
    }
    return classified.inScope;
  } catch (err) {
    console.error("[query-scope] classification failed:", err);
    return true;
  }
}
