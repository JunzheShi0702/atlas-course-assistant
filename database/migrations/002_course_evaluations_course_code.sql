-- Store evals by catalog course_code only (no FK to courses).
ALTER TABLE course_evaluations
  ADD COLUMN IF NOT EXISTS course_code TEXT;

ALTER TABLE course_evaluations
  DROP COLUMN IF EXISTS course_id;

CREATE INDEX IF NOT EXISTS idx_course_evaluations_course_code
  ON course_evaluations (course_code);
