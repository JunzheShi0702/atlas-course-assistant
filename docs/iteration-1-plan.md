## Iteration 1 Plan (Search UX & Shortlisting)

## Requirements & Acceptance Criteria

### R1: Single Query Textarea

**Description:** Users can enter any course-related query (from exact lookups to open-ended queries) into a single prominent textarea.

- **Acceptance Criteria:**
  - [ ] A single, clearly labeled textarea is displayed as the primary input on the main search view
  - [ ] A hovering button that communicates that both exact codes/names (e.g., "EN.553.171" or "Data Structures") and open-ended queries (e.g., "easy stats class with light workload") are supported
  - [ ] Users can submit via a visible button and via pressing Enter
  - [ ] When the text area is empty (or only with space), the send button should be disabled
  - [ ] The textarea value clears after search so users can make a new search request

### R2: Ranked List of Relevant Courses

**Description:** After submitting a query, the system displays a ranked list of relevant course results.

- **Acceptance Criteria:**
  - [ ] Submitting a valid query triggers a search request and shows a loading state in the results area
  - [ ] Results are displayed as an ordered list of course cards (see R3) sorted by a numeric relevance score returned from the backend
  - [ ] A configurable maximum number of results (default 5) is returned and shown
  - [ ] An empty state (indicating no results) is shown when no courses match the query
  - [ ] An error state is shown if the search fails (network/LLM/backend), with a retry button 

### R3: Course Cards with Match Explanation

**Description:** Each result is displayed as a course card that includes the course code and title, and includes a brief explanation of why the course matches the user’s query when the query is exploratory, preference-based, or otherwise non-exact.

- **Acceptance Criteria:**
  - [ ] Each course card displays the department+number code (e.g., `EN.553.171`) and course title
  - [ ] For exploratory, preference-based, or vague queries, each card includes a visible "Why this matches" explanation field
  - [ ] Explanations reference concrete aspects of the query (e.g., "mentions 'machine learning' in description", "historically lower workload", "matches requirement for CS department")
  - [ ] When the query is a strict exact lookup (e.g., a full course code or precise SIS filters), the system omits the explanation section from view
  - [ ] Each course card includes an "Expand" / "View more details" affordance that, when clicked, fetches full SIS details (if not already loaded) and reveals the complete `SisCourse` shape: full `description`, and all schedule/level fields (`level`, `timeOfDay`, `daysOfWeek`, `location`, `instructors`, `status`, `schoolName`, `department`)
  - [ ] Expanded state can be collapsed to return to the compact view; SIS details are cached per course for the session to avoid redundant fetches

### R4: On-Demand Evaluation-Based Course Summaries

**Description:** Users can request an on-demand summary for any course, which is generated from available quantitative course evaluation data.

- **Acceptance Criteria:**
  - [ ] Each detailed course card includes a "Summarize course evals" button to request a summary
  - [ ] Clicking the affordance triggers a summary request without blocking the rest of the UI
  - [ ] A loading state appears in the card while the summary is being generated
  - [ ] When evaluation data is available, the summary clearly references key quantitative metrics (e.g., overall rating, workload, difficulty)
  - [ ] When evaluation data is missing or incomplete, the UI displays a transparent message (e.g., "Not enough evaluation data to summarize this course") instead of a fabricated summary
  - [ ] Summaries are generated on-demand (not precomputed per course on initial page load), and subsequent summary requests for the same course within a session use cached data to avoid duplicate work

### R5: Session-Persistent Shortlist of Courses

**Description:** Users can add courses from search results to a temporary shortlist that persists for the duration of the session and supports removal.

- **Acceptance Criteria:**
  - [ ] Each course card includes a plus icon to add/remove that course from the shortlist
  - [ ] There is a dedicated shortlist region/panel visible alongside the search view
  - [ ] Adding a course to the shortlist updates the shortlist panel immediately and provides subtle feedback (e.g., toast, icon change)
  - [ ] Removing a course from the shortlist is supported from the shortlist panel through a button
  - [ ] The shortlist persists across query changes and subsequent searches within the same browser session (e.g., via in-memory or local storage)
  - [ ] The shortlist never affects global data; it is scoped to the individual user’s current session only

### R6 (Nice-to-Have): Attributed Course Summaries

**Description:** Course summaries clearly attribute the evaluation metrics used, labeled by instructor and term range.

- **Acceptance Criteria:**
  - [ ] Summary text or a structured metrics section indicates which terms and instructors were included (e.g., "Based on evaluations from Fall 2022–Spring 2024 for Dr. Smith and Dr. Lee")
  - [ ] A compact metrics table shows the quantitative values used (e.g., overall rating, workload), with labels for term ranges and instructor names
  - [ ] When evaluation data spans multiple instructors/terms, the summary clarifies whether metrics are averaged or otherwise aggregated

### R7 (Nice-to-Have): Ambiguity Refinement Prompts

**Description:** When queries are ambiguous, the system prompts users with suggested refinements to improve results.

- **Acceptance Criteria:**
  - [ ] The backend/LLM can detect when a query is ambiguous (e.g., "data science" with no constraints) or underspecified for the user’s likely intent
  - [ ] In these cases, the UI displays 1–3 concise refinement suggestions (e.g., "Filter to CIS department", "Limit to 300/400-level", "Prioritize lighter workload")
  - [ ] Users can apply a refinement suggestion with a single click, which updates the query or filters and re-runs the search
  - [ ] Refinement suggestions are contextual to the user's query and not generic boilerplate

## Coordination & Design Decisions

### LLM Tool Contracts & Data Shapes

- **LLM Tool: `searchCourseDescriptions`**
  - **Purpose:** Given a free-form user query, perform semantic search over the Spring 2026 title/description vector index, optionally use evaluation data for ranking, and return a ranked list of candidate courses plus explanations/refinement hints for the agent/UI.
  - **Request body (JSON):**
    - Shape:
      - `{ "query": string }`
    - Example:
      - `{ "query": "easy stats class with light workload" }`
  - **Response body (JSON):**
    - Shape:
      - `{ "results": SearchResult[] }`
      - `SearchResult`:
        - `courseId: string` — internal ID from `course_embeddings.course_id`; passed to `fetchSisCourseDetails`
        - `sisOfferingName: string` — maps to SIS `OfferingName` (e.g., `"EN.553.171.01"`)
        - `code: string` — dotted course code (e.g., `"EN.553.171"`, `"AS.270.415"`); matches `course_code` in `course_evaluations` and is the identifier to pass to `getCourseEvalSummary`
        - `title: string` — SIS `Title`
        - `shortDescription: string` — derived from SIS section `Description` and `WebNotes`
        - `term: string` — e.g., `"Spring 2026"`
        - `rank: number` — 1-based rank in the ordered results list
        - `relevanceScore: number` — underlying numeric relevance score
        - `matchExplanation?: string` — brief natural-language explanation of why this course matches the query
        - `ambiguityHints?: string[]` — suggested refinements for the overall query (for R7)
    - Example:
      - ```json
        {
          "results": [
            {
              "courseId": "en-553-171-01-spring-2026",
              "sisOfferingName": "EN.553.171.01",
              "code": "EN.553.171",
              "title": "Discrete Mathematics",
              "shortDescription": "Introduction to discrete mathematics with an emphasis on proofs.",
              "term": "Spring 2026",
              "rank": 1,
              "relevanceScore": 0.92,
              "matchExplanation": "Matches 'stats' and has historically lighter reported workload based on course evaluations.",
              "ambiguityHints": [
                "Limit to 100-level courses",
                "Filter to Krieger School only"
              ]
            }
          ]
        }
        ```

- **LLM Tool: `getCourseEvalSummary`**
  - **Purpose:** Given a `courseId`, fetch quantitative evaluation metrics and generate a concise, grounded summary (with attribution) suitable for the “Summarize course evaluations” UI on a single card.
  - **Exposure:** Implemented as both an **LLM tool** (for the agent to call in conversational / multi-step flows) and as a **REST API endpoint** (e.g., `GET /api/courses/:id/eval-summary`) used by the course card “Summarize course evals” button; both entrypoints share the same underlying implementation.
  - **Request:**
    - Path parameter: `id: string` — dotted course code (e.g., `"AS.270.415"`, `"EN.663.657"`); corresponds to the `code` field from `SearchResult` and matches `course_code` in `course_evaluations`
  - **Response body (JSON):**
    - Shape:
      - `summaryText: string` — generated narrative summary grounded in quantitative evaluation metrics
      - `metrics: { overallQuality, teachingEffectiveness, difficulty, workload, feedbackQuality }` — weighted averages (by `num_respondents`) of scraped quantitative eval fields across all sections; all on a 5-point scale
      - `attribution: { instructorNames: string[], termRange: { startTerm: string, endTerm: string }, sampleSize: number }` — `sampleSize` is total respondents across sections (falls back to section count if `num_respondents` is unavailable); `termRange` is inclusive and uses human-readable semester labels (e.g., `"Fall 2022"`, `"Spring 2025"`)
      - `hasData: boolean` — when `false`, only `message: string` is returned; no fabricated summary
    - Example:
      - ```json
        {
          "summaryText": "Students rate this course highly overall with moderate workload and clear instruction.",
          "metrics": {
            "overallQuality": 4.5,
            "teachingEffectiveness": 4.2,
            "difficulty": 3.2,
            "workload": 3.8,
            "feedbackQuality": 4.0
          },
          "attribution": {
            "instructorNames": ["Dr. Smith", "Dr. Lee"],
            "termRange": { "startTerm": "Fall 2022", "endTerm": "Spring 2025" },
            "sampleSize": 120
          },
          "hasData": true
        }
        ```

- **LLM Tool: `filterSisCourses`**
  - **Purpose:** Flexible wrapper around SIS `/classes` endpoints that can run filtered course searches using SIS query parameters (school, department, term, days of week, time window, level, instructor, etc.) to honor user constraints like specific days/times or instructors.
  - **Request body (JSON):**
      - Uses flat PascalCase keys that map directly to the SIS `/classes` query parameters. This flat shape was chosen over a nested friendly object because LLMs produce more reliable tool calls when the parameter schema closely mirrors the target API — fewer encoding steps mean fewer hallucination opportunities and simpler validation.
        - ```json
          {
            "Term"?: string,
            "School"?: string,
            "Department"?: string,
            "Instructor"?: string,
            "Credits"?: string,
            "TimeOfDay"?: string,
            "DaysOfWeek"?: string,
            "StartTimeEndTime"?: string,
            "Level"?: string,
            "WritingIntensive"?: "Yes" | "No",
            "limit"?: number
          }
          ```
        - `DaysOfWeek` uses an encoded format `"matchType|sum"` (e.g., `"all|21"` for Mon/Wed/Fri). A companion `generateDaysOfWeek` helper tool accepts `{ days: string[], matchType: "all" | "any" }` and produces the encoded string, so the LLM does not need to compute bitmasks manually.
        - `StartTimeEndTime` uses pipe-separated 24h format: `"HH:mm|HH:mm"` (e.g., `"09:00|10:15"`).
        - `Department` requires forward slashes replaced with underscores (e.g., `"Applied Mathematics_Statistics"` for `"Applied Mathematics/Statistics"`).
        - `limit` (optional): maximum number of courses to return (default 10). Omit or set to a higher value if the caller needs more results.
  - **Response body (JSON):**
    - Shape:
      - `{ "courses": SisCourse[] }`
      - `SisCourse` mirrors the relevant subset of the SIS Course + Section Detail layout, focused on schedule/level filters:
        - `offeringName: string`
        - `title: string`
        - `description: string` — always empty from the `/classes` endpoint; must be populated via `fetchSisCourseDetails` if needed
        - `schoolName: string`
        - `department: string`
        - `level: string` — SIS `Level` (e.g., `"Upper Level Undergraduate"`)
        - `timeOfDay: string` — SIS `TimeOfDay` (e.g., `"morning"`, `"afternoon"`)
        - `daysOfWeek: string` — humanized form of SIS `DOW` (e.g., `"Mon/Wed/Fri"`)
        - `location: string` — SIS `Location` / campus
        - `instructors: string[]`
        - `status: string` — section `Status` (e.g., `"Open"`, `"Closed"`, `"Waitlist"`)

- **LLM Tool: `fetchSisCourseDetails`**
  - **Purpose:** Fetch the full `SisCourse` record for a specific offering. Used by the course card "Expand" affordance to load additional details on demand or if user query asks about information for a specific course number.
  - **Request:** `courseId: string` — from `SearchResult`; backend resolves to SIS `/classes/{course number+section}/{term}`.
  - **Response body (JSON):** `{ "course": SisCourse }` — same shape as a single element from `filterSisCourses` response.

### Data Sources & Scope

- **SIS Web API (Course Catalog)**
  - All authoritative course data comes from the SIS Self-Service Public Course Search API at `https://sis.jhu.edu/api/classes`.
  - We obtain an API key via SIS access validation and pass it on all requests with the `key` query parameter.
  - For this iteration, the system:
    - Fetches **Spring 2026** offerings once to build a vector index over **titles and descriptions only** (plus `courseId` for lookup, and minimal keys like course code, offering name, and term needed to re-identify courses).
    - Does **not** persist any other SIS fields (e.g., seats, instructors, meeting times) outside this vector index.
  - At query time, additional SIS details (beyond title/description/code/term) are retrieved on demand via the `fetchSisCourseDetails` tool and are not stored long term, only cached for the session.

- **Course Evaluations Website**
  - Quantitative course evaluation metrics (e.g., overall quality, workload, difficulty) are scraped from the course evaluations website.
  - Scraped evaluation data is stored in the `course_evaluations` table, keyed by catalog course code (`course_code`) so we can store and query evals for any course/semester; `getCourseEvalSummary` looks up by course code derived from `courseId`.
  - For summaries and attribution (R4/R6), only scraped numeric evaluation data and associated instructor/term metadata are used — no synthetic ratings are introduced.

### Database Schema

**Storage:** Both tables live in **PostgreSQL**. The `course_embeddings` table uses the **pgvector** extension for its vector column; `course_evaluations` is a standard relational table. Depends on foundational setup (#7).

- **`course_embeddings`** — vector index for semantic search over course titles and descriptions (PostgreSQL + pgvector):
  - `course_id` — primary key; matches `courseId` in `SearchResult`
  - `code`, `sis_offering_name`, `term`, `title`, `short_description` — metadata returned with search results
  - `embedding` — vector (1536 dimensions, OpenAI `text-embedding-3-small`); computed from `title` + `short_description`
  - Similarity: cosine
  ``` sql
  CREATE TABLE course_embeddings (
    course_id         TEXT PRIMARY KEY,
    code              TEXT NOT NULL,
    sis_offering_name TEXT NOT NULL,
    term              TEXT NOT NULL,
    title             TEXT NOT NULL,
    short_description TEXT NOT NULL DEFAULT '',
    embedding         VECTOR(1536)
  );
  CREATE INDEX course_embeddings_hnsw_idx ON course_embeddings USING hnsw (embedding vector_cosine_ops);
  ```

- **`course_evaluations`** — stores scraped quantitative metrics for summaries and attribution (PostgreSQL, standard relational table). Keyed by catalog course code so evals can be stored for any course/semester (not only courses in the `courses` table):
  - `id` — primary key for the evaluation row (e.g., UUID)
  - `course_code` — catalog course code (e.g., EN.553.171); used for lookup in `getCourseEvalSummary` (derive from `courseId`/search result)
  - `semester` — e.g., Fall 2024, Spring 2025
  - `instructor` and numeric metric columns as below
  ``` sql
  CREATE TABLE course_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code TEXT NOT NULL,
    semester VARCHAR(20) NOT NULL,
    instructor VARCHAR(255),
    overall_quality DECIMAL(3,2),
    teaching_effectiveness DECIMAL(3,2),
    intellectual_challange DECIMAL(3,2),
    ta_quality DECIMAL(3,2),
    feedback_quality DECIMAL(3,2),
    work_load DECIMAL(3,2),
    response_rate DECIMAL(3,2)
  );
  CREATE INDEX idx_course_evaluations_course_code ON course_evaluations (course_code);
  ```

### Frontend UX Decisions

- Single-page experience where:
  - The textarea and results list share the main viewport
  - The shortlist is visible as a sidebar or docked panel
- Course cards are the reusable component used in:
  - Search results list
  - Shortlist view (possibly with a compact variant)
- State management:
  - Shortlist maintained in client state and optionally persisted in `localStorage` for the session

### Request Flow & LLM Usage

- **Request flow:** User query → LLM agent → agent orchestrates tool calls (`searchCourseDescriptions`, `filterSisCourses`, `getCourseEvalSummary`, `fetchSisCourseDetails`) and returns structured response to UI. Frontend sends user message to a single agent endpoint for query-based interactions; the agent decides which tools to call and in what order.
- **Agent orchestration:** The agent receives the user's natural-language query (or intent, e.g., "summarize course X"), reasons about which tools to invoke, calls them, and returns results. For search: the agent typically calls `searchCourseDescriptions` and/or `filterSisCourses` for constraints. For conversational "Summarize" requests, the agent receives a courseId and calls `getCourseEvalSummary`.
- **Summary button flow:** The course card "Summarize course evals" button may call a dedicated REST endpoint (e.g., `GET /api/courses/:id/eval-summary`) that wraps the same `getCourseEvalSummary` implementation; this endpoint is a thin HTTP wrapper over the shared tool logic. Evaluation data (scraped into `course_evaluations`) is only exposed via this eval-summary response; there is no separate metrics API.
- **LLM usage:** LLM is used for (1) agent reasoning and tool selection, and (2) _inside_ tools: `searchCourseDescriptions` generates `matchExplanation`; `getCourseEvalSummary` generates `summaryText` from metrics. The `getCourseEvalSummary` implementation includes an in-memory cache keyed by `courseId` so repeated summary requests in this iteration avoid duplicate LLM calls.

### Responsibilities & Dependencies

- **Dependencies**
  - Attributed summaries (R6) depend on having instructor/term metadata available in the evaluations source
  - Ambiguity refinement prompts (R7) depend on LLM or rule-based detection of under-specified queries

## Task Breakdown

**Team:** 6 members — @Alinapanyue, @chjenniferhede, @James-Guo-03, @JunzheShi0702, @rachael-p, @madooei

**Convention:** 2–3 members per feature; 1 member per task

### Must-Have Features (R1–R5) — Evenly Split

- Feature: R1 – Single Query Textarea
  - Type: feature
  - Assignee(s): @chjenniferhede, @JunzheShi0702
  - Requirement Number: R1

- Feature: R2 – Ranked Results List
  - Type: feature
  - Assignee(s): @Alinapanyue, @chjenniferhede, @madooei
  - Requirement Number: R2

- Feature: R3 – Course Cards with Match Explanation
  - Type: feature
  - Assignee(s): @chjenniferhede, @James-Guo-03, @JunzheShi0702
  - Requirement Number: R3

- Feature: R4 – On-Demand Evaluation-Based Summaries
  - Type: feature
  - Assignee(s): @rachael-p, @madooei
  - Requirement Number: R4

- Feature: R5 – Session-Persistent Shortlist
  - Type: feature
  - Assignee(s): @chjenniferhede, @James-Guo-03, @JunzheShi0702
  - Requirement Number: R5

### Nice-to-Have Features (R6–R7) — Extras

- Feature: R6 – Attributed Course Summaries (Nice-to-Have)
  - Type: feature
  - Assignee(s): @rachael-p, @chjenniferhede
  - Requirement Number: R6

- Feature: R7 – Ambiguity Refinement Prompts (Nice-to-Have)
  - Type: feature
  - Assignee(s): @James-Guo-03, @Alinapanyue
  - Requirement Number: R7

### Must-Have Tasks (R1–R5)

- Task: Implement single textarea search input & submission UX
  - Type: task
  - Assignee(s): @James-Guo-03
  - Requirement Number: R1

- Task: Implement LLM agent orchestration
  - Type: task
  - Assignee(s): @rachael-p
  - Requirement Number: R1, R2, R4

- Task: Add loading, empty, and error states to results area
  - Type: task
  - Assignee(s): @chjenniferhede
  - Requirement Number: R2

- Task: Create `course_embeddings` table and SIS snapshot + embedding pipeline
  - Type: task
  - Assignee(s): @Alinapanyue
  - Requirement Number: R2, R3

- Task: Implement `searchCourseDescriptions` LLM tool
  - Type: task
  - Assignee(s): @Alinapanyue
  - Requirement Number: R2

- Task: Extend `searchCourseDescriptions` to include matchExplanation
  - Type: task
  - Assignee(s): @Alinapanyue
  - Requirement Number: R3

- Task: Register for SIS Course Search API key and configure secure storage
  - Type: task
  - Assignee(s): @rachael-p
  - Requirement Number: R2, R3

- Task: Implement `filterSisCourses` tool (SIS /classes proxy)
  - Type: task
  - Assignee(s): @madooei
  - Requirement Number: R2, R3

- Task: Implement course card component
  - Type: task
  - Assignee(s): @JunzheShi0702
  - Requirement Number: R3

- Task: Implement `fetchSisCourseDetails` LLM tool and wire course card expand
  - Type: task
  - Assignee(s): @JunzheShi0702
  - Requirement Number: R3

- Task: Implement View summary UI and loading/cached states per card
  - Type: task
  - Assignee(s): @James-Guo-03
  - Requirement Number: R4

- Task: Implement `getCourseEvalSummary` LLM tool and summary API endpoint
  - Type: task
  - Assignee(s): @rachael-p
  - Requirement Number: R4

- Task: Create `course_evaluations` table and scrape evaluation metrics
  - Type: task
  - Assignee(s): @rachael-p
  - Requirement Number: R4

- Task: Implement shortlist panel UI and mobile behavior
  - Type: task
  - Assignee(s): @chjenniferhede
  - Requirement Number: R5

- Task: Add shortlist state management (add/remove, dedupe)
  - Type: task
  - Assignee(s): @chjenniferhede
  - Requirement Number: R5

- Task: Add unit tests for core behavior
  - Type: task
  - Assignee(s): @James-Guo-03
  - Requirement Number: R1, R2, R4, R5

### Nice-to-Have Tasks (R6–R7) — Extras

- Task: Extend summary generation to include attribution metadata
  - Type: task
  - Assignee(s): @rachael-p
  - Requirement Number: R6

- Task: Render attributed metrics section in course summary UI
  - Type: task
  - Assignee(s): @chjenniferhede
  - Requirement Number: R6

- Task: Implement ambiguity detection and refinement suggestions
  - Type: task
  - Assignee(s): @James-Guo-03
  - Requirement Number: R7

- Task: Render refinement suggestions as clickable chips
  - Type: task
  - Assignee(s): @Alinapanyue
  - Requirement Number: R7

- Task: Add unit tests for refinement flows
  - Type: task
  - Assignee(s): @JunzheShi0702
  - Requirement Number: R7

- Task: Document data refresh process
  - Type: task
  - Assignee(s): @madooei
  - Requirement Number: R2, R3, R4
