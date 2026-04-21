# Backend: JHU SIS API Integration

## Overview

The backend includes a client for the JHU Student Information System (SIS) public API. This client allows searching the JHU course catalog programmatically, filtering by term, school, department, instructor, schedule, and more. It is intended to power the course search feature of our application.

## Getting an API Key

1. Go to <https://sis.jhu.edu/api>
2. Register with a valid email address (registration is free)
3. An API key (32-character alphanumeric string) will be sent to your email

## Environment Setup

Add your API key to `backend/.env`:

```plaintext
JHU_SIS_API_KEY=your-api-key-here
```

See `backend/.env.example` for the full list of required environment variables. You will also need `OPENAI_API_KEY` set if you want to run the demo.

## What Is Implemented

### Source Files

- **`backend/src/types/sis.ts`** — Zod schemas (`courseSearchParamsSchema`, `courseSchema`, `generateDaysOfWeekParamsSchema`) defining all supported search parameters (term, school, department, instructor, days of week, time of day, credits, level, etc.). Also defines TypeScript types for raw SIS responses and our trimmed output format.

- **`backend/src/services/sis-client.ts`** — HTTP client that calls the SIS API (`https://sis.jhu.edu/api/classes`). Appends the API key and query parameters, handles timeouts (10s), and returns raw course data.

- **`backend/src/tools/search-courses-by-sis-constraints.ts`** — The main tool function. Takes friendly filter inputs, encodes them into the format the SIS API expects (e.g., days-of-week bitmask encoding, department slash-to-underscore replacement), calls the SIS client, and returns trimmed/normalized course objects.

- **`backend/src/demo.ts`** — A standalone CLI demo showing LLM function calling end-to-end using the Vercel AI SDK. The LLM decides when to call `searchCoursesBySisConstraints` based on natural-language user queries. This is a reference implementation meant to demonstrate the pattern for whoever implements the actual course search feature.

### How It Works

The architecture follows the LLM function-calling pattern:

1. User asks a natural-language question (e.g., "What CS courses are offered in Spring 2026?")
2. The LLM (GPT-4o-mini) analyzes the question and decides to call the `searchCoursesBySisConstraints` tool with appropriate parameters
3. The tool calls the SIS API, gets course data, and returns it to the LLM
4. The LLM formats the results into a human-readable response
5. Multi-turn conversation is supported — the LLM remembers context across follow-up questions

The Vercel AI SDK's `generateText()` with `stepCountIs(15)` handles the tool-dispatch loop automatically — no manual message-role juggling needed.

### Running the Demo

```sh
cd backend
npm run demo
```

This starts an interactive CLI session. Ask questions about JHU courses and type `/exit` or press `Ctrl+C` to quit.

### Dependencies Added for the Demo

- `ai` — Vercel AI SDK core (`generateText`, `tool`, `stepCountIs`)
- `@ai-sdk/openai` — OpenAI provider (reads `OPENAI_API_KEY` from env)
- `chalk@^4.1.2` — Colored terminal output, pinned to v4 for CommonJS compatibility (devDependency — only used by the demo)

### Tests

Unit tests cover the three main modules (run with `npm test` from the `backend` directory):

- **`backend/src/types/sis.test.ts`** — `generateDaysOfWeek` and `parseDaysOfWeek` encoding/decoding, day-of-week constants, schema validation for `courseSearchParamsSchema` and `generateDaysOfWeekParamsSchema`.
- **`backend/src/services/sis-client.test.ts`** — Missing API key error, URL construction, JSON parsing, HTTP error handling, and timeout/abort behavior (uses mocked `fetch`).
- **`backend/src/tools/search-courses-by-sis-constraints.test.ts`** — `mapRawToSisCourse` field mapping and instructor splitting, `searchCoursesBySisConstraints` param forwarding, empty/undefined param stripping, result limiting, and empty results (uses mocked SIS client).

### Integrating Into the Course Search Feature

The demo (`demo.ts`) is a toy app. The real course search feature should reuse the following from this work:

- `courseSearchParamsSchema` — as the tool's parameter schema
- `searchCoursesBySisConstraints()` — as the tool's execute function
- The system prompt pattern — documenting the tool's capabilities and constraints for the LLM

The Express route in `backend/src/routes/courses.ts` does **not** use the SIS API. The SIS integration is only wired up in the demo for now.

## Weekly Calendar Events Contract (Issue #268)

Stage 0 defines a stable DTO and endpoint used by weekly calendar UI work.

- Endpoint: `GET /api/schedules/:id/events`
- Ownership/auth behavior:
  - `404` when schedule does not exist
  - `403` when schedule belongs to another user
  - `200` with `{ events: [] }` for empty schedules

Stable event DTO fields:

```json
{
  "eventId": "string",
  "dayOfWeek": "Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday | null",
  "startTime": "HH:mm | null",
  "endTime": "HH:mm | null",
  "courseCode": "string",
  "courseTitle": "string",
  "location": "string | null"
}
```

Deterministic missing-data behavior:

- Missing/invalid day data: `dayOfWeek = null`
- Missing/invalid time data: `startTime = null`, `endTime = null`
- Missing location: `location = null`
- Missing title: falls back to `courseCode`

Example responses:

Normal schedule events:

```json
{
  "events": [
    {
      "eventId": "sched-1:EN.601.226:Monday:15:30:17:20",
      "dayOfWeek": "Monday",
      "startTime": "15:30",
      "endTime": "17:20",
      "courseCode": "EN.601.226",
      "courseTitle": "Data Structures",
      "location": "Malone 228"
    }
  ]
}
```

Empty schedule:

```json
{
  "events": []
}
```

Missing SIS fields:

```json
{
  "events": [
    {
      "eventId": "sched-1:EN.601.999:unknown",
      "dayOfWeek": null,
      "startTime": null,
      "endTime": null,
      "courseCode": "EN.601.999",
      "courseTitle": "EN.601.999",
      "location": null
    }
  ]
}
```
