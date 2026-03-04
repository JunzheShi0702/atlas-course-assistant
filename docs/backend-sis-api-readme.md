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

- **`backend/src/types/sis.ts`** — Zod schema (`filterSisCoursesInputSchema`) defining all supported search parameters (term, school, department, instructor, days of week, time of day, credits, level, etc.). Also defines TypeScript types for raw SIS responses and our trimmed output format.

- **`backend/src/services/sis-client.ts`** — HTTP client that calls the SIS API (`https://sis.jhu.edu/api/classes`). Appends the API key and query parameters, handles timeouts (10s), and returns raw course data.

- **`backend/src/tools/filter-sis-courses.ts`** — The main tool function. Takes friendly filter inputs, encodes them into the format the SIS API expects (e.g., days-of-week bitmask encoding, department slash-to-underscore replacement), calls the SIS client, and returns trimmed/normalized course objects.

- **`backend/src/demo.ts`** — A standalone CLI demo showing LLM function calling end-to-end using the Vercel AI SDK. The LLM decides when to call `filterSisCourses` based on natural-language user queries. This is a reference implementation meant to demonstrate the pattern for whoever implements the actual course search feature.

### How It Works

The architecture follows the LLM function-calling pattern:

1. User asks a natural-language question (e.g., "What CS courses are offered in Spring 2026?")
2. The LLM (GPT-4o-mini) analyzes the question and decides to call the `filterSisCourses` tool with appropriate parameters
3. The tool calls the SIS API, gets course data, and returns it to the LLM
4. The LLM formats the results into a human-readable response
5. Multi-turn conversation is supported — the LLM remembers context across follow-up questions

The Vercel AI SDK's `generateText()` with `stepCountIs(5)` handles the tool-dispatch loop automatically — no manual message-role juggling needed.

### Running the Demo

```sh
cd backend
npm run demo
```

This starts an interactive CLI session. Ask questions about JHU courses and type `/exit` or press `Ctrl+C` to quit.

### Dependencies Added for the Demo

- `ai` — Vercel AI SDK core (`generateText`, `tool`, `stepCountIs`)
- `@ai-sdk/openai` — OpenAI provider (reads `OPENAI_API_KEY` from env)
- `chalk@^4.1.2` — Colored terminal output (pinned to v4 for CommonJS compatibility)

### Integrating Into the Course Search Feature

The demo (`demo.ts`) is a toy app. The real course search feature should reuse the following from this work:

- `filterSisCoursesInputSchema` — as the tool's parameter schema
- `filterSisCourses()` — as the tool's execute function
- The system prompt pattern — documenting the tool's capabilities and constraints for the LLM

The Express route in `backend/src/routes/courses.ts` does **not** use the SIS API. The SIS integration is only wired up in the demo for now.

## Blocker: Cloudflare Bot Protection

**Status: Blocked**

As of March 2026, the SIS API (`sis.jhu.edu/api`) is behind Cloudflare's managed challenge (bot protection). This means:

- **Browser requests work** — Cloudflare serves a JavaScript challenge, the browser executes it, gets a `cf_clearance` cookie, and subsequent requests go through transparently.
- **All programmatic requests fail with 403** — Node.js `fetch`, `axios`, `curl`, Postman, and any other non-browser HTTP client cannot execute the JavaScript challenge. Instead of JSON, they receive an HTML page titled "Attention Required! | Cloudflare" or "Just a moment..." containing Cloudflare's challenge script.

This is not an API key issue. The key is valid (browser requests with the same key succeed). The block happens at the network/WAF layer before the request ever reaches the SIS API server.

### What We Tried

- Native `fetch` with no extra headers — 403
- `fetch` with `User-Agent` and `Accept` headers mimicking axios — 403
- Different URL formats (key as query param vs. path segment) — 403
- The same behavior occurs in Postman (non-browser client) — 403

### Why This Happens

JHU's IT likely enabled Cloudflare's bot management across `sis.jhu.edu` without exempting the `/api/*` routes. Cloudflare's challenge requires a real browser engine to solve (it fingerprints the JS environment, checks for DOM APIs, canvas, WebGL, etc.), so no amount of header manipulation can bypass it from a server-side client.

### Possible Resolutions

- **Contact JHU IT** to request that Cloudflare's managed challenge be disabled or loosened for the `/api/*` endpoints. This is the correct fix since the API was designed for programmatic access.
- **Use a headless browser** (e.g., Puppeteer) to solve the Cloudflare challenge and obtain cookies, then forward them in subsequent API calls. This works but adds significant overhead and complexity.
- **Pre-cache course data** by fetching it manually through a browser and storing it locally. Queries then run against the local cache instead of the live API.
