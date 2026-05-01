# Final Delivery Rubric

Source: `product-final-delivery.pdf`

## Overview

- Total points: **100**
- Focus: final product quality (code, AI components, tests, docs, deployed app)
- Reading-period week is for polish only (docs, testing, bug fixes, quality improvements)
- After final code submission deadline, code changes are not permitted for grading
- Category deductions can exceed category points, but each category floor is `0`

## Testing and Evaluation (25 points)

- `-8` Unit testing (primarily backend) missing/insufficient/poor coverage
- `-8` End-to-end testing (frontend-involved) missing/insufficient/poor coverage
- `-8` No AI evaluation suite (golden set, LLM-as-judge harness, or structured manual eval)
- `-5` Tests/evals are not automated or not integrated with CI
- `-5` Poor test practices (low modularity, prod DB usage, flaky tests silenced, behavior-locking AI tests)
- `-5` Master branch does not pass tests, or major bugs remain

## Process and Practices (20 points)

- `-5` README incomplete/outdated (app purpose, local setup, env vars/AI creds, test instructions)
- `-8` `docs/` disorganized/incomplete (must include up-to-date requirements and iteration plans 1-4)
- `-5` Open issues do not capture bugs, limitations, and follow-up tasks
- `-7` GitHub flow not cleanly completed (stale PRs/branches, unresolved reviews, final state not on `master`)
- `-5` AI project config/agent harness missing or outdated (`CLAUDE.md`, `.cursor/rules/`, `.claude/`, etc.)

## Delivery (35 points)

- `-25` App not deployed, or deployed core flows are broken
- `-10` Missing one planned functional/non-functional requirement
  - Advisor note: additional `-10` for each extra missing requirement
- `-12` Not polished to alpha-release quality (visible bugs, broken edge cases, confusing UX)
- `-10` AI features unreliable in production (timeouts/rate limits/failures/no fallback/harmful hallucinations)
- `-5` No AI observability (prompt/response logs, cost/latency tracking, diagnosis path)
- `-5` Missing AI safeguards (rate limits, validation, prompt-injection protections, spend controls)

## Implementation (20 points)

- `-7` Codebase structure/maintainability is weak
- `-7` AI architecture poorly reasoned (fragile prompt assembly, weak retrieval, unbounded loops/history, malformed tool args handling)
- `-5` Non-AI code quality is weak (long methods, poor naming, duplication, unexplained boilerplate)
- `-5` Poorly justified or mismatched tool/library/model choices
- `-5` Secrets handling is unsafe (keys committed, poor env/secret management)

## Notes for Team Checklist

- Freeze feature development during polish week
- Ensure deployment is stable and demonstrable
- Validate test + CI status before deadline
- Keep documentation and issue tracker aligned with reality
