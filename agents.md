# Project Configuration

## Project Description

Atlas is an AI-assisted schedule builder/advisor for JHU undergraduate students. It combines course search, schedule planning, and personalized advising using SIS data, course evaluations, and user onboarding preferences.

## Tech Stack

- Frontend: React + TypeScript (Vite) + Tailwind CSS — `frontend/`
- Backend: Node.js + Express + TypeScript — `backend/`
- Database: PostgreSQL + pgvector — `database/init.sql`, `docker-compose.yml`
- Auth: Google OAuth 2.0 + `express-session` + Postgres session store
- LLM:
  - OpenAI `gpt-4o-mini` (agent, onboarding parsing, schedule audit, eval summaries)
  - OpenAI `text-embedding-3-small` (semantic course search embeddings)
- AI orchestration: Vercel AI SDK (`generateText`, `generateObject`, tool calling)
- Testing: Vitest (backend + frontend), Playwright (frontend e2e)

## Commands

- Install dependencies:
  - `cd backend && npm install`
  - `cd frontend && npm install`
- Start local DB: `docker compose up -d`
- Apply DB schema: `psql "$DATABASE_URL" -f database/init.sql`
- Run backend dev server: `cd backend && npm run dev`
- Run frontend dev server: `cd frontend && npm run dev`
- Build:
  - `cd backend && npm run build`
  - `cd frontend && npm run build`
- Lint:
  - `cd backend && npm run lint`
  - `cd frontend && npm run lint`
- Tests:
  - `cd backend && npm test`
  - `cd frontend && npm test`
  - `cd frontend && npm run test:e2e`
- Data jobs:
  - `cd backend && npm run seed` (SIS embeddings)
  - `cd backend && npm run scrape-evals` (course evaluations)

## Code Style

- Make sure all code written is clean, concise, and organized
- Language: TypeScript (strict mode)
- Naming: camelCase (variables/functions), PascalCase (components/types)
- Formatting: Prettier
- Linting: ESLint
- Comments should explain intent/trade-offs only (not narrate obvious code)

## Architecture

```text
team-02/
├── backend/
│   └── src/
│       ├── index.ts                         # Express app entrypoint + route mounting
│       ├── db.ts                            # PostgreSQL pool + eval summary cache helpers
│       ├── pool.ts                          # shared DB pool export
│       ├── middleware/
│       │   ├── session.ts                   # express-session + connect-pg-simple
│       │   ├── populateUser.ts              # attaches req.user from session
│       │   └── auth.ts                      # requireAuth + dev auth helpers
│       ├── routes/
│       │   ├── agent.ts                     # POST /api/agent
│       │   ├── courses.ts                   # /api/courses/:id/eval-summary, /details
│       │   ├── schedules.ts                 # /api/schedules CRUD + courses + audit
│       │   ├── users.ts                     # /api/user, /api/user/profile
│       │   └── auth.ts                      # /auth/google, callback, logout
│       ├── tools/
│       │   ├── search-course-descriptions.ts
│       │   ├── search-courses-by-sis-constraints.ts
│       │   ├── get-course-eval-summary.ts
│       │   └── analyze-schedule-workload.ts
│       ├── services/
│       │   ├── sis-client.ts                # SIS API client + detail-cache integration
│       │   ├── sis-course-details-cache.ts  # SIS detail response cache table logic
│       │   ├── parse-onboarding-responses.ts# LLM structured memory extraction
│       │   ├── schedule-context.ts          # schedule + profile context for agent/audit
│       │   ├── embeddings.ts                # embedding generation client
│       │   └── query-scope.ts               # in-scope/out-of-scope query classification
│       ├── scripts/
│       │   ├── seed-embeddings.ts
│       │   └── scrape-course-evaluations.ts
│       └── types/
│           ├── sis.ts
│           ├── search.ts
│           ├── eval-summary.ts
│           └── database.ts
├── frontend/
│   └── src/
│       ├── main.tsx                         # routes: /login, /, /onboarding, /schedules/:id
│       ├── App.tsx                          # home + onboarding shell
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── SchedulesDashboard.tsx
│       │   └── SchedulePage.tsx
│       ├── components/
│       │   ├── ScheduleChat.tsx
│       │   ├── CourseCard.tsx
│       │   ├── Onboard.tsx
│       │   └── AuthGuard.tsx
│       ├── hooks/
│       │   ├── useApi.tsx
│       │   ├── useSchedules.ts
│       │   └── useAuth.ts
│       └── store/atoms.ts
├── database/
│   └── init.sql                             # embeddings/evals/users/profiles/schedules/audits/cache tables
├── docs/
└── docker-compose.yml
```

## Agent Architecture (`POST /api/agent`)

- Uses Vercel AI SDK `generateText` with tool calling.
- Supports optional `scheduleId`; when present, it loads schedule + user profile context and appends it to system instructions.
- In-scope guardrails:
  - Out-of-scope queries return a fixed redirect message.
  - Empty/no-result responses are normalized to a fallback no-results message.

### Agent tools

- `searchCourseDescriptions` (semantic vector search over `course_embeddings`)
- `searchCoursesBySisConstraints` (SIS structured filtering)
- `generateDaysOfWeek` (encodes SIS day mask strings)
- `getCourseEvalSummary` (evaluation summary from `course_evaluations` with DB cache)
- `fetchSisCourseDetails` (SIS offering details via cache + API)

### Response shape

JSON with `type` in:

- `"search"`: `results[]` (course cards)
- `"summary"`: evaluation summary payload
- `"details"`: SIS course details payload
- `"text"`: plain message
- `"error"`: failure response

## Database Schema (high-level)

- `course_embeddings`
- `course_evaluations`
- `course_summaries`
- `sis_course_details_cache`
- `users`
- `user_profiles`
- `schedules`
- `schedule_courses`
- `schedule_audits`
- session table (`connect-pg-simple`, auto-created if missing)

## Branch & Commit Conventions

- Branch pattern: `<author>/<type>/issue-<number>-<short-description>`
  - `type`: `feature`, `bug`, or `task`
- Never push directly to `master`
- Reference issue numbers in commit messages, e.g. `Add file validation (#12)`
- Keep PRs small (target < ~400 changed lines)
- Use merge commits (no squash or rebase)
- Label PRs with `feature`, `bug`, or `task`

## Common Mistakes

- Forgetting issue references in commits/PR titles
- Skipping `npm run lint` before pushing
- Running full-project `tsc --noEmit` and expecting it to be practical in CI
  - Prefer `npm run lint`, `npm run build`, and tests for verification
- Missing OAuth setup (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI)
- Missing session/OAuth env vars (`SESSION_SECRET`, `FRONTEND_URL`, deployment `BACKEND_URL`)
- Creating module-level OpenAI clients before env initialization in new files
