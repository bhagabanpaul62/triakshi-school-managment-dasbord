# Daily TODO

Start at Day 1. Each day is a suggested focused session; finish the ticket and its checks before moving on. Larger tickets can take multiple days. All tickets start as `todo`; no implementation work is claimed complete.

Follow the [daily workflow and completion rules](README.md). Check the [generated board](BOARD.md) or run `node tickets/tools/tickets.mjs next` to see what is actually ready. Check a box only when the linked ticket is `done`.

## Days 1–4: Agree on the work and record the baseline

- [ ] Day 1: [P0-01 — Confirm the foundation scope](phase-0/P0-01-confirm-foundation-scope.md)
- [ ] Day 2: [P0-02 — Resolve permission to reuse the tutorial UI](phase-0/P0-02-check-ui-licence.md)
- [ ] Day 3: [P0-03 — Review and preserve the existing workspace changes](phase-0/P0-03-review-existing-work.md)
- [ ] Day 4: [P0-04 — Record a runnable workspace baseline](phase-0/P0-04-record-workspace-baseline.md)

## Days 5–9: Restore checks and choose the foundations

- [ ] Day 5: [P0-05 — Restore linting across the workspace](phase-0/P0-05-restore-eslint.md)
- [ ] Day 6: [P0-06 — Set up unit and browser test commands](phase-0/P0-06-set-up-tests.md)
- [ ] Day 7: [P0-07 — Validate configuration through one module](phase-0/P0-07-validate-configuration.md)
- [ ] Day 8: [P0-08 — Run local PostgreSQL with separate database roles](phase-0/P0-08-local-postgres.md)
- [ ] Day 9: [P0-09 — Choose the authentication approach with evidence](phase-0/P0-09-auth-decision.md)

## Days 10–13: Store and isolate school data

- [ ] Day 10: [P0-10 — Create the minimum platform database schema](phase-0/P0-10-platform-schema.md)
- [ ] Day 11: [P0-11 — Implement the school-scoped database boundary](phase-0/P0-11-school-scoped-database.md)
- [ ] Day 12: [P0-12 — Prove database isolation between two schools](phase-0/P0-12-enforce-rls.md)
- [ ] Day 13: [P0-13 — Resolve school identity from the request host](phase-0/P0-13-resolve-school-host.md)

## Days 14–17: Make login and permissions work

- [ ] Day 14: [P0-14 — Implement school-scoped authentication services](phase-0/P0-14-session-service.md)
- [ ] Day 15: [P0-15 — Place the dashboard under the app route](phase-0/P0-15-dashboard-app-routes.md)
- [ ] Day 16: [P0-16 — Connect login and logout to the dashboard](phase-0/P0-16-login-screen.md)
- [ ] Day 17: [P0-17 — Enforce permissions using the authenticated role](phase-0/P0-17-role-permissions.md)

## Days 18–21: Add feature controls and school branding

- [ ] Day 18: [P0-18 — Implement per-school feature resolution](phase-0/P0-18-feature-resolution.md)
- [ ] Day 19: [P0-19 — Apply feature guards to navigation and server access](phase-0/P0-19-feature-guards.md)
- [ ] Day 20: [P0-20 — Apply each school name and theme](phase-0/P0-20-school-theme.md)
- [ ] Day 21: [P0-21 — Create repeatable fixtures for two demo schools](phase-0/P0-21-two-school-demo-data.md)

## Days 22–24: Verify and review the foundation

- [ ] Day 22: [P0-22 — Prove the two-school foundation in a browser](phase-0/P0-22-foundation-browser-tests.md)
- [ ] Day 23: [P0-23 — Run the foundation checks in CI](phase-0/P0-23-continuous-integration.md)
- [ ] Day 24: [P0-24 — Review the foundation before building school modules](phase-0/P0-24-foundation-owner-review.md)

## At the end of each work session

Record what changed, the exact check commands and results, any blockers, and the next concrete step in the ticket. Update its status with the CLI. If it is not complete, continue it next session instead of checking the box.

## After Phase 0

Use P0-24 to approve the next backlog. The planned school-core sequence is school setup and academic year, classes and subjects, students and parents, staff, attendance, offline fees, then exams and results. These are future work, not implemented features.
