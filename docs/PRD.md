# Triakshi — Product Requirements (PRD)

- **Date:** 2026-11-18 · **Owner:** Suman · **Status:** approved for build
- **Product:** a school management SaaS for India. Many schools rent one codebase. Each gets an admin panel and a public website, on our subdomain or its own domain. We run every school from a platform console.
- **Source design:** [specs/2026-11-05-school-saas-platform-design.md](superpowers/specs/2026-11-05-school-saas-platform-design.md). This PRD supersedes it where they differ (Cashfree, AWS, the UI kit, Phase 6 in scope).
- **Contracts for builders:** [ARCHITECTURE.md](ARCHITECTURE.md).
- **Placeholder:** `yourbrand.com` = the product domain (`ROOT_DOMAIN` env). Locally it is `localhost`.

---

## 1. Owner decisions (2026-11-18)

| Question | Answer |
|---|---|
| Scope of this build | Every phase, 0 to 6 |
| Payment gateway | **Cashfree**, for platform billing only (schools pay us). Parent fees stay offline-recorded |
| Panel UI | Rebuilt in the Kinetic Monolith kit (dark). Kit accent = school primary colour. Tutorial UI removed, which removes the licence risk |
| Hosting | One **AWS EC2** VM in Mumbai (`ap-south-1`) with Docker Compose. Files on **S3**, email on **SES**, backups to S3 |
| Local dev | Postgres 17, MinIO (S3 stand-in) and Mailpit (email inbox) in Docker. No cloud service needed to run or test |
| Auth | Own small session layer (see §4). Better Auth rejected: per-school unique email and host-only cookies across custom domains need workarounds bigger than the layer itself |

## 2. Users

| Persona | Where | Main jobs |
|---|---|---|
| Platform owner and staff (owner, support, sales) | `console.yourbrand.com` | Onboard schools, set plans and modules, bill, support, audit |
| School admin | `<slug>.yourbrand.com/app` | Set up the year, admit students, staff, fees, website, billing |
| Accountant | panel | Fee structure, record payments, receipts, dues |
| Teacher | panel | Attendance, marks, assignments, timetable, messages |
| Student | panel | Timetable, assignments, results, attendance, library |
| Parent | panel | Children's attendance, fees due, results, announcements |
| Website visitor | `<slug>.yourbrand.com` or own domain | Read about the school, send an admission enquiry |
| Prospective school | `yourbrand.com` | Compare plans, start a free trial |

## 3. Success metrics

- A school signs up, completes the wizard and admits its first student in under 20 minutes with no help.
- Isolation suite: zero cross-school reads or writes, on every service.
- Time to record a fee payment and print its receipt: under 30 seconds.
- p95 panel page load under 1.5 s on the EC2 VM with 100 schools.
- Monthly restore test passes.

## 4. Stack (recommended and chosen)

| Concern | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Already in place |
| Web | Next.js 16 App Router, React 19, TypeScript strict | Already in use; server actions keep forms simple |
| Styling | **Tailwind v4** + `design-tokens.css` + the cool-dashboard-ui kit | Kit needs v4; CSS variables make per-school theming free |
| Charts / motion / icons | recharts, framer-motion, @tabler/icons-react | The kit's own dependencies |
| Overlays | Radix dialog / alert-dialog / slot | The kit's Modal and SidePanel |
| Database | PostgreSQL 17 | Row-level security, JSONB, mature backups |
| ORM | Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver | SQL-first, RLS declared next to tables, plain SQL migrations |
| Validation | zod 4 | One schema for forms, services and the REST API |
| Auth | Own layer: 32-byte random token, SHA-256 hash stored, sliding 30-day expiry, `@node-rs/argon2` passwords, host-only cookie; the same token works as `Authorization: Bearer` for the mobile API | Fits per-school accounts and many domains exactly |
| Console 2FA | TOTP via `otpauth` | Mandatory for platform staff |
| Jobs | pg-boss | Queue lives in Postgres, no Redis |
| Files | `@aws-sdk/client-s3` + presigned URLs. MinIO locally, S3 `ap-south-1` in prod | Same API in both |
| Email | nodemailer over SMTP. Mailpit locally, **SES SMTP** in prod | One adapter, no SDK |
| Payments | **Cashfree PG** REST API (`x-api-version: 2025-01-01`) via `fetch`: Orders for annual/one-time, Subscriptions for auto-renew, webhook HMAC-SHA256 check | No SDK needed; sandbox and prod differ only by base URL and keys |
| PDF | pdf-lib | Pure JS: receipts, GST invoices, report cards |
| CSV import | papaparse | Student import with a row-by-row error report |
| Logs | pino JSON, every line with `schoolId` and `requestId` | Spec §7 |
| Tests | Vitest (unit + integration on real Postgres), Playwright (browser) | Spec §23 |
| Lint | ESLint 9 flat config + `typescript-eslint` + boundary rules | `next lint` is gone in Next 16 |
| Proxy / TLS | Caddy 2 with Cloudflare DNS module; on-demand TLS for custom domains | Spec §9 |
| Hosting | EC2 `t4g.large` (2 vCPU / 8 GB, ARM) to start, Elastic IP, gp3 disk; grow to `t4g.xlarge` near 100 schools | Elastic IP keeps apex-domain A records valid |
| CI / CD | GitHub Actions → GHCR images → SSH deploy to EC2, migrations as a one-off container | Spec §21 |
| Backups | wal-g to a versioned S3 bucket in `ap-south-1`, 30-day retention, monthly restore test | Data stays in India (DPDP) |
| Monitoring | Sentry (errors), an external uptime check, CloudWatch agent for disk/CPU | |

## 5. Architecture in one picture

```
                 Internet
                    │
            Caddy (EC2, HTTPS)
   ┌────────────────┼──────────────────────┐
yourbrand.com   console.yourbrand.com   *.yourbrand.com + custom domains
   │                │                      │
marketing:3001   console:3002           school:3000 (website + /app panel + /api/v1)
   │                │                      │
   └──── PostgreSQL 17 (RLS) ─── worker (pg-boss) ─── S3 · SES · Cashfree
```

Three database roles: `app_school` (RLS enforced), `app_console` (bypasses RLS), `app_migrate` (owns tables). The school app can never see another school.

---

## 6. Phase 0 — Foundation

**Outcome.** Two demo schools, `a.localhost:3000` and `b.localhost:3000`, show their own name and colours; users log in; isolation tests pass; lint, typecheck, tests and build pass in CI.

| # | Requirement | Acceptance |
|---|---|---|
| F0.1 | Local stack: `pnpm db:up` starts Postgres 17 (port 5433), MinIO (9000/9001), Mailpit (1025/8025) | Three DB roles exist; `pnpm db:migrate` and `pnpm db:seed` work on an empty volume |
| F0.2 | Config: one zod env schema in `@smw/config`, validated at startup, secrets never logged | App fails fast with a clear message on a missing variable |
| F0.3 | Platform schema: `schools`, `school_domains`, `plans`, `plan_modules`, `school_module_overrides`, `users`, `sessions`, `audit_logs`, `platform_staff`, `staff_sessions` | Migrations append-only; UUIDv7 keys |
| F0.4 | `withSchool(ctx, fn)` opens a transaction and sets `app.school_id`; RLS on every school-owned table | Raw query with no school set returns zero rows; school A cannot read or write B |
| F0.5 | Host resolution via `resolve_school_by_host()` (security definer), cached 60 s; incoming school headers stripped | Unknown host → "School not found"; suspended → "Service paused" |
| F0.6 | Sessions: login by email, phone or login ID (admission number), host-only cookie, rate limit per IP and account, logout | Cookie has no `Domain`; a session from school A is rejected on school B |
| F0.7 | Roles `admin`, `accountant`, `teacher`, `student`, `parent`; permission map in code; checked in every service | A teacher calling a fees write gets 403 |
| F0.8 | Feature kit: declare features, registry, resolver (suspended → billing only; read-only; override; plan + `ga`; requires) | Unit tests cover each rule |
| F0.9 | Feature guards in the menu, in each module layout (upgrade page) and in every service | Turning a module off hides it and services throw |
| F0.10 | Theme: tokens per school, written as CSS variables on `:root`; kit accent ramp generated from the school primary colour | Changing a theme needs no rebuild |
| F0.11 | Panel shell in the kit: sidebar, top bar, school name and logo, role menu, mobile drawer | Matches the kit's "before you say done" list |
| F0.12 | Demo fixtures: two schools, every role, a term of data | `pnpm db:seed` is repeatable |

## 7. Phase 1 — School core

**Outcome.** A demo school can run a term: admit students, mark attendance, collect fees, publish results.

Every module ships: list page (search, filters, pagination, empty/loading/error states), record page (EntityHeader + TabBar + FactList), create/edit modal, delete with confirmation, permission-gated actions, audit log entries, and the A-versus-B isolation test.

### 7.1 Academic setup (`academics`)
- Academic years (default April–March), one current year; terms.
- Classes with Indian presets (Nursery, LKG, UKG, Class 1–12), sections, capacity, class teacher.
- Subjects with board presets (CBSE, ICSE, State), mapped to classes; subject teachers.
- **Accept:** promoting a year copies classes and subjects forward.

### 7.2 People (`students`, `staff`)
- Students: admission number (unique per school), name, DOB, gender, blood group, class and section, roll number, photo (S3), address, optional APAAR ID, status (active, alumni, left), guardians (many), documents (S3, private, signed URLs). No Aadhaar number stored.
- Guardian consent record (DPDP): who, when, what for.
- Parents: a parent user links to one or more students in the same school.
- Staff: teachers, accountants, admins; employee ID, designation, subjects, phone, email, joining date, photo.
- Student CSV import with template download, dry run with row-by-row errors, then commit (worker job).
- Bulk promote students to the next class at year end; mark alumni.
- Student cap: warning at 90%, block new admissions past 110%.
- **Accept:** a student without email logs in with the admission number.

### 7.3 Attendance (`attendance`)
- Daily attendance per section: present, absent, late, leave; one-tap "all present" then exceptions.
- Staff attendance.
- Monthly register per section, student attendance %, defaulters below 75%.
- Parent and student view of their own record.
- **Accept:** marking twice the same day updates, not duplicates.

### 7.4 Fees (`fees`)
- Fee heads (tuition, admission, transport, exam…), fee structure per class per year, installments with due dates.
- Concessions per student (amount or %), late fee rule per installment.
- Record payment: cash, cheque, UPI, bank transfer; partial payments; numbered PDF receipt per financial year (sequence per school).
- Dues report by class, overdue list, collection over time; student fee ledger.
- Parent view: what is due, what is paid, receipts.
- **Accept:** totals reconcile: structure − concessions + late fee − payments = due, to the paisa. Money stored as integer paise.

### 7.5 Exams and results (`exams`)
- Exam types and exams per term, schedule per class and subject, max and pass marks.
- Marks entry grid per section and subject (teacher), absent marker, lock after publish.
- Grade scales (CBSE 9-point default, editable).
- Results view per student and per class, rank, pass/fail, publish to students and parents.

### 7.6 Timetable, lessons, assignments, announcements, events, messages
- `timetable`: weekly periods per section, teacher clash check, teacher's own timetable, calendar view.
- `assignments`: create with due date and attachments (S3), student submissions with files, teacher grading.
- `announcements`: audience (whole school, class, role), optional "public" flag for the website.
- `events`: calendar, audience, optional "public" flag.
- `messages`: one-to-one and group threads between staff, parents and students, within the school, unread counts.

### 7.7 Dashboards and common
- Role home pages built from real data with the kit: admin (students vs cap, attendance today, fee collection trend, dues, upcoming events), teacher (today's periods, sections to mark, pending grading), student and parent (attendance %, next exams, dues, latest announcements).
- Profile, change password, school settings (profile, UDISE+ code, logo), users and roles, audit log (admin), data export (one student or whole school, ZIP of CSVs).

## 8. Phase 2 — Console and production

**Outcome.** We onboard pilot schools on subdomains and invoice them offline.

- Console login with mandatory TOTP 2FA; staff roles owner, support, sales.
- Schools: search, filter by status and plan; create (sales-assisted, sends admin invite), suspend, reactivate, extend trial, change plan, export, schedule deletion.
- School detail: profile, plan, students against cap, modules and overrides (with expiry and note), domains, theme, template, invoices, tickets, audit log, **support login** (one-time 5-minute token → 30-minute read-only session with a banner; owner may allow writes; all logged).
- Plans and add-ons: versioned plans with price, cap, limits and modules; old subscribers keep their price until renewal.
- Modules: stage (alpha, beta, ga), number of schools on, 30-day usage (nightly job from audit log).
- Support tickets: schools raise from the panel; console replies; statuses.
- Platform audit log.
- Worker: pg-boss with send email, student import, usage counts, lifecycle jobs.
- Infra: production `docker-compose.yml`, `Caddyfile`, Dockerfiles, wal-g backups, restore script, GitHub Actions CI and SSH deploy, EC2 runbook in `infra/README.md`.

## 9. Phase 3 — Self-serve signup and billing

**Outcome.** A school signs up, sets up and pays with no help from us.

- Marketing site: landing, features, pricing from the `plans` table, FAQ, contact; agency-grade, not template slop.
- Signup: school name, admin name, email, phone, state, city, board, approx students, subdomain (lowercase, unique, not reserved); email verification (Mailpit locally).
- Creates the school in `trial` and the admin; lands on `/app` with the setup wizard: academic year → classes and sections → subjects → student import → invite staff → website template and theme.
- Plans: Starter (≤300), Growth (301–1,000), Pro (1,001–3,000), Enterprise (custom). Annual or monthly.
- **Cashfree:** annual or one-time → Cashfree Order + hosted checkout; monthly auto-renew → Cashfree Subscription (plan + mandate). Webhooks at `console/api/webhooks/cashfree`, signature verified (`x-webhook-signature` = base64 HMAC-SHA256 of `timestamp + rawBody` with the secret key), idempotent by event ID. Return URL re-checks the order with the API, never trusts the redirect.
- Offline payments (bank transfer, cheque) recorded by staff against an invoice in the console.
- GST invoices: our GSTIN, school GSTIN if any, SAC 998431 (CA to confirm), CGST+SGST in our state else IGST, sequence per financial year, PDF.
- Upgrade now with proration for remaining days; downgrade at renewal.
- Trial lifecycle: 30 days → read-only 14 days (export works) → suspended, data kept 90 days → deleted after final email. Overdue: reminders at −7, 0, +7 days; read-only after 15 days unpaid.
- Billing page in the panel: plan, usage vs cap, invoices, pay now.

## 10. Phase 4 — Themes and school websites

**Outcome.** A school publishes a themed website on its subdomain.

- Theme editor: presets, primary/secondary/accent colours, radius, font from a fixed list, logo, favicon; live preview; WCAG AA contrast check blocks bad combinations. Full editor is a plan feature; every plan gets logo and primary colour.
- Three preset templates (e.g. Classic, Modern, Minimal), each a light, responsive public site.
- Section types: hero, rich text, stats, gallery (S3), news (public announcements), events (public events), staff list (public teachers), testimonials, admission enquiry form, contact with map.
- Form-based section editor: add, remove, reorder, fill; pages with slug, title, SEO; nav and footer; draft vs published; publish clears that school's cache. Reserved slugs blocked.
- Admission enquiries land in the panel as a pipeline (new, contacted, visited, admitted, closed) and can convert into a student.
- Per-host `sitemap.xml`, `robots.txt`, titles and share images.
- Custom design requests (paid) tracked: requested, quoted, paid, in progress, in review, delivered.

## 11. Phase 5 — Custom domains

**Outcome.** A school's own domain serves its website and panel over HTTPS.

- Admin adds `www.school.in`; panel shows TXT `_smw-verify.www.school.in` and CNAME to `sites.yourbrand.com`.
- Worker checks DNS every 10 minutes for 72 hours; verified → first visit issues a certificate via Caddy on-demand TLS, which asks `/api/internal/tls-allowed` (Docker network only).
- Bare domain via A record to the Elastic IP, redirected to `www`.
- Primary domain choice; remove domain; console lists every domain with status.
- Server-action origin check works on custom domains (tested).

## 12. Phase 6 — Extensions

- **Mobile REST API v1** at `/api/v1` on each school host: bearer tokens from the same session layer, endpoints reuse feature services and zod inputs, OpenAPI document at `/api/v1/openapi.json`. Covers login, me, timetable, attendance, fees due, results, announcements, assignments, messages.
- **Report cards:** board-style PDF per student per term (CBSE scholastic + co-scholastic), class-wide batch generation via the worker.
- **Transport:** vehicles, drivers, routes, stops with times, student assignment, transport fee head linked to fees, route-wise lists.
- **Library:** books, copies with accession numbers, issue and return, due dates, fines, member history, overdue list.
- **Notifications:** in-app notification centre (bell) fed by announcements, fee dues and results; email digests via the worker.
- **SMS / WhatsApp:** `SmsSender` interface with a fake adapter; real provider waits for DLT registration (owner task).
- **Not in this run:** a native mobile app (the API is its contract), parent online fee payment (owner chose platform-only Cashfree).

## 13. Non-functional requirements

- **Isolation:** RLS + scoped services + the isolation suite on every feature.
- **Security:** zod at every boundary, parameterised SQL only, rate limits on auth, host-only cookies, CSRF via server-action origin check, private S3 with signed URLs and type/size checks, secrets only via `@smw/config`, append-only audit log.
- **DPDP 2023 + Rules 2025:** school = Data Fiduciary, we = Processor; guardian consent records; per-student and per-school export; deletion on request and after churn; data and backups in India; breach runbook.
- **Accessibility:** keyboard reachable, visible focus, `aria-label` on icon buttons, contrast AA, reduced motion respected.
- **Performance:** every list paginated; indexes start with `school_id`; host lookup cached.
- **Copy:** human dates ("Sep 29"), INR formatting (₹1,23,456 and compact ₹1.2L), no internal IDs in the UI.

## 14. Testing and done-ness

- Unit: entitlement resolver, theme validation and contrast, fee calculation, proration, GST split, invoice numbering, Cashfree signature check, domain verification.
- Integration: every service on a real Postgres, with the A-versus-B isolation test and the "no school set → zero rows" test.
- Browser (Playwright on `*.localhost`): signup → wizard, login per role, add a student, mark attendance, record a fee and open the receipt, enter marks and publish, publish the website, two schools side by side, console support login, Cashfree sandbox checkout (fake adapter when no keys).
- Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; Playwright suite green on local dev servers.

## 15. Owner-only tasks (cannot be automated)

| Task | Needed for |
|---|---|
| Buy the product domain, move DNS to Cloudflare, create a DNS API token | Wildcard certificate |
| Cashfree merchant account and KYC; sandbox then prod keys in the server `.env` | Phase 3 live payments |
| AWS account: EC2, Elastic IP, S3 buckets, SES domain verification and production access | Deploy |
| CA confirms SAC code and GST rate; lawyer confirms DPDP duties and the DPA | Before charging schools |
| DLT registration | SMS (Phase 6) |

## 16. Risks

| Risk | Mitigation |
|---|---|
| One VM is a single point of failure | wal-g PITR, monthly restore test, Elastic IP, runbook; RDS or a replica as revenue grows |
| Cashfree subscription API changes | Adapter behind `PaymentGateway`, fake adapter in tests, sandbox smoke test |
| Phase 1 breadth | Every module follows one feature template; isolation test is mandatory |
| Tax and legal assumptions | CA and lawyer review before Phase 3 goes live |
