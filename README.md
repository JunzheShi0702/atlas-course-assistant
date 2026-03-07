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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/search` | Search courses (`?query=...&limit=10&mode=exact|semantic`) |
| GET | `/api/courses/:id/summary` | AI-generated summary |
| GET | `/api/courses/:id/metrics` | Course evaluation metrics |

## Tech Stack

- **Frontend:** React + TypeScript (Vite)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL with pgvector
- **LLM:** OpenAI GPT-4

## Documentation

- Iteration plans: `docs/iteration-x-plan.md`
- Product Requirements: `docs/product-requirements.md`
- Team Agreement: `docs/team-agreement.md`
