# Product Requirement Document

## Overview

### Problem Statement

JHU students often struggle to balance career goals with graduation requirements during course selection, leading to unmanageable workloads, poorly structured schedules, or even delayed graduation. While numerical course ratings from previous semesters are available on the JHU course evaluations site, they are presented with little context or synthesis. Students must independently interpret what the numbers mean, compare courses, and weigh trade-offs themselves. Although qualitative student reviews do exist on informal platforms, they are scattered, inconsistent, and not comprehensive. As a result, students are left to individually piece together fragmented information across multiple sites without guidance tailored to their personal preferences or constraints.

### Proposed Solution

Atlas is a full-stack web application that helps students navigate the course selection process by planning and evaluating their schedules within the broader context of their academic paths. Users can dynamically build tentative schedules, specify personal preferences (e.g., time constraints, workload tolerance, career goals, learning style), and receive personalized feedback on both individual courses and their schedule as a whole.

The platform includes a conversational interface powered by an LLM grounded in JHU-specific data sources, including course evaluations, SIS, and potentially other external platforms. Courses and professors within Atlas will also have AI-generated summaries that synthesize all available data into concise, student-friendly insights.

Atlas is intended to complement, not replace, existing JHU systems at first. The MVP focuses on data interpretation and personalization rather than schedule visualization or degree auditing, which already exist.

Questions that the system will be able to answer include:

- What are the most useful upper-level electives for \[major\] if I want to pursue grad school?
- How heavy will my workload be with this schedule? Is it doable?
- What professor should I take for Intro to Fiction and Poetry?
- How difficult is data structures compared to intermediate programming?
- What ChemBE classes should I take \[as a non-ChemBE\] if I want to work in biotech postgrad?
- Should I take \[this class\] or \[that class\]?
- How is \[professor\]?

Proposed data sources include course information from the public, official SIS Web API; numerical ratings from automated ingestion of student-accessible PDFs from the JHU course evaluations site; and optionally discussion posts from the JHU subreddit via the public Reddit API. All sources are public or student-facing and do not require additional privileges, and existing student projects have successfully extracted data from the JHU course evaluation site using similar methods.

### Target Users

JHU undergraduate students in KSAS and WSE, particularly those who are concerned about workload balance, course difficulty, or alignment between coursework and future career or academic goals.

### AI Component

Atlas leverages AI in three primary ways:

1. **LLM-Based Conversational Assistant**: Students can interact with Atlas through natural language to design schedules, ask course-related questions, and receive guidance tailored to their degree requirements and stated preferences. Responses are generated using a retrieval-augmented generation (RAG) pipeline that grounds the LLM in JHU-specific data, including course evaluations and structured academic information. The experience mirrors an academic advising conversation while remaining on-demand and student-driven.
2. **Course Summaries**: The system compiles and synthesizes data from course evaluations and related sources to generate concise summaries for courses and instructors, including typical workload and faculty research interests.
3. **Intelligent Selection and Filtering:** When students describe their needs in natural language (e.g., “low workload electives that fit a Tue/Thu schedule”), Atlas translates these requests into structured database queries to filter, rank, and suggest courses. This reduces the need for manual searching and credit calculations within SIS.

Without the help of AI, students would have to independently search multiple platforms, navigate the unwieldy course evaluation interface, or rely on limited academic advising appointments. This is both time-consuming and also provides students with a limited scope of information if their search is not thorough. Atlas reduces this burden by centralizing information and providing personalized, holistic feedback that is difficult to obtain through existing tools.

### Similar Existing Solutions

**Semester.ly**: JHU-specific course planning tool that allows students to visually arrange schedules by day and time. While useful for layout and conflict detection, it does not provide AI-driven insights, personalized feedback, or synthesized evaluations of workload and career relevance.

**uCredit/Stellic**: JHU-specific degree audit and tracking platforms that help students verify graduation requirements. These tools do not offer AI-powered recommendations or qualitative insights.

**Course evaluation scraper app**: personal GitHub project by a JHU student that aggregates course evaluation data into a more usable interface. However, it lacks AI features and personalization.

**Yale Coursetable**: Yale-specific course discovery and planning tool that combines scheduling, evaluations, and historical enrollment data. While powerful, Coursetable primarily supports browsing and comparison rather than AI-driven personalization or holistic schedule analysis.

**Stanford Carta**: Stanford-specific course evaluation platform that aggregates structured and open-ended feedback.

## Requirements

## Functional Requirements

#### Essential (Must-Have): core AI reqs denoted with \!\!

- Users can log in using their Google account
- The system extracts graduation month/year, degree information (degrees pursued, primary major/school), career goals, workload tolerance, and personal preferences about classes (e.g., doesn’t like morning classes) from first-time users through an onboarding questionnaire
  - Users can select graduation date and degree info using multi-select dropdowns
  - \!\! Users can answer the remaining questions in natural language, which are parsed by the LLM
- \!\! Users can search for courses using a single course search field that accepts (a) keyword queries matching SIS attributes (e.g., course title/instructor) and/or (b) natural-language descriptors (e.g., “easy humanities classes”)
  - The system performs keyword matching on SIS course fields and translates natural-language descriptors into structured SIS constraints and semantic matches against course titles and descriptions
  - The system displays matching courses/sections based on search results
- \!\! The system generates on-demand course summaries using quantitative course evaluation data (e..g, overall quality, intellectual challenge, workload) and highlights observable trends across instructors and over time when such trends are present (e.g., “the intellectual challenge of this course has increased over the past three years, from an average rating of 2/5 to 4.2/5”)
  - The system provides source attribution by including inline references to course evaluation metrics and offering an option to view the underlying evaluation data used, labelled by term range and instructor(s)
- Users can create, edit, and delete schedules
- \!\! Users can add, drop, or swap courses in a selected schedule using natural language commands (e.g., “drop physics and add a different NS course”)
- \!\! The system provides personalized audits of users’ schedules, including assessments of workload feasibility, alignment with the user’s future goals, and alternative course recommendations
- \!\! Users can chat with the LLM to answer questions related to their schedules and receive personalized course planning advice
- The system stores information from the initial questionnaire and other stable/long-term course selection preferences obtained through chat as memories, which are presented to users as short preference statements (e.g., “prefers classes starting after 11 am”)
  - Users can view and delete these stored statements
- Users can edit their graduation and degree information
- Users can view their schedules in a structured dashboard layout
- The system displays a public landing page outlining core capabilities

#### Non-Essential (Nice-to-Have)

- Users can add free-form text reviews for courses they’ve taken
  - The system includes user-submitted reviews in course summaries by displaying a “Student Reviews” section that summarizes available reviews for that course
- Users can use the course search feature to indicate courses they have taken already
  - The system uses this course history to exclude those courses from recommendations and identify fulfilled prerequisites
- Users can upload a photo of their extracurricular schedule or describe non-course time commitments in natural language
  - The system extracts approximate time constraints from this input and uses them to exclude course sections that conflict with these constraints from recommendations
- Users can view schedules in a weekly calendar format
- The system can support importing planned schedules from Semesterly

#### Out of Scope (Won’t Have)

- Expansion to institutions outside Johns Hopkins University
- Automated registration in SIS on behalf of users
- Mobile native application
- Support for graduate, part-time, or Peabody-specific logic

## Non-functional Requirements

#### Performance & Data Freshness

- Core application pages load within 2 seconds
- Course search returns results within 2 seconds
- LLM chat responses begin streaming within 2 seconds of user submission for typical queries
- On-demand course summaries are generated within 5 seconds if no cached version exists
  - Generated summaries are cached for 24 hours to reduce repeated computation
- Complex AI tasks (personalized schedule audits, multi-constraint natural-language schedule restructures) complete within 15 seconds
- SIS API calls time out after 10 seconds; fallback messaging shown if SIS is unavailable
- Course evaluation data is extracted at the start of each academic semester
  - After initial extraction, only the most recent completed semester is added \- no historical evaluation data is modified after ingestion
  - If data extraction fails for a given semester, the system continues using previously stored evaluation data

#### Privacy

- The system stores only the following user data:
  - User’s email address obtained from Google OAuth
  - Graduation date and degree information
  - User-created schedules
  - Long-term preferences inferred from onboarding or chat interactions
- Chat messages are processed for response generation, but are not permanently stored unless explicitly converted into long-term memories
- Course evaluation data used by the system does not contain personally identifiable information and is stored separately from user account data
- Users can permanently delete their account and all associated data at any time

#### Security

- Authentication is handled via Google OAuth
- All user data stored by the system (detailed above in ‘Privacy’ section) is encrypted at rest
- Users can only access their own schedules and stored preferences
- API keys are stored securely and never exposed to users
- Chat and course search endpoints are rate-limited to 100 requests per hour per user
- User sessions expire after 2 hours of inactivity

#### Usability

- The system provides onboarding guidance for first-time users to explain key features and workflows
- The application is implemented as a responsive web application

## Technology Stack

- Frontend: Next.js (React), TypeScript, TailwindCSS
- Backend: Node.js (TypeScript), Prisma (ORM)
- Database:
  - PostgreSQL: relational storage for users, schedules, preferences, and course metadata
  - pgvector: vector storage for semantic embeddings used in natural-language course search and RAG
- Auth: Google OAuth 2.0
- AI components:
  - LLM API: OpenAI API
    - GPT-4o-mini (for chat/routing) and GPT-4o (for complex tasks)
  - Embeddings: OpenAI text-embedding-3-small
  - AI Orchestration: Vercel AI SDK (used as a framework-agnostic Node.js library for streaming responses and prompt orchestration; not dependent on Vercel Edge Functions)
- External: SIS Web API, Playwright (course eval scraping)
- Deployment: Render
- Testing: Vitest (unit/integration), Playwright (end-to-end), Postman (for manual tests)

## Product Roadmap

Notes:

- The carry-over mechanism mentioned in the feedback is now only used for requirements that are nice-to-have in early iterations, but that are ultimately intended to be in the final product over other features (which is why they later become must-haves). Since we’ve revised the iteration workloads, the usage now reflects the prioritization of features across iterations, similar to how it’s used in the professor’s sample document for Summit, instead of overcommitment.
- Parentheticals include a potential breakdown of tasks, where each member is a random number 1-5 each iteration
- Our current roadmap is heavier for iterations 1 and 2, but that’s due to trying to implement most of our core AI features within those four weeks

## Iteration 1

Dates: Week 5-6  
Goal: AI-powered course discovery

**Must-Have Features**

- Search UI: users can search for courses using a single course search field and view matching search results (primary: 3\)
- Query interpretation (routing) for the search field: input is parsed into (a) structured SIS attributes and (b) natural-language descriptors (primary: 4\)
- The system retrieves and ranks courses for natural-language descriptors by searching over course titles and descriptions (primary: 1, supporting: 3, 4\)
- The system executes SIS attribute-based search using parsed structured constraints and combines these results with natural language search results (primary: 2, supporting: 5\)
- The system generates on-demand course summaries using quantitative course evaluation data (primary: 5, supporting: 1\)

**Nice-To-Have Features**

- The system provides source attribution by including inline references to course evaluation metrics and offering an option to view the underlying evaluation data used, labelled by term range and instructor(s)
- Summaries highlight observable trends across instructors and over time when such trends are present (e.g., “the intellectual challenge of this course has increased over the past three years, from an average rating of 2/5 to 4.2/5”)

## Iteration 2

Dates: Week 7-8  
Goal: Personalized planning and schedules

**Must-Have Features**

- Users can log in using their Google account (primary: 2\)
- The system collects graduation month/year, degree information (degrees pursued, primary major/school), career goals, workload tolerance, and personal preferences about classes from first-time users through an onboarding questionnaire consisting of multi-select dropdowns for graduation/degree info and natural language responses for the rest (primary: 1, supporting: 2, 4\)
- The system stores information from the initial questionnaire as memories (primary: 2, supporting: 1\)
- Users can create at least one schedule and view it in a structured dashboard layout (primary: 3, supporting: 5\)
- The system provides personalized workload feasibility audits of users’ schedules (primary: 4, supporting: 3\)
- Users can chat with the LLM to answer questions related to their schedules and receive personalized course planning advice (primary: 5, supporting: 2\)

**Nice-To-Have Features**

- Personalized audits also include assessments of alignment with the user’s future goals and alternative course recommendations
- Users can create more than one schedule

## Iteration 3

Dates: Week 10-11  
Goal: Natural-language schedule control and memory management

**Must-Have Features**

- The system stores other stable/long-term course selection preferences obtained through chat as memories (primary: 2\)
- Users can add, drop, or swap courses in a selected schedule using natural language commands (primary: 1\)
- Users can view stored memories as short preference statements and delete them (e.g., “prefers classes starting after 11 am”) (primary: 3\)
- The system displays a public landing page outlining core capabilities (primary: 5\)
- Personalized audits also include assessments of alignment with the user’s future goals and alternative course recommendations (if not implemented in Iteration 2\) (primary: 4\)

**Nice-To-Have Features**

- Users can view and edit their graduation and degree information
- Users can delete their schedules

## Iteration 4

Dates: Week 12-13  
Goal: Source attribution and course history

**Must-Have Features**

- Source attribution in summaries (if not implemented in previous iterations)
- Users can use the course search feature to indicate courses they have taken already and view them in a dedicated tab
- The system uses this course history to exclude those courses from recommendations and identify fulfilled prerequisites
- Users can create and delete any number of schedules

**Nice-To-Have Features**

- Users can add free-form text reviews for courses they’ve taken
- The system includes user-submitted reviews in course summaries by displaying a “Student Reviews” section that summarizes available reviews for that course
