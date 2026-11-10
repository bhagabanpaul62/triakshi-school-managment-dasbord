---
id: P0-16
title: Connect login and logout to the dashboard
phase: 0
type: build
status: todo
size: M
depends_on: [P0-14, P0-15]
spec: [9, 10]
---

# P0-16: Connect login and logout to the dashboard

## Outcome

Give a school user a working login screen backed by real school-scoped sessions.

## Likely files

- `apps/school/src/app/login routes and form (new)`
- `protected app layout`
- `logout action`
- `authentication browser tests`

## Acceptance criteria

- [ ] The /login form handles validation, loading and failed login accessibly, using the approved auth services.
- [ ] Unauthenticated dashboard requests require login, validated sessions reach the dashboard and logout removes access.
- [ ] Return paths remain within the current school host; no open redirect or cross-school session reuse is possible.

## Verification

Run browser tests for login failure, successful login, protected-route redirects and logout on both local school hosts; run pnpm build.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
