---
id: P0-20
title: Apply each school name and theme
phase: 0
type: build
status: todo
size: M
depends_on: [P0-13]
spec: [12]
---

# P0-20: Apply each school name and theme

## Outcome

Replace the literal school name and shared hard-coded theme with validated school branding.

## Likely files

- `packages/themes/src token schema and CSS output (new)`
- `school theme storage migration`
- `apps/school root layout, globals.css and tailwind.config.ts`

## Acceptance criteria

- [ ] Render the resolved school's name and validated theme without requiring a rebuild; reject invalid or unsafe token values.
- [ ] Map the existing tutorial palette to the default CSS variables and preserve its appearance.
- [ ] School A and B can have distinct themes without leaking variables across responses; validate required text contrast.

## Verification

Run theme validation tests and two-host visual checks at desktop and mobile widths; compare the default theme with the current dashboard and run pnpm build.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
