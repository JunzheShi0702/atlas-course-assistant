# Atlas

AI-assisted schedule builder and advisor for JHU undergraduates.

Deployed version: configure in Vercel.


## Tech Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL + pgvector
- LLM: OpenAI (`gpt-4o-mini`)
- AI SDK: Vercel AI SDK (`generateText` / `generateObject` + tool calling)
- Testing: Vitest + Playwright

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL (local Docker or hosted, e.g. Supabase)
- Google OAuth credentials (for login)
- JHU SIS API key
- OpenAI API key

## Local Setup

```bash
git clone <repo-url>
cd team-02

cd backend && npm install && cd ..
cd frontend && npm install && cd ..

cp backend/.env.example backend/.env
```

Set values in `backend/.env`:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `JHU_SIS_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `FRONTEND_URL=http://localhost:5173`
- `BACKEND_URL=http://localhost:3001` (optional locally, recommended in deployment)
- `TAVILY_API_KEY` (optional; enables Reddit search tool in agent workflow)

## Database

Start local Postgres + pgvector (optional if using hosted DB):

```bash
docker compose up -d
```

Apply schema:

```bash
psql "$DATABASE_URL" -f database/init.sql
```

### Supabase Option

You can use Supabase instead of local Docker:

1. Create or use an existing Supabase project.
2. Copy the Session Pooler connection string into `backend/.env` as `DATABASE_URL`.
3. Apply the schema:

```bash
psql "$DATABASE_URL" -f database/init.sql
```

The project’s `backend/.env.example` includes a Supabase `DATABASE_URL` template.


## Run the App

Backend (terminal 1):

```bash
cd backend
npm run dev
```

Frontend (terminal 2):

```bash
cd frontend
npm run dev
```

App URL: `http://localhost:5173`

## Google OAuth Setup

In Google Cloud Console, configure the OAuth client redirect URI:

- `http://localhost:3001/auth/google/callback` (for local)
- `https://<your-backend-domain>/auth/google/callback` (for deployed)

## Vercel Deployment

The repo includes `vercel.json` for a single Vercel project:

- Builds the React app from `frontend/` into `frontend/dist`.
- Routes `/api/*` and `/auth/*` to the Express backend through `api/index.ts`.
- Routes all other paths to `index.html` for React Router.
- Runs a weekly Vercel Cron request to `/api/keepalive`, which performs a
  lightweight `SELECT 1` query to keep the Supabase database active.

Create a Vercel project from the repository root and use the checked-in settings.
Set these environment variables in Vercel:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `JHU_SIS_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `TAVILY_API_KEY` (optional; enables Reddit search)
- `FRONTEND_URL` (optional if using the Vercel domain)
- `BACKEND_URL` (optional if using the Vercel domain)
- `GOOGLE_CALLBACK_URL` (optional override)

If you use the Vercel domain for both frontend and backend, the app can infer
the public URL from Vercel's system environment variables. For a custom domain,
set `FRONTEND_URL` and `BACKEND_URL` to the same `https://...` origin unless you
split the frontend and backend across separate domains.

In Google Cloud Console, add the Vercel callback URL:

```text
https://atlas-course-assistant.vercel.app/auth/google/callback
```

The keepalive cron is scheduled as:

```text
0 0 * * 0
```

That runs once every Sunday at 00:00 UTC.

## Data Refresh Jobs

From `backend/`:

```bash
# Rebuild course embedding index from SIS
npm run seed

# Refresh evaluation metrics from EvaluationKit
npm run scrape-evals
```

`scrape-evals` uses Playwright; if prompted, install browser binaries:

```bash
npx playwright install chromium
```

## Testing and Quality Checks

```bash
cd backend
npm run lint
npm run build
npm test
npm run test:coverage

cd ../frontend
npm run lint
npm run build
npm test
npm run test:coverage
npm run test:e2e
```

Database-backed backend integration tests are opt-in for local runs. Set
`RUN_DATABASE_INTEGRATION=1` with `DATABASE_URL` pointed at a disposable
PostgreSQL database that has pgvector available.

The Playwright full-stack smoke test is also opt-in locally. Set
`FULL_STACK_E2E=1` to start the backend alongside the frontend and verify the
real Vite proxy path to backend auth/health routes.

### Coverage Targets

- Backend coverage is enforced by Vitest with minimum thresholds of:
  - `lines`: 60%
  - `functions`: 60%
  - `statements`: 60%
  - `branches`: 50%
- Frontend coverage is enforced by Vitest with minimum thresholds of:
  - `lines`: 50%
  - `functions`: 50%
  - `statements`: 50%
  - `branches`: 40%
- Coverage reports are written to `backend/coverage/` and `frontend/coverage/`.
- CI runs lint, build, unit tests, coverage, backend database integration tests,
  and Playwright E2E on pull requests and pushes to `master`.
- CI uses a `pgvector/pgvector` PostgreSQL service for database integration
  coverage.

### Testing Expectations

- Route behavior should be covered with backend route tests using mocked dependencies where appropriate.
- Core middleware should have direct tests when the middleware carries auth, session, or request-shaping behavior.
- Pure parsing and normalization logic should be tested directly, even when the production entrypoint is a script.
- Frontend unit tests should cover component and hook behavior with Vitest; end-to-end user flows should be covered with Playwright.
- Playwright currently runs desktop Chromium. Broader mobile/tablet/browser
  coverage should be added when the team is ready to own the extra CI time and
  responsive assertions.

## API Overview

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/auth/me` | Current authenticated user |
| `GET` | `/auth/google` | Start Google OAuth |
| `GET` | `/auth/google/callback` | OAuth callback |
| `POST` | `/auth/logout` | Logout and destroy session |
| `POST` | `/api/agent` | Main chat/agent endpoint (`message`, optional `scheduleId`) |
| `GET` | `/api/courses/:id/eval-summary` | Eval summary for a course code |
| `GET` | `/api/courses/:id/details` | SIS details for a course offering id |
| `POST` | `/api/user` | Upsert user by Google sub |
| `GET` | `/api/user/profile` | Get profile (auth required) |
| `PUT` | `/api/user/profile` | Upsert profile + derived memories (auth required) |
| `GET` | `/api/schedules` | List schedules (auth required) |
| `POST` | `/api/schedules` | Create schedule (auth required) |
| `GET` | `/api/schedules/:id` | Get schedule detail (auth required) |
| `GET` | `/api/schedules/:id/events` | Get weekly calendar event DTO (auth required) |
| `GET` | `/api/schedules/:id/chat` | Get schedule chat history + rolling summary (auth required) |
| `DELETE` | `/api/schedules/:id` | Delete schedule (auth required) |
| `POST` | `/api/schedules/:id/courses` | Add course to schedule (auth required) |
| `DELETE` | `/api/schedules/:id/courses` | Remove course from schedule (auth required) |
| `POST` | `/api/schedules/:id/custom-events` | Create custom event (auth required) |
| `PATCH` | `/api/schedules/:id/custom-events/:eventId` | Update custom event (auth required) |
| `DELETE` | `/api/schedules/:id/custom-events/:eventId` | Delete custom event (auth required) |
| `POST` | `/api/schedules/:id/audit` | Run and persist workload audit (auth required) |
| `GET` | `/api/user/memories` | List stored user memories (auth required) |
| `POST` | `/api/user/memories/manual` | Add manual memory (auth required) |
| `POST` | `/api/user/memories/clear-conversations` | Clear conversation/manual memories (auth required) |
| `POST` | `/api/user/memories/transcript/process` | Classify transcript course codes for review (auth required) |
| `POST` | `/api/user/memories/transcript/save` | Save reviewed transcript course history (auth required) |
| `POST` | `/api/user/memories/course-history` | Upsert single course-history memory (auth required) |
| `DELETE` | `/api/user/memories/:id` | Delete memory by id (auth required) |
| `DELETE` | `/api/user` | Delete authenticated user and related data (auth required) |

## More Documentation

- [Project docs index](docs/README.md)
- [Data refresh guide](docs/data-refresh.md)
- [Backend SIS API notes](docs/backend-sis-api-readme.md)
