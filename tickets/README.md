# Development tickets

Start with [TODO.md](TODO.md) for the daily sequence. Use [BOARD.md](BOARD.md) for current statuses and dependency readiness.

## First milestone

Two local schools, `a.localhost` and `b.localhost`, show different school names and themes. Users log in with school-scoped sessions. Database isolation, roles and feature controls are verified. The existing monorepo scaffold is reviewed, not recreated.

Source: [platform design](../docs/superpowers/specs/2026-11-05-school-saas-platform-design.md), especially sections 8–12, 23 and 24. The design is still marked draft; P0-01 records owner decisions before implementation.

These 24 Phase 0 tickets are the highest-priority foundation backlog. Student records, attendance, offline fees and results follow in Phase 1. Hosting, billing, websites and custom domains follow the later roadmap. This backlog creates no implementation or dependency-installation approval.

## Daily workflow

1. Open the next unchecked entry in TODO.md and read its linked ticket and dependencies.
2. Run `node tickets/tools/tickets.mjs next`. Start a ticket only when its dependencies are done.
3. Present the implementation plan, affected files, risks and checks; wait for the owner's approval before changing state. New dependencies need explicit approval.
4. Mark the ticket `doing` using the command below, then complete its acceptance criteria and verification.
5. Record commands, actual results and blockers in the ticket. Use `review` while owner review is pending; use `blocked` if work cannot proceed.
6. Mark `done` only after the completion rules are met, then check its entry in TODO.md. The CLI refreshes BOARD.md but does not edit TODO.md.

The numbered days are suggested work sessions, not calendar dates or completion promises. Carry unfinished work forward. The current TODO checkbox and ticket status take precedence over the suggested day number.

## Commands

Run from the repository root with Node 24. Ticket commands use only Node's standard library and do not require pnpm installation.

```sh
node tickets/tools/tickets.mjs check
node tickets/tools/tickets.mjs next
node tickets/tools/tickets.mjs board
node tickets/tools/tickets.mjs set P0-01 doing
node tickets/tools/tickets.mjs set P0-01 review
node tickets/tools/tickets.mjs set P0-01 done
node --test tickets/tools/tickets.test.mjs
```

`check`, `next` and the test command do not change repository ticket files. `board` writes BOARD.md. `set` changes the ticket status and regenerates BOARD.md. Tests create and remove isolated temporary fixtures.

Use the explicit test-file path: the old comment suggesting `node --test tickets/tools/` fails with the current Node runtime. The CLI and test source are unchanged by this backlog task.

## Ticket format

- Location: `phase-<number>/P<phase>-<number>-<slug>.md`; IDs and file prefixes must agree.
- Required frontmatter: `id`, `title`, `phase`, `type`, `status`, `size`, `depends_on`.
- `spec` lists source section numbers. It is reference metadata, not a status or priority field.
- Status: `todo`, `doing`, `blocked`, `review`, `done`.
- Type: `build`, `chore`, `spike`, `owner`, `checkpoint`, `epic`.
- Size: `XS`, `S`, `M`, `L`; only epics use size `epic`. Size is a rough scope estimate, not a duration promise.
- Lower phases and the daily sequence establish priority. Dependencies establish readiness. A `todo` ticket with unfinished dependencies is waiting; do not mark it blocked just for that reason.
- Every dependency must exist, be in the same or an earlier phase, and form no cycle. A done ticket must have all dependencies done.

## Completion rules

- Read affected code and callers and run relevant baseline checks before implementation. Record existing failures before building on them.
- Work only within the approved plan. Discuss changes to behavior, public APIs, schemas and deployments before writing them.
- Start every behavior change with an appropriate failing test; verify behavior through public interfaces. Owner/research tickets use recorded decisions and evidence instead of artificial tests.
- Meet the ticket's acceptance criteria, run its focused checks and rerun relevant baseline checks. Once configured, use `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` as appropriate. Fix regressions; do not suppress checks to obtain a pass.
- Document unrun checks explicitly. A blocker is not a pass. Implementation tickets require their checks to pass before `done`. A baseline or research ticket may document an existing failure as its expected finding, provided it records a reproducible result and identifies the follow-up ticket; it must not claim the underlying failure is fixed.
- Ask before dependency installation, production/AWS/shared-database access or any state change outside the approved plan. Never commit, push or open a PR without an explicit request.
- Update work notes, status and the TODO checkbox together. Generate BOARD.md through the CLI; do not hand-edit it.

## Backlog creation checks

Before adding tickets on 2026-11-10, `node tickets/tools/tickets.mjs check` reported `0 tickets OK`; `node --test tickets/tools/tickets.test.mjs` passed all 22 tests. The older directory-form test command failed to resolve a module. Full application checks were not run for this documentation-only backlog change; P0-04 captures the implementation baseline.
