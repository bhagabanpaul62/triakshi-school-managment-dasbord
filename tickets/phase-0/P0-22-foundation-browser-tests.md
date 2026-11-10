---
id: P0-22
title: Prove the two-school foundation in a browser
phase: 0
type: checkpoint
status: todo
size: M
depends_on: [P0-21]
spec: [23, 24]
---

# P0-22: Prove the two-school foundation in a browser

## Outcome

Exercise the full local milestone through public UI and server interfaces.

## Likely files

- `tests/e2e two-school scenarios (new)`
- `Playwright fixture wiring`
- `verification evidence`

## Acceptance criteria

- [ ] Both hosts display their own identity and theme, and valid users can log in and log out.
- [ ] Tests prove cookie isolation, rejected cross-school sessions, role denial, disabled feature access and read-only write denial.
- [ ] Document which screens still use demo data; mark the milestone as foundation only, not a usable school-management product.

## Verification

Run the documented two-host Playwright suite plus pnpm test, pnpm typecheck, pnpm lint and pnpm build; record command results and any manual visual checks.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
