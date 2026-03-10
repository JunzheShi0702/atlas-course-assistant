## Iteration 2 Plan (Personalized Planning & Schedules)

## Requirements & Acceptance Criteria

### R1: Google OAuth Login

**Description:** Users can log in using their Google account to access personalized planning features.

- **Acceptance Criteria:**
  - [ ] A “Sign in with Google” button is visible on the landing/login view.
  - [ ] Clicking the button initiates the Google OAuth flow and redirects back to Atlas on success.
  - [ ] On successful login, the backend creates or looks up a user record keyed by Google email.
  - [ ] Authenticated users see their name/email in the UI and can log out.
  - [ ] Unauthenticated users cannot access the schedules dashboard or chat; they are redirected to the login/onboarding flow.

### R2: Onboarding & Initial Preference Memories

**Description:** First-time users complete an onboarding questionnaire whose answers are stored as both explicit profile fields and structured long-term preference memories.

- **Acceptance Criteria:**
  - [ ] First-time logged-in users are directed to an onboarding flow before reaching the main dashboard.
  - [ ] Graduation month/year and degree(s) are selected via multi-select dropdowns with sensible defaults and validation.
  - [ ] The questionnaire includes at least three prompts covering career goals, workload tolerance, and class/time preferences, where each prompt allows users to either (a) type a free-text response or (b) select one or more suggested preset answers via clickable chips/buttons (or a combination of both).
  - [ ] On successful onboarding submission, the answers are persisted in the database in the `user_profiles` (or equivalent) table as:
    - Raw fields for graduation date, degree(s), and school, and
    - A `derived_memories` JSON field containing the LLM-parsed structured preferences (goals, workload tolerance, time preferences, notes) as specified in the “Onboarding, Profiles & Memories” design decisions section.
  - [ ] Stored memories include graduation date, degree info, and derived preference statements (e.g., “prefers afternoon classes,” “aiming for ML PhD”).
  - [ ] The LLM agent can retrieve these memories and they are available to schedule audits and chat responses.
  - [ ] Refreshing the page after onboarding still reflects the saved profile (no data loss).

### R3: Schedule Creation & Dashboard View

**Description:** Users can create named schedules and view them in a dashboard that shows all schedules as tiles; clicking a schedule tile navigates to that schedule's page (`/schedules/:id`) with courses, audit panel, and chat.

- **Acceptance Criteria:**
  - [ ] Authenticated users can create a new schedule with a name/label and associated term (e.g., “Spring 2026”).
  - [ ] Multiple schedules per user are supported and persisted in the database (at minimum, users can create more than one schedule and see them all on the dashboard).
  - [ ] The main schedules dashboard displays all of a user’s schedules as square or card-like blocks in a row/grid layout, each showing at least the schedule name and term.
  - [ ] Clicking a schedule card navigates to that schedule’s page (e.g. `/schedules/:id`), where:
    - The right/adjacent area shows the schedule’s courses (course code, title, and basic details), and space for audits.
    - The left/primary area shows the schedule-aware chat panel (R5).
  - [ ] Users can add/remove courses from the active schedule via a simple UI (e.g., add from search results, remove via button), even if not yet natural-language-driven.
  - [ ] Each schedule has its own page/URL (e.g. `/schedules/:id`); the layout makes it clear which schedule is being viewed.

### R4: Personalized Workload Feasibility Audits

**Description:** The system provides personalized workload feasibility audits of users’ schedules, tailored explicitly to each user’s stated goals and preferences, and shown in a dedicated “Schedule audit” panel that replaces the current “Current stats” panel in the UI.

- **Acceptance Criteria:**
  - [ ] On the schedule page (`/schedules/:id`), there is a clearly labeled "Run workload audit" button near the schedule header or course list header (not per-course).
  - [ ] Clicking this button calls a dedicated backend endpoint for the active schedule (e.g., `POST /api/schedules/:id/audit`) that:
    - Reads schedule courses, course evaluation metrics (e.g., workload, difficulty), and user preferences/memories.
    - Returns a structured audit result (numeric metrics + narrative summary).
  - [ ] The audit result is rendered in a dedicated “Schedule audit” panel (replacing the existing “Current stats” panel), which shows at least:
    - Estimated weekly workload range.
    - Overall difficulty estimate.
    - A clear “risk” or “feasibility” label (e.g., “light,” “moderate,” “heavy”).
  - [ ] The audit panel shows loading and last-run information, and includes a “Re-run audit” control that reuses the same endpoint.
  - [ ] The most recent audit result for a schedule is persisted (e.g., in a `schedule_audits` table or durable cache) and automatically loaded when the user returns to that schedule, so the panel always shows the last completed audit until the user explicitly re-runs it.
  - [ ] The panel includes a “View full audit” affordance (e.g., a button) that opens a centered modal or expanded view showing the complete audit narrative and metrics for easier reading on smaller panels.
  - [ ] If evaluation data is missing for one or more courses, the audit clearly states this and avoids fabricating numbers.

### R5: Schedule-Aware Chat for Planning Advice

**Description:** Users can chat with the LLM to ask questions related to their schedules and receive personalized course planning advice.

- **Acceptance Criteria:**
  - [ ] Authenticated users see a chat panel associated with the selected schedule.
  - [ ] User messages are sent to a backend agent endpoint that has access to schedule data and user memories.
  - [ ] The LLM can reference the current schedule (e.g., “Your current schedule includes X, Y, Z”) in responses.
  - [ ] Users can ask at least three categories of questions: workload balance, alternative course ideas, and high-level planning (e.g., for grad school vs. industry).
  - [ ] Responses stream in the UI and show clear message attribution (user vs. assistant).
  - [ ] The chat UI includes a functional “Stop” control that cancels in-flight responses so the experience remains responsive under long-running LLM calls.
  - [ ] If no schedule exists, the chat explains that the user must create a schedule first.

### R6: Rich Undergraduate Course Discovery & Details

**Description:** The system lets students quickly search only relevant undergraduate courses and view rich, semester-specific details (descriptions, evaluation-based summaries, and schedules) in a responsive UI that stays controllable and up to date.

- **Acceptance Criteria:**
  - [ ] The embeddings pipeline and backing database only index lower- and upper-level **undergraduate** offerings (e.g., by SIS level and/or course-number ranges), so search results exclude clearly out-of-scope graduate or non-undergrad courses.
  - [ ] Course search orchestration supports both semantic and exact search in a single query and always returns a `description` field in search results, even when `searchCourseDescriptions` is not called directly.
  - [ ] The “Why this matches” explanation is only generated for semantic search results; exact/structured-only matches do not fabricate explanations.
  - [ ] SIS course details are cached server-side with a clear TTL (e.g., refreshed at most once per week per course), so schedule/location/status stay reasonably fresh without over-calling SIS.
  - [ ] Course evaluation summaries are cached in Postgres per course per semester; subsequent summary requests reuse the cached result where possible.
  - [ ] The course summaries UI optionally includes attribution (terms, instructors, dates) and, when data permits, highlights trends over time.
  - [ ] Course and schedule views clearly surface semester/term information (e.g., course cards and schedules are labeled by semester), and card layouts in the main UI show at least title, course number, and time/day, with an affordance to view full details.

### R7 (Nice-to-Have): Goal Alignment & Alternative Recommendation Audits

**Description:** Personalized audits also include deeper assessments of alignment with the user’s future goals and specific alternative course recommendations beyond the core workload feasibility check.

- **Acceptance Criteria:**
  - [ ] The audit result structure (and stored `schedule_audits.result`) is extended to include a clearly labeled “Goal alignment” section that explicitly states how well the current schedule supports the user’s stated career/academic goals.
  - [ ] When evaluation and search data permit, the audit suggests at least one concrete alternative course or adjustment (e.g., “Consider replacing EN.XXXX with AS.YYYY for lighter workload but similar topic”), grounded in real courses and evaluation data (no fabricated course codes).
  - [ ] When the system does not have enough data to recommend alternatives confidently, the audit explicitly explains that limitation instead of guessing.
  - [ ] The Schedule audit panel UI surfaces the goal-alignment text and any recommended changes in a distinct sub-section so users can easily differentiate it from the core workload feasibility summary.

---

## Coordination & Design Decisions

### Auth & Session Management

- **Google OAuth Flow**
  - Use a backend-driven OAuth flow (e.g., `GET /auth/google`, `GET /auth/google/callback`) with Google OAuth 2.0.
  - On callback, create or update a `users` table entry keyed by email and Google subject ID.
  - Maintain a session (e.g., signed cookie or JWT) that the frontend uses for authenticated API calls.

- **Shared Auth Contract (for this iteration)**
  - All user-specific routes in this iteration (`/api/onboarding`, `/api/schedules/*`, `/api/agent` when schedule-aware, etc.) must rely on a **shared auth contract**, regardless of how `req.user` is populated:
    - `req.user` is either `undefined` (unauthenticated) or an object `{ id: string; email: string; name?: string }`.
    - A `requireAuth`-style guard enforces authentication on user-specific routes:
      - If `!req.user`, respond with `401` and `{ error: "Unauthorized" }`.
      - Otherwise, proceed and downstream handlers can assume `req.user` is defined.
  - In this iteration, we **do not mandate a specific dev-only middleware implementation**. Instead:
    - Production code should be written assuming that Google OAuth will eventually populate `req.user` according to this contract.
    - Test code is free to stub or mock `req.user` directly (e.g., in unit/integration tests), as long as it respects the same shape and behavior.
  - Routes must **not** depend on ad-hoc headers (e.g., `X-Dev-User-Email`) or one-off auth checks; they should consistently use the shared contract (`req.user` + `requireAuth`-style guard) so that swapping in real OAuth later does not require changing business logic.

- **Data Model (`users` table, simplified example)**
  - `id: uuid` (PK)
  - `email: string` (unique)
  - `google_sub: string` (unique)
  - `created_at`, `updated_at`

### Onboarding, Profiles & Memories

- **Data Model**
  - `users` (extends existing table in `database/init.sql` to back OAuth + profiles):
    - `id: uuid` (PK)
    - `email: text` (unique)
    - `google_sub: text` (unique) — Google subject identifier
    - `created_at: timestamptz`
    - `updated_at: timestamptz`
  - `user_profiles`:
    - `user_id: uuid` (PK, FK to `users`)
    - `graduation_month: int`
    - `graduation_year: int`
    - `degrees: text[]` (or normalized table)
    - `school: text`
    - `raw_goals_text: text`
    - `raw_workload_text: text`
    - `raw_preferences_text: text`
    - `derived_memories: jsonb` (normalized, LLM-parsed preference objects)

- **LLM-backed parsing function: `parseOnboardingResponses`**
  - **Request:** `{ goals: string; workload: string; preferences: string }`.
  - **Response:** structured preferences, e.g.:
    ```json
    {
      "goals": ["graduate_school_ml", "research_oriented"],
      "workloadTolerance": "medium",
      "timePreferences": ["after_11am", "no_friday"],
      "notes": ["prefers project-based classes"]
    }
    ```
  - Invoked only by the `PUT /api/user/profile` handler when the user submits onboarding. Result is stored in `user_profiles.derived_memories`. The chat agent does **not** have access to this function; it only reads the stored memories.

### Schedules, Courses & Audits

- **Data Model**
  - `schedules`:
    - `id: uuid`
    - `user_id: uuid` (FK)
    - `name: text`
    - `term: text`
    - `created_at`, `updated_at`
  - `schedule_courses`:
    - `schedule_id: uuid` (FK)
    - `course_code: text`
    - `sis_offering_name: text`
    - `term: text`
    - (Optionally) cached title/description fields
  - `schedule_audits`:
    - `id: uuid`
    - `schedule_id: uuid` (FK to `schedules`)
    - `created_at: timestamptz`
    - `updated_at: timestamptz`
    - `result: jsonb` — structured audit result for that schedule, including:
      - numeric metrics (e.g., workload range, difficulty score)
      - feasibility label
      - narrative summary text
    - (Optional) `model_version: text` — identifies the LLM or algorithm used to generate the audit

### API Schema

All user-scoped routes require authentication (`requireAuth`); unauthenticated requests receive `401` and `{ error: "Unauthorized" }`. Request/response bodies are JSON unless noted.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/auth/google` | Redirect to Google OAuth consent | No |
| GET | `/auth/google/callback` | OAuth callback; create/update user, set session, redirect to app | No |
| POST | `/auth/logout` | Clear session | No |
| GET | `/api/user/profile` | Get current user's profile (for onboarding check / load); 404 if none | Yes |
| PUT | `/api/user/profile` | Create or update profile (onboarding submit). Body: `{ graduationMonth?, graduationYear?, degrees?, school?, goalsText?, workloadText?, preferencesText? }`. Backend calls the `parseOnboardingResponses` parsing function and stores `derived_memories`. | Yes |
| GET | `/api/schedules` | List schedules for current user. Response: `{ schedules: Array<{ id, name, term, createdAt, updatedAt }> }` | Yes |
| POST | `/api/schedules` | Create schedule. Body: `{ name: string, term: string }`. Response: created schedule. | Yes |
| GET | `/api/schedules/:id` | Get schedule and its courses. Response: schedule + `courses: Array<...>` + `latestAudit?: { id, createdAt, result }` when available. 403 if not owner. | Yes |
| POST | `/api/schedules/:id/courses` | Add course to schedule. Body: `{ courseCode, sisOfferingName, term }`. 403 if not owner. | Yes |
| DELETE | `/api/schedules/:id/courses` | Remove course. Body: `{ courseCode, sisOfferingName, term }` or query params. 403 if not owner. | Yes |
| POST | `/api/schedules/:id/audit` | Run workload audit; persist to `schedule_audits`. Response: `{ result: { workloadRange?, difficulty?, feasibilityLabel?, narrativeSummary?, ... } }`. 403 if not owner. | Yes |
| POST | `/api/agent` | Stream chat. Body: `{ message: string, scheduleId?: string }`. Uses `req.user` and optional schedule/memories. | Yes |
| GET | `/api/courses/:id/eval-summary` | Course eval summary (existing). | No (or Yes if you gate later) |
| GET | `/api/courses/:id/details` | SIS course details (existing). | No |

### Database Schema (SQL for `database/init.sql`)

The following SQL definitions capture the tables required for Iteration 2. These should be added to or reconciled with `database/init.sql` and then run in Supabase (e.g., via the SQL editor) so the remote database matches local expectations.

```sql
-- Users: OAuth-backed application users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  google_sub  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles: onboarding answers and long-term preference memories
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  graduation_month    INT,
  graduation_year     INT,
  degrees             TEXT[] DEFAULT '{}',
  school              TEXT,
  raw_goals_text      TEXT,
  raw_workload_text   TEXT,
  raw_preferences_text TEXT,
  derived_memories    JSONB DEFAULT '{}'::JSONB
);

-- Schedules: named schedules per user and term
CREATE TABLE IF NOT EXISTS schedules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  term       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedule → courses association
CREATE TABLE IF NOT EXISTS schedule_courses (
  schedule_id      UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  course_code      TEXT NOT NULL,
  sis_offering_name TEXT NOT NULL,
  term             TEXT NOT NULL,
  PRIMARY KEY (schedule_id, course_code, sis_offering_name, term)
);

-- Stored workload/goal audits per schedule (latest row is used by UI)
CREATE TABLE IF NOT EXISTS schedule_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result        JSONB NOT NULL,
  model_version TEXT
);

-- Cached course summaries per course per semester
CREATE TABLE IF NOT EXISTS course_summaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  term        TEXT NOT NULL,
  summary     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_code, term)
);
```

- **LLM Tool: `analyzeScheduleWorkload`**
  - **Input:** schedule + evaluation metrics + user memories.
  - **Output:** structured workload summary (numeric ranges, labels) and narrative explanation.
  - Used in R5 and, optionally, extended for R7.

- **Schedule-Aware Chat Agent**
  - Chat endpoint (`POST /api/agent`) is extended to:
    - Inject user profile and active schedule data into system prompt/tool calls.
    - Use tools like `searchCourseDescriptions`, `getCourseEvalSummary`, and `analyzeScheduleWorkload` as needed.
  - The frontend sends the active schedule ID along with chat messages.

---

## Task Breakdown

**Team:** 5 members — @Alinapanyue, @chjenniferhede, @James-Guo-03, @JunzheShi0702, @rachael-p  

**Convention:** 2–3 members per feature; 1 member per task.

### Must-Have Features (R1–R6)

- Feature: R1 – Google OAuth Login
  - Type: feature
  - Assignee(s): @chjenniferhede
  - Requirement Number: R1

- Feature: R2 – Onboarding & Initial Preference Memories
  - Type: feature
  - Assignee(s): @James-Guo-03, @chjenniferhede
  - Requirement Number: R2

- Feature: R3 – Schedule Creation & Dashboard
  - Type: feature
  - Assignee(s): @Alinapanyue, @JunzheShi0702
  - Requirement Number: R3

- Feature: R4 – Personalized Workload Feasibility Audits
  - Type: feature
  - Assignee(s): @rachael-p, @chjenniferhede
  - Requirement Number: R4

- Feature: R5 – Schedule-Aware Chat
  - Type: feature
  - Assignee(s): @rachael-p, @Alinapanyue
  - Requirement Number: R5

- Feature: R6 – Rich Undergraduate Course Discovery & Details
  - Type: feature
  - Assignee(s): @Alinapanyue, @chjenniferhede, @James-Guo-03, @JunzheShi0702, @rachael-p
  - Requirement Number: R6

### Nice-to-Have Features

- Feature: R7 – Goal Alignment & Alternatives
  - Type: feature
  - Assignee(s): @James-Guo-03, @JunzheShi0702
  - Requirement Number: R7

### Must-Have Tasks (R1–R6)

- Task: Implement backend Google OAuth endpoints and session handling (#108)
   - Type: task
   - Assignee(s): @chjenniferhede
   - Requirement Number: R1

- Task: Wire frontend login/logout UI to auth endpoints (#109)
   - Type: task
   - Assignee(s): @chjenniferhede
   - Requirement Number: R1

- Task: Implement users and user_profiles schema and apply to Supabase (#111)
   - Type: task
   - Assignee(s): @chjenniferhede
   - Requirement Number: R1, R2

- Task: Build onboarding UI (steps, validation, navigation) (#112)
   - Type: task
   - Assignee(s): @James-Guo-03
   - Requirement Number: R2

- Task: Implement onboarding submit endpoint and persistence (#113)
   - Type: task
   - Assignee(s): @James-Guo-03
   - Requirement Number: R2

- Task: Implement parseOnboardingResponses function and integrate on submit (#114)
   - Type: task
   - Assignee(s): @James-Guo-03
   - Requirement Number: R2

- Task: Implement schedules, schedule_courses, and schedule_audits schema (#115)
   - Type: task
   - Assignee(s): @JunzheShi0702
   - Requirement Number: R3

- Task: Build schedules dashboard UI and routing (#116)
   - Type: task
   - Assignee(s): @Alinapanyue
   - Requirement Number: R3

- Task: Implement add/remove course endpoints and wire to search results (#117)
   - Type: task
   - Assignee(s): @JunzheShi0702
   - Requirement Number: R3

- Task: Implement analyzeScheduleWorkload tool and schedule audit endpoint (#118)
   - Type: task
   - Assignee(s): @chjenniferhede
   - Requirement Number: R4

- Task: Extend agent (/api/agent) for schedule-aware chat (#120)
   - Type: task
   - Assignee(s): @rachael-p
   - Requirement Number: R5

- Task: Implement schedule-aware chat panel UI (#121)
   - Type: task
   - Assignee(s): @Alinapanyue
   - Requirement Number: R5

- Task: Implement Stop button behavior for chat (#124)
   - Type: task
   - Assignee(s): @Alinapanyue
   - Requirement Number: R6

- Task: Restrict embeddings pipeline and DB to undergraduate courses (#125)
   - Type: task
   - Assignee(s): @Alinapanyue
   - Requirement Number: R6

- Task: Load additional course evaluations into the database (#126)
   - Type: task
   - Assignee(s): @JunzheShi0702
   - Requirement Number: R6

- Task: Refine course search orchestration layer (#127)
   - Type: task
   - Assignee(s): @rachael-p
   - Requirement Number: R6

- Task: Only generate whyMatch for semantic search and rename shortDescription to description (#128)
   - Type: task
   - Assignee(s): @rachael-p
   - Requirement Number: R6

- Task: Add server-side TTL caching for SIS course details (#129)
   - Type: task
   - Assignee(s): @James-Guo-03
   - Requirement Number: R6

- Task: Cache course summaries in Postgres per course per semester (#131)
   - Type: task
   - Assignee(s): @JunzheShi0702
   - Requirement Number: R6

- Task: Refine course and schedule frontend UI for rich, semester-specific display (#132)
   - Type: task
   - Assignee(s): @rachael-p
   - Requirement Number: R3–R6

### Nice-to-Have Tasks (R7–R8)

- Task: Extend analyzeScheduleWorkload for goal alignment and alternatives (#122)
   - Type: task
   - Assignee(s): @James-Guo-03
   - Requirement Number: R7

- Task: Render goal alignment and recommendations in Schedule audit panel (#123)
   - Type: task
   - Assignee(s): @JunzheShi0702
   - Requirement Number: R7

- Task: Refine course summaries with dates, attribution, and trends (#130)
   - Type: task
   - Assignee(s): @Alinapanyue, @chjenniferhede
   - Requirement Number: R6

