# Iteration 4 Plan (Attribution, Course History, Conversational Search, and Schedule UX)

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
When a request is ambiguous or underspecified, the assistant must collect required user input first, then continue the same request using one unified search capability.

- **Acceptance Criteria:**
  - [ ] For ambiguous course references or constraints, the assistant returns a clarification question instead of a final answer or mutation.
  - [ ] Clarification prompts include concrete options with identifiers (course code/section/term) when candidates exist.
  - [ ] After the user answers a clarification, the system resumes the pending request without requiring the user to restate the original query.
  - [ ] Pending clarification state is stored per schedule conversation so refresh/revisit preserves unfinished turns.
  - [ ] The LLM can invoke only one course-search capability (`searchCourses`) and does not choose between separate exact/semantic search tools.
  - [ ] `searchCourses` internally combines exact identifier matching, SIS constraint filtering, and semantic retrieval, then returns one merged ranked result set.
  - [ ] Each returned search result includes an explicit `matchType`: `exact`, `constraint`, `semantic`, or `hybrid`.
  - [ ] For non-search intents (e.g., simple schedule status questions), the assistant completes the turn without calling `searchCourses`.
  - [ ] `queryCourseMetrics` aggregates across all available evaluation terms by default, and applies term scoping only when a specific term is explicitly provided.

---

### R4: Section-Aware Schedule Operations - Alina, Junzhe

**Description:**  
Course exploration remains course-level, but adding to a schedule is section-specific: users choose a concrete section (with meeting times) before enrollment.

- **Acceptance Criteria:**
  - [ ] Course exploration/search cards remain at course level and do not require section-level rendering in the initial result card.
  - [ ] When a user chooses to add a course, the UI presents a section dropdown/list with section identifier and meeting-time info for each available section.
  - [ ] The addable section list includes only sections that have complete meeting-time data (day mask, start time, end time).
  - [ ] If multiple valid sections exist, add-to-schedule is blocked until one section is selected.
  - [ ] Schedule data for enrolled items stores and returns the selected section identifier, day mask, start time, end time, and location.
  - [ ] Add/drop/swap operations target the selected section (not only the base course code).
  - [ ] For chat-driven add/swap requests with multiple valid sections and no section choice, the assistant asks a section clarification question before mutating.
  - [ ] Conflict detection runs at section meeting-time granularity and notifies users about conflicting adds/swaps with a conflict message naming both sections.

---

### R5: UI Refinement and Presentation Quality - Jennifer

**Description:**  
The product UI is refined for clarity and usability across core surfaces, including schedule visualization and the public landing experience.

- **Acceptance Criteria:**
  - [ ] The schedule UI includes a user-visible toggle between list view and weekly calendar view.
  - [ ] Calendar view renders each selected section in the correct day/time slot using local timezone times.
  - [ ] Calendar entries display, at minimum, course code, section identifier, and meeting time range.
  - [ ] Switching between list and calendar views does not lose schedule state or selected courses.
  - [ ] The public landing page is updated with improved content hierarchy and clearer calls-to-action for unauthenticated users.
  - [ ] Core UI refinements preserve existing auth and routing behavior (unauthenticated users stay on public landing; authenticated users can still navigate to schedules).

## Iteration 4 Design Decisions

### D1: Clarification-State Lifecycle (R3)

- Ambiguous requests create pending clarification state scoped to a schedule conversation.
- The next user reply resolves pending clarification before a new request is processed.
- Mutations do not run until required clarification input is provided.

### D2: Conflict Error Contract (R4)

- Section-time conflicts return structured data containing attempted section, conflicting section, and a conflict reason/message.
- Chat and UI render conflict feedback from this structured payload.

### D3: Course Metrics Scope (R3)

- `queryCourseMetrics` defaults to cross-term aggregation over all available evaluation rows for the course.
- If a specific term is provided in the query/tool input, metrics are scoped to that term.

## Task Breakdown

### R1: Summary Source Attribution - Junzhe

- [ ] Extend course summary responses to include the numerical evaluation rows used to generate each summary.
- [ ] Add a button in the summary UI that displays those values in a modal/table and handles no-data states.

### R2: Course History Tracking - James

- [ ] Implement completed-course history management so users can add/remove completed courses from search and from a dedicated history view. - James
- [ ] Implement transcript intake and review flow that extracts courses, maps them to SIS IDs with `matched/ambiguous/unmatched` statuses, and requires user resolution for ambiguous entries before save. - James
- [ ] Apply completed-course history in recommendation and prerequisite flows so completed courses are excluded from recommendations and counted toward prerequisite fulfillment. 

### R3: Disambiguation-Gated Multi-Turn Requests + Unified Search - Rachael, Junzhe

- [ ] Implement clarification-state handling for ambiguous requests so the assistant asks for required input and resumes the pending request after the user reply. - Rachael
- [ ] Replace separate model-facing course search tools with one unified `searchCourses` capability that returns merged ranked results with explicit `matchType` values. - Rachael
- [ ] Update `queryCourseMetrics` to use cross-term aggregation by default, with optional explicit term filtering. - Junzhe
- [ ] Stabilize integrations by resolving end-to-end defects across search, clarification, section selection, and schedule update flows. - Rachael

### R4: Section-Aware Schedule Operations - Alina, Junzhe

- [ ] Update tool contracts, schedule data model, and schedule APIs so section identifier and meeting-time fields are available, persisted, and returned for section-aware schedule operations. - Alina
- [ ] Implement section-selection add flow so adding a course requires choosing one valid section with meeting times. - Alina
- [ ] Implement section-level conflict detection in add/swap flows with user-visible conflict messages naming both conflicting sections. - Alina
- [ ] Implement section-level clarification for chat-driven add/swap requests when a course has multiple valid sections. - Junzhe

### R5: UI Refinement and Presentation Quality - Jennifer

- [ ] Refine the public landing page layout/content hierarchy and strengthen login/sign-up calls-to-action, as well as refining the UI of any page within the app.
- [ ] Refine memory storage display: user memories should be stored and viewable as short statements that are optimized for the agent to parse, not curt phrases like "monday" to indicate that the user prefers classes on Mondays.
- [ ] Implement weekly calendar rendering for scheduled sections with correct local-time placement and required entry details (course code, section, time range) and list/calendar view toggle.
