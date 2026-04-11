# Iteration 3 Plan (Natural-Language Schedule Control & Memory Management)

## Requirements & Acceptance Criteria

### R1: Natural-Language Schedule Modification (Add / Drop / Swap)

**Description:**  
Users can modify their schedules using natural-language commands (e.g., “drop physics and add an easier NS course”).

- **Acceptance Criteria:**
  - [ ] Users can submit natural-language commands through the schedule-aware chat.
  - [ ] The system correctly identifies intent types: add, drop, swap, or replace.
  - [ ] The system resolves referenced courses using course search (by name, code, or description).
  - [ ] The system performs the requested modification via backend schedule APIs.
  - [ ] The updated schedule is immediately reflected in the UI.
  - [ ] If a command is ambiguous, the system asks a clarification question instead of guessing.
  - [ ] If a requested action fails, the system provides a clear error and suggests alternatives when possible.

---

### R2: Persistent Chat History (Stateful Conversations)

**Description:**  
The system stores chat history so that conversations are stateful across sessions and can be used as context for future responses, with older messages condensed for efficiency.

- **Acceptance Criteria:**
  - [ ] Chat messages (user and assistant) are persisted as part of a conversation thread (e.g., per schedule).
  - [ ] Messages are associated with a specific schedule (`schedule_id`).
  - [ ] When a user revisits a schedule or chat, relevant prior messages are loaded and displayed in order.
  - [ ] The LLM receives relevant prior messages as context when generating responses.
  - [ ] Chat history persists across sessions (refreshing or logging out does not erase messages).
  - [ ] Messages include role, content, and timestamp.
  - [ ] The system limits context sent to the LLM (e.g., last N messages or token-based truncation).
  - [ ] Older messages may be condensed into a summarized representation, and the system is not required to retain all raw messages indefinitely.
  - [ ] Streaming responses are properly persisted after completion.
  - [ ] If chat history fails to load, the system gracefully falls back to stateless behavior.

---

### R3: Chat-Derived Long-Term Memory Extraction

**Description:**  
The system extracts stable user preferences from chat interactions and stores them as structured long-term memories.

- **Acceptance Criteria:**
  - [ ] The system identifies and extracts stable preference statements from user messages.
  - [ ] Only long-term preferences (not transient statements) are persisted.
  - [ ] Extracted memories are stored in structured format.
  - [ ] Duplicate or highly similar memories are not stored multiple times.
  - [ ] Stored memories are available to chat, audits, and recommendations.
  - [ ] Memory extraction does not block chat response generation.

---

### R4: Memory Management UI (View & Delete)

**Description:**  
Users can view and manage their stored preference memories.

- **Acceptance Criteria:**
  - [ ] Users can access a dedicated memory/preferences view.
  - [ ] Memories are displayed as short, human-readable statements.
  - [ ] Each memory includes a delete control.
  - [ ] Deleting a memory removes it from the database immediately.
  - [ ] Deleted memories are no longer used in system behavior.
  - [ ] UI updates immediately after deletion.

---

### R5: Enhanced Schedule Audits (Goal Alignment & Recommendations)

**Description:**  
Schedule audits include alignment with user goals and suggest alternative courses or adjustments.

- **Acceptance Criteria:**
  - [ ] Audit results include a clearly labeled “Goal Alignment” section.
  - [ ] The system evaluates how well the schedule supports user goals.
  - [ ] The system suggests at least one concrete alternative when data permits.
  - [ ] Recommendations are grounded in real courses and evaluation data.
  - [ ] If insufficient data exists, the system explicitly states this.
  - [ ] The UI clearly separates workload, alignment, and recommendations.

---

### R6: Responsive AI Feedback (Streaming + Progress States)

**Description:**  
AI-powered interactions provide responsive feedback through visible progress states and streaming responses, and the system provides a public-facing landing page for non-authenticated users.

- **Acceptance Criteria:**
  - [ ] When backend tools are being used, the UI displays concise status updates indicating the current stage of processing (e.g., retrieving schedule data, searching courses, generating response).
  - [ ] Chat responses begin rendering within 2 seconds.
  - [ ] AI-generated responses stream incrementally to the frontend once generation begins.
  - [ ] The UI displays partial responses progressively rather than waiting for full completion.
  - [ ] If streaming is unavailable or delayed, progress indicators still make it clear that work is ongoing.
  - [ ] The UI clearly distinguishes among:
    - in-progress tool/activity states
    - streaming response generation
    - completed responses
  - [ ] A public landing page is accessible without authentication that describes core Atlas functionality and includes a clear login call-to-action.
  - [ ] Authenticated users visiting the root route are redirected to their dashboard.

---

## Iteration 3 Design Decisions

### R1: Natural-Language Schedule Modification (Add / Drop / Swap)

- Single tool for schedule edits: `modifyScheduleCourses`.
- `modifyScheduleCourses` handles intent + resolution internally and is the only mutation tool.
- `modifyScheduleCourses` input contract:
  - `scheduleId`
  - `operation`
  - `addCourses[]` and/or `dropCourses[]` entries with `{ courseCode, sisOfferingName, term, courseTitle?, credits? }`
- `modifyScheduleCourses` output contract:
  - `ok`: boolean
  - `needsClarification`: boolean
  - `added[]` and `removed[]` entries with `{ courseCode, sisOfferingName, term }`
  - `failed[]` entries with `{ action, reasonCode, message, candidates? }`
- Ambiguous requests must return `needsClarification: true` with `candidates[]` and must not mutate.
- Agent response remains existing shape (`search`/`text`/etc.); for edits, return `type: "text"` plus optional `scheduleChanges` metadata:
  - `{ operation, added[], removed[], failed[] }`
- Backend writes continue through existing schedule APIs:
  - `POST /api/schedules/:id/courses`
  - `DELETE /api/schedules/:id/courses`
- Failure `reasonCode` enum: `not_found | ambiguous_reference | already_in_schedule | not_in_schedule | term_mismatch | forbidden | invalid_input`.

### R2: Persistent Chat History (Stateful Conversations)

- One chat thread per `schedule_id`.
- New table schema: `schedule_chat_state`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `schedule_id UUID UNIQUE NOT NULL REFERENCES schedules(id) ON DELETE CASCADE`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `rolling_summary TEXT NOT NULL DEFAULT ''`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- New table schema: `schedule_chat_messages`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `chat_state_id UUID NOT NULL REFERENCES schedule_chat_state(id) ON DELETE CASCADE`
  - `schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE`
  - `role TEXT NOT NULL CHECK (role IN ('user','assistant','system'))`
  - `content TEXT NOT NULL`
  - `response_type TEXT`
  - `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Retention/context policy: keep latest 100 raw messages, summarize older messages into `rolling_summary`, and send `rolling_summary + latest 15 messages` to the LLM.
- Failure behavior: if history load fails, continue with stateless chat (do not block response).

### R3: Chat-Derived Long-Term Memory Extraction

- Canonical memory store is `user_memories`; `user_profiles.derived_memories` is treated as legacy during migration.
- New table schema: `user_memories`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `memory_text TEXT NOT NULL`
  - `memory_type TEXT NOT NULL CHECK (memory_type IN ('goal','preference','constraint','learning_style'))`
  - `source TEXT NOT NULL CHECK (source IN ('chat','onboarding','manual'))`
  - `confidence NUMERIC(3,2) NOT NULL DEFAULT 0.70`
  - `created_from_message_id UUID NULL REFERENCES schedule_chat_messages(id) ON DELETE SET NULL`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `user_memories` keeps both onboarding and chat memories, distinguished by `source`:
  - `source IN ('chat','onboarding','manual')`
- Onboarding/profile answers remain canonical raw inputs in `user_profiles`; onboarding-derived memory rows are regenerated when those answers change.
- Chat-derived extraction runs asynchronously after assistant completion and never blocks chat response.
- Memory reads for chat/audit/recommendations use all rows in `user_memories` (hard-delete model).
- Transition rule:
  - Backfill existing `derived_memories` into `user_memories`.
  - Short-term fallback reads from `derived_memories` only when `user_memories` is empty.
  - New writes go to `user_memories` only.

### R4: Memory Management UI (View & Delete)

- New endpoints:
  - `GET /api/user/memories` returns `{ memories: MemoryItem[] }`.
  - `DELETE /api/user/memories/:id` performs hard delete (`DELETE FROM user_memories ...`), returns `204` for `source IN ('chat','manual')`.
  - `DELETE /api/user/memories/:id` returns `409` for `source='onboarding'` with message: `"Edit profile preferences to change this memory."`
  - **`DELETE /api/user`** permanently deletes the authenticated **user** row (and, via PostgreSQL `ON DELETE CASCADE`, all related `user_profiles`, `schedules` / `schedule_courses` / `schedule_audits` / `schedule_chat_state` / `schedule_chat_messages`, and `user_memories`). Request body **must** be JSON `{ "confirm": true }` so accidental deletes are harder. The handler also removes **`session`** rows for that user (connect-pg-simple) and destroys the current session; response **`204`** with no body.
- **UI — delete account (profile removal):**
  - **Memories** page (`/memories`): under “Non deletable memory”, **Delete account** opens a modal. The user must type **`DELETE`** to enable **Delete my account**, then confirm. On success, redirect to **`/login`**.
  - **Onboarding / profile** (`/onboarding`): when editing an existing profile, a **Danger zone** block includes **Delete account** with the same modal flow.
- `MemoryItem` response shape:
  - `id`, `text`, `type`, `source`, `confidence`, `createdAt`.
- Deleted memories are physically removed and therefore absent from all future prompt construction and audit generation. Full account deletion removes all stored user data tied to that account as described above.

### R5: Enhanced Schedule Audits (Goal Alignment & Recommendations)

- Audit output must include:
  - `goalAlignment`: `{ score, rationale, alignedGoals, conflicts }`
  - `recommendations`: array of grounded alternatives
- Each recommendation must reference a real course: `{ courseCode, sisOfferingName, term, title }`.
- If data is insufficient, audit must explicitly say so.
- Metrics tool contract:
  - tool name: `queryCourseMetrics`
  - input: `{ courseCode, term }`
  - output: `{ courseCode, term, metrics | null }` where `metrics` includes workload/difficulty/overallQuality/respondentCount.
  - aggregation rule: consolidate all sections for `(courseCode, term)` into one course-level metric set, weighted by `respondentCount`.

### R6: Responsive AI Feedback (Streaming + Progress States)

- Reuse existing endpoint: `POST /api/agent`.
- `POST /api/agent` streams via SSE by default.
- Non-streaming fallback is supported with request flag `stream: false` (returns current JSON shape).
- SIS details tool contract (rename from `fetchSisCourseDetails` to `getSisCourseDetails`, same shape):
  - input: `{ courseId }` where `courseId` format is `en-553-171-spring-2026` or `en-553-171-01-spring-2026`
  - output: `{ courseId, course, message? }`
  - `course` shape: `{ offeringName, sectionName, title, description, schoolName, department, level, timeOfDay, daysOfWeek, location, instructors, status }`
  - if no result: `{ courseId, course: null, message: "Course not found" }`
- SSE events: `status`, `text_chunk`, `final`, `error`.
- Stages used by `status`: `loading_context`, `calling_tools`, `generating_response`, `done`.
- Persistence rule: save user message immediately; save assistant message on `final`; if aborted, save partial assistant text with `metadata.aborted = true`.
- Routing: `/` is public landing; authenticated users at `/` redirect to `/schedules`; unauthenticated users on schedule routes redirect to `/login`.

---

## Task Breakdown

**Team:** 5 members — @Alinapanyue, @chjenniferhede, @James-Guo-03, @JunzheShi0702, @rachael-p  

**Convention:** 1 member per task. Tasks are grouped by requirement and assigned to minimize dependencies.

---

### @rachael-p (Natural-Language Schedule Control + Agent Behavior)

- Extend agent to detect schedule modification intent (add/drop/swap) from chat input  
  - Requirement Number: R1

- Implement full schedule modification flow (parse → resolve courses → call existing schedule APIs)  
  - Requirement Number: R1

- Update agent system prompt with examples demonstrating proper use of the course metrics query tool, and enforce correct agent behavior such that course description searches are restricted to the active schedule’s term  
  - Requirement Number: R5, R6

---

### @JunzheShi0702 (Schedule Audits + SIS Tooling)

- Expose `getSisCourseDetails` as a properly structured agent tool and integrate into agent flow  
  - Requirement Number: R6

- Extend workload audit output to include goal alignment section and implement alternative course recommendation logic grounded in SIS + evaluation data  
  - Requirement Number: R5

- Create course metrics query tool for agent for workload/difficulty queries
  - Requirement Number: R5

---

### @Alinapanyue (Streaming + Landing Page)

- Implement streaming responses in `/api/agent` and audit generation and ensure frontend renders partial responses incrementally and progress states (based on SSE `status` events) are visible in chat UI
  - Requirement Number: R6

- Implement public landing page for non-authenticated users with overview of Atlas features (similar to uCredit's) and login button  
  - Requirement Number: R6

- Improve agent handling of edge cases (ambiguous inputs, missing data, conflicting constraints) and refine workload audit prompt and workload calculation logic for accuracy and consistency
  - Requirement Number: R5, R6

---

### @James-Guo-03 (Memory System)

- Implement extraction of long-term user preferences from chat messages and storage into the database  
  - Requirement Number: R3

- Build UI to allow users to view and delete stored memories (in the form of short preference statements)  
  - Requirement Number: R4

- Inject stored memories into agent context for chat and audits and build backend for memory deletion  
  - Requirement Number: R3, R5

---

### @chjenniferhede (Chat History)

- Persist up to the most recent 100 user and agent messages per schedule chat in the database, and maintain a rolling summary of older conversation context as older raw messages are removed  
  - Requirement Number: R2

- Inject the rolling summary plus the most recent 10–20 messages into the agent context when constructing each request
  - Requirement Number: R2

- Load and display chat history per schedule (threaded by `schedule_id`)
    - Requirement Number: R2

---
