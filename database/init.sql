-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department VARCHAR(4) NOT NULL,
  code VARCHAR(3) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  embedding VECTOR(1536)
);

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
  semester VARCHAR(20) NOT NULL,            -- e.g. Fall 2024, Spring 2025
  instructor VARCHAR(255),
  overall_quality DECIMAL(3,2),
  teaching_effectiveness DECIMAL(3,2),
  intellectual_challange DECIMAL(3,2),
  ta_quality DECIMAL(3,2),
  feedback_quality DECIMAL(3,2),
  work_load DECIMAL(3,2),
  response_rate DECIMAL(3,2)
);
CREATE INDEX IF NOT EXISTS idx_course_evaluations_course_code ON course_evaluations (course_code);
