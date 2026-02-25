# Project Configuration

## Project Description

An AI-assisted schedule builder/advisor for JHU undergraduate students. This is a project for a class titled "AI Enabled Software Engineering" that has a focus on incorporating agentic AI in software.

## Tech Stack

- Frontend: React + TypeScript (Vite) + TailwindCSS — `frontend/`
- Backend: Node.js + Express + TypeScript — `backend/`
- Database: PostgreSQL with pgvector (Docker) — `docker-compose.yml`, `database/init.sql`
- LLM: OpenAI GPT-4
  - Embeddings: OpenAI text-embedding-3-small
- AI Orchestration: Vercel AI SDK 
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

## Code Style

- Language: TypeScript (strict mode) for both frontend and backend
- Naming conventions: camelCase for variables/functions, PascalCase for React components and types
- Formatting: Prettier
- Linting: ESLint

## Architecture

```
team-02/
├── backend/          # Express API server
│   └── src/
│       ├── index.ts          # Entry point
│       ├── db.ts             # PostgreSQL connection pool
│       └── routes/
│           └── courses.ts    # /api/search, /api/courses/:id/*
├── frontend/         # React + Vite app
│   └── src/
│       ├── main.tsx
│       └── App.tsx
├── database/
│   └── init.sql      # Schema (courses + course_evaluations + pgvector)
├── docker-compose.yml
└── docs/
```

## Branch & Commit Conventions

- Branch pattern: `<author>/<type>/issue-<number>-<short-description>`
  - `type` must match the issue label: `feature`, `bug`, or `task`
- Never push directly to master
- Reference issues in commits: `Add file validation (#12)`
- Keep PRs under ~400 changed lines
- Use merge commits (no squash or rebase)

## Common Mistakes

<!-- TODO: Add patterns your team discovers during development -->

- [ ] Forgetting to reference the issue number in commits
- [ ] Pushing directly to master instead of creating a PR
- [ ] Creating issues for future iterations instead of the current one
