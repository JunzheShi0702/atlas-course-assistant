import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { pool } from "../db";

export interface CourseEvalSummaryOutput {
  courseId: string;
  summaryText: string | null;
  hasData: boolean;
  message?: string;
  metrics?: {
    overallQuality: number | null;
    teachingEffectiveness: number | null;
    intellectualChallenge: number | null;
    taQuality: number | null;
    feedbackQuality: number | null;
    workload: number | null;
    responseRate: number | null;
    sampleSize: number;
  };
  attribution?: {
    instructors: string[];
    startTerm: string | null;
    endTerm: string | null;
  };
}

const summaryCache = new Map<string, CourseEvalSummaryOutput>();

interface EvalAggregateRow {
  sample_size: number;
  overall_quality: number | null;
  teaching_effectiveness: number | null;
  intellectual_challange: number | null;
  ta_quality: number | null;
  feedback_quality: number | null;
  work_load: number | null;
  response_rate: number | null;
  instructors: string[] | null;
  start_term: string | null;
  end_term: string | null;
}

let evalKeyColumnCache: "course_code" | "course_id" | null = null;

async function getEvalKeyColumn(): Promise<"course_code" | "course_id"> {
  if (evalKeyColumnCache) {
    return evalKeyColumnCache;
  }

  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'course_evaluations'
       AND column_name IN ('course_code', 'course_id')`,
  );

  const names = new Set(rows.map((r) => r.column_name));
  evalKeyColumnCache = names.has("course_code") ? "course_code" : "course_id";
  return evalKeyColumnCache;
}

function buildFallbackSummary(row: EvalAggregateRow): string {
  const oq = row.overall_quality?.toFixed(2) ?? "N/A";
  const wl = row.work_load?.toFixed(2) ?? "N/A";
  const rr = row.response_rate?.toFixed(2) ?? "N/A";
  return `Based on ${row.sample_size} evaluation responses, overall quality is ${oq}, workload is ${wl}, and response rate is ${rr}.`;
}

function parseCourseCode(courseId: string): string {
  const parts = courseId.split("-");
  if (parts.length < 3) return "";
  return `${parts[0].toUpperCase()}.${parts[1]}.${parts[2]}`;
}

export async function getCourseEvalSummary(courseId: string): Promise<CourseEvalSummaryOutput> {
  const normalized = courseId.trim();
  if (!normalized) {
    return {
      courseId,
      summaryText: null,
      hasData: false,
      message: "courseId is required",
    };
  }

  const cached = summaryCache.get(normalized);
  if (cached) {
    return cached;
  }

  const courseCode = parseCourseCode(normalized);

  try {
    const evalKey = await getEvalKeyColumn();

    const sqlByCourseCode = `
      SELECT
        COUNT(*)::int AS sample_size,
        AVG(ce.overall_quality)::float8 AS overall_quality,
        AVG(ce.teaching_effectiveness)::float8 AS teaching_effectiveness,
        AVG(ce.intellectual_challange)::float8 AS intellectual_challange,
        AVG(ce.ta_quality)::float8 AS ta_quality,
        AVG(ce.feedback_quality)::float8 AS feedback_quality,
        AVG(ce.work_load)::float8 AS work_load,
        AVG(ce.response_rate)::float8 AS response_rate,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ce.instructor), NULL) AS instructors,
        MIN(ce.semester) AS start_term,
        MAX(ce.semester) AS end_term
      FROM course_evaluations ce
      WHERE ce.course_code = $1
         OR ce.course_code = $2
         OR ce.course_code = $3
    `;

    const sqlByCourseId = `
      WITH target_ids AS (
        SELECT ce.course_id
        FROM course_embeddings emb
        JOIN course_evaluations ce ON ce.course_id::text = emb.course_id::text
        WHERE emb.course_id = $1
           OR emb.code = $2
           OR emb.sis_offering_name = $3
        LIMIT 1
      )
      SELECT
        COUNT(*)::int AS sample_size,
        AVG(ce.overall_quality)::float8 AS overall_quality,
        AVG(ce.teaching_effectiveness)::float8 AS teaching_effectiveness,
        AVG(ce.intellectual_challange)::float8 AS intellectual_challange,
        AVG(ce.ta_quality)::float8 AS ta_quality,
        AVG(ce.feedback_quality)::float8 AS feedback_quality,
        AVG(ce.work_load)::float8 AS work_load,
        AVG(ce.response_rate)::float8 AS response_rate,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ce.instructor), NULL) AS instructors,
        MIN(ce.semester) AS start_term,
        MAX(ce.semester) AS end_term
      FROM course_evaluations ce
      WHERE ce.course_id::text IN (
        SELECT course_id::text FROM target_ids
        UNION
        SELECT $1::text
      )
    `;

    const params = [normalized, courseCode, `${courseCode}.01`];
    const { rows } = await pool.query<EvalAggregateRow>(
      evalKey === "course_code" ? sqlByCourseCode : sqlByCourseId,
      params,
    );

    const row = rows[0];
    if (!row || row.sample_size === 0) {
      const noData: CourseEvalSummaryOutput = {
        courseId: normalized,
        summaryText: null,
        hasData: false,
        message: "Not enough evaluation data to summarize this course.",
      };
      summaryCache.set(normalized, noData);
      return noData;
    }

    let summaryText = buildFallbackSummary(row);
    try {
      const llm = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: `Summarize this course evaluation data in 1-2 concise sentences. Be factual and avoid hype.\n\nData:\n- sample size: ${row.sample_size}\n- overall quality: ${row.overall_quality ?? "N/A"}\n- teaching effectiveness: ${row.teaching_effectiveness ?? "N/A"}\n- intellectual challenge: ${row.intellectual_challange ?? "N/A"}\n- TA quality: ${row.ta_quality ?? "N/A"}\n- feedback quality: ${row.feedback_quality ?? "N/A"}\n- workload: ${row.work_load ?? "N/A"}\n- response rate: ${row.response_rate ?? "N/A"}\n- instructors: ${(row.instructors ?? []).join(", ") || "N/A"}\n- terms: ${row.start_term ?? "N/A"} to ${row.end_term ?? "N/A"}`,
        temperature: 0,
      });
      if (llm.text.trim()) {
        summaryText = llm.text.trim();
      }
    } catch {
      // Keep deterministic fallback summary if LLM call fails.
    }

    const out: CourseEvalSummaryOutput = {
      courseId: normalized,
      summaryText,
      hasData: true,
      metrics: {
        overallQuality: row.overall_quality,
        teachingEffectiveness: row.teaching_effectiveness,
        intellectualChallenge: row.intellectual_challange,
        taQuality: row.ta_quality,
        feedbackQuality: row.feedback_quality,
        workload: row.work_load,
        responseRate: row.response_rate,
        sampleSize: row.sample_size,
      },
      attribution: {
        instructors: row.instructors ?? [],
        startTerm: row.start_term,
        endTerm: row.end_term,
      },
    };

    summaryCache.set(normalized, out);
    return out;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return {
      courseId: normalized,
      summaryText: null,
      hasData: false,
      message: `Failed to generate summary: ${detail}`,
    };
  }
}
