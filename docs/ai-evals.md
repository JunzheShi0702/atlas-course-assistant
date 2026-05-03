# AI Evaluation Suite

Atlas now includes a dedicated AI eval suite for `/api/agent` using golden cases.

## What It Covers

- Out-of-scope guardrail behavior.
- Search payload shape and minimum viable results contract.
- No-results fallback normalization.
- Evaluation-summary no-data behavior.
- Course-details payload shape.

The suite is intentionally contract-focused: it validates user-visible response quality contracts that should not regress when prompts, tool orchestration, or normalization logic changes.

## Run Locally

```bash
cd backend
npm run test:ai-evals
```

## CI Integration

The suite runs in GitHub Actions CI via:

- `.github/workflows/ci.yml` step: `Run backend AI eval suite`

## Extending the Suite

Golden cases live in:

- `backend/src/evals/agent-golden-cases.ts`

Harness logic lives in:

- `backend/src/evals/agent-eval-suite.test.ts`

When adding a case, include:

- A realistic user message.
- Whether the query should be in-scope.
- Expected final payload contract (`type`, required snippets/fields).
- Any tool-result context needed to emulate tool-calling outcomes.
