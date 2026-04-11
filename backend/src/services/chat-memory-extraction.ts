/**
 * Async extraction of durable preferences from a single user chat turn.
 * Persists into `user_memories` with source `chat`; never blocks the agent response.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { Pool } from "pg";
import { generateEmbeddingsBatch } from "./embeddings";
import { toDatabaseUserId } from "../middleware/auth";

export const CHAT_MEMORY_MIN_MESSAGE_LENGTH = 12;
/** Cosine similarity above this vs an existing memory is treated as duplicate. */
export const CHAT_MEMORY_DEDUP_THRESHOLD = 0.88;

const memoryTypeSchema = z.enum(["goal", "preference", "constraint", "learning_style"]);

const memoryItemSchema = z.object({
  memory_text: z
    .string()
    .min(1)
    .max(600)
    .describe(
      "Short phrase only: implied subject (e.g. 'Likes computer science', 'Prefers morning classes'). No 'The user' or 'They'.",
    ),
  memory_type: memoryTypeSchema,
  /** How confident you are (0–100) that this is a durable preference worth saving. */
  confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Integer 0–100: confidence this memory is stable and correctly extracted."),
});

const extractionSchema = z.object({
  memories: z.array(memoryItemSchema),
});

export type ExtractedChatMemory = z.infer<typeof memoryItemSchema>;

/** Maps model output 0–100 to DB `NUMERIC(3,2)` scale 0.00–1.00. */
export function confidencePercentToStoredValue(percent: number): number {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  return Math.round((p / 100) * 100) / 100;
}

const EXTRACTION_SYSTEM = `You extract stable, long-term preferences and constraints for Atlas (a JHU undergraduate course planning assistant).

Include a memory ONLY when the user states something that would still matter in future semesters (goals, standing preferences, recurring constraints, learning style).

EXCLUDE:
- One-off plans for today/this week/this term only (unless they reveal a stable rule, e.g. "I always avoid Friday labs")
- Questions with no stated preference
- Pure acknowledgements ("thanks", "ok"), or search queries with no personal preference
- Course-specific picks that sound ephemeral ("add EN.601.226 now") unless the user states a rule ("I always want a backup writing course")

memory_text format (strict):
- Use a compact phrase or verb phrase as if labeling the preference, not a full sentence about the user.
- Start with a verb or noun phrase: e.g. "Likes computer science", "Interested in ML research", "Avoids evening sections".
- Do NOT use "The user", "They", "Student", or third-person narration. Do NOT start with "The user likes…".

memory_type:
- goal: degree/career/academic direction
- preference: general likes/dislikes about courses, workload, format
- constraint: hard limits (time, sequence, requirements)
- learning_style: how they learn best

For each memory, set confidence to an integer 0–100 (how sure you are that it is a stable, correctly extracted preference).

Return {"memories": []} when nothing durable is present.`;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export async function extractStableMemoriesFromUserMessage(
  userMessage: string,
): Promise<ExtractedChatMemory[]> {
  const trimmed = userMessage.trim();
  if (trimmed.length < CHAT_MEMORY_MIN_MESSAGE_LENGTH) {
    return [];
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return [];
  }

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: extractionSchema,
      system: EXTRACTION_SYSTEM,
      prompt: `User message:\n"""${trimmed}"""`,
      temperature: 0,
    });
    return object.memories;
  } catch (err) {
    console.error("[chat-memory-extraction] extractStableMemoriesFromUserMessage failed:", err);
    return [];
  }
}

async function loadExistingMemoryTexts(pool: Pool, userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ memory_text: string }>(
    `SELECT memory_text FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map((r) => r.memory_text);
}

/**
 * Returns indices of candidates to keep (0-based), filtering duplicates against existing
 * and already-kept candidates in the same batch.
 */
export function filterDuplicateMemoryCandidates(
  existingTexts: string[],
  candidates: ExtractedChatMemory[],
  embeddings: number[][] | null,
  threshold: number,
): number[] {
  if (candidates.length === 0) return [];
  if (!embeddings || embeddings.length !== existingTexts.length + candidates.length) {
    throw new Error("filterDuplicateMemoryCandidates: embedding count mismatch");
  }

  const existingEmb = embeddings.slice(0, existingTexts.length);
  const candidateEmb = embeddings.slice(existingTexts.length);
  const keptEmbeddings: number[][] = [...existingEmb];
  const keepIndices: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const vec = candidateEmb[i];
    let isDup = false;
    for (const other of keptEmbeddings) {
      if (cosineSimilarity(vec, other) >= threshold) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      keepIndices.push(i);
      keptEmbeddings.push(vec);
    }
  }
  return keepIndices;
}

export async function persistChatMemories(
  pool: Pool,
  dbUserId: string,
  userMessageId: string,
  candidates: ExtractedChatMemory[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  if (!process.env.OPENAI_API_KEY?.trim()) return 0;

  const existingTexts = await loadExistingMemoryTexts(pool, dbUserId);
  const textsToEmbed = [...existingTexts, ...candidates.map((c) => c.memory_text)];
  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddingsBatch(textsToEmbed);
  } catch (err) {
    console.error("[chat-memory-extraction] embedding batch failed:", err);
    return 0;
  }

  const keepIdx = filterDuplicateMemoryCandidates(
    existingTexts,
    candidates,
    embeddings,
    CHAT_MEMORY_DEDUP_THRESHOLD,
  );
  if (keepIdx.length === 0) return 0;

  let inserted = 0;
  for (const idx of keepIdx) {
    const m = candidates[idx];
    const conf = confidencePercentToStoredValue(m.confidence);
    try {
      await pool.query(
        `INSERT INTO user_memories
           (user_id, memory_text, memory_type, source, confidence, created_from_message_id)
         VALUES ($1, $2, $3, 'chat', $4, $5)`,
        [dbUserId, m.memory_text.trim(), m.memory_type, conf, userMessageId],
      );
      inserted += 1;
    } catch (err) {
      console.error("[chat-memory-extraction] insert failed:", err);
    }
  }
  return inserted;
}

/**
 * Fire-and-forget safe entry: extracts from the user message and persists non-duplicate rows.
 */
export async function runChatMemoryExtraction(params: {
  pool: Pool;
  appUserId: string;
  userMessage: string;
  userMessageId: string;
}): Promise<void> {
  const { pool, appUserId, userMessage, userMessageId } = params;
  const dbUserId = toDatabaseUserId(appUserId);

  const memories = await extractStableMemoriesFromUserMessage(userMessage);
  if (memories.length === 0) return;

  await persistChatMemories(pool, dbUserId, userMessageId, memories);
}
