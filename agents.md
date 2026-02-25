# Project Configuration

## Project Description

An AI-assisted schedule builder/advisor for JHU undergraduate students. This is a project for a class titled "AI Enabled Software Engineering" that has a focus on incorporating agentic AI in software.

## Tech Stack

* Frontend: Next.js (React), TypeScript, TailwindCSS  
* Backend: Node.js (TypeScript), Prisma (ORM)  
* Database:  
  * PostgreSQL: relational storage for users, schedules, preferences, and course metadata  
  * pgvector: vector storage for semantic embeddings used in natural-language course search and RAG  
* Auth: Google OAuth 2.0  
* AI components:  
  * LLM API: OpenAI API  
    * GPT-4o-mini (for chat/routing) and GPT-4o (for complex tasks)  
  * Embeddings: OpenAI text-embedding-3-small  
  * AI Orchestration: Vercel AI SDK  (used as a framework-agnostic Node.js library for streaming responses and prompt orchestration; not dependent on Vercel Edge Functions)   
* External: SIS Web API, Playwright (course eval scraping)  
* Deployment: Render  
* Testing: Vitest (unit/integration), Playwright (end-to-end), Postman (for manual tests)

## Commands

<!-- TODO: Fill in after choosing your tech stack -->

- Install dependencies: `<command>`
- Run development server: `<command>`
- Run tests: `<command>`
- Run linter: `<command>`
- Build for production: `<command>`

## Code Style

<!-- TODO: Document your team's style decisions -->

- Formatting: Prettier
- Linting: ESLint
- Naming conventions: camelCase for JS

## Architecture

<!-- TODO: Describe your project structure -->

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
