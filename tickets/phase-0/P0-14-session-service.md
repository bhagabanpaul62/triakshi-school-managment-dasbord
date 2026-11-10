---
id: P0-14
title: Implement school-scoped authentication services
phase: 0
type: build
status: todo
size: M
depends_on: [P0-13]
spec: [10, 22]
---

# P0-14: Implement school-scoped authentication services

## Outcome

Implement login, session validation and logout behind the authentication boundary selected by the spike.

## Likely files

- `packages/auth/src session and credential services (new)`
- `auth input validation`
- `auth service tests`

## Acceptance criteria

- [ ] Login uses validated input and resolves accounts within the host's school; credentials and errors never reveal passwords or session tokens.
- [ ] Host-only cookies, secure production settings, expiry, logout/revocation and cross-school session rejection match the approved decision.
- [ ] Login rate limits apply per account and IP through a testable boundary; a user from school A cannot authenticate to school B.

## Verification

Run focused authentication tests with two schools, including wrong credentials, expired/revoked sessions, cookie attributes and rate limits; run the isolation suite.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
