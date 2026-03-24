-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Course embeddings (vector index for semantic search; populated by seed script)
CREATE TABLE IF NOT EXISTS course_embeddings (
  course_id         TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  sis_offering_name TEXT NOT NULL,
  term              TEXT NOT NULL,
  title             TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  embedding         VECTOR(1536)
);
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
  raw_text          TEXT,                         -- free-form self-description entered by the user
  derived_memories  JSONB NOT NULL DEFAULT '[]',  -- structured memories extracted by the AI
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
