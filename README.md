# Atlas

AI-assisted schedule builder and advisor for JHU undergraduates.

Deployed version: https://team-02-nire.onrender.com/


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

cd ../frontend
npm run lint
npm run build
npm test
npm run test:e2e
```

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
| `DELETE` | `/api/schedules/:id` | Delete schedule (auth required) |
| `POST` | `/api/schedules/:id/courses` | Add course to schedule (auth required) |
| `DELETE` | `/api/schedules/:id/courses` | Remove course from schedule (auth required) |
| `POST` | `/api/schedules/:id/audit` | Run and persist workload audit (auth required) |

## More Documentation

- [Project docs index](docs/README.md)
- [Data refresh guide](docs/data-refresh.md)
- [Backend SIS API notes](docs/backend-sis-api-readme.md)
