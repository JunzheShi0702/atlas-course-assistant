export interface AiCallLogInput {
  route: string;
  userId: string | null;
  requestId?: string | null;
  model?: string | null;
  operation: string;
  prompt: string;
  response: string;
  usage?: unknown;
  estimatedCostUsd?: number | null;
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

function toFiniteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampExcerpt(text: string, maxLen = 2000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

export function extractTokenUsage(usage: unknown): TokenUsage {
  if (!usage || typeof usage !== "object") {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const candidate = usage as Record<string, unknown>;
  const promptTokens =
    toFiniteOrNull(candidate.inputTokens) ??
    toFiniteOrNull(candidate.promptTokens) ??
    toFiniteOrNull(candidate.prompt_tokens);
  const completionTokens =
    toFiniteOrNull(candidate.outputTokens) ??
    toFiniteOrNull(candidate.completionTokens) ??
    toFiniteOrNull(candidate.completion_tokens);
  const explicitTotal =
    toFiniteOrNull(candidate.totalTokens) ??
    toFiniteOrNull(candidate.total_tokens);
  const totalTokens =
    explicitTotal ??
    (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  return { promptTokens, completionTokens, totalTokens };
}

const DEFAULT_PRICE_USD_PER_1K_INPUT_TOKENS = 0.00015;
const DEFAULT_PRICE_USD_PER_1K_OUTPUT_TOKENS = 0.0006;

function estimateCostFromTokens(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * DEFAULT_PRICE_USD_PER_1K_INPUT_TOKENS;
  const outputCost = (outputTokens / 1000) * DEFAULT_PRICE_USD_PER_1K_OUTPUT_TOKENS;
  return Number((inputCost + outputCost).toFixed(6));
}

export function resolveEstimatedCostUsd(
  usage: unknown,
  explicitEstimatedCostUsd?: number | null,
): number {
  if (typeof explicitEstimatedCostUsd === "number" && Number.isFinite(explicitEstimatedCostUsd)) {
    return Number(Math.max(0, explicitEstimatedCostUsd).toFixed(6));
  }
  const tokens = extractTokenUsage(usage);
  return estimateCostFromTokens(tokens.promptTokens ?? 0, tokens.completionTokens ?? 0);
}

type LogRow = {
  createdAtMs: number;
  route: string;
  userId: string | null;
  estimatedCostUsd: number;
};

const inMemoryLogs: LogRow[] = [];
const MAX_IN_MEMORY_LOGS = 5000;

function appendInMemoryLog(row: LogRow): void {
  inMemoryLogs.push(row);
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.splice(0, inMemoryLogs.length - MAX_IN_MEMORY_LOGS);
  }
}

export function getDailySpendUsd(route: string, userId: string | null): number {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let total = 0;
  for (const row of inMemoryLogs) {
    if (row.createdAtMs < dayAgo) continue;
    if (row.route !== route) continue;
    if (row.userId !== userId) continue;
    total += row.estimatedCostUsd;
  }
  return Number(total.toFixed(6));
}

export async function writeAiCallLog(input: AiCallLogInput): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const tokenUsage = extractTokenUsage(input.usage);
  const estimatedCostUsd = resolveEstimatedCostUsd(input.usage, input.estimatedCostUsd);
  appendInMemoryLog({
    createdAtMs: Date.now(),
    route: input.route,
    userId: input.userId,
    estimatedCostUsd,
  });
  console.info("[ai-observability]", {
    route: input.route,
    userId: input.userId,
    requestId: input.requestId ?? null,
    model: input.model ?? null,
    operation: input.operation,
    promptExcerpt: clampExcerpt(input.prompt),
    responseExcerpt: clampExcerpt(input.response),
    promptTokens: tokenUsage.promptTokens,
    completionTokens: tokenUsage.completionTokens,
    totalTokens: tokenUsage.totalTokens,
    estimatedCostUsd,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    success: input.success,
    metadata: input.metadata ?? {},
  });
}
