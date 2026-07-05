import type { Pool } from "pg";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export interface ChatStateRow {
  id: string;
  schedule_id: string;
  user_id: string;
  rolling_summary: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessageRow {
  id: string;
  chat_state_id: string;
  schedule_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  response_type: string | null;
  metadata: unknown;
  created_at: Date;
}

export interface PersistMessageInput {
  chatStateId: string;
  scheduleId: string;
  role: "user" | "assistant" | "system";
  content: string;
  responseType?: string;
  metadata?: Record<string, unknown>;
}

function toJsonbParam(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Returns the existing chat state row for a schedule, creating one if it
 * doesn't exist yet. The UNIQUE constraint on schedule_id makes this safe
 * under concurrent requests.
 */
export async function getOrCreateChatState(
  pool: Pool,
  scheduleId: string,
  userId: string,
): Promise<ChatStateRow> {
  const { rows } = await pool.query<ChatStateRow>(
    `INSERT INTO schedule_chat_state (schedule_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (schedule_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [scheduleId, userId],
  );
  return rows[0];
}

/** Returns the active pending clarification state for this schedule conversation. */
export async function getPendingClarificationState(
  pool: Pool,
  chatStateId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM schedule_clarification_state
     WHERE chat_state_id = $1 AND status = 'pending'
     LIMIT 1`,
    [chatStateId],
  );
  return rows[0] ?? null;
}

/** Upserts/refreshes the pending clarification state for this schedule conversation. */
export async function upsertPendingClarificationState(
  pool: Pool,
  input: {
    chatStateId: string;
    scheduleId: string;
    userId: string;
    intent?: Record<string, unknown>;
    missingSlots?: string[];
    confirmedSlots?: Record<string, unknown>;
    candidateOptions?: Record<string, unknown>;
    nextQuestion?: Record<string, unknown> | null;
    originalRequest?: string;
  },
): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO schedule_clarification_state
       (chat_state_id, schedule_id, user_id, status, intent, missing_slots, confirmed_slots, candidate_options, next_question, original_request)
     VALUES ($1, $2, $3, 'pending', $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     ON CONFLICT (chat_state_id)
     DO UPDATE SET
       schedule_id = EXCLUDED.schedule_id,
       user_id = EXCLUDED.user_id,
       status = 'pending',
       intent = EXCLUDED.intent,
       missing_slots = EXCLUDED.missing_slots,
       confirmed_slots = EXCLUDED.confirmed_slots,
       candidate_options = EXCLUDED.candidate_options,
       next_question = EXCLUDED.next_question,
       original_request = EXCLUDED.original_request,
       updated_at = now()
     RETURNING *`,
    [
      input.chatStateId,
      input.scheduleId,
      input.userId,
      toJsonbParam(input.intent ?? {}),
      toJsonbParam(input.missingSlots ?? []),
      toJsonbParam(input.confirmedSlots ?? {}),
      toJsonbParam(input.candidateOptions ?? {}),
      input.nextQuestion == null ? null : toJsonbParam(input.nextQuestion),
      input.originalRequest ?? "",
    ],
  );
  return rows[0];
}

export async function resolvePendingClarificationState(
  pool: Pool,
  chatStateId: string,
): Promise<void> {
  await pool.query(
    `UPDATE schedule_clarification_state
     SET status = 'resolved', updated_at = now()
     WHERE chat_state_id = $1 AND status = 'pending'`,
    [chatStateId],
  );
}

/**
 * Inserts a single message into schedule_chat_messages and returns it.
 */
export async function persistMessage(
  pool: Pool,
  input: PersistMessageInput,
): Promise<ChatMessageRow> {
  const { chatStateId, scheduleId, role, content, responseType, metadata } = input;
  const { rows } = await pool.query<ChatMessageRow>(
    `INSERT INTO schedule_chat_messages
       (chat_state_id, schedule_id, role, content, response_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [chatStateId, scheduleId, role, content, responseType ?? null, metadata ?? {}],
  );
  return rows[0];
}

/**
 * Returns the most recent `limit` messages for a chat thread in chronological
 * order (oldest first). Returns an empty array if none exist yet.
 */
export async function loadRecentMessages(
  pool: Pool,
  chatStateId: string,
  limit = 15,
): Promise<ChatMessageRow[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `SELECT * FROM schedule_chat_messages
     WHERE chat_state_id = $1
       AND (response_type IS NULL OR response_type <> 'clarification')
     ORDER BY created_at DESC
     LIMIT $2`,
    [chatStateId, limit],
  );
  return rows.reverse(); // chronological order
}

/**
 * Formats a rolling summary + recent messages into a context block that can
 * be appended to the LLM system prompt. Returns an empty string when there
 * is nothing to inject (no summary and no messages).
 */
export function formatChatHistoryBlock(
  rollingSummary: string,
  messages: Pick<ChatMessageRow, "role" | "content">[],
): string {
  if (!rollingSummary && messages.length === 0) return "";

  const parts: string[] = ["--- Conversation History ---"];
  if (rollingSummary) {
    parts.push(`Summary of earlier messages:\n${rollingSummary}`);
  }
  if (messages.length > 0) {
    parts.push("Recent messages:");
    for (const m of messages) {
      parts.push(`${m.role}: ${m.content}`);
    }
  }
  parts.push("--- End of Conversation History ---");
  return "\n\n" + parts.join("\n");
}

/**
 * Enforces the 100-message retention cap for a chat thread.
 *
 * When total message count exceeds 100, the oldest 30 messages are
 * condensed into the rolling_summary via an LLM call, then deleted.
 * This means the LLM summarization fires once per ~30 new messages
 * (not on every message past 100), keeping the thread within bounds
 * without constant overhead.
 */
export async function enforceRetentionPolicy(
  pool: Pool,
  chatStateId: string,
): Promise<void> {
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM schedule_chat_messages WHERE chat_state_id = $1`,
    [chatStateId],
  );
  const count = parseInt(countResult.rows[0].count, 10);
  if (count <= 100) return;

  // Fetch the oldest 30 messages to summarize and remove
  const oldResult = await pool.query<{ id: string; role: string; content: string }>(
    `SELECT id, role, content
     FROM schedule_chat_messages
     WHERE chat_state_id = $1
     ORDER BY created_at ASC
     LIMIT 30`,
    [chatStateId],
  );
  const oldMessages = oldResult.rows;
  if (oldMessages.length === 0) return;

  // Fetch current rolling summary
  const stateResult = await pool.query<{ rolling_summary: string }>(
    `SELECT rolling_summary FROM schedule_chat_state WHERE id = $1`,
    [chatStateId],
  );
  const existingSummary = stateResult.rows[0]?.rolling_summary ?? "";

  // Build a condensed summary of existing summary + old messages
  const transcript = oldMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const prompt = existingSummary
    ? `Prior summary:\n${existingSummary}\n\nNew messages to merge in:\n${transcript}\n\nProduce a single updated summary that integrates both. Quote specific course names, codes, or user preferences exactly as stated.`
    : `Summarize the following conversation. Quote specific course names, codes, or user preferences exactly as stated.\n\n${transcript}`;

  const { text: newSummary } = await generateText({
    model: openai("gpt-4.1-mini"),
    system:
      "You are a helpful assistant that condenses chat history into a concise summary. " +
      "Rules:\n" +
      "- Preserve verbatim any specific course names, course codes, instructor names, or exact user-stated preferences (e.g. 'I want no Friday classes').\n" +
      "- Retain key decisions and conclusions the user reached.\n" +
      "- If a prior summary exists, merge it with the new messages into one unified summary — do not just append.\n" +
      "- Omit filler, pleasantries, and redundant exchanges.\n" +
      "- Be concise but complete: a future LLM must be able to reconstruct the user's goals and constraints from this summary alone.",
    prompt,
  });

  const oldIds = oldMessages.map((m) => m.id);

  // Update rolling summary and delete old messages in a transaction.
  // Must use a dedicated client — pool.query() can dispatch each call to a
  // different connection, so BEGIN/COMMIT issued through the pool have no effect.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE schedule_chat_state SET rolling_summary = $1, updated_at = now() WHERE id = $2`,
      [newSummary, chatStateId],
    );
    await client.query(
      `DELETE FROM schedule_chat_messages WHERE id = ANY($1::uuid[])`,
      [oldIds],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
