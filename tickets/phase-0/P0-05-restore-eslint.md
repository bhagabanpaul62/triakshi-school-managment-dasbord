---
id: P0-05
title: Restore linting across the workspace
phase: 0
type: chore
status: todo
size: M
depends_on: [P0-04]
spec: [6, 23]
---

# P0-05: Restore linting across the workspace

## Outcome

Replace the obsolete next lint command with working ESLint configuration for the installed toolchain.

## Likely files

- `packages/config/eslint.config.mjs (new)`
- `application and package lint scripts`
- `apps/school/.eslintrc.json`
- `root package.json as needed`

## Acceptance criteria

- [ ] Propose exact compatible dependency changes for approval before installation.
- [ ] pnpm lint runs the ESLint CLI and covers the relevant workspace source without checking generated output.
- [ ] Existing violations are fixed within an approved scope or recorded as blockers; checks are not weakened with blanket ignores.

## Verification

Run pnpm lint and pnpm typecheck; compare failures with P0-04 and resolve any regression before completion.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
