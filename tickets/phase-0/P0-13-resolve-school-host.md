---
id: P0-13
title: Resolve school identity from the request host
phase: 0
type: build
status: todo
size: M
depends_on: [P0-12]
spec: [8, 9]
---

# P0-13: Resolve school identity from the request host

## Outcome

Look up a school safely from its registered host without granting general cross-school database access.

## Likely files

- `packages/db host-lookup function migration (new)`
- `apps/school/src/proxy.ts (new)`
- `host-resolution tests`

## Acceptance criteria

- [ ] resolve_school_by_host returns only the allowed school identifier, slug and status using tightly scoped elevated privileges.
- [ ] Host normalization handles ports and invalid hosts; unknown hosts fail closed and incoming school-identity headers are discarded.
- [ ] Tests cover a.localhost, b.localhost, malicious identity headers, unknown hosts and cache expiry according to the design.

## Verification

Run database lookup and request-routing tests, then verify each local host resolves only its registered school; run pnpm typecheck and pnpm lint.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
