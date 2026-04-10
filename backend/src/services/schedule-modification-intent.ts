export type ScheduleOperation = "add" | "drop" | "replace";

export type ScheduleModificationIntent =
  | { isScheduleModification: false }
  | {
      isScheduleModification: true;
      operation: ScheduleOperation;
    };

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function inferOperation(message: string): ScheduleOperation | null {
  const text = message.toLowerCase();

  const hasReplace = hasAny(text, [
    /\breplace\b/,
    /\breplcae\b/,
    /\bsubstitute\b/,
    /\binstead of\b/,
    /\binsted of\b/,
    /\bswap\b/,
    /\bswpa\b/,
    /\bswitch\b/,
    /\bexchange\b/,
    /\btrade\b/,
  ]);
  if (hasReplace) return "replace";

  const hasAdd = hasAny(text, [/\badd\b/, /\binsert\b/, /\benroll\b/, /\btake\b.*\b(on|in)\b/]);
  const hasDrop = hasAny(text, [/\bdrop\b/, /\bremove\b/, /\bdelete\b/, /\bunenroll\b/]);

  if (hasAdd && hasDrop) return "replace";
  if (hasAdd) return "add";
  if (hasDrop) return "drop";

  return null;
}

export function detectScheduleModificationIntent(message: string): ScheduleModificationIntent {
  const operation = inferOperation(message);
  if (!operation) {
    return { isScheduleModification: false };
  }

  return {
    isScheduleModification: true,
    operation,
  };
}
