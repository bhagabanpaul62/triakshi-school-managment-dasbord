# Build status (2026-11-19, 06:20)

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
