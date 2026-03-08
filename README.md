# Course Search

A JHU course search tool powered by semantic search and AI-generated summaries.

**Live demo:** https://team-02-nire.onrender.com/

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Git](https://git-scm.com/downloads)
- [GitHub CLI (`gh`)](https://cli.github.com/)

## Local Setup

```bash
# Clone the repository
git clone <repo-url>
cd team-02

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy and fill in environment variables
cp backend/.env.example backend/.env
# Edit backend/.env and fill in your keys
```

## Running the Application

**Database**

The app requires PostgreSQL with pgvector. Choose one:

- **Team members:** Use the shared Supabase project. Get the `DATABASE_URL` from the team and add it to `backend/.env`.
- **External contributors:** Either spin up a local Postgres instance with Docker (`docker compose up -d`) or create a free [Supabase](https://supabase.com/) project.

Then initialize the schema:

```bash
psql $DATABASE_URL -f database/init.sql
```

**1. Start the backend** (in one terminal)

```bash
cd backend
npm run dev
# Runs on http://localhost:3001
```

**2. Start the frontend** (in another terminal)

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
