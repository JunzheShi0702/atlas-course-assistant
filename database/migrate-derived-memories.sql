-- Backfill user_memories from legacy user_profiles.derived_memories JSONB column.
-- Run once after the user_memories table has been created (see init.sql).
-- Safe to re-run: wrap in a transaction and skip users who already have onboarding rows.

BEGIN;

INSERT INTO user_memories (user_id, memory_text, memory_type, source)

-- goals[] → 'goal'
SELECT up.user_id, g.val, 'goal', 'onboarding'
FROM user_profiles up,
     jsonb_array_elements_text(up.derived_memories -> 'goals') AS g(val)
WHERE jsonb_array_length(COALESCE(up.derived_memories -> 'goals', '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM user_memories um
    WHERE um.user_id = up.user_id AND um.source = 'onboarding'
  )

UNION ALL

-- workloadTolerance → 'preference' (skip "unspecified")
SELECT up.user_id,
       'workload_tolerance: ' || (up.derived_memories ->> 'workloadTolerance'),
       'preference',
       'onboarding'
FROM user_profiles up
WHERE up.derived_memories ->> 'workloadTolerance' IS NOT NULL
  AND up.derived_memories ->> 'workloadTolerance' <> 'unspecified'
  AND NOT EXISTS (
    SELECT 1 FROM user_memories um
    WHERE um.user_id = up.user_id AND um.source = 'onboarding'
  )

UNION ALL

-- timePreferences[] → 'constraint'
SELECT up.user_id, tp.val, 'constraint', 'onboarding'
FROM user_profiles up,
     jsonb_array_elements_text(up.derived_memories -> 'timePreferences') AS tp(val)
WHERE jsonb_array_length(COALESCE(up.derived_memories -> 'timePreferences', '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM user_memories um
    WHERE um.user_id = up.user_id AND um.source = 'onboarding'
  )

UNION ALL

-- notes[] → 'preference'
SELECT up.user_id, n.val, 'preference', 'onboarding'
FROM user_profiles up,
     jsonb_array_elements_text(up.derived_memories -> 'notes') AS n(val)
WHERE jsonb_array_length(COALESCE(up.derived_memories -> 'notes', '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM user_memories um
    WHERE um.user_id = up.user_id AND um.source = 'onboarding'
  );

COMMIT;
