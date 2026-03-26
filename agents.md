# Project Configuration

## Project Description

An AI-assisted schedule builder/advisor for JHU undergraduate students. This is a project for a class titled "AI Enabled Software Engineering" that has a focus on incorporating agentic AI in software.

## Tech Stack

- Frontend: React + TypeScript (Vite) + TailwindCSS — `frontend/`
- Backend: Node.js + Express + TypeScript — `backend/`
- Database: PostgreSQL with pgvector (Docker) — `docker-compose.yml`, `database/init.sql`
- LLM: OpenAI GPT-4 family (currently GPT-4o-mini) via OpenAI API
  - Embeddings: OpenAI text-embedding-3-small
- AI Orchestration: Vercel AI SDK (`generateText` + tool calling)
- Testing: Vitest (unit/integration), Playwright (end-to-end), Postman (for manual tests)

## Commands

- Install dependencies: `cd backend && npm install` / `cd frontend && npm install`
- Start database: `docker compose up -d`
- Run backend dev server: `cd backend && npm run dev`
- Run frontend dev server: `cd frontend && npm run dev`
- Build backend: `cd backend && npm run build`
- Build frontend: `cd frontend && npm run build`
- Run linter (backend): `cd backend && npm run lint`
- Run linter (frontend): `cd frontend && npm run lint`
- Run backend tests: `cd backend && npm test`

## Code Style

- Make sure all code written is clean, concise, and organized
- Language: TypeScript (strict mode) for both frontend and backend
- Naming conventions: camelCase for variables/functions, PascalCase for React components and types
- Formatting: Prettier
- Linting: ESLint
- No comments that just narrate the code — only explain non-obvious intent or trade-offs

## Architecture

```
team-02/
├── backend/                      # Express API server + LLM tools
│   └── src/
│       ├── index.ts              # Entry point (Express app + routes)
│       ├── db.ts                 # PostgreSQL connection pool
│       ├── routes/
│       │   ├── agent.ts          # POST /api/agent (LLM agent entrypoint)
│       │   ├── courses.ts        # /api/courses/:id/eval-summary, /api/courses/:id/details
│       │   └── schedules.ts      # /api/schedules CRUD + /api/schedules/:id/courses
│       ├── tools/                # LLM tools (registered with Vercel AI SDK)
│       │   ├── search-course-descriptions.ts  # Vector semantic search
│       │   ├── filter-sis-courses.ts    # SIS API structured filter
│       │   └── get-course-eval-summary.ts     # Evaluation summary
│       ├── services/             # External service clients
│       │   └── sis-client.ts     # JHU SIS API wrapper
│       ├── scripts/
│       │   └── seed-embeddings.ts  # Embed & upsert undergrad courses into pgvector
│       └── types/
│           ├── sis.ts            # SIS data types + utilities (parseCourseNumber, isUndergraduateCourse)
│           └── search.ts         # SearchResult / tool I/O types
├── frontend/                     # React + Vite app
│   └── src/
│       ├── main.tsx              # Vite entry + React Router setup
│       ├── App.tsx               # Home page (course search + shortlist)
│       ├── components/
│       │   ├── CourseCard.tsx    # Course card with shortlist + add-to-schedule actions
│       │   ├── ScheduleChat.tsx  # Schedule-aware chat panel (POST /api/agent)
│       │   └── ...
│       ├── pages/
│       │   ├── SchedulesDashboard.tsx  # /schedules — grid of schedule cards
│       │   └── SchedulePage.tsx        # /schedules/:id — chat + course list + audit
│       ├── hooks/
│       │   ├── useApi.tsx        # Agent API hook (search, SIS details, eval summary)
│       │   └── useSchedules.ts   # Schedule CRUD + add/remove course hooks
│       └── store/
│           └── atoms.ts          # Jotai global state (shortlist, history, theme)
├── database/
│   └── init.sql                  # Schema: course_embeddings, course_evaluations,
│                                 #         users, schedules, schedule_courses
├── docker-compose.yml            # Local Postgres/pgvector
└── docs/                         # PRD, iteration plans, team agreement
```

## Agent Architecture

The LLM agent (`POST /api/agent`) uses Vercel AI SDK `generateText` with tool calling:

**Tool routing:** All queries go to GPT-4o-mini which selects from: `searchCourseDescriptions`, `filterSisCourses`, `generateDaysOfWeek`, `getCourseEvalSummary`, `fetchSisCourseDetails`.

**Response shape:** Always JSON `{ type, ...payload }`. Frontend renders based on `type`:
- `"search"` → CourseCard components
- `"text"` → plain message bubble
- `"summary"` / `"details"` → text bubble

**Embedding index:** Only Spring 2026 undergraduate courses (course number 100–499) are indexed. Graduate courses (500+) are filtered out at seed time.

## Branch & Commit Conventions

- Branch pattern: `<author>/<type>/issue-<number>-<short-description>`
  - `type` must match the issue label: `feature`, `bug`, or `task`
- Never push directly to master
- Reference issues in commits: `Add file validation (#12)`
- Keep PRs under ~400 changed lines
- Use merge commits (no squash or rebase)
- Label PRs with the appropriate label (feature / bug / task)

## Common Mistakes

Patterns discovered during development — check these before submitting a PR:

- Forgetting to reference the issue number in commits and PR titles
- Deleting test files instead of fixing them
- Forgetting to filter graduate courses (500+) when working with the embedding pipeline
- Adding `pool` imports to route files — DB queries belong in `tools/` or `services/`
- Not running `npm run lint` before pushing — ESLint errors will fail CI
- Module-level `new OpenAI()` calls fail if `dotenv.config()` hasn't run yet — use `-r dotenv/config` in the dev script or lazy-initialize the client
