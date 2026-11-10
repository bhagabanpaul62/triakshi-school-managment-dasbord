---
id: P0-08
title: Run local PostgreSQL with separate database roles
phase: 0
type: chore
status: todo
size: M
depends_on: [P0-07]
spec: [7, 8, 21]
---

# P0-08: Run local PostgreSQL with separate database roles

## Outcome

Create a local-only database environment with distinct school, console and migration privileges.

## Likely files

- `infra/docker-compose.dev.yml (new)`
- `infra/postgres initialization scripts (new)`
- `infra/README.md`

## Acceptance criteria

- [ ] Use PostgreSQL 17 and the app_school, app_console and app_migrate roles described in the design.
- [ ] The school role is neither table owner nor superuser and cannot bypass row-level security; database access is local only.
- [ ] Document start, health check and non-destructive stop commands; use environment configuration and no hard-coded credentials.

## Verification

After approval to start local containers, verify readiness and inspect role privileges; restart without deleting volumes and verify persistence. Never connect to a shared or production database.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
