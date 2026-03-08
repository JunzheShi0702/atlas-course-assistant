# Course Search

A JHU course search tool powered by semantic search and AI-generated summaries.

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker](https://www.docker.com/) (for PostgreSQL + pgvector)
- [Git](https://git-scm.com/downloads)
- [GitHub CLI (`gh`)](https://cli.github.com/)

## Setup

```bash
# Clone the repository
git clone <repo-url>
cd team-02

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy and fill in environment variables
cp .env.example backend/.env
# Edit backend/.env and add your OPENAI_API_KEY
```

## Running the Application

**1. Start the database** (requires Docker)

```bash
docker compose up -d
```

**Database schema**

We use **Supabase** for PostgreSQL. In the [Supabase SQL Editor](https://supabase.com/dashboard) (your project → SQL Editor):

- **New project:** Run `database/init.sql` once. It creates `courses`, `course_embeddings`, and `course_evaluations`.
- **Existing project (schema updates):** Run the migration files in **order** (001, then 002). 001 adds `course_embeddings` if missing; 002 adds `course_code` to `course_evaluations` and drops `course_id` if present.

From the CLI you can instead run:
  ```bash
  psql $DATABASE_URL -f database/init.sql
  # or for migrations: 001 then 002
  psql $DATABASE_URL -f database/migrations/001_course_embeddings.sql
  psql $DATABASE_URL -f database/migrations/002_course_evaluations_course_code.sql
  ```

**2. Start the backend** (in one terminal)

```bash
cd backend
npm run dev
# Runs on http://localhost:3001
```

**3. Start the frontend** (in another terminal)

```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Course evaluation data

Quantitative course evaluation metrics are scraped from the [JHU EvaluationKit public report](https://asen-jhu.evaluationkit.com/Report/Public) and stored in the `course_evaluations` table. To refresh that data (e.g. at the start of a semester), from the `backend` directory run:

```bash
npm run scrape-evals
```

Requires `DATABASE_URL` in `backend/.env`. After the first run, install Playwright browsers if prompted: `npx playwright install chromium`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/agent` | Query-based entry point (search, summarize, details); body `{ "message": string }` |
| GET | `/api/courses/:id/eval-summary` | AI-generated summary from scraped evaluation data (Supabase `course_evaluations`) |
| GET | `/api/courses/:id/details` | Full SIS course details (schedule, instructor, location) |

Evaluation data (overall quality, workload, difficulty, etc.) is scraped via Playwright into `course_evaluations` and used in the **eval-summary** response; there is no separate metrics endpoint.

## Deployment (Render)

On push to `master`, GitHub Actions triggers deploys via Render Deploy Hooks. Add these repository secrets (Settings → Secrets and variables → Actions):

- **RENDER_DEPLOY_HOOK_URL_BACKEND** — from Render dashboard → backend service → Settings → Deploy Hook
- **RENDER_DEPLOY_HOOK_URL_FRONTEND** — from Render dashboard → frontend service → Settings → Deploy Hook

## Tech Stack

- **Frontend:** React + TypeScript (Vite)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL with pgvector
- **LLM:** OpenAI GPT-4

## Documentation

- Iteration plans: `docs/iteration-x-plan.md`
- Product Requirements: `docs/product-requirements.md`
- Team Agreement: `docs/team-agreement.md`
