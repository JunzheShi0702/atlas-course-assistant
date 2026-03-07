-- Run this in the Supabase SQL Editor (pgvector is pre-enabled on Supabase)
-- https://supabase.com/dashboard/project/wlfmfnmaxrczcndtyush/sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS course_embeddings (
  course_id         TEXT PRIMARY KEY,        -- e.g. en-553-171-01-spring-2026
  code              TEXT NOT NULL,            -- e.g. EN.553.171
  sis_offering_name TEXT NOT NULL,            -- e.g. EN.553.171.01
  term              TEXT NOT NULL,            -- e.g. Spring 2026
  title             TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  embedding         VECTOR(1536)
);

-- HNSW index for fast cosine similarity search (pgvector >= 0.5, available on Supabase)
CREATE INDEX IF NOT EXISTS course_embeddings_hnsw_idx
  ON course_embeddings USING hnsw (embedding vector_cosine_ops);
