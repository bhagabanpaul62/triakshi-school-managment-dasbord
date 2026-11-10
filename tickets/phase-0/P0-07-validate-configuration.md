---
id: P0-07
title: Validate configuration through one module
phase: 0
type: build
status: todo
size: M
depends_on: [P0-06]
spec: [7, 22]
---

# P0-07: Validate configuration through one module

## Outcome

Give services one validated configuration boundary so missing settings fail clearly and secrets stay on the server.

## Likely files

- `packages/config/src/env.ts (new)`
- `packages/config/src/index.ts`
- `configuration tests`
- `.env.example (new, placeholders only)`

## Acceptance criteria

- [ ] Get approval for the exact validation dependency before installation.
- [ ] Server settings are validated at startup and accessed through packages/config; browser code cannot receive server secrets.
- [ ] Tests cover valid settings, missing settings and invalid values, and error output never includes secret values.

## Verification

Run the focused config tests plus pnpm typecheck, pnpm lint and pnpm test; inspect .env.example for placeholders only.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
