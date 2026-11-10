---
id: P0-11
title: Implement the school-scoped database boundary
phase: 0
type: build
status: todo
size: M
depends_on: [P0-10]
spec: [6, 8]
---

# P0-11: Implement the school-scoped database boundary

## Outcome

Expose a database boundary that requires school context and scopes every service transaction.

## Likely files

- `packages/db/src client and scope modules (new)`
- `packages/db/src/index.ts`
- `scoped-client integration tests`

## Acceptance criteria

- [ ] withSchool receives typed school context and sets app.school_id transaction-locally before school queries.
- [ ] School-facing services cannot obtain console or migration credentials; boundary interfaces can be mocked.
- [ ] Errors propagate explicitly, transactions roll back and pooled connections never retain the previous school context.

## Verification

Run integration tests for successful scope, rollback, missing context and consecutive requests from different schools on reused connections.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
