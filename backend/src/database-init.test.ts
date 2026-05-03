import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const initSql = readFileSync(join(__dirname, "../../database/init.sql"), "utf8");

describe("database/init.sql schema contract", () => {
  it("enables pgvector and defines the course embedding vector index", () => {
    expect(initSql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(initSql).toContain("embedding         VECTOR(1536)");
    expect(initSql).toContain("USING hnsw (embedding vector_cosine_ops)");
  });

  it("keeps schedule ownership and cascading deletes wired through foreign keys", () => {
    expect(initSql).toContain("user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE");
    expect(initSql).toContain("schedule_id       UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE");
    expect(initSql).toContain("schedule_id   UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE");
  });

  it("guards memory and chat state invariants with checks and uniqueness", () => {
    expect(initSql).toContain("schedule_id     UUID UNIQUE NOT NULL REFERENCES schedules(id) ON DELETE CASCADE");
    expect(initSql).toContain("role           TEXT NOT NULL CHECK (role IN ('user','assistant','system'))");
    expect(initSql).toContain("memory_type             TEXT NOT NULL CHECK");
    expect(initSql).toContain("source                  TEXT NOT NULL CHECK");
    expect(initSql).toContain("uq_user_memories_course_history_user_text");
  });
});
