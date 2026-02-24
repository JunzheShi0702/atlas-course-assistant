# Iteration 1 Plan

## Requirements & Acceptance Criteria

### R1: Search UI

**Description:** Users can search for courses using a single course search field and view matching search results.

- **Acceptance Criteria:**
  - [ ] Single search input field is prominently displayed on the main page
  - [ ] Users can type a query and submit via button or Enter key
  - [ ] Search results display as a list showing course code, title, and brief description
  - [ ] Loading state of clear indication is shown while search is in progress
  - [ ] Empty state is shown when no results match
  - [ ] Error state is shown if search fails

### R2: Query Interpretation (Routing)

**Description:** Input is parsed into (a) structured SIS attributes and (b) natural-language descriptors.

- **Acceptance Criteria:**
  - [ ] System identifies structured attributes (e.g., department codes like "CIS", course levels like "1000-level", semesters like "Fall 2024")
  - [ ] System extracts natural-language descriptors (e.g., "easy", "interesting", "about machine learning")
  - [ ] Mixed queries are correctly split (e.g., "CIS courses about data science" → structured: CIS, natural: "data science")
  - [ ] Parser returns a structured object with both attribute types
  - [ ] Edge cases handled: empty query, only structured, only natural language

### R3: Natural Language Search

**Description:** The system retrieves and ranks courses for natural-language descriptors by searching over course titles and descriptions.

- **Acceptance Criteria:**
  - [ ] Natural language queries return semantically relevant courses
  - [ ] Search covers both course titles and descriptions
  - [ ] Results are ranked by relevance score
  - [ ] System uses vector embeddings for semantic search
  - [ ] Returns top N results (configurable, default 10)

### R4: SIS Attribute Search with Combined Results

**Description:** The system executes SIS attribute-based search using parsed structured constraints and combines these results with natural language search results.

- **Acceptance Criteria:**
  - [ ] Structured attributes filter courses correctly (department, level, semester, etc.)
  - [ ] Attribute filters can be combined (AND logic)
  - [ ] Results from attribute search are merged with natural language results
  - [ ] Combined ranking preserves relevance while respecting hard constraints
  - [ ] Pure attribute searches return all matching courses

### R5: AI-Generated Course Summaries

**Description:** The system generates on-demand course summaries using quantitative course evaluation data.

- **Acceptance Criteria:**
  - [ ] Clicking on a button of a course card shows an AI-generated summary
  - [ ] Summary incorporates course evaluation metrics (ratings, workload, etc.)
  - [ ] Summary is generated on-demand (not pre-computed)
  - [ ] Summary includes key metrics: overall rating, difficulty, workload hours
  - [ ] Loading state shown while summary generates
  - [ ] Informing user when evaluation data is unavailable


## Coordination & Design Decisions

### API Endpoints

```
POST /api/search
Request:  { query: string }
Response: { results: [{ courseId, code, title, description, relevanceScore }] }

GET /api/courses/:id/summary
Response: { courseId, summary }

GET /api/courses/:id/metrics
Response: { courseId, metrics: { overall_quality, teaching_effectiveness, intellectual_challange, ta_quality, feedback_quality, work_load, response_rate } }
```

### Database Schema

```sql
-- courses table
CREATE TABLE courses (
  id UUID PRIMARY KEY,
  department VARCHAR(4) NOT NULL,
  code VARCHAR(3) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  embedding VECTOR(1536)
);

-- course_evaluations table
CREATE TABLE course_evaluations (
  id UUID PRIMARY KEY,
  course_id UUID REFERENCES courses(id),
  semester VARCHAR(4),
  instructor VARCHAR(255),
  overall_quality DECIMAL(3,2),
  teaching_effectiveness DECIMAL(3,2),
  intellectual_challange DECIMAL(3,2),
  ta_quality DECIMAL(3,2),
  feedback_quality DECIMAL(3,2),
  work_load DECIMAL(3,2),
  response_rate DECIMAL(3,2)
);
```

### Vector Search

- Embedding model: OpenAI `text-embedding-3-small` (1536 dimensions)
- Vector store: pgvector extension in PostgreSQL
- Similarity metric: Cosine similarity

### Tech Stack

- Frontend: React with TypeScript
- Backend: Node.js/Express
- Database: PostgreSQL with pgvector
- LLM: OpenAI GPT-4 for summary generation and query parsing

### Dependencies Between Tasks

- R2 (Query Parsing) must be completed before R4 (Combined Results) can be fully implemented
- R3 (Natural Language Search) requires database setup and course embeddings first
- R4 (SIS Attribute Search) depends on R2 and R3 being functional
- R5 (Summaries) depends on course evaluations data being seeded

### Team Responsibilities

- **Alina:** Database setup, schema design, pgvector configuration, data seeding
- **James:** Query parsing service, result combination/ranking logic
- **Junzhe:** Semantic search implementation, vector embeddings, search API endpoint
- **Jennifer:** Frontend UI components (search input, results list, course detail view)
- **Rachael:** Summary generation service, summary API endpoint, integration testing

## Task Breakdown

- Feature: R1 - Search UI
  - Type: feature
  - Assignee(s): @jennifer, @junzhe
  - Requirement Number: R1

- Feature: R2 - Query Interpretation (Routing)
  - Type: feature
  - Assignee(s): @james
  - Requirement Number: R2

- Feature: R3 - Natural Language Search
  - Type: feature
  - Assignee(s): @junzhe, @alina
  - Requirement Number: R3

- Feature: R4 - SIS Attribute Search with Combined Results
  - Type: feature
  - Assignee(s): @alina, @james
  - Requirement Number: R4

- Feature: R5 - AI-Generated Course Summaries
  - Type: feature
  - Assignee(s): @rachael, @jennifer
  - Requirement Number: R5

- Task: Set up PostgreSQL with pgvector extension
  - Type: task
  - Assignee(s): @alina
  - Requirement Number: R3

- Task: Create courses and evaluations database schema
  - Type: task
  - Assignee(s): @alina
  - Requirement Number: R4

- Task: Seed database with course catalog data
  - Type: task
  - Assignee(s): @alina
  - Requirement Number: R4

- Task: Build query parsing service with LLM
  - Type: task
  - Assignee(s): @james
  - Requirement Number: R2

- Task: Add unit tests for query parser
  - Type: task
  - Assignee(s): @james
  - Requirement Number: R2

- Task: Implement vector embedding generation for courses
  - Type: task
  - Assignee(s): @junzhe
  - Requirement Number: R3

- Task: Build semantic search endpoint
  - Type: task
  - Assignee(s): @junzhe
  - Requirement Number: R3

- Task: Build search API endpoint (POST /api/search)
  - Type: task
  - Assignee(s): @junzhe
  - Requirement Number: R1

- Task: Build SIS attribute filter queries
  - Type: task
  - Assignee(s): @alina
  - Requirement Number: R4

- Task: Implement result combination/ranking logic
  - Type: task
  - Assignee(s): @james
  - Requirement Number: R4

- Task: Build search UI component (input + results list)
  - Type: task
  - Assignee(s): @jennifer
  - Requirement Number: R1

- Task: Build course detail/summary UI component
  - Type: task
  - Assignee(s): @jennifer
  - Requirement Number: R5

- Task: Build course summary generation service
  - Type: task
  - Assignee(s): @rachael
  - Requirement Number: R5

- Task: Build summary API endpoint (GET /api/courses/:id/summary)
  - Type: task
  - Assignee(s): @rachael
  - Requirement Number: R5

- Task: Add integration tests for search pipeline
  - Type: task
  - Assignee(s): @rachael
  - Requirement Number: R3

- Task: Seed database with course evaluation data
  - Type: task
  - Assignee(s): @rachael
  - Requirement Number: R5
