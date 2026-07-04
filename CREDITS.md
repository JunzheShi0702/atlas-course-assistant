# Credits & Attribution

## Project Origin

Atlas was originally developed as a team project at Johns Hopkins University. The system evolved across multiple documented iterations, beginning with AI-assisted course discovery and expanding into authenticated planning, schedule persistence, schedule-aware chat, long-term memories, audit workflows, calendar views, custom events, and evaluation-backed evidence surfaces.

The original project involved collaborative frontend, backend, AI-agent, data, planning, evaluation, testing, and deployment work. The contribution summaries below identify documented areas of work while preserving the shared nature of the final system.

## Original Contributors

### Junzhe Shi — `JunzheShi0702`

- Contributed to course cards, SIS detail retrieval, and course information surfaces.
- Implemented or expanded schedule schema, schedule persistence, and course add/remove management workflows.
- Worked on evaluation loading, summary caching, source-data attribution, and raw evaluation inspection UI.
- Added agent-facing SIS details and course metrics tooling, goal-alignment audit fields, preference checks, weekly event contracts, calendar/planning UI, custom events, and test/CI hardening.

### Rachael Pei — `rachael-p`

- Contributed to course evaluation ingestion and summary generation, including scraping, summary tooling, and related tests.
- Worked on agent orchestration, response contracts, prompt/tool boundaries, and route hardening.
- Developed natural-language schedule modification flows for parsing, resolving, adding, dropping, and swapping courses.
- Expanded unified search, constraint alignment, clarification behavior, AI evaluation coverage, observability, and stabilization work.

### Siyuan "James" Guo — `James-Guo-03`

- Contributed to early product/team documentation and foundational search/chat UI surfaces.
- Worked on onboarding UI, profile submission, and structured preference parsing.
- Implemented or expanded memories, account deletion, course history, transcript review, and prerequisite-related flows.
- Supported SIS detail caching, course-code normalization, presentation materials, and late-stage bug fixes.

### Yue "Alina" Pan — `Alinapanyue`

- Set up or expanded starter application foundations, embeddings generation, semantic search tooling, and early LLM agent entry infrastructure.
- Contributed to schedules dashboard UI, schedule-aware chat UI, stop behavior, streaming/progress states, landing page work, and auth redirect behavior.
- Worked on parallel audit execution, partial audit handling, audit quality gates, and related backend/frontend contracts.
- Supported testing coverage, deployment fixes, build reliability, and final stabilization work.

### Jennifer He — `chjenniferhede`

- Contributed to search result, shortlist, course-card, and early frontend state/UI surfaces.
- Implemented or expanded Google OAuth, session/auth middleware, user/profile schema, and login/logout UI.
- Worked on workload audit foundations and per-schedule chat persistence/history.
- Supported schedule page UI polish, offline response evaluation, external source tools, compound query fixes, and final presentation-quality refinements.

## Additional Repository-Supported Contribution

### Ali Madooei — `madooei`

- Provided early repository and course workflow scaffolding, including project documentation structure and development process materials.
- Contributed to early SIS API integration, a demo workflow, SIS filtering/tooling, tests, and backend SIS documentation.
- Supported backend test setup and data refresh documentation.

Repository evidence supports these early contributions, but the available project documentation separately identifies the five student team members listed above as the original student contributors.

## Shared Systems and Collaboration

Several major Atlas systems evolved through contributions from multiple team members across iterations. The AI agent and tool orchestration, course search and SIS integration, CourseCard and course information surfaces, course evaluation summaries and evidence views, schedule state and persistence, schedule modification workflows, audits and preference checks, chat and schedule interaction, calendar/planning UI, custom events, and testing/CI all show shared development history.

The contributor descriptions above identify documented contribution areas. They do not imply sole ownership of every final file, route, component, or behavior containing that work. Large systems such as the agent route, course cards, schedule page, search workflows, audit workflows, and chat experience were revised and integrated by multiple contributors over time.

## About This Public Repository

This repository is Junzhe Shi's personal public and portfolio-facing copy of Atlas. It may emphasize systems and engineering work most relevant to Junzhe's documented contributions and technical reflection, including schedule persistence, planning interfaces, course information surfaces, metrics/evaluation evidence, weekly events, and custom event workflows.

That emphasis does not imply sole authorship of Atlas or sole ownership of shared systems. Original team attribution is intentionally preserved here, and repository history plus the original project documentation remain the authoritative historical evidence where available.

## Repository References

The public credits above are summarized from the original Atlas repository's team agreement, iteration plans, issue/branch history, implementation files, tests, and retrospective discussions.

- [README](./README.md)
- [Team Agreement](./docs/team-agreement.md)

Additional attribution evidence was derived from the original repository's documented iteration plans, GitHub issues, branches, tests, and implementation history. Some of that historical evidence may not be fully represented in this public copy.
