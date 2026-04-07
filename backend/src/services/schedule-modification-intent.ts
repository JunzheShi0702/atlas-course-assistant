export type ScheduleOperation = "add" | "drop" | "replace";

export type ScheduleModificationIntent =
  | { isScheduleModification: false }
  | {
      isScheduleModification: true;
      operation: ScheduleOperation;
      needsClarification: boolean;
      clarificationQuestion?: string;
    };

const COURSE_CODE_PATTERN = /\b(?:[a-z]{2}\.)?\d{3}\.\d{3}\b/i;
const AMBIGUOUS_REFERENCE_PATTERN =
  /\b(it|this|that|one|ones|something|anything|another|one of)\b/i;

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function inferOperation(message: string): ScheduleOperation | null {
  const text = message.toLowerCase();

  const hasSwap = hasAny(text, [/\bswap\b/, /\bswitch\b/, /\bexchange\b/, /\btrade\b/]);
  if (hasSwap) return "replace";

  const hasReplace = hasAny(text, [/\breplace\b/, /\bsubstitute\b/, /\binstead of\b/]);
  if (hasReplace) return "replace";

  const hasAdd = hasAny(text, [/\badd\b/, /\binsert\b/, /\benroll\b/, /\btake\b.*\b(on|in)\b/]);
  const hasDrop = hasAny(text, [/\bdrop\b/, /\bremove\b/, /\bdelete\b/, /\bunenroll\b/]);

  if (hasAdd && hasDrop) return "replace";
  if (hasAdd) return "add";
  if (hasDrop) return "drop";

  return null;
}

function needsClarificationForOperation(message: string, operation: ScheduleOperation): boolean {
  const text = message.toLowerCase();
  const hasCourseCode = COURSE_CODE_PATTERN.test(text);
  const hasAmbiguousReference = AMBIGUOUS_REFERENCE_PATTERN.test(text);

  if (operation === "replace") {
    const hasConnector = /\b(with|for|instead of)\b/i.test(text);
    return !hasConnector || (!hasCourseCode && hasAmbiguousReference);
  }

  return !hasCourseCode && hasAmbiguousReference;
}

function buildClarificationQuestion(operation: ScheduleOperation): string {
  if (operation === "add") {
    return "Which course should I add? Share the course code (for example EN.601.226) or exact title and term.";
  }
  if (operation === "drop") {
    return "Which course should I drop from this schedule? Share the course code (for example EN.601.226) or exact title and term.";
  }
  return "Please clarify which course to remove and which course to add (course code or exact title + term for each).";
}

export function detectScheduleModificationIntent(message: string): ScheduleModificationIntent {
  const operation = inferOperation(message);
  if (!operation) {
    return { isScheduleModification: false };
  }

  const needsClarification = needsClarificationForOperation(message, operation);
  return {
    isScheduleModification: true,
    operation,
    needsClarification,
    clarificationQuestion: needsClarification ? buildClarificationQuestion(operation) : undefined,
  };
}
