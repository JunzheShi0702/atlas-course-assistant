export const SEARCH_MATCH_TYPE_BASE_WEIGHTS = {
  exact: 1000,
  hybrid: 850,
  constraint: 750,
  semantic: 650,
} as const;

export const SEARCH_ALIGNMENT_PENALTIES = {
  constraintMismatch: -300,
  preferenceMismatch: -120,
  unknown: 0,
} as const;
