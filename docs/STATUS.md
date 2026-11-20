# Build status (2026-11-20, 01:30)

## Academics group build (docs/ACADEMICS-PRD.md), 2026-11-20. Built, uncommitted
| Module | Shipped | Unit tests |
|---|---|---|
| academics | electives/streams, `subjectsForStudent`, rollover copies teachers, default terms, houses + points, class CSV, allocation PDF | 29 |
| attendance | absence alerts (once per day), student and staff leave with class-teacher approval, register PDF/CSV, staff register, board eligibility + condonation, settings | 35 |
| timetable | whole-school generator (wizard, solver, draft/review/lock/re-run/publish versions), substitutions with covers, print PDFs, copy week, room clash, special days | 61 |
| assignments | due reminders, extensions, marks CSV, bulk grade, comments, scheduled publish, quick publish/close, orphan-file fix | 50 |
| exams | scale editor + presets (CBSE/ICSE), co-scholastic entry by term, components (80+20), term weights, term report cards, attendance + remarks on the card, electives, date sheet, admit cards | 76 |
| library | settings, Code128 labels, scan desk, member history, renew, holds, OPAC, weekly overdue reminders, fines to the fee ledger | 54 |
| transport | fee lines on the ledger from the next month, monthly fee sync, vehicle documents + expiry alerts, safety checklist, route notices, tracking link | 42 |
| fees | `fee_charges` (transport, library fine) in the ledger, dues and receipts, with the student lock against payment races | 61 |

- **Totals:** 32 packages and 914 unit tests pass. Typecheck and lint are clean.
- **Migrations 0004 and 0005:** applied locally. 0005 holds the data steps for timetable live versions and term-keyed co-scholastic grades. It was deduped after review and checked on a scratch DB.
- **Worker schedules:** assignments (15 and 5 min), library overdue (daily), transport document expiry (daily), transport fee sync (the 1st of each month).
- **Independent review:** 11 findings. Fixed:
  - the fee waiver/payment race
  - the 0005 duplicate rows
  - the staff-base role scoping for leave approval and assignments
  - the leave decision race
  - co-scholastic edits after publish
  - the student term-card visibility
  - student-readable rosters
  - the timetable re-run race
  - covers carried over on publish
  - file handling

  Accepted as is: emails are at-most-once (sent after commit by design).
- **e2e (prod build):** tests/e2e/academics-group.spec.ts passes 4/4. The full suite is the next check.
**Round 2 (same day):**
- **Elective blocks in the timetable:** `tt_blocks`, `tt_block_options` and `tt_block_slots`. The generator places a block at one slot for every section of the class. Students see only their chosen subject, and covers work for each option. Timetable tests: 84.
- **Admit card photos:** `PdfBuilder.image` draws the photo from `students.photoKey`; a missing photo falls back to the box. WebP shows the box too, because pdf-lib can't embed it.
- **Academics:** full create, list, edit and delete for every entity, plus new fields:
  - class: stage, display order
  - section: medium, shift, stream
  - subject: short name, type, max marks, board code, colour, language flag
  - year: status (a closed year is read-only)
  - term: order

  Academics tests: 42.
- **Assignments:** edit or revoke an extension, edit or delete a comment within 15 minutes, re-grade with history, withdraw a submission. Extensions count in the progress numbers. Assignments tests: 56.
- **Attendance:**
  - Period-wise mode: the teacher marks their own period or a cover from "My classes", and blocks list students across sections.
  - The day rolls up from the periods.
  - Subject-wise % and CSV.
  - Leave can be edited and reversed. Condonations can be edited. Holidays have a guard.

  Period mode needs the timetable module; without it the school stays daily. Attendance tests: 59.
- **Shared pattern:** `CrudService.usage()` plus `countIn`/`by` in @smw/feature-kit give every module a friendly in-use guard on delete, and a 23503 foreign-key error becomes a ConflictError.
- **Migration 0006:** applied locally, with backfills for `classes.display_order` and `terms.sort_order`.

**Round 3 (same day): the known gaps, closed**
- **Elective picks:** the class page roster has a "Picks" button per student (own electives outside a group). The roster returns `picks`.
- **Teacher limits in the cell editor:** `slotOptions().limits` carries each limited teacher's day and week count across the version. The editor marks "over their limit" and warns, but still lets the admin save. Helper: `features/timetable/limits.ts` (tested).
- **Scheduled publish:** a draft can get a "Go live on" day (`tt_versions.publish_on`, migration 0007). One draft is scheduled at a time, it stays editable, and there's an Unschedule button. The worker job `timetable.publish-due` runs at 00:15 IST and publishes it; an emptied draft is unscheduled, not published.
- **Homework into internal marks:** `MarksService.homeworkMarks(paperId)` gives each student's graded-homework share in the paper's subject over the exam's term. Marks entry on a split paper shows "Fill <part> from homework", which fills the column for review; nothing saves until Save.
- **WebP photos:** student and profile photo uploads are re-encoded to JPEG in the browser (`Field.asJpeg`), so admit cards can print them. Photos uploaded as WebP before this still show the box until re-uploaded.
- Tests: timetable 90, exams 79, academics 13 in crud, students 40, settings 48.

**Round 4 (same day): line-by-line PRD audit.** All 52 must and should rows were checked for a service AND a screen. 48 were fully built. These 4 were partial and are now finished:
- **Absence alerts batch after marking settles:** saving queues the alert (`absence_alerts.queued_at`). The worker job `attendance.send-alerts` runs every 10 minutes and sends alerts older than 30 minutes, only if the student is still absent or late (a corrected mistake is dropped). Migration 0008 marks old alerts as sent.
- **Room clash for typed-in rooms:** any room text clashes, matched ignoring case and spaces at the ends, not only rooms from the room list.
- **RTE-quota flag:** `students.rte_quota` (migration 0008). It's a Yes/No select on the student form, shown as a chip and a fact on the record.
- **Library history from both records:** a link from the student record (related links) and the staff record (header). It is gated by the library read rule, so accountants don't get a link to a refusal.
- **Seed fix found by the e2e:** the demo `teacher` login had no staff profile, so it was missing from Staff and its page returned 404. It now gets T000.
- **e2e:** 3 new tests in `tests/e2e/academics-group.spec.ts` drive every round-3 and round-4 screen on the prod build: elective picks, RTE flag, library links, scheduled publish and unschedule, the over-limit warning, and the homework fill. All pass.
- Unit tests: all 32 packages pass (attendance 60, students 41). Typecheck 37/37, lint 0 errors.

- **Known limits:**
  - Homework share counts graded work only; missing or ungraded homework is not counted as zero.
  - Old WebP photos need a re-upload to print.

## Resume here (auth + RBAC + People work, all uncommitted)
Specs: docs/AUTH-PRD.md (sign-in, roles, email OTP) and docs/PEOPLE-PRD.md (profiles, self-edit, sheet onboarding).

Done and passing:
- Typecheck 37/37 and lint 0 errors.
- Unit tests: every package passes. People adds students 40 and staff 31. Integrations parseSheet passes 2/2.
- Security review findings: all fixed, with tests.
- Prod bug fixed: "School not found" after any server-action redirect. The fix is `requestHost()` in packages/runtime/src/host.ts.
- Local DB has migrations 0001 (roles, must-change, parent logins off), 0002 (people columns) and 0003 (email_verified_at). It was applied by hand with psql because the local DB was built by push.

Not finished:
1. Full e2e on the prod build was cut off at about 45/80 by a shutdown. Re-run it:
   - `pnpm --filter @smw/school build && pnpm --filter @smw/console build && pnpm --filter @smw/marketing build`
   - `pnpm db:fresh`
   - start `school-prod`, `console-prod` and `marketing-prod` from .claude/launch.json
   - `npx playwright test --project=desktop --workers=4`
   - The auth spec alone (tests/e2e/auth-rbac.spec.ts) was at 11/14 before the fixes; re-check it.
2. The People pages have no e2e yet: My profile (student and teacher), the student import with .xlsx, and /app/staff/import. Add a spec for docs/PEOPLE-PRD.md section 4.
3. "Verify my email" is done: users.email_verified_at (migration 0003, applied locally). It is set by the verify code or a confirmed email change, and cleared when an admin changes the email.
   Brevo SMTP credentials are in .env.local as a commented block; the login was checked OK. Local mail stays on Mailpit.
4. Speed-ups are in place:
   - dev Postgres runs with fsync off (infra/docker-compose.dev.yml)
   - turbo typecheck runs fully parallel
   - `pnpm test` runs at concurrency 4
   - e2e runs on the prod build
   Seeding still takes about 150 s; it runs one transaction per row.
5. Nothing is committed. Commit only when the owner says so.

# Earlier status (2026-11-19, 06:20)

Nothing is committed yet. Everything below is in the working tree.

## Done
- All 21 features built and wired. 37 packages typecheck clean on TypeScript 7 (`tsgo`); ESLint 0 errors.
- Production builds pass: school 18 s, console 10 s, marketing 7 s. Pages answer in 0.003–0.02 s on `next start`.
- UX polish: wave A (12 areas) and most of wave B done. Wave B was stopped early; fees and students lost their final review and communication is unreviewed. The prod-build E2E run covers them.
- New white-theme landing page (`apps/marketing/src/components/landing/`), reviewed at desktop and 375 px.
- Root fixes this session:
  - DataTable phone overflow (shared).
  - Duplicate unpaid invoices on re-checkout.
  - ToneBadge sentence case; 40 px tap area on small buttons.
  - Admission form: kept typed data and reported failed sends.
  - The demo `teacher` now owns a class (staff seed).
  - `isLocal()` / `secureCookies()` in `@smw/config`, replacing `NODE_ENV` checks for ports, dev-only pages, the Mailpit link and cookie `secure`.
  - Setup loader phone overflow.

## Resume here
Update 06:28: all three apps are rebuilt with every fix. Another chat's dev server holds port 4100, so the prod set runs
with school on **4110**: launch.json `school-prod-4110`, `console-prod-4110` and `marketing-prod-4110` (all three need `SCHOOL_PORT=4110`
so their links point at 4110). The tests read `SCHOOL_PORT`: `SCHOOL_PORT=4110 npx playwright test ...`.

Re-run against 4110 (cut off at 500 s, so partial):
- approval-setup "owner flow": the verify link now works (port fix confirmed). It fails later, on a `toHaveValue` check in the setup step. Look at `/private/tmp/claude-501/pw-prod2/ux-approval-setup-approval-02540*/`.
- attendance "past day": test-side strict-mode miss. `getByText("Past day")` matches the badge and the sentence; use `{ exact: true }`.
- attendance "teacher mark" and "admin register": open the screenshots in `/private/tmp/claude-501/pw-prod2/ux-attendance-*/`.
- billing and academics: they did not report before the cut-off, so re-run them.

1. Stop the prod servers, rebuild (the last fixes are not in the build yet), then restart:
   `pnpm --filter @smw/school build && pnpm --filter @smw/console build && pnpm --filter @smw/marketing build`.
   Then start `school-prod`, `console-prod` and `marketing-prod` from `.claude/launch.json`.
2. Re-run the specs that failed on the first prod run (expected fixed by the changes above):
   `npx playwright test tests/e2e/ux-approval-setup.spec.ts tests/e2e/ux-attendance.spec.ts tests/e2e/ux-billing-support-notify.spec.ts tests/e2e/ux-academics-timetable.spec.ts --project=desktop --workers=4`
   - approval-setup ×3: the verify-email link had no port, and the setup loader overflowed on phones. Both are fixed.
   - attendance ×2: the status locator was ambiguous (fixed). The demo teacher had no class (seed fixed, and the local DB was patched).
   - billing: the fake checkout returned 404 under `next start` (fixed via `isLocal()`).
   - academics-timetable "now and next" (student view): timed out in `waitForURL` after sign-in. This is likely the same port-less URL bug, now fixed. If it still fails after the rebuild, check the student login redirect.
3. Run the full suite, then all unit tests one after another: `pnpm turbo run test --concurrency=2`.
4. Run `pnpm db:fresh` before a clean demo; test runs leave data behind ("Asha Rao" teachers, paid sunrise invoices).
5. Generate the production migration: `pnpm --filter @smw/db generate`.

## Temporary deployment on free-vm (until EC2 + S3)
- URLs:
  - marketing: `https://161-118-163-201.sslip.io`
  - console: `https://console.161-118-163-201.sslip.io`
  - schools: `https://<slug>.161-118-163-201.sslip.io` (a certificate is issued on first visit, only for real schools)
- Everything runs locally on the VM: Postgres, RustFS (in place of S3), Mailpit in place of SES (inbox `http://100.74.65.66:8025`, tailnet only), and the test checkout (`FAKE_PAYMENTS=true`: anyone can "pay", so never on a real launch). WAL archiving is off.
- Files on the VM:
  - `/opt/triakshi/repo`: the fork's `feat/school-platform` branch
  - `/opt/triakshi/.env`: secrets, mode 600
  - `/opt/triakshi/compose.freevm.yml`: no stack Caddy, apps on 127.0.0.1:4310-4312, RustFS, Mailpit
  - `/opt/triakshi/build.sh` + `mem-guard.sh`: sequential build that stops if free memory drops under 1.5 GB
  - `/opt/triakshi/superadmin.txt`: the console owner's one-time password and TOTP secret, mode 600
- The host Caddy (systemd) serves other sites too. The Triakshi part is `/etc/caddy/triakshi.caddy`, imported at the end of `/etc/caddy/Caddyfile`, plus an `on_demand_tls { ask … }` global block at the top. A backup is `Caddyfile.bak-triakshi-*`.
- Deploy an update:
  `cd /opt/triakshi/repo && git pull && /opt/triakshi/build.sh` (run it with the guard, as before)
  then `docker compose --env-file /opt/triakshi/.env -f infra/docker-compose.yml -f /opt/triakshi/compose.freevm.yml` with `run --rm migrate`, `run --rm worker pnpm --filter @smw/school bootstrap` and `up -d`.
- Remove it completely:
  1. Run `down -v` with the same compose command.
  2. Delete the `triakshi-*` images and `rm -rf /opt/triakshi`.
  3. Restore `/etc/caddy/Caddyfile` from `Caddyfile.bak-triakshi-*`, delete `triakshi.caddy`, then `sudo systemctl reload caddy`.

## Local environment notes
- The local hr-app (Kaamsetu) Supabase containers were stopped to free Colima RAM (production Kaamsetu is untouched).
  Bring them back with `supabase start` in `~/supabase-local`.
- Colima has only 2.9 GB RAM. Keep only one Supabase stack running next to this project's Postgres.

## Owner-only before launch
Cashfree KYC and keys, the AWS account (EC2, S3, SES), the domain and Cloudflare DNS, DLT registration for SMS, a legal review of the terms and privacy pages, and approval to commit and deploy.
