# AI Evaluation Suite

Atlas includes a dedicated golden-case eval suite for `/api/agent` that validates response contracts at the API boundary.

## What It Covers

The suite currently covers these contract categories:

- Out-of-scope guardrail redirects for non-product prompts.
- Search payload contract (`type: "search"`) with one or multiple result cards.
- Empty-search normalization and preservation of model-provided no-results messaging.
- Summary payload contract (`type: "summary"`) for both `hasData: true` and `hasData: false`.
- Details payload contract (`type: "details"`) and null-details fallback normalization to user-facing text.
- Text payload normalization for blank responses and plain advising messages.
- JSON parsing robustness when the model wraps payloads in markdown fences.

This suite is intentionally contract-focused: it protects user-visible behavior from regressions when prompts, tool orchestration, or normalization logic evolve.

## Current Footprint

- Golden cases: `14`
- Endpoint under test: `POST /api/agent`
- Runtime: `vitest` + `supertest` against the real route handler with mocked model/tool dependencies

## Run Locally

```bash
cd backend
npm run test:ai-evals
```

## CI Integration

The suite runs in GitHub Actions CI:

- Workflow: `.github/workflows/ci.yml`
- Step: `Run backend AI eval suite`

## Source Files

- Golden case definitions: `backend/src/evals/agent-golden-cases.ts`
- Test harness: `backend/src/evals/agent-eval-suite.test.ts`

## Extending the Suite

When adding a case:

- Use a realistic user prompt and concise case description.
- Set expected scope (`inScope`) explicitly.
- Assert the stable response contract:
  - `expected.type` (`search`, `summary`, `details`, `text`, or `error`)
  - Optional shape/content checks (`minResults`, `hasData`, `summaryContains`, `messageIncludes`, `messageExcludes`)
- Provide `toolResults` when behavior depends on tool-calling outcomes (for example summary/details fallbacks).
- Prefer contract-level assertions over brittle wording assertions unless user-facing copy stability is required.

If a product decision intentionally changes user-facing behavior, update both the route logic and the corresponding golden case in the same PR.
