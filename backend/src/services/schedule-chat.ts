import { pool } from "../pool";

export type ScheduleChatRole = "user" | "assistant" | "system";

export interface PersistScheduleChatMessageInput {
  userId: string;
  scheduleId: string;
  role: ScheduleChatRole;
  content: string;
  responseType?: string | null;
  metadata?: Record<string, unknown>;
}

async function ensureScheduleChatState(
  userId: string,
  scheduleId: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO schedule_chat_state (user_id, schedule_id)
     VALUES ($1, $2)
     ON CONFLICT (schedule_id)
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [userId, scheduleId],
  );

  return rows[0].id;
}

export async function persistScheduleChatMessage(
  input: PersistScheduleChatMessageInput,
): Promise<string> {
  const chatStateId = await ensureScheduleChatState(input.userId, input.scheduleId);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO schedule_chat_messages (
       chat_state_id,
       schedule_id,
       role,
       content,
       response_type,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      chatStateId,
      input.scheduleId,
      input.role,
      input.content,
      input.responseType ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  await pool.query(
    `UPDATE schedule_chat_state
     SET updated_at = now()
     WHERE id = $1`,
    [chatStateId],
  );

  return rows[0].id;
}
