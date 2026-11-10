---
id: P0-04
title: Record a runnable workspace baseline
phase: 0
type: chore
status: todo
size: S
depends_on: [P0-02, P0-03]
spec: [4, 6, 23]
---

# P0-04: Record a runnable workspace baseline

## Outcome

Verify the scaffold already present instead of recreating or moving it again, and capture the actual starting failures.

## Likely files

- `docs/verification-baseline.md (new)`
- `README.md only for verified command corrections`

## Acceptance criteria

- [ ] Confirm Node and pnpm prerequisites and that workspace package names and application ports match the READMEs.
- [ ] With approval for any installation, run typecheck, lint, tests and build and record each command, exit result and blocker without exposing secrets.
- [ ] Record current failures as blockers for their owning tickets; never label an unrun check as passing.

## Verification

Run pnpm typecheck, pnpm lint, pnpm test, pnpm build and node --test tickets/tools/tickets.test.mjs; record setup blockers if dependencies are unavailable.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
