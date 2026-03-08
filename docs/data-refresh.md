# Data Refresh Guide

This document describes how to refresh the two data pipelines that populate the application's database: the **SIS course embeddings** and the **course evaluations**. Any team member should be able to follow these steps.

## Prerequisites

- Node.js v20+
- Access to the Supabase project or a local PostgreSQL instance with pgvector
- Backend dependencies installed (`cd backend && npm install`)
- If using the local database, start it from the repo root with `docker compose up -d`
- The following environment variables set in `backend/.env`:
  - `DATABASE_URL` — PostgreSQL connection string (Supabase or local Docker)
  - `OPENAI_API_KEY` — required for generating embeddings (seed only)
  - `JHU_SIS_API_KEY` — register at <https://sis.jhu.edu/api> (seed only)
- Database schema already applied from the repo root (`psql "$DATABASE_URL" -f database/init.sql`)

## 1. Refresh SIS Course Embeddings

This pipeline fetches Spring 2026 courses from the JHU SIS API, generates vector embeddings (OpenAI `text-embedding-3-small`), and upserts them into the `course_embeddings` table.

### What it does

1. Fetches all course sections from two schools (Krieger School of Arts and Sciences, Whiting School of Engineering) via the SIS `/classes` bulk endpoint.
2. Deduplicates by `OfferingName`.
3. Fetches individual course descriptions from the SIS detail endpoint (concurrent batches of 10).
4. Generates embeddings for `"Title. Description"` text using OpenAI, in batches of 100.
5. Upserts rows into `course_embeddings` (on conflict by `course_id`).

### How to run

From the `backend/` directory:

```bash
npm run seed
```

This runs `ts-node src/scripts/seed-embeddings.ts`.

### Configuration

The script has constants at the top of `src/scripts/seed-embeddings.ts` that you can adjust:

- `TERM` — currently `"Spring 2026"`. Change this to target a different term.
- `SCHOOLS` — array of school names to fetch. Currently Krieger and Whiting.
- `EMBED_BATCH_SIZE` — number of courses per OpenAI embedding call (default 100).
- `DESC_CONCURRENCY` — concurrent SIS description requests (default 10).

### Known limitations

- **Cost:** Each full run generates embeddings for ~1,000+ courses. At OpenAI's `text-embedding-3-small` pricing this is inexpensive (fractions of a cent) but be aware it calls the API.

## 2. Refresh Course Evaluations

Course evaluation metrics are scraped from the [JHU EvaluationKit public report](https://asen-jhu.evaluationkit.com/Report/Public) and stored in the `course_evaluations` table.

### What it does

1. Launches a headless Chromium browser via Playwright.
2. Navigates to the EvaluationKit public report page.
3. For each course prefix (`AS.`, `EN.`), searches and filters by year (currently `2025`).
4. Expands all results ("Show more results" until exhausted).
5. For each result, opens the "View Report" popup and extracts six quantitative metrics from the report JSON (or falls back to DOM parsing):
   - `overall_quality`
   - `teaching_effectiveness`
   - `intellectual_challange`
   - `ta_quality`
   - `feedback_quality`
   - `work_load`
6. Upserts rows into `course_evaluations`, keyed by `(course_code, section_number, semester, instructor)`. Re-running the scraper updates existing rows for that key with newly scraped values. Rows with zero metrics are skipped.

### How to run

From the `backend/` directory:

```bash
# Install Playwright browser (first time only)
npx playwright install chromium

# Run the scraper
npm run scrape-evals
```

This runs `ts-node src/scripts/scrape-course-evaluations.ts`.

### Modes

- **Default (headless):** `npm run scrape-evals` -- scrapes and writes to DB.
- **Dry run:** `npm run scrape-evals -- --dry-run` -- scrapes and logs results without writing to DB. Useful for verifying the scraper works before committing data.
- **Discover:** `npm run scrape-evals -- --discover` -- opens a visible browser, saves HTML and screenshots to `backend/scrape-debug/` for inspecting page structure. Use this when the EvaluationKit UI changes and the scraper needs updating.

### Configuration

Constants at the top of `src/scripts/scrape-course-evaluations.ts`:

- `SEARCH_COURSE_PREFIXES` — currently `["AS.", "EN."]`. Add more prefixes to cover other schools.
- `TARGET_YEARS` — currently `["2025"]`. Update this each semester.

### Known limitations

- **Scrape takes a while:** The script opens a popup for every course evaluation result, so a full run can take 10-20+ minutes depending on the number of results.
- **EvaluationKit UI changes:** If EvaluationKit changes their page structure, the scraper may break. Use `--discover` mode to inspect the current page and update selectors as needed.
- **Failed rows:** Rows that fail to yield metrics after retry are written to `backend/scrape-failed.json` for manual inspection.
- **Concurrency:** The scraper runs 4 concurrent popup workers. If the site throttles, you may need to reduce this (the `withConcurrency` call in the `scrape()` function).
- **Updating existing local schemas:** If your database was initialized before the unique refresh key was added, apply the latest `database/init.sql` changes or create the `course_evaluations_refresh_key` index before relying on reruns to update existing rows.

## Troubleshooting

- **`JHU_SIS_API_KEY is not set`** — Make sure `backend/.env` has the key. Register at <https://sis.jhu.edu/api> if you don't have one.
- **`No courses fetched`** — The SIS API may be unreachable. Verify your `JHU_SIS_API_KEY` is valid and try the same request in a browser to confirm.
- **Embedding failures** — Check that `OPENAI_API_KEY` is valid and has available credits.
- **Database connection errors** — Verify `DATABASE_URL` is correct and the Supabase project is running. If using the session pooler, ensure port 5432 is used.
- **`gen_random_uuid()` is undefined** — Re-apply `database/init.sql` so the `pgcrypto` extension is enabled.
- **Playwright errors** — Run `npx playwright install chromium` if you get browser-not-found errors.
- **Scraper returns 0 metrics for all rows** — The EvaluationKit page structure may have changed. Run `npm run scrape-evals -- --discover` and check the saved HTML/screenshots in `backend/scrape-debug/`.
