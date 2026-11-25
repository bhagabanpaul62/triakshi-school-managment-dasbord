# Build status (2026-11-25)

Finance was built on 2026-11-24 and 25 and tested locally; Communication followed. Git, CI and the demo server were last checked on 2026-11-24.

## Finance module (2026-11-25)
Built on branch `feat/finance`; **merged to `main` as PR #5 (`69f1898`), not deployed**. Guide: [FINANCE](FINANCE.md). Plan: [FINANCE-PRD](FINANCE-PRD.md).

| Part | State |
|---|---|
| Ledger, approvals, banking, statements, month and year close | built |
| Fees on frozen bills and receipts; old fee engine removed, old tables read only | built |
| Expenses, petty cash, claims, budgets | built |
| Payroll, loans, exits, statutory files; leave types and balances | built |
| Triakshi billing: credit notes, refunds, account credit, TDS | built |
| Move of old fee data (`move-fees`) | built; 287 receipts of old local data moved, every difference explained |
| Migrations 0009, 0010, 0011 | run in order on an empty database; still to be rehearsed on a copy of the live data |

**Tested 2026-11-25, local, production build, fresh database:** 105 browser tests passed, 0 failed, 1 skipped (the console approval test: the seed has no pending school). They include the 13 money journeys and a crawl of every money link for 7 logins at desktop and phone width (0 problems). Unit: 1,493 passed in 35 packages. Typecheck 40/40, lint 0 errors, no schema drift. Two independent reviews (about 40 findings) were fixed.

### Before real schools use it
Logged 2026-11-25. All three are open.

| # | What | Why | Done when |
|---|---|---|---|
| 1 | A payroll professional checks the rates in `features/payroll/rates.ts` before the first real salary run | They came from public sources. Rates we are less sure of are marked low confidence and show a warning on the pay run | The checked rates are in the code, or overridden on the Statutory screen |
| 2 | Set `DATA_KEY` on the server before payroll is used, and keep a copy somewhere safe | It encrypts bank and ID numbers. Losing it loses the stored values; without it payroll refuses to save them | It is in the server's env and a copy is stored outside the server |
| 3 | Rehearse the move of old fee data on a copy of the live data, after a backup (`move-fees --dry-run`, then bootstrap) | It worked on local data: 287 receipts, every difference explained. It has not been run on live data | The report on the copy explains every difference, and Finance shows no red "books do not match" panel |

## Communication module (2026-11-25)
Built on local branch `feat/communication`: **not merged, not deployed**. Guide: [COMMUNICATION](COMMUNICATION.md). Rules for changing it: [COMMUNICATION-BUILD](COMMUNICATION-BUILD.md). Plan: [COMMUNICATION-PRD](COMMUNICATION-PRD.md).

| Part | State |
|---|---|
| Notices, circulars, urgent alerts, answers, reports | built |
| Messages, reports of a concern, safeguarding review | built |
| Requests (Growth plan and up), Calendar, Meetings (Growth plan and up), Holidays | built |
| Bell, push, email, digest, audiences, settings (the kernel) | built |
| Migration `0012_communication.sql` | built; holds hand-written data steps, never regenerate it; not run on a copy of live data |
| Worker jobs (`comms.*`, `messages.*`, `requests.clock`, `events.*`, `meetings.reminders`) | built; restart the worker to schedule them |

**Tested 2026-11-25, local, production build, fresh database:** every desktop browser test passes; the 15 journeys (42 checks) passed in three full runs, the last on the final build. The older specs ran in parts, not in one run; failed ones were fixed and rerun. Links followed for six roles: 0 problems. Accessibility (axe): 6 of 6. Unit: 2,048 passed in 39 packages on the first full run; packages changed after it were rerun. Typecheck 42/42, lint 0 errors.

**Speed (one person at a time, about 30,000 notifications and 56,000 notice recipients in a 214-student school):** feed, inbox, requests, calendar and notifications answer in under 30 ms (median). Bell check about 2 ms at 3,000 students (service level). Not measured: many people at once on the pages.

### New environment values
| Name | What |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push. Make the pair with `npx web-push generate-vapid-keys`. Without them push is hidden. |
| `MAIL_DAILY_LIMIT` | Emails per day across all schools (default 300). 20% is kept for codes and passwords. |
| `MAIL_WEBHOOK_SECRET` | Header `x-webhook-secret` for the bounce and spam webhook at `/api/webhooks/mail`. Without it the webhook refuses everything. |
| `DATA_KEY` (not new) | Now also signs unsubscribe links and the circular QR. Same key as payroll; never change it. |
| `MAIL_FROM` (not new) | Must be an address on our own sending domain before real use. |

### Before real schools use it
1. Back up the database.
2. Run the migrations (0012), then `pnpm --filter @smw/db post-sql`.
3. Run `pnpm --filter @smw/school bootstrap` (adds Requests and Meetings to the plans except Starter).
4. Set the new environment values above and restart the worker.
5. Name a safeguarding lead in every school. With none, every admin hears reports.
6. Send from our own domain, with SPF and DKIM set at the mail provider.
7. Each school's admins read the "Check these holidays" notices under Attendance, Holidays.

### Not verified
- Push on a real phone, over HTTPS.
- Email from a real domain into real inboxes (spam placement, bounce webhook).
- The demo server: nothing here has run there.
- Legal rules for keeping and reviewing private messages, and the school's own policy for them.
- Migration 0012 on a copy of live data.

## Where things stand
| What | State |
|---|---|
| Code | All 21 features, sign-in and roles, People, the Academics group, onboarding and Finance are built and committed. Communication is on `feat/communication`. |
| `origin/main` | Has everything through Finance (PR #5, `69f1898`). |
| `63f18d5` (forms keep what was typed after a refusal; e2e fixes) | In `origin/main`; **not on the demo**. |
| CI | Passes for PR #2, PR #3 and `63f18d5`. |
| Deploy workflow on main | **Fails every time.** The PR #3 run stops in its SSH setup, where it needs `EC2_SSH_KEY` and `EC2_HOST`. No EC2 exists yet. **Nothing waits for approval:** the `production` environment has no required reviewers in either repo. |
| Demo (free-vm) | Live on `378e90f`, built 2026-11-20, migrations 0000–0008 applied. Marketing answers 200, console redirects to sign-in. |
| Migrations | 0000–0011 on `main` (0009–0011 are Finance, not on the demo); 0012 (Communication) only on `feat/communication`. 0005, 0006, 0008 and 0012 hold hand-written data steps: never regenerate them. |

PRs, all merged: [#1 platform](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/1), [#2 Academics, auth and People](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/2), [#3 onboarding](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/3).

## Next
0. Do the three items in "Before real schools use it" (Finance) before deploying Finance.
1. Deploy `main` to the demo. It needs the owner's go-ahead.
1a. Review and merge `feat/communication`, then do its "Before real schools use it" list.
2. Get the approved demo schools signed in; resend their sign-in email from the console school page where needed.
3. Prove email delivery to outside inboxes. A sender on a domain of our own, verified in Brevo, is the likely fix (not confirmed). Communication needs this too.
4. Add browser tests for `/app/staff/import` and for the school-record panels on My profile (student and teacher). They have unit tests only. Student import has a browser test.
5. Finish the UX review of the fees and students screens (wave B stopped early).
6. Make the Deploy workflow pass or stop running on push: it needs the EC2 host and its secrets. Add required reviewers to `production` **before** the secrets, or the next push to `main` deploys by itself.
7. Do the owner-only launch items (last section).

## Test results
- **e2e, production build, fresh DB (`63f18d5`):** 84 passed and 4 failed in one run. The 4 were in the two onboarding signup specs, which hit the in-memory signup limit; both specs passed (5 of 5) after a marketing restart. 20 spec files.
- **Unit (CI on `63f18d5`):** all 32 test tasks pass, 999 tests counted in the log. Typecheck 37/37, lint 0 errors.
- **Reviews:** 10 auth findings and 11 Academics findings from independent reviews were fixed. One was accepted: emails are sent at most once, after the commit.

## What is built
Plans: [PRD](PRD.md), [AUTH-PRD](AUTH-PRD.md), [PEOPLE-PRD](PEOPLE-PRD.md), [ACADEMICS-PRD](ACADEMICS-PRD.md). Setup and demo logins: [DEV](DEV.md).

**Sign-in and roles**
- Student, teacher and admin logins, plus custom staff roles from a module × permission matrix. No parent logins: the student login is the family login.
- Forced password change on default passwords; forgot password by link or 6-digit code; sign-in by code; verify my email; access links; printable login slips; devices list.
- Custom roles can never hold settings (except the My profile baseline), billing, domains or setup grants.

**People**
- Student and staff records with contact, emergency and (students) medical fields. Students and staff edit their own contact details; official fields stay with the office.
- Import of students and staff from `.xlsx` or `.csv`, with a dry run and then all-or-nothing.

**Onboarding (PR #3)**
- One email, one account: signup refuses an email that already signs in to a school or the console.
- The approval email opens "Set up your account" when the admin has no password yet, otherwise sign-in with the email filled in. The console can resend it.

**Academics group**
| Module | Shipped |
|---|---|
| academics | electives and streams, houses and points, default terms, rollover, class CSV, allocation PDF, full create/edit/delete for every entity |
| attendance | daily and period-wise marking, leave with approval, absence alerts (sent 30 min after marking settles), register PDF/CSV, board eligibility and condonation |
| timetable | whole-school generator with draft, review, lock and publish; scheduled publish; elective blocks; covers; print; room clash; teacher limits |
| assignments | reminders, extensions, scheduled publish, bulk grade and re-grade, comments, marks CSV |
| exams | grade scales (CBSE/ICSE presets), co-scholastic, components, term report cards, date sheet, admit cards, homework into internal marks |
| library | settings, barcode labels, scan desk, holds, member history, overdue reminders, fines to the fee ledger |
| transport | fees on the ledger from the next full month, vehicle documents and expiry alerts, safety checklist, route notices |
| fees | `fee_charges` (transport, library fine) in the ledger, dues and receipts |

## Known limits
- Homework share in internal marks counts graded work only.
- Photos uploaded as WebP before the JPEG change need a re-upload to print on admit cards.
- Login and signup limits are per process, in memory; a restart resets them.

## Test and run locally
- `colima start`, then `pnpm db:up` (Postgres on 5433, RustFS, Mailpit at http://localhost:8025). Local DBs built by push cannot use `migrate`; apply new migration SQL with psql, or run `pnpm db:fresh`, which wipes local data and takes about 150 s.
- e2e runs on the **production build**, never the dev server:
  1. `pnpm --filter @smw/school build && pnpm --filter @smw/console build && pnpm --filter @smw/marketing build`
  2. `pnpm db:fresh`
  3. start `school-prod`, `console-prod` and `marketing-prod` from `.claude/launch.json` (or the `*-prod-4110` set with `SCHOOL_PORT=4110` when 4100 is taken)
  4. `npx playwright test --project=desktop --workers=4`
- Unit tests: `pnpm test`. Typecheck: `pnpm typecheck`.
- Colima has 3 GB and 2 CPUs (raised to 6 GB and 4 on 2026-11-20, but `~/supabase-local/up.sh` starts it at 3 GB): keep only one Supabase stack running next to this Postgres. The local hr-app (Kaamsetu) containers were stopped for this; bring them back with `supabase start` in `~/supabase-local`.

## Temporary deployment on free-vm (until EC2 + S3)
- URLs:
  - marketing: `https://161-118-163-201.sslip.io`
  - console: `https://console.161-118-163-201.sslip.io`
  - schools: `https://<slug>.161-118-163-201.sslip.io` (a certificate is issued on first visit, only for real schools)
- **Running:** `378e90f`. Before migrations 0001–0008 the DB was backed up to `/opt/triakshi/backup-20261120-1124-before-0001-0008.sql.gz` (`pg_dumpall`, mode 600).
- Everything runs locally on the VM: Postgres, RustFS (in place of S3), and the test checkout (`FAKE_PAYMENTS=true`: anyone can "pay", so never on a real launch). WAL archiving is off.
- **Email is real:** Brevo SMTP (`smtp-relay.brevo.com:587`, 300 a day free), sent from `Triakshi AI <bhagabanpaulofficial@gmail.com>`. The Mailpit container still runs but nothing sends to it. The `.env` from before the switch is `/opt/triakshi/.env.bak-20261120-1124`.
- Files on the VM:
  - `/opt/triakshi/repo`: the fork's `feat/school-platform` branch
  - `/opt/triakshi/.env`: secrets, mode 600
  - `/opt/triakshi/compose.freevm.yml`: no stack Caddy, apps on 127.0.0.1:4310-4312, RustFS, Mailpit
  - `/opt/triakshi/build.sh` + `mem-guard.sh`: sequential build that stops if free memory drops under 1.5 GB
  - `/opt/triakshi/superadmin.txt`: the console owner's one-time password and TOTP secret, mode 600
- The host Caddy (systemd) serves other sites too. The Triakshi part is `/etc/caddy/triakshi.caddy`, imported at the end of `/etc/caddy/Caddyfile`, plus an `on_demand_tls { ask … }` global block at the top. A backup is `Caddyfile.bak-triakshi-*`.
- Deploy an update:
  1. Back up the DB.
  2. `cd /opt/triakshi/repo && git pull`
  3. Build in the background with the guard:
     `cd /opt/triakshi && : > build.log && nohup ./build.sh > build.log 2>&1 & echo $! > build.pid; nohup ./mem-guard.sh &`
     `build.sh` builds worker, school, console and marketing one at a time (pass names to build only some). It is done when `build.log` ends with `BUILD_EXIT=0`.
  4. From `/opt/triakshi/repo`, run `docker compose --env-file /opt/triakshi/.env -f infra/docker-compose.yml -f /opt/triakshi/compose.freevm.yml` with `run --rm migrate`, then `run --rm worker pnpm --filter @smw/school bootstrap`, then `up -d`.
- Remove it completely:
  1. Run `down -v` with the same compose command.
  2. Delete the `triakshi-*` images and `rm -rf /opt/triakshi`.
  3. Restore `/etc/caddy/Caddyfile` from `Caddyfile.bak-triakshi-*`, delete `triakshi.caddy`, then `sudo systemctl reload caddy`.

## Owner-only before launch
Cashfree KYC and keys, the AWS account (EC2, S3, SES) and the deploy secrets, the domain and Cloudflare DNS, DLT registration for SMS, a new Brevo key, and a legal review of the terms and privacy pages.
