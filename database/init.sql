-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Course embeddings (vector index for semantic search; populated by seed script)
CREATE TABLE IF NOT EXISTS course_embeddings (
  course_id         TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  sis_offering_name TEXT NOT NULL,
  term              TEXT NOT NULL,
  title             TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  credits           DECIMAL(4,2),
  embedding         VECTOR(1536)
);
ALTER TABLE course_embeddings ADD COLUMN IF NOT EXISTS credits DECIMAL(4,2);
CREATE INDEX IF NOT EXISTS course_embeddings_hnsw_idx
  ON course_embeddings USING hnsw (embedding vector_cosine_ops);

-- Course evaluations table (scraped from EvaluationKit; evals keyed by catalog course_code only)
CREATE TABLE IF NOT EXISTS course_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,               -- catalog course code (e.g. EN.553.171)
  section_number TEXT,                     -- section identifier within a course (e.g. 01, 11, W01)
  semester VARCHAR(20) NOT NULL,            -- e.g. Fall 2024, Spring 2025
  instructor VARCHAR(255),
  overall_quality DECIMAL(3,2),
  teaching_effectiveness DECIMAL(3,2),
  intellectual_challange DECIMAL(3,2),
  ta_quality DECIMAL(3,2),
  feedback_quality DECIMAL(3,2),
  work_load DECIMAL(3,2),
  num_respondents INT
);
CREATE INDEX IF NOT EXISTS idx_course_evaluations_course_code ON course_evaluations (course_code);

-- Users (one row per authenticated account; google_sub comes from Google OAuth)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  google_sub  TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User profiles (one-to-one with users; stores academic background + AI-derived memories)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  graduation_month  SMALLINT,                     -- 1–12
  graduation_year   SMALLINT,                     -- e.g. 2026
  degrees           TEXT[],                       -- e.g. {"B.S. Computer Science"}
  school            TEXT,                         -- e.g. "Whiting School of Engineering"
  raw_goals_text    TEXT,
  raw_workload_text  TEXT,
  raw_preferences_text TEXT,
  derived_memories  JSONB NOT NULL DEFAULT '[]',  -- structured memories extracted by the AI
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cached course summaries per course (Task #131)
CREATE TABLE IF NOT EXISTS course_summaries (
  course_code TEXT PRIMARY KEY,          -- One row per course_code
  latest_term TEXT NOT NULL,             -- Latest eval semester used for cache invalidation
  summary     JSONB NOT NULL,            -- Stores full CourseEvalSummaryResult object
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SIS /classes detail responses (Issue #129): one row per offering + term + section
CREATE TABLE IF NOT EXISTS sis_course_details_cache (
  sis_offering_name TEXT NOT NULL,
  term              TEXT NOT NULL,
  section_name      TEXT NOT NULL DEFAULT '',
  payload           JSONB NOT NULL,
  prerequisites     TEXT,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sis_offering_name, term, section_name)
);
ALTER TABLE sis_course_details_cache ADD COLUMN IF NOT EXISTS prerequisites TEXT;

-- Schedules: named schedules per user and term
CREATE TABLE IF NOT EXISTS schedules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  term       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedule → courses association
CREATE TABLE IF NOT EXISTS schedule_courses (
  schedule_id       UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  course_code       TEXT NOT NULL,
  sis_offering_name TEXT NOT NULL,
  term              TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  credits           DECIMAL(4,2),
  PRIMARY KEY (schedule_id, course_code, sis_offering_name, term)
);
ALTER TABLE schedule_courses ADD COLUMN IF NOT EXISTS credits DECIMAL(4,2);

-- User-authored custom schedule events (clubs, work, study blocks, etc.)
CREATE TABLE IF NOT EXISTS schedule_custom_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  day_of_week TEXT,
  start_time TEXT,
  end_time   TEXT,
  location   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE schedule_custom_events ALTER COLUMN day_of_week DROP NOT NULL;
ALTER TABLE schedule_custom_events ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE schedule_custom_events ALTER COLUMN end_time DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_custom_events_schedule_id
  ON schedule_custom_events (schedule_id, day_of_week, start_time);

-- Stored workload/goal audits per schedule (latest row is used by UI)
CREATE TABLE IF NOT EXISTS schedule_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result        JSONB NOT NULL,
  model_version TEXT
);

-- Chat state per schedule: one row per schedule, holds rolling summary of older messages
CREATE TABLE IF NOT EXISTS schedule_chat_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID UNIQUE NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rolling_summary TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_chat_state_user_id ON schedule_chat_state (user_id);

-- Individual chat messages per schedule thread
CREATE TABLE IF NOT EXISTS schedule_chat_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_state_id  UUID NOT NULL REFERENCES schedule_chat_state(id) ON DELETE CASCADE,
  schedule_id    UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content        TEXT NOT NULL,
  response_type  TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_chat_messages_chat_state_id ON schedule_chat_messages (chat_state_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_chat_messages_schedule_id ON schedule_chat_messages (schedule_id, created_at);

-- Pending clarification state per schedule conversation.
-- One active row per schedule chat thread (chat_state_id), updated across turns.
CREATE TABLE IF NOT EXISTS schedule_clarification_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_state_id     UUID UNIQUE NOT NULL REFERENCES schedule_chat_state(id) ON DELETE CASCADE,
  schedule_id       UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'cancelled')),
  intent            JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_slots     JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_slots   JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_question     JSONB NULL,
  original_request  TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_clarification_state_schedule_id
  ON schedule_clarification_state (schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_clarification_state_user_id
  ON schedule_clarification_state (user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_clarification_state_status
  ON schedule_clarification_state (status);

-- User memories: onboarding + chat-derived structured memories (Issue #195).
-- Existing DBs: apply one-time migrations under database/migrations/ (do not rely on re-running full init).
CREATE TABLE IF NOT EXISTS user_memories (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_text             TEXT NOT NULL,
  memory_type             TEXT NOT NULL CHECK (memory_type IN ('goal','preference','constraint','learning_style','course_history')),
  source                  TEXT NOT NULL CHECK (source IN ('chat','onboarding','manual','course_history')),
  confidence              NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  created_from_message_id UUID NULL REFERENCES schedule_chat_messages(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories (user_id);
-- One course code per user for course_history (race-safe upsert via ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memories_course_history_user_text
  ON user_memories (user_id, memory_text)
  WHERE memory_type = 'course_history';

-- Offline response evaluation log (Issue #278).
-- Existing DBs: apply database/migrations/add_agent_eval_logs.sql
CREATE TABLE IF NOT EXISTS agent_eval_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  message_id      UUID        REFERENCES schedule_chat_messages(id) ON DELETE SET NULL,
  query_type      TEXT,
  response_type   TEXT,
  tool_sequence   TEXT[]      NOT NULL DEFAULT '{}',
  issues          JSONB       NOT NULL DEFAULT '[]',
  passed          BOOLEAN     NOT NULL,
  raw_query       TEXT,
  raw_response    JSONB
);
CREATE INDEX IF NOT EXISTS idx_agent_eval_logs_user_id ON agent_eval_logs (user_id, created_at DESC);
