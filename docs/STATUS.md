# Build status (2026-11-24)

Git, CI and the demo server were checked on 2026-11-24. Test results are from the commit and PR they belong to; nothing was re-run that day.

## Where things stand
| What | State |
|---|---|
| Code | All 21 features, sign-in and roles, People, the Academics group and onboarding are built and committed. The working tree was clean before this file was edited. |
| `origin/main` (bhagabanpaul62) | Has everything through PR #3 (`cf3ae29`), merged 2026-11-20. |
| `fork/feat/school-platform` | One commit ahead: `63f18d5` (forms keep what was typed after a refusal; e2e fixes). **PR open to `main`; not on the demo.** |
| CI | Passes for PR #2, PR #3 and `63f18d5`. |
| Deploy workflow on main | **Fails every time.** The PR #3 run stops in its SSH setup, where it needs `EC2_SSH_KEY` and `EC2_HOST`. No EC2 exists yet. **Nothing waits for approval:** the `production` environment has no required reviewers in either repo. |
| Demo (free-vm) | Live on `378e90f`, built 2026-11-20, migrations 0000–0008 applied. Marketing answers 200, console redirects to sign-in. |
| Migrations | 0000–0008 in `packages/db/migrations`. 0005, 0006 and 0008 hold hand-written data steps: never regenerate them. |

PRs, all merged: [#1 platform](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/1), [#2 Academics, auth and People](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/2), [#3 onboarding](https://github.com/bhagabanpaul62/triakshi-school-managment-dasbord/pull/3).

## Next
1. Merge the PR for `63f18d5`, then deploy it to the demo. Both need the owner's go-ahead.
2. Get the approved demo schools signed in; resend their sign-in email from the console school page where needed.
3. Prove email delivery to outside inboxes. A sender on a domain of our own, verified in Brevo, is the likely fix (not confirmed).
4. Add browser tests for `/app/staff/import` and for the school-record panels on My profile (student and teacher). They have unit tests only. Student import has a browser test.
5. Finish the UX review of the fees, students and communication screens (wave B stopped early).
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
