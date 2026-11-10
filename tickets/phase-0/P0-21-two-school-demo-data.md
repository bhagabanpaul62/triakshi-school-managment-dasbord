---
id: P0-21
title: Create repeatable fixtures for two demo schools
phase: 0
type: chore
status: todo
size: S
depends_on: [P0-19, P0-20]
spec: [8, 23, 24]
---

# P0-21: Create repeatable fixtures for two demo schools

## Outcome

Provide local demo records and test identities for the final foundation checks.

## Likely files

- `packages/db local fixture or seed modules (new)`
- `test fixtures`
- `local-development documentation`

## Acceptance criteria

- [ ] Create a.localhost and b.localhost with separate names, colours, login accounts and differing feature access.
- [ ] The local-only seed is repeatable, refuses production/shared environments and does not print or commit passwords.
- [ ] Demo account setup uses approved local configuration and includes an admin and a restricted role for permission checks.

## Verification

Run the seed twice on a disposable local database and assert no duplicate schools, domains or users; confirm both identities and feature settings are distinct.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
