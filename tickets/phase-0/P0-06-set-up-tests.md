---
id: P0-06
title: Set up unit and browser test commands
phase: 0
type: chore
status: todo
size: M
depends_on: [P0-05]
spec: [7, 23]
---

# P0-06: Set up unit and browser test commands

## Outcome

Provide repeatable unit and browser test entry points before adding backend behavior.

## Likely files

- `root and relevant workspace package.json files`
- `Vitest and Playwright configuration (new)`
- `tests/smoke (new)`

## Acceptance criteria

- [ ] Get approval for exact Vitest and Playwright packages and browser installation before adding them.
- [ ] A meaningful unit test and browser smoke test run through documented commands; existing ticket-tool tests are included in verification.
- [ ] Tests have isolated local fixtures and fail on errors; no skipped assertions or production connections are used.

## Verification

Run pnpm test, the documented browser smoke command, pnpm typecheck and pnpm lint; confirm an intentionally wrong local assertion fails before restoring it.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
