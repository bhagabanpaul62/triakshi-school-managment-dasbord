---
id: P0-18
title: Implement per-school feature resolution
phase: 0
type: build
status: todo
size: M
depends_on: [P0-12]
spec: [8, 11]
---

# P0-18: Implement per-school feature resolution

## Outcome

Implement one tested resolver for school status, plan modules, overrides and required features.

## Likely files

- `packages/feature-kit/src declarations, registry and resolver (new)`
- `minimal plan and override schema with new migrations`
- `resolver tests`

## Acceptance criteria

- [ ] Declare features with stages and requirements; validate unknown requirements and reject dependency cycles.
- [ ] Apply suspended/read-only rules, non-expired overrides, plan membership and required-feature availability in the documented order.
- [ ] Tests cover missing plans, expired overrides, disabled dependencies, alpha/beta access and school lifecycle states using an explicit clock.

## Verification

Run resolver unit tests and relevant schema/isolation tests, including false-positive access attempts; run pnpm typecheck and pnpm lint.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
