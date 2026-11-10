---
id: P0-10
title: Create the minimum platform database schema
phase: 0
type: build
status: todo
size: M
depends_on: [P0-08, P0-09]
spec: [8, 10]
---

# P0-10: Create the minimum platform database schema

## Outcome

Add only the platform tables required for two demo schools and authentication, using the chosen auth contract.

## Likely files

- `packages/db/src/schema (new)`
- `packages/db/drizzle configuration and migrations (new)`
- `schema integration tests`

## Acceptance criteria

- [ ] Approve exact Drizzle and PostgreSQL driver dependencies before installation; use one append-only migration history.
- [ ] Create schools, school_domains and the users/session tables required by P0-09, with school-scoped uniqueness and indexes.
- [ ] Use UUIDv7 identifiers as specified and prove foreign keys prevent mismatched school ownership; defer unrelated billing and console tables.

## Verification

Apply migrations to a disposable local database and run schema tests for duplicate hostnames, per-school login identifiers and invalid relationships; run pnpm typecheck.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
