---
id: P0-15
title: Place the dashboard under the app route
phase: 0
type: build
status: todo
size: M
depends_on: [P0-13]
spec: [6, 9]
---

# P0-15: Place the dashboard under the app route

## Outcome

Prepare the school host for separate public pages and the protected dashboard without duplicating screen logic.

## Likely files

- `apps/school/src/app route structure`
- `apps/school/src/components/Menu.tsx`
- `internal navigation links`
- `routing tests`

## Acceptance criteria

- [ ] Present the exact route moves and compatibility redirects for owner approval before changing existing URLs.
- [ ] Dashboard pages live under /app with working menus and detail links; public paths and reserved paths remain distinct.
- [ ] Approved redirects preserve existing bookmarked dashboard URLs and avoid redirect loops or school-identity exposure.

## Verification

Run route tests and a browser navigation smoke covering every existing menu target and student/teacher detail links; run pnpm build and pnpm typecheck.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
