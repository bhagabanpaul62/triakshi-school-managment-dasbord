---
id: P0-19
title: Apply feature guards to navigation and server access
phase: 0
type: build
status: todo
size: M
depends_on: [P0-17, P0-18]
spec: [11]
---

# P0-19: Apply feature guards to navigation and server access

## Outcome

Use the same entitlement decision for the menu, module routes and implemented feature service calls.

## Likely files

- `packages/feature-kit guard interfaces`
- `apps/school menu and route wiring`
- `protected service adapters`
- `feature-access tests`

## Acceptance criteria

- [ ] Disabled features disappear from navigation and show the documented unavailable/upgrade state when opened directly.
- [ ] Every implemented module service entry point checks permission and entitlement; read-only schools cannot write.
- [ ] Tests demonstrate that edited requests and direct URLs cannot bypass the resolver; unbuilt demo screens are clearly identified as demo-only.

## Verification

Run feature-access integration tests and browser checks for enabled, disabled, read-only and suspended states; rerun authentication and isolation suites.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
