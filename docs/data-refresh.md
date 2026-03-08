# Data Refresh Guide

This document describes how to refresh the two data pipelines that populate the application's database: the **SIS course embeddings** and the **course evaluations**. Any team member should be able to follow these steps.

## Prerequisites

- Node.js v20+
- Access to the Supabase project (or a local PostgreSQL instance with pgvector)
- The following environment variables set in `backend/.env`:
  - `DATABASE_URL` — Supabase session pooler connection string
  - `OPENAI_API_KEY` — required for generating embeddings
  - `JHU_SIS_API_KEY` — register at <https://sis.jhu.edu/api>
- Database schema already applied (`database/init.sql`)

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

### Known issues

<!-- TODO: Confirm whether JHU VPN is actually required — current evidence suggests it is NOT needed. The seed script header says VPN is required, but this may be outdated. -->

- **Cloudflare blocking:** As of early 2026, the SIS API at `sis.jhu.edu` has Cloudflare bot protection that returns 403 for programmatic HTTP clients (Node.js fetch, curl, etc.). Browser requests with the same API key work fine. This is a JHU IT configuration issue — we've reached out to request a WAF exemption for `/api/*` routes. Until resolved, the seed script may fail.
- **Cost:** Each full run generates embeddings for ~1,000+ courses. At OpenAI's `text-embedding-3-small` pricing this is inexpensive (fractions of a cent) but be aware it calls the API.

## 2. Refresh Course Evaluations

Course evaluation metrics are scraped from the [JHU EvaluationKit public report](https://asen-jhu.evaluationkit.com/Report/Public) and stored in the `course_evaluations` table.

### How to run

From the `backend/` directory:

```bash
npm run scrape-evals
```

### Prerequisites (in addition to the common ones above)

- Playwright with Chromium installed:
  ```bash
  npx playwright install chromium
  ```

### Known issues

<!-- TODO: The scrape-evals script and npm command are referenced in the README but do not appear to exist on master yet. Confirm with the team where this script lives (possibly merged from rachael/task/issue-43-scrape-course-evals or issue-43-update-course-evals-db). Fill in the details once located. -->

- **Script status:** The `scrape-evals` script is referenced in the README but may not be on `master` yet. See the team for the current state of this pipeline.

## Troubleshooting

- **`JHU_SIS_API_KEY is not set`** — Make sure `backend/.env` has the key. Register at <https://sis.jhu.edu/api> if you don't have one.
- **`No courses fetched`** — The SIS API may be unreachable (see Cloudflare issue above). Try the same request in a browser to confirm.
- **Embedding failures** — Check that `OPENAI_API_KEY` is valid and has available credits.
- **Database connection errors** — Verify `DATABASE_URL` is correct and the Supabase project is running. If using the session pooler, ensure port 5432 is used.
- **Playwright errors** — Run `npx playwright install chromium` if you get browser-not-found errors.
