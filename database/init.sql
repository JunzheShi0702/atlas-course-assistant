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

-- Course evaluations table
CREATE TABLE IF NOT EXISTS course_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id),
  semester VARCHAR(4),
  instructor VARCHAR(255),
  overall_quality DECIMAL(3,2),
  teaching_effectiveness DECIMAL(3,2),
  intellectual_challange DECIMAL(3,2),
  ta_quality DECIMAL(3,2),
  feedback_quality DECIMAL(3,2),
  work_load DECIMAL(3,2),
  response_rate DECIMAL(3,2)
);
