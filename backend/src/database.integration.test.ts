import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const shouldRun = process.env.RUN_DATABASE_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration("database/init.sql integration", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    const initSql = readFileSync(join(__dirname, "../../database/init.sql"), "utf8");
    await pool.query(initSql);
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  it("applies pgvector schema and supports vector-backed course search ordering", async () => {
    await pool.query("TRUNCATE course_embeddings");
    const embedding = `[${Array.from({ length: 1536 }, (_, index) => (index === 0 ? "1" : "0")).join(",")}]`;

    await pool.query(
      `INSERT INTO course_embeddings
        (course_id, code, sis_offering_name, term, title, short_description, credits, embedding)
       VALUES
        ('AS.100.101.01.FA25', 'AS.100.101', 'AS.100.101 (01)', 'Fall 2025', 'Close Match', 'Near query vector', 3.00, $1::vector),
        ('AS.100.102.01.FA25', 'AS.100.102', 'AS.100.102 (01)', 'Fall 2025', 'Far Match', 'Far query vector', 4.00, $2::vector)`,
      [
        embedding,
        `[${Array.from({ length: 1536 }, (_, index) => (index === 1 ? "1" : "0")).join(",")}]`,
      ],
    );

    const { rows } = await pool.query<{ course_id: string }>(
      `SELECT course_id
         FROM course_embeddings
        ORDER BY embedding <=> $1::vector
        LIMIT 2`,
      [embedding],
    );

    expect(rows.map((row) => row.course_id)).toEqual([
      "AS.100.101.01.FA25",
      "AS.100.102.01.FA25",
    ]);
  });

  it("enforces schedule cascades and chat role constraints", async () => {
    await pool.query("TRUNCATE users CASCADE");

    const {
      rows: [user],
    } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, google_sub) VALUES ('integration@example.com', 'integration-sub') RETURNING id",
    );
    const {
      rows: [schedule],
    } = await pool.query<{ id: string }>(
      "INSERT INTO schedules (user_id, name, term) VALUES ($1, 'Integration Schedule', 'Fall 2025') RETURNING id",
      [user.id],
    );
    const {
      rows: [chatState],
    } = await pool.query<{ id: string }>(
      "INSERT INTO schedule_chat_state (schedule_id, user_id) VALUES ($1, $2) RETURNING id",
      [schedule.id, user.id],
    );

    await expect(
      pool.query(
        "INSERT INTO schedule_chat_messages (chat_state_id, schedule_id, role, content) VALUES ($1, $2, 'bot', 'bad role')",
        [chatState.id, schedule.id],
      ),
    ).rejects.toThrow();

    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);

    const { rows: schedules } = await pool.query("SELECT id FROM schedules WHERE id = $1", [schedule.id]);
    const { rows: messages } = await pool.query("SELECT id FROM schedule_chat_messages WHERE schedule_id = $1", [
      schedule.id,
    ]);

    expect(schedules).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});
