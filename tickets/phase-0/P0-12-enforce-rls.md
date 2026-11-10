---
id: P0-12
title: Prove database isolation between two schools
phase: 0
type: build
status: todo
size: M
depends_on: [P0-11]
spec: [8, 23]
---

# P0-12: Prove database isolation between two schools

## Outcome

Enforce and test database policies under the real restricted application role before connecting the UI.

## Likely files

- `packages/db schema policies and new migrations`
- `tests/integration/isolation (new)`

## Acceptance criteria

- [ ] Enable and force row-level security where required so the application cannot bypass school policies.
- [ ] Under app_school, school A cannot read, insert, update or delete school B's rows; raw queries with no school context expose no school-owned rows.
- [ ] Tests exercise protected platform rows and school-owned tables with the intended database roles, including pooled-connection context reset.

## Verification

Run the real PostgreSQL isolation suite for both schools, including raw queries and attempted writes; an intentionally disabled policy must make a relevant test fail.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
