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

-- Schedules: named schedules per user and term
CREATE TABLE IF NOT EXISTS schedules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,  -- Will reference users.id when OAuth team implements users table
  name       TEXT NOT NULL,
  term       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedule → courses association
CREATE TABLE IF NOT EXISTS schedule_courses (
  schedule_id      UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  course_code      TEXT NOT NULL,
  sis_offering_name TEXT NOT NULL,
  term             TEXT NOT NULL,
  PRIMARY KEY (schedule_id, course_code, sis_offering_name, term)
);

-- Stored workload/goal audits per schedule (latest row is used by UI)
CREATE TABLE IF NOT EXISTS schedule_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result        JSONB NOT NULL,
  model_version TEXT
);
