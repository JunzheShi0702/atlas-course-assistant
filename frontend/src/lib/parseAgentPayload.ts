/**
 * The model sometimes wraps JSON in markdown fences or adds prose; the backend may
 * still fall back to type "text" with the raw string. Recover structured payloads so
 * course cards render instead of a wall of JSON.
 */

export function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  if (!s.startsWith("```")) return s;
  const firstNl = s.indexOf("\n");
  if (firstNl > 0) s = s.slice(firstNl + 1);
  const endFence = s.lastIndexOf("```");
  if (endFence >= 0) s = s.slice(0, endFence);
  return s.trim();
}

/** Extract balanced `{ ... }` from text (first complete JSON object). */
export function extractFirstJsonObjectString(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAgentPayloadFromModelText(text: string): unknown {
  const unfenced = stripMarkdownJsonFence(text);
  try {
    return JSON.parse(unfenced);
  } catch {
    const slice = extractFirstJsonObjectString(unfenced);
    if (slice) return JSON.parse(slice);
    throw new Error("not valid agent JSON");
  }
}

/** If the API returned type=text but the body is actually JSON (e.g. fenced), normalize. */
export function normalizeAgentApiPayload<T extends { type?: string; message?: string }>(data: T): T {
  if (data.type && data.type !== "text") return data;
  const raw = data.message;
  if (typeof raw !== "string" || raw.length < 2) return data;
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("```")) return data;
  try {
    const parsed = parseAgentPayloadFromModelText(raw) as { type?: string };
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return { ...data, ...(parsed as object) } as T;
    }
  } catch {
    /* keep original */
  }
  return data;
}
