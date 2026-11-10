---
id: P0-23
title: Run the foundation checks in CI
phase: 0
type: chore
status: todo
size: M
depends_on: [P0-22]
spec: [23]
---

# P0-23: Run the foundation checks in CI

## Outcome

Make the verified local checks reproducible in an isolated CI job before feature development expands.

## Likely files

- `.github/workflows/ci.yml (new)`
- `package scripts only if required`
- `CI database setup and fixtures`

## Acceptance criteria

- [ ] Use the repository's approved Node and pnpm versions and an isolated PostgreSQL service with the restricted test roles.
- [ ] Run ticket validation, ticket-tool tests, typecheck, lint, unit/integration tests, browser checks and build; any failure fails the workflow.
- [ ] Use CI-owned test configuration with no production credentials or deployment steps.

## Verification

Validate workflow configuration locally and run the same commands; after an explicitly authorized push, observe a real CI run before claiming CI passes.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
