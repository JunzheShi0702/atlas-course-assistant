export type ClarificationChoice = Record<string, unknown>;

type CandidateOptionsMap = Record<string, unknown>;

type ScheduleChangeFailure = {
  action?: "add" | "drop";
  reasonCode?: string;
  candidates?: unknown;
};

type ScheduleChangesLike = {
  operation?: string;
  failed?: ScheduleChangeFailure[];
};

export function isAmbiguousClarificationPayload(payload: Record<string, unknown>): boolean {
  const failed = (payload as { scheduleChanges?: { failed?: Array<{ reasonCode?: string }> } })
    .scheduleChanges?.failed;
  return Array.isArray(failed) && failed.some((f) => f.reasonCode === "ambiguous_reference");
}

function courseChoiceKey(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const codeSource =
    (typeof row.courseCode === "string" && row.courseCode.trim()) ||
    (typeof row.code === "string" && row.code.trim()) ||
    "";
  const offering =
    (typeof row.sisOfferingName === "string" && row.sisOfferingName.trim()) ||
    (typeof row.offeringName === "string" && row.offeringName.trim()) ||
    "";
  const term = typeof row.term === "string" ? row.term.trim() : "";
  if (!codeSource && !offering) return null;
  return `${codeSource.toLowerCase()}|${offering.toLowerCase()}|${term.toLowerCase()}`;
}

export function buildClarificationChoicesForFailure(
  failedCandidates: unknown,
  payloadResults: unknown[],
): ClarificationChoice[] {
  const fallback = Array.isArray(failedCandidates)
    ? failedCandidates.filter((raw): raw is ClarificationChoice => !!raw && typeof raw === "object")
    : [];
  if (fallback.length === 0) return [];
  const fallbackKeys = new Set(fallback.map((candidate) => courseChoiceKey(candidate)).filter(Boolean));
  if (fallbackKeys.size === 0) return fallback;

  const richMatches = payloadResults.filter((raw): raw is ClarificationChoice => {
    if (!raw || typeof raw !== "object") return false;
    const key = courseChoiceKey(raw);
    return !!key && fallbackKeys.has(key);
  });

  return richMatches.length > 0 ? richMatches : fallback;
}

export function normalizePendingChoices(rawChoices: unknown): ClarificationChoice[] {
  if (!Array.isArray(rawChoices)) return [];
  return rawChoices.filter((raw): raw is ClarificationChoice => !!raw && typeof raw === "object");
}

export function normalizeClarificationOptions(rawChoices: unknown): ClarificationChoice[] {
  if (!Array.isArray(rawChoices)) return [];
  return rawChoices
    .filter((raw): raw is ClarificationChoice => !!raw && typeof raw === "object")
    .map((choice) => {
      const courseCode =
        (typeof choice.courseCode === "string" && choice.courseCode.trim()) ||
        (typeof choice.code === "string" && choice.code.trim()) ||
        "";
      const sisOfferingName =
        (typeof choice.sisOfferingName === "string" && choice.sisOfferingName.trim()) ||
        (typeof choice.offeringName === "string" && choice.offeringName.trim()) ||
        "";
      const title = typeof choice.title === "string" ? choice.title.trim() : "";
      const term = typeof choice.term === "string" ? choice.term.trim() : "";
      const courseLabel = [sisOfferingName || courseCode, title].filter(Boolean).join(" - ");
      const label =
        (typeof choice.label === "string" && choice.label.trim()) ||
        (courseLabel ? `${courseLabel}${term ? ` (${term})` : ""}` : "") ||
        sisOfferingName ||
        courseCode ||
        (typeof choice.id === "string" && choice.id.trim()) ||
        "";
      if (!label) return null;
      const value =
        (typeof choice.value === "string" && choice.value.trim()) ||
        sisOfferingName ||
        courseCode ||
        label;
      return {
        ...choice,
        ...(courseCode ? { courseCode } : {}),
        ...(sisOfferingName ? { sisOfferingName } : {}),
        ...(term ? { term } : {}),
        label,
        value,
      };
    })
    .filter((choice): choice is ClarificationChoice => choice !== null);
}

export function buildClarificationPayload(input: {
  prompt: string;
  slotKey: string;
  candidateOptions: CandidateOptionsMap;
}): Record<string, unknown> {
  return {
    type: "clarification",
    question: input.prompt,
    message: input.prompt,
    slotKey: input.slotKey,
    options: normalizeClarificationOptions(input.candidateOptions[input.slotKey]),
  };
}

export function extractPendingClarificationFromPayload(payload: {
  scheduleChanges?: ScheduleChangesLike;
  results?: unknown[];
}): {
  operation: string;
  candidateOptions: Record<string, ClarificationChoice[]>;
  sortedMissingSlots: string[];
} | null {
  const scheduleChanges = payload.scheduleChanges;
  const payloadResults = Array.isArray(payload.results) ? payload.results : [];
  const failedWithCandidates =
    scheduleChanges?.failed?.filter((f): f is ScheduleChangeFailure & { action: "add" | "drop"; candidates: unknown[] } =>
      (f.action === "add" || f.action === "drop") && Array.isArray(f.candidates),
    ) ?? [];
  const failedAll =
    scheduleChanges?.failed?.filter((f): f is ScheduleChangeFailure & { action: "add" | "drop" } =>
      f.action === "add" || f.action === "drop",
    ) ?? [];
  const candidateOptions = Object.fromEntries(
    failedWithCandidates.map((f) => [
      `${f.action}Target`,
      buildClarificationChoicesForFailure(f.candidates, payloadResults),
    ]),
  ) as Record<string, ClarificationChoice[]>;
  const missingSlots = Array.from(new Set(
    failedAll
      .filter(
        (f) =>
          f.reasonCode === "ambiguous_reference" ||
          f.reasonCode === "not_found" ||
          f.reasonCode === "not_in_schedule",
      )
      .map((f) => `${f.action}Target`),
  ));
  if (missingSlots.length === 0) return null;
  const sortedMissingSlots = sortSlotsByOptions(missingSlots, candidateOptions);
  return {
    operation: scheduleChanges?.operation ?? "unknown",
    candidateOptions,
    sortedMissingSlots,
  };
}

export function sortSlotsByOptions(
  slots: string[],
  candidateOptions: CandidateOptionsMap,
): string[] {
  return [...slots].sort(
    (a, b) =>
      (Array.isArray(candidateOptions[a]) && candidateOptions[a].length > 0 ? 0 : 1) -
      (Array.isArray(candidateOptions[b]) && candidateOptions[b].length > 0 ? 0 : 1),
  );
}
