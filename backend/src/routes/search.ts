import { Router, Request, Response } from "express";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";
import { filterSisCourses } from "../tools/filter-sis-courses";
import { fetchSisCourseDescription } from "../services/sis-client";
import type { SearchResult } from "../types/search";

const DEFAULT_TERM = "Spring 2026";

/** Combine instructor names, deduplicate, and join with ";". */
function combineUniqueInstructors(
  ...instructorStrings: (string | undefined)[]
): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of instructorStrings) {
    if (!s?.trim()) continue;
    for (const part of s.split(/[,;]/)) {
      const name = part.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names.join("; ");
}

/**
 * Enrich semantic search results: do exact SIS lookup by course code to get
 * full details (instructor, description). No matchExplanation (hidden for semantic).
 * Fetches multiple sections to ensure instructor is found when available.
 */
async function enrichSemanticWithExact(
  semanticResults: SearchResult[],
  term: string,
): Promise<SearchResult[]> {
  const enriched: SearchResult[] = [];
  for (const sem of semanticResults) {
    const exactOutput = await filterSisCourses(
      { Term: term, CourseNumber: sem.code },
      10,
    );

    if (exactOutput.courses.length > 0) {
      const sisResults = await sisCoursesToSearchResults(
        exactOutput.courses,
        term,
        true,
      );
      const merged = mergeExactResultsByCodeAndInstructor(sisResults);
      const first = merged[0];
      enriched.push({
        ...first,
        rank: sem.rank,
        relevanceScore: sem.relevanceScore,
      });
    } else {
      enriched.push({
        ...sem,
        instructor: undefined,
      });
    }
  }
  return enriched;
}

/**
 * Merge exact search results that share the same course code into a single
 * result per code. Combines instructor names (unique, joined by "; ").
 */
function mergeExactResultsByCodeAndInstructor(
  results: SearchResult[],
): SearchResult[] {
  const byCode = new Map<string, SearchResult[]>();
  for (const r of results) {
    const list = byCode.get(r.code) ?? [];
    list.push(r);
    byCode.set(r.code, list);
  }
  const merged: SearchResult[] = [];
  let rank = 1;
  for (const list of byCode.values()) {
    const first = list[0];
    const sectionIds = list.map((r) => r.sisOfferingName).filter(Boolean);
    const instructor = combineUniqueInstructors(
      ...list.map((r) => r.instructor).filter(Boolean),
    );
    const mergedId = `${first.code.replace(/\./g, "-").toLowerCase()}-${first.term.replace(/\s+/g, "-").toLowerCase()}`;
    merged.push({
      ...first,
      courseId: mergedId,
      sisOfferingName:
        sectionIds.length > 1 ? sectionIds.join(", ") : first.sisOfferingName,
      instructor: instructor || undefined,
      rank: rank++,
    });
  }
  return merged;
}

/** Map filterSisCourses output to the search API result shape (with optional description fetch). */
async function sisCoursesToSearchResults(
  courses: Array<{
    offeringName: string;
    sectionName: string;
    title: string;
    description: string;
    instructors: string[];
  }>,
  term: string,
  fetchDescriptions: boolean = true,
): Promise<SearchResult[]> {
  const withDescriptions = fetchDescriptions
    ? await Promise.all(
        courses.map(async (c) => {
          const desc =
            c.description ||
            (await fetchSisCourseDescription(c.offeringName, c.sectionName, term));
          return { ...c, description: desc };
        }),
      )
    : courses;

  return withDescriptions.map((c, i) => ({
    courseId: `${c.offeringName.replace(/\./g, "-").toLowerCase()}-${term.replace(/\s+/g, "-").toLowerCase()}`,
    sisOfferingName: c.offeringName,
    code: c.offeringName.split(".").slice(0, 3).join(".") || c.offeringName,
    title: c.title,
    shortDescription: c.description,
    term,
    rank: i + 1,
    relevanceScore: 1,
    instructor:
      c.instructors.length > 0
        ? combineUniqueInstructors(c.instructors.join(", "))
        : undefined,
  }));
}

const router = Router();

// GET /api/search?query=...&limit=10&mode=exact|semantic
// First tries exact match via SIS API (filterSisCourses), then semantic (course_embeddings) if no results.
router.get("/", async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;
  const limitParam = req.query.limit;
  const limit =
    typeof limitParam === "string" ? parseInt(limitParam, 10) : undefined;
  const mode =
    typeof req.query.mode === "string"
      ? (req.query.mode as "exact" | "semantic")
      : undefined;

  if (!query || !query.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const lim = limit ?? 10;

  try {
    if (mode === "semantic") {
      const semanticOutput = await searchCourseDescriptions({ query, limit: lim });
      const enriched = await enrichSemanticWithExact(semanticOutput.results, DEFAULT_TERM);
      return res.json({ results: enriched });
    }

    // Exact match: use filterSisCourses (SIS API) with CourseNumber, CourseTitle, or Instructor
    const trimmed = query.trim();
    const looksLikeCode = /^[A-Za-z]{2,3}\.\d{3}\.\d{3}/.test(trimmed);
    const looksLikeCourseId = /^[a-z]{2,3}-\d{3}-\d{3}(-[a-z0-9-]+)?$/i.test(
      trimmed.replace(/\s+/g, ""),
    );

    let exactOutput;
    if (looksLikeCode) {
      exactOutput = await filterSisCourses(
        { Term: DEFAULT_TERM, CourseNumber: trimmed },
        lim,
      );
    } else if (looksLikeCourseId) {
      const courseNumber = trimmed
        .split("-")
        .slice(0, 3)
        .map((p, i) => (i === 0 ? p.toUpperCase() : p))
        .join(".");
      exactOutput = await filterSisCourses(
        { Term: DEFAULT_TERM, CourseNumber: courseNumber },
        lim,
      );
    } else {
      // Try course title first, then instructor if no results
      exactOutput = await filterSisCourses(
        { Term: DEFAULT_TERM, CourseTitle: trimmed },
        lim,
      );
      if (exactOutput.courses.length === 0) {
        exactOutput = await filterSisCourses(
          { Term: DEFAULT_TERM, Instructor: trimmed },
          lim,
        );
      }
    }
    let exactResults = await sisCoursesToSearchResults(
      exactOutput.courses,
      DEFAULT_TERM,
      true,
    );
    exactResults = mergeExactResultsByCodeAndInstructor(exactResults);

    if (mode === "exact") {
      return res.json({ results: exactResults });
    }
    if (exactResults.length > 0) {
      return res.json({ results: exactResults });
    }
    if (looksLikeCode || looksLikeCourseId) {
      return res.json({ results: [] });
    }

    const semanticOutput = await searchCourseDescriptions({ query, limit: lim });
    const enriched = await enrichSemanticWithExact(semanticOutput.results, DEFAULT_TERM);
    res.json({ results: enriched });
  } catch (err) {
    console.error("Search error:", err);
    let message: string =
      err instanceof Error ? err.message : "Search failed. Please try again.";
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "ECONNREFUSED") {
      message =
        "Database connection refused. Is PostgreSQL running? Check DATABASE_URL and try 'docker compose up -d' if using Docker.";
    } else if (message.includes("Invalid URL") || code === "ERR_INVALID_URL") {
      message =
        "Invalid DATABASE_URL in backend .env. Use a full URL, e.g. postgresql://user:pass@host:5432/dbname";
    } else if (message.includes("does not exist") || message.includes("relation")) {
      message =
        "Database table missing. Run the course_embeddings migration and seed (see database/migrations and backend README).";
    }
    res.status(500).json({
      error: "Search failed. Please try again.",
      detail: message,
    });
  }
});

export default router;
