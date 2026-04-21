# Iteration 4 Plan (Attribution, Course History, Conversational Search, Schedule UX, and Agentic Audit Quality)

## Requirements & Acceptance Criteria

### R1: Summary Source Attribution - Junzhe

**Description:**  
Users can inspect the underlying raw values directly from the course summary UI.

- **Acceptance Criteria:**
  - [ ] Each course summary card/page includes a visible button near the summary text.
  - [ ] Clicking that button opens a modal/overlay that shows a table of numerical evaluation data used to generate that summary.
  - [ ] The raw-data view includes, at minimum, metric names, numeric values, terms, and instructor(s) when available.
  - [ ] Every numeric claim in the summary maps to at least one value shown in the raw-data view.
  - [ ] When no backing evaluation rows exist, the View Raw Eval Data control is not shown (or is disabled), and no raw-data panel can be opened.

---

### R2: Course History Tracking - James

**Description:**  
Users can maintain a completed-course history manually or via transcript input, and Atlas uses that history in recommendations and prerequisite checks.

- **Acceptance Criteria:**
  - [ ] Users can add a completed course from search results and from a dedicated completed-courses page.
  - [ ] Users can remove a completed course from their history.
  - [ ] Users can submit transcript data via pasted text and file upload.
  - [ ] Transcript parsing outputs a review list of extracted courses before save.
  - [ ] Each extracted course is mapped to a SIS course ID with status `matched`, `ambiguous`, or `unmatched`.
  - [ ] Courses with status `ambiguous` are not saved until the user selects one candidate.
  - [ ] Recommendation endpoints exclude completed courses by default.
  - [ ] Prerequisite checks mark a prerequisite as fulfilled only when a mapped completed course exists in user history.
  - [ ] When a planned course has unmet or unknown prerequisites, the UI prompts the user to confirm whether they have taken the prerequisite course.
  - [ ] If the user confirms they have not taken a prerequisite, the schedule displays a visible prerequisite warning for that course.

---

### R3: Disambiguation-Gated Multi-Turn Requests + Unified Search - Rachael

**Description:**  
The assistant uses a stateful clarification loop for ambiguous or underspecified requests: identify missing required inputs, ask targeted follow-up questions, persist progress across turns, and resume execution safely once required inputs are confirmed.

- **Acceptance Criteria:**
  - [ ] For ambiguous course references or constraints, the assistant enters clarification mode and returns a targeted follow-up question instead of a final mutation.
  - [ ] Clarification prompts include concrete options with identifiers (course code/section/term) when candidates exist.
  - [ ] Clarification mode supports multiple rounds when more than one required input is missing.
  - [ ] Required mutation inputs are tracked as an explicit checklist (slot set), and mutations are blocked until all required slots are confirmed.
  - [ ] After each clarification answer, the system resumes the pending request from saved state without requiring the user to restate the original query.
  - [ ] Pending clarification state is stored per schedule conversation so refresh/revisit preserves unfinished turns.
  - [ ] Users can correct a previously provided clarification value in the same pending flow.
  - [ ] The LLM can invoke only one course-search capability (`searchCourses`) and does not choose between separate exact/semantic search tools.
  - [ ] `searchCourses` internally combines exact identifier matching, SIS constraint filtering, and semantic retrieval, then returns one merged ranked result set.
  - [ ] Each returned search result includes an explicit `matchType`: `exact`, `constraint`, `semantic`, or `hybrid`.
  - [ ] For non-search intents (e.g., simple schedule status questions), the assistant routes directly to response handling without calling `searchCourses` or entering clarification mode unless required.
  - [ ] `queryCourseMetrics` aggregates across all available evaluation terms by default, and applies term scoping only when a specific term is explicitly provided.

---

### R4: UI Refinement and Presentation Quality - Jennifer

**Description:**  
The product UI is refined for clarity and usability across core surfaces, including schedule visualization and the public landing experience.

- **Acceptance Criteria:**
  - [ ] The schedule UI includes a user-visible toggle between list view and weekly calendar view.
  - [ ] Calendar view renders each selected section in the correct day/time slot using local timezone times.
  - [ ] Calendar entries display, at minimum, course code, section identifier, and meeting time range.
  - [ ] Switching between list and calendar views does not lose schedule state or selected courses.
  - [ ] The public landing page is updated with improved content hierarchy and clearer calls-to-action for unauthenticated users.
  - [ ] Core UI refinements preserve existing auth and routing behavior (unauthenticated users stay on public landing; authenticated users can still navigate to schedules).

---

### R5: Parallelized Audit Workflow + Audit/Non-Audit Quality Gates - Alina, Jennifer

**Description:**  
Schedule audit generation is upgraded from a single-pass response to a parallelized workflow that runs independent checks concurrently and then synthesizes findings. Output quality validation is implemented as an audit-only vertical slice and expanded to non-audit responses through a policy router and bounded gate integration.

- **Acceptance Criteria:**
  - [ ] Audit execution runs independent checks in parallel (at minimum: prerequisites, schedule conflicts, and workload) and combines them into one structured audit result.
  - [ ] Each audit finding includes a category/severity and evidence that references the check output used to produce it.
  - [ ] If one audit check fails, the audit still returns partial findings from successful checks and clearly marks failed/missing check areas.
  - [ ] Audit outputs run an audit-only quality gate that validates unsupported claims, missed constraints, and contradictions before final return.
  - [ ] For audit outputs, if the quality gate fails, the system performs one bounded regenerate pass with feedback; if it still fails, it returns a safe fallback response.
  - [ ] Non-audit outputs are routed to `read_only` or `mutation_adjacent` policy classes (strictest-policy-wins for multi-type outputs) before gate validation.
  - [ ] Non-audit outputs run a bounded quality gate (single regenerate retry + safe fallback) across `search`, `summary`, `details`, generic `text`, and mutation confirmations.
  - [ ] Preference-consistency checks run only when preferences are relevant to the output and preference context is available.

## Iteration 4 Design Decisions

### D1: Clarification-State Lifecycle (R3)

- Ambiguous requests create pending clarification state scoped to a schedule conversation.
- Clarification state stores intent, missing/confirmed slots, candidate options, and next required question.
- The next user reply resolves the current clarification step before a new request is processed.
- Clarification can run for multiple rounds until all required slots are confirmed.
- Mutations do not run until required clarification slots are confirmed.

### D2: Course Metrics Scope (R3)

- `queryCourseMetrics` defaults to cross-term aggregation over all available evaluation rows for the course.
- If a specific term is provided in the query/tool input, metrics are scoped to that term.

### D3: Parallel Audit Composition (R5)

- Audit checks execute concurrently and emit normalized check outputs for synthesis.
- Audit synthesis merges normalized outputs into one structured finding list with category, severity, and evidence.
- Audit failures are isolated per check so one failed check does not block other findings.

### D4: Output Quality Gate Policy (R5)

- Audit outputs use an audit-only quality gate vertical slice (validate -> regenerate once -> fallback).
- Non-audit outputs are policy-routed (`read_only`/`mutation_adjacent`) with strictest-policy-wins for multi-type outputs.
- For all gated outputs, evaluator failure triggers one regenerate attempt; if still failing, return a safe fallback response.
- Preference-consistency checks are conditional on relevant output types and available preference context.

## Task Breakdown

### R1: Summary Source Attribution - Junzhe

- [ ] Extend course summary responses to include the numerical evaluation rows used to generate each summary.
- [ ] Add a button in the summary UI that displays those values in a modal/table and handles no-data states.

### R2: Course History Tracking - James

- [ ] Implement completed-course history management so users can add/remove completed courses from search and from a dedicated history view. - James
- [ ] Implement transcript intake and review flow that extracts courses, maps them to SIS IDs with `matched/ambiguous/unmatched` statuses, and requires user resolution for ambiguous entries before save. - James
- [ ] Apply completed-course history in recommendation and prerequisite flows so completed courses are excluded from recommendations and counted toward prerequisite fulfillment. 

### R3: Disambiguation-Gated Multi-Turn Requests + Unified Search - Rachael, Junzhe

- [ ] Implement multi-round clarification-state handling for ambiguous requests so the assistant tracks required slots, asks targeted follow-up questions, supports corrections, and resumes the pending request after each user reply. - Rachael
- [ ] Replace separate model-facing course search tools with one unified `searchCourses` capability that returns merged ranked results with explicit `matchType` values. - Rachael
- [ ] Add routing so non-search/non-ambiguous intents skip clarification mode and complete directly, while ambiguous mutation intents must satisfy required slots before execution. - Rachael
- [ ] Update `queryCourseMetrics` to use cross-term aggregation by default, with optional explicit term filtering. - Junzhe
- [ ] Stabilize integrations by resolving end-to-end defects across search, clarification, and schedule update flows. - Rachael

### R4: UI Refinement and Presentation Quality - Jennifer

- [ ] Refine the public landing page layout/content hierarchy and strengthen login/sign-up calls-to-action, as well as refining the UI of any page within the app.
- [ ] Refine memory storage display: user memories should be stored and viewable as short statements that are optimized for the agent to parse, not curt phrases like "monday" to indicate that the user prefers classes on Mondays.
- [ ] Implement weekly calendar rendering for scheduled sections with correct local-time placement and required entry details (course code, section, time range) and list/calendar view toggle.

### R5: Parallelized Audit Workflow + Audit/Non-Audit Quality Gates - Alina, Jennifer

- [ ] Implement parallel audit check orchestration (prerequisites, conflicts, workload) and synthesis into one structured audit response with category, severity, and evidence per finding. - Alina
- [ ] Implement partial-result handling so failed audit checks are surfaced as incomplete areas while successful checks still return findings. - Alina
- [ ] Implement an audit-only output quality gate vertical slice for audit responses (validate -> regenerate once -> fallback). - Jennifer
- [ ] Implement a non-audit quality-gate policy router (`read_only`/`mutation_adjacent`) with strictest-policy selection for multi-type outputs. - Jennifer
- [ ] Integrate bounded non-audit quality gate execution across `/api/agent` response paths with telemetry (`gate_pass`, `gate_fail`, `regen_used`, `fallback_used`) by response type. - Jennifer

## AI Components Summary (Iteration 4)

- **Prompt chaining (R3):** Multi-turn clarification loop follows a staged flow (`understand intent -> identify missing slots -> ask -> resume -> execute safely`).
- **Routing (R3, R5):** Requests are routed by intent/state; non-ambiguous turns can bypass clarification, and non-audit outputs are policy-routed (`read_only` vs `mutation_adjacent`) before gating.
- **Parallelization (R5):** Audit runs prerequisite, conflict, and workload checks concurrently, then synthesizes structured findings with evidence.
- **Evaluator-optimizer loop (R5):** Audit and non-audit outputs pass through a bounded quality gate (`validate -> regenerate once on failure -> safe fallback if still failing`).
- **State management + guardrails (R3, R5):** Clarification state is persisted across turns, mutations are blocked until required inputs are confirmed, and unsupported/inconsistent outputs are filtered before return.
