/**
 * Pre-flight classifier: whether the user message belongs to Atlas (JHU courses/schedules).
 * Out-of-scope messages skip the main agent and receive a fixed redirect response.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const OUT_OF_SCOPE_REDIRECT_MESSAGE =
  "I’m Atlas—I only help with JHU courses and schedules (finding classes, sections, instructors, and course evaluations). Ask me something in that area and I’d be happy to help!";

/** Explicit type stops TS from recursing through Zod + AI SDK `InferSchema` (excessively deep instantiation). */
type ScopeClassification = { inScope: boolean };

const scopeSchema: z.ZodType<ScopeClassification> = z.object({
  inScope: z.boolean(),
});

const CLASSIFIER_SYSTEM = `You classify user messages for Atlas, a JHU undergraduate course and schedule assistant.

IN SCOPE (inScope: true):
- Finding, comparing, or understanding JHU courses; sections; meeting times; locations
- Course evaluations, workload, difficulty; instructors for JHU offerings
- Course codes, terms, KSAS/WSE, prerequisites, registration context at JHU
- Building or reviewing schedules, conflicts, degree/course planning at JHU
- Short greetings or thanks where the user may continue with course questions (e.g. "hi", "thanks")
- How to use course search or schedule features in this app

OUT OF SCOPE (inScope: false):
- General knowledge, news, weather, sports, politics, unrelated personal advice
- Coding or homework help not about choosing or understanding JHU courses
- Other schools as the main topic; travel, recipes, entertainment unrelated to coursework
- Nonsense or random strings with no plausible link to courses/scheduling

If unsure whether the user might want course or schedule help, prefer inScope: true.`;

export async function isQueryInProductScope(message: string): Promise<boolean> {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: scopeSchema,
      system: CLASSIFIER_SYSTEM,
      prompt: `User message:\n"""${trimmed}"""`,
      temperature: 0,
    });
    return object.inScope;
  } catch (err) {
    console.error("[query-scope] classification failed:", err);
    return true;
  }
}
