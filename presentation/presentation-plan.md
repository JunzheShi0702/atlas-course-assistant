# Atlas — Final Presentation Plan

This plan aligns the **final presentation rubric** (`final-presentation-rubric.md`) and **final delivery rubric** (`final-delivery-rubric.md`) with how we actually split work across **Iteration 1–4** plans in `docs/`. Use it to assign slides, demos, and technical deep-dives so every speaker can point to concrete iteration ownership.

**Rubric anchors**

- Presentation: 35–45 min + 15 min Q&A; **live demo on deployed app** (local backup); **slides** for the technical block; **all members** participate with **balanced** time; **≥4** functional requirements demoed (**≥3** must be **meaningful AI**).
- Delivery (prep, not spoken): tests/evals in CI, docs and issues current, deployment stable, AI observability/safeguards where applicable.

**Iteration plan sources**

- `docs/iteration-1-plan.md` — search UX, embeddings, course cards, eval summaries, shortlist, agent tools (team listed includes six handles; later iterations list five).
- `docs/iteration-2-plan.md` — OAuth, onboarding/memories, schedules, audits, schedule-aware chat, undergrad discovery refinements.
- `docs/iteration-3-plan.md` — NL schedule edits, persistent chat, chat-derived memories, memory UI, enhanced audits, SSE streaming + landing.
- `docs/iteration-4-plan.md` — eval raw attribution, course history/transcripts, clarification + unified search, UI/calendar, parallel audits + quality gates.

---

## Team roster (from iteration plans)

| Handle | Iteration 1 | Iterations 2–4 |
|--------|-------------|------------------|
| @Alinapanyue | R2, R6–R7; embeddings, semantic search | R3, R5–R6; dashboard, chat UI, streaming, landing, audit prompts |
| @chjenniferhede | R1–R3, R5–R6; UX, results states, shortlist | R1–R4, R6–R7; OAuth, audits API, chat history, quality gates |
| @James-Guo-03 | R3–R5, R7; textarea, summary UI, tests | R2, R6; onboarding, SIS TTL cache; R3–R5 memories; R2 history (iter 4) |
| @JunzheShi0702 | R3, R5, R7; course cards, SIS expand | R3, R6–R7; schema, eval load, summaries cache; R5–R6 SIS tool, audits, R1 iter4 |
| @rachael-p | Agent, eval summary tool, SIS key, scrapes | R4–R6; agent/schedule chat, search orchestration; R1/R3/R5 iter3–4 |
| @madooei | R2, R4–R5; SIS constraints tool | Not in iter 2–4 task breakdown |

If the course expects **every** enrolled teammate to speak, add @madooei to a demo or technical subsection drawn from **Iteration 1** (e.g., `searchCoursesBySisConstraints` / data refresh story) so their time is grounded in `iteration-1-plan.md`.

---

## Run-of-show (target ~40 min talk + Q&A)

| Block | Target time | Rubric alignment | Owner (primary) | Iteration evidence (what to say / show) |
|-------|----------------|------------------|-----------------|-------------------------------------------|
| **Opening** | 2–3 min | Problem, users, **why AI is essential** (not bolt-on); one speaker | **@Alinapanyue** | Iter 1: agent + semantic search over catalog; Iter 2–3: personalized planning + NL control; Iter 4: clarification + quality gates — narrative “Atlas is an AI-assisted planner, not a static catalog.” |
| **Demo 1 — Semantic / unified course discovery** | ~4 min | Live product; **AI** | **@rachael-p** | Iter 1 R2–R3 (`searchCourseDescriptions`, match explanations); Iter 2 R6 orchestration; Iter 4 R3 unified `searchCourses`, `matchType`, disambiguation. **Demo:** deployed app — open-ended query → ranked results → optional clarification path. |
| **Demo 2 — Eval summaries + raw attribution** | ~4 min | Live; **AI** | **@JunzheShi0702** | Iter 1 R4 (`getCourseEvalSummary`); Iter 4 R1 raw eval modal. **Demo:** summary on a course card → open “raw / source” view; mention grounded metrics vs no-data. |
| **Demo 3 — Onboarding + memories + history** | ~4 min | Live; **AI** | **@James-Guo-03** | Iter 2 R2 onboarding + `derived_memories`; Iter 3 R3–R4 chat memories + UI; Iter 4 R2 completed courses / transcript flow. **Demo:** onboarding or memories page + one chat-derived preference; optional completed-course / prereq angle. |
| **Demo 4 — Schedules + calendar + audit** | ~4 min | Live; **AI** | **@chjenniferhede** | Iter 2 R3–R4 schedules + workload audit; Iter 4 R4 list/calendar toggle; Iter 4 R5 parallel audit + gates (high level). **Demo:** dashboard → schedule → run audit → show calendar view. |
| **Demo 5 — Schedule-aware chat + NL edits** | ~4 min | Live; **AI** | **@rachael-p** (or split with **@chjenniferhede** if chat UI emphasis) | Iter 2 R5 schedule-aware agent; Iter 3 R1 `modifyScheduleCourses`, R2 history injection; Iter 4 R3 clarification state. **Demo:** one NL add/drop/swap with deployed URL; show clarification if time. |
| **Technical — Software architecture** | ~5 min | Stack diagram; clear stack sentence | **@JunzheShi0702** | Iter 2 API table + schema tasks; Iter 3 persistence tables. Slide: React frontend, Express backend, Postgres/pgvector, OAuth session, deployment. |
| **Technical — AI architecture** | ~8 min | Models, tools, RAG/search, agent loop, guardrails | **@rachael-p** (lead) + **@Alinapanyue** (streaming SSE) | Iter 1 tool contracts; Iter 2 `analyzeScheduleWorkload`, agent schedule context; Iter 3 SSE `status` / `text_chunk` / `final`; Iter 4 clarification FSM + policy router + parallel audit synthesis. |
| **Technical — Testing, evals, observability** | ~5 min | Non-AI tests + **AI eval**; justify trade-offs | **@James-Guo-03** (tests) + **@chjenniferhede** (CI/integration) | Final delivery rubric: unit/E2E/AI eval harness; point to iter 1 “unit tests” ownership and iter 4 telemetry on gates if implemented. Include **coverage screenshot** if available. |
| **Closing** | 3–5 min | Limitations, future work, reflection; **different speaker than opening** | **@James-Guo-03** | Honest edges from iter 4 issues list; roadmap (course history, gates, search stability); team + “building with AI tools” reflection. |

**Timing check:** Opening + five demos + technical splits + closing should land in **35–45 minutes**. If long, shorten technical sub-blocks or merge “Testing” into “AI architecture” as two speakers back-to-back.

---

## Per-person cheat sheet (goals)

| Person | Presentation goal | Primary iteration anchors |
|--------|--------------------|----------------------------|
| **@Alinapanyue** | Set vision; why AI; streaming/landing credibility | Iter 3 R6 (SSE, landing); Iter 4 R5 (audit parallelization with @chjenniferhede) |
| **@chjenniferhede** | Demo schedule/audit/calendar; co-own quality gates + testing story | Iter 2 R1/R4; Iter 3 R2 chat persistence; Iter 4 R4 UI, R5 gates |
| **@James-Guo-03** | Demo memory + history; closing; testing/coverage narrative | Iter 2 R2; Iter 3 R3–R4; Iter 4 R2; Iter 1 unit tests task |
| **@JunzheShi0702** | Demo eval + attribution; backend/schema architecture slide | Iter 1 R3–R4; Iter 3 R5–R6; Iter 4 R1 |
| **@rachael-p** | Demo search + agent + NL schedule + clarification | Iter 1 agent + tools; Iter 2 R5–R6; Iter 3 R1/R5; Iter 4 R3 |
| **@madooei** (if presenting) | Short segment on **SIS constraint search** or **data refresh** from Iter 1 | Iter 1 R2/R3 tasks: `searchCoursesBySisConstraints`, data refresh doc |

---

## Rubric-driven rehearsal checklist

**Opening (avoid −5 / −3)**

- [ ] One rehearsed speaker; slides minimal (no wall of text).
- [ ] 30-second problem, user, and “why LLM/agent” — cite iterations 1→4 progression.

**Live demo (avoid −20, −7, −7, −5, −7, −7)**

- [ ] Use **production URL**; each presenter has **local backup** running.
- [ ] **≥4** requirements; **≥3** clearly AI (search, summary, chat/audit, NL modify, memories).
- [ ] Avoid trivial-only demos (login-only).
- [ ] Practice handoffs; each demo owner can answer “what model/tool ran?”

**Technical section (avoid −10, −12, −7)**

- [ ] Slides with **one** clear architecture diagram + **one** AI/tool flow diagram.
- [ ] Cover: models, prompting, memory, retrieval/search, tool calling, failure handling, **AI testing/eval**, **observability** (logs, latency/cost if applicable), **safety** (rate limits, validation).
- [ ] Prepare answers for trade-off questions (cost vs quality, latency vs depth, etc.).

**Closing (avoid −12, −7, −5)**

- [ ] Limitations list is **honest and short** (known bugs, partial data, gate false positives, etc.).
- [ ] Future work: what you would ship next week / post-course.
- [ ] Reflection: team process + using AI in development.

**Cross-cutting (avoid −5, −7, −7, −5)**

- [ ] Roughly **even** minutes per teammate (adjust if one person has two short demos).
- [ ] Total time **≤45** min before Q&A buffer.
- [ ] Energy + transitions rehearsed once end-to-end.

**Delivery rubric (pre-presentation week)**

- [ ] CI green; README and `docs/` iteration plans reflect shipped scope.
- [ ] Issues document known gaps.
- [ ] If citing observability/safeguards in talk, verify they exist or say “planned / partial” honestly.

---

## Slide deck TODO (map to `slides.tex`)

1. Title + team + one-line Atlas value.
2. Problem / user / why AI (opening).
3–7. One slide per demo requirement (bullet script + screenshot fallback).
8. System context diagram (frontend / API / DB / external: Google, OpenAI, SIS).
9. AI pipeline diagram (agent → tools → SSE → UI).
10. Testing + AI eval + (optional) observability slide with **coverage screenshot**.
11. Limitations + future + thanks (closing).

---

## Q&A prep (from rubrics)

- Be ready to **live-demonstrate** a specific requirement if asked (−5 if fumbling).
- Be ready to explain **model choice**, **prompt strategy**, **clarification state machine**, and **audit quality gate** with reference to Iteration 4 design decisions in `docs/iteration-4-plan.md`.
