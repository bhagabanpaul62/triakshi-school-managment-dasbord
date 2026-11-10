# School SaaS Platform: Design Spec

- **Date:** 2026-11-05
- **Status:** Draft, waiting for owner review
- **Scope:** Whole-platform architecture and roadmap. Each phase gets its own implementation plan. Large phases may also get a short spec of their own.
- **Placeholder:** `yourbrand.com` stands for the product domain you will buy.

---

## 1. Summary

We turn the existing single-school dashboard into one product that many schools rent. Each school gets its own admin panel and its own public website, on our subdomain or on its own domain. You control every school from a platform console: plans, features, themes, templates, domains, billing and support.

The first market is India. Everything runs on a VPS we manage. A mobile app may come later, so business logic stays independent of the web framework.

## 2. Goals and non-goals

**Goals**
1. Onboard many schools from one codebase and one deployment.
2. Let schools sign up and set themselves up without your help.
3. Turn any feature on or off per school, and see who uses it.
4. Theme each school's panel and website without code changes.
5. Offer preset website templates, and sell custom designs as paid work.
6. Connect a school's own domain with automatic HTTPS.
7. Price per school, tiered by student count.
8. Keep each school's data fully isolated from every other school.

**Non-goals for the first year**
- Native mobile apps. The design keeps the door open (section 20).
- Online fee payment by parents. Schools record fees collected offline first (section 17).
- SMS and WhatsApp messaging. These need DLT registration (section 19).
- Drag-and-drop website builder. A form-based section editor is enough.
- Custom roles per school. Fixed roles cover the first year.
- A database per school. Shared database with row-level security is used instead.

## 3. Decisions already taken

| Question | Answer | Effect on design |
|---|---|---|
| Target country | India | Razorpay, GST invoices, INR, April–March academic year, DPDP Act, Indian class names |
| Hosting | VPS | Docker Compose, Caddy for HTTPS and custom domains, self-managed backups |
| Mobile app | Maybe later | Framework-free service layer now, REST API added later |
| Existing screens | Reuse | Tutorial UI becomes the school panel, after licence check |
| Pricing | Per school, tiered by student count | Plans carry a student cap, prices live in the database |

## 4. Current state and baseline

The repo holds the Lama Dev tutorial dashboard on Next.js 16, React 19 and Tailwind 3.

- Screens exist for admin, teacher, student and parent home pages and for list pages of teachers, students, parents, subjects, classes, lessons, exams, assignments, results, events and announcements.
- All data comes from `src/lib/data.ts`. The role is hard-coded to `admin`.
- There is no database, no login and no backend.
- The homepage and sign-in page are empty.
- Colours are hard-coded in `tailwind.config.ts`. The sidebar shows the literal text "School Name".
- There is no licence file.

**Baseline checks recorded on 2026-11-05**

| Check | Result |
|---|---|
| `tsc --noEmit` | Passes |
| `pnpm lint` | Broken. Next.js 16 removed `next lint`, and ESLint 10 no longer reads `.eslintrc.json` |
| Tests | None exist |
| Build | Not run, to avoid writing build output during planning |

Three files have real uncommitted edits. Thirty-seven more show whitespace-only changes. These must be committed or discarded before Phase 0 moves files.

## 5. System overview

Three apps share one database.

| App | Address | Users |
|---|---|---|
| Marketing site | `yourbrand.com` | Schools you are selling to |
| Platform console | `console.yourbrand.com` | You and your staff |
| School app | `<slug>.yourbrand.com` or the school's own domain | School staff, students, parents, website visitors |

```
                         Internet
                            |
                    Caddy (HTTPS, routing)
        +-------------------+--------------------+
        |                   |                    |
  yourbrand.com     console.yourbrand.com   *.yourbrand.com + custom domains
        |                   |                    |
  marketing app       console app           school app
                            |               (website + /app panel)
                            |                    |
                            +------ PostgreSQL --+---- worker (background jobs)
                                       |
                              object storage (files)
```

**Why the console is a separate app.** It connects to the database with a role that can see every school. The school app connects with a role that cannot. Keeping them in separate containers means a bug in the school app can never use the console's powers.

**Why the website and panel share one app.** They share the school lookup, theme, login and data. One app per school domain keeps routing and HTTPS simple.

## 6. Repository layout

The repo is a pnpm workspace monorepo with Turborepo. The tutorial app lives in `apps/school`, moved with its git history kept. This structure was created on 2026-11-07; each folder's README says what goes there and in which phase.

```
apps/               routes and wiring only
  marketing/        Next.js, yourbrand.com: landing, pricing, signup and onboarding (port 3001)
  console/          Next.js, console.yourbrand.com: platform console (port 3002)
  school/           Next.js, school websites and the /app panel (port 3000)
  worker/           Background jobs with pg-boss
features/           One package per school feature, switched on per school (section 11)
  <name>/
    feature.ts      Key, name, stage, required features, menu items, permissions, settings schema
    schema.ts       Drizzle tables, each with school_id and row-level security
    service.ts      Business logic. No React, no Next.js
    inputs.ts       zod schemas for every input
    ui/             Pages and components for the school app
packages/
  db/               Drizzle client, platform tables, the one migration history, RLS, school-scoped client
  feature-kit/      Feature declaration, registry and per-school entitlement resolver
  auth/             Sessions, password hashing, permission checks
  themes/           Theme token schema, presets, CSS variable output
  onboarding/       Signup and setup wizard, shared by marketing, console and school
  site-templates/   Website templates and section schemas
  ui/               Shared React components, taken from the tutorial
  integrations/     Interfaces and adapters: email, payments, storage, DNS
  config/           Shared tsconfig presets, ESLint config, env schema
infra/
  docker-compose files, Caddyfile, backup and deploy scripts
docs/
tickets/
```

**Layer rule.** Pages and server actions call services in `features/*/service.ts`. Services call `packages/db`. No business logic lives in pages, components or query helpers.

**Boundary rules.**
- Route files in `apps/school` are one-line re-exports of pages from `features/*/ui`.
- Features may import packages. Packages never import features.
- A feature may use another feature only if it lists it in `requires`.
- Feature packages declare their own tables, but migrations are generated in `packages/db` in one ordered, append-only history.
- Lint enforces these rules once ESLint works again (Phase 0).

The folder name `sechoolManagement(Dashbord)` contains brackets, which break some Docker and shell tooling. Renaming it is recommended and is the owner's call.

## 7. Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Web framework | Next.js 16, App Router | Already in use |
| Styling | Tailwind 3 with CSS variables | Already in use, variables enable theming |
| Database | PostgreSQL 17 | Row-level security, JSON columns, mature backups |
| ORM and migrations | Drizzle | Declares RLS policies in schema, plain SQL migrations |
| Validation | zod | One schema for forms, services and API |
| Background jobs | pg-boss | Queue stored in Postgres, so no Redis to run |
| Auth | Decided by a Phase 0 spike (section 10) | Must work across many domains |
| Reverse proxy and HTTPS | Caddy | On-demand certificates for custom domains |
| File storage | S3-compatible bucket in an Indian region | Behind a storage interface |
| Email | Amazon SES Mumbai or similar | Behind an email interface |
| Payments | Razorpay | Indian cards, UPI and subscriptions |
| Tests | Vitest and Playwright | Unit, integration and browser tests |
| Logs | pino, structured JSON | Every line carries school ID and request ID |

**New dependencies that need your approval.** Each phase plan lists the exact packages again before installing them.

- Phase 0: `turbo`, `drizzle-orm`, `drizzle-kit`, `postgres`, `zod`, `vitest`, `@playwright/test`, `pino`, and either `better-auth` or `@node-rs/argon2`.
- Phase 1: `react-hook-form`, `@hookform/resolvers`, a PDF library for receipts.
- Phase 2: `pg-boss`, `@aws-sdk/client-s3`.
- Phase 3: `razorpay`.
- Infra: Caddy built with the Cloudflare DNS module, PostgreSQL 17, wal-g.

## 8. Multi-tenancy and data isolation

**Model.** One database and one schema. Every school-owned table has a `school_id` column that is never null.

**Two layers of protection.**
1. **Application layer.** Services receive a context object with `schoolId`, `userId` and `role`. The school-scoped database client opens a transaction and runs `set_config('app.school_id', <id>, true)` before any query.
2. **Database layer.** Row-level security on every school-owned table allows a row only when `school_id = current_setting('app.school_id')::uuid`. If the application forgets to scope a query, the database returns nothing.

**Database roles.**

| Role | Used by | Can bypass RLS |
|---|---|---|
| `app_school` | School app, worker jobs for one school | No |
| `app_console` | Console app, cross-school worker jobs | Yes |
| `app_migrate` | Migrations only | Owner of tables |

**Conventions.**
- Primary keys are UUIDv7, so they sort by time and leak no counts.
- Every school-owned table has an index starting with `school_id`.
- Every list is paginated. The tutorial's pagination component is reused.
- Migrations are append-only. An applied migration is never edited.

**Platform tables and the school app.** Some tables belong to the platform, but the school app still needs part of them.

| Tables | School app access |
|---|---|
| `plans`, `plan_modules`, `addons` | Read only |
| `website_templates` | Read presets and its own custom templates |
| `schools`, `subscriptions`, `invoices`, `payments`, `school_module_overrides` | Read its own school's rows only |
| `school_domains` | Read, add and remove its own custom domains |
| `support_tickets`, `custom_design_requests` | Read and create for its own school |
| `audit_logs` | Insert. Admins read their own school's rows |
| `platform_staff` | No access |

**Host lookup.** The school is not known yet when a request arrives. So the lookup uses one database function, `resolve_school_by_host(hostname)`, which runs with elevated rights and returns only the school ID, slug and status. The school app has no other way to read another school's domains.

**Key platform columns.**

```
schools:        id, slug, name, status (trial|active|past_due|read_only|suspended|cancelled),
                plan_id, student_cap, board, state, city, timezone, academic_year_start_month,
                trial_ends_at, created_at
school_domains: id, school_id, hostname (unique), kind (subdomain|custom),
                status (pending|verified|failed), verify_token, verified_at, is_primary
plans:          id, key, name, version, student_cap, price_annual_paise, price_monthly_paise,
                limits (jsonb), is_public, is_active
plan_modules:   plan_id, module_key
school_module_overrides: school_id, module_key, enabled, note, expires_at, set_by
```

## 9. Domain routing and HTTPS

**Request flow on a school host.**
1. Caddy terminates HTTPS and forwards to the school app with the original `Host` header.
2. The Next.js proxy file reads the host and looks it up in `school_domains`. Lookups are cached in memory for 60 seconds.
3. An unknown host shows a "school not found" page. A suspended school's website shows a "service paused" page, and its panel lets only the admin in, for billing and data export.
4. The proxy rewrites the request internally to `/<schoolId>/<path>`. Users never see the school ID.
5. Any incoming header that claims a school ID is deleted. The school comes only from the host.
6. The proxy skips the lookup only for `/api/internal/*`. Caddy blocks that path from the internet, so only Caddy itself can call it.

**Paths on a school host.**

| Path | Serves |
|---|---|
| `/`, `/about`, `/admissions`, other page slugs | Public website |
| `/login` | Login for staff, students and parents |
| `/app/...` | Admin panel. Existing tutorial routes move here, such as `/app/list/students` |
| `/api/...` | Route handlers and the future mobile API |

Website page slugs cannot use the reserved words `app`, `login`, `api`, `_next` or `support-login`.

**Certificates.**
- `*.yourbrand.com` uses one wildcard certificate through a DNS challenge. The product domain's DNS sits on Cloudflare so Caddy can create the challenge record.
- Custom domains use Caddy's on-demand TLS. Before issuing a certificate, Caddy calls an internal endpoint that answers yes only for verified domains. That endpoint is reachable only inside the Docker network.

```
{
  on_demand_tls {
    ask http://school:3000/api/internal/tls-allowed
  }
}
yourbrand.com, www.yourbrand.com { reverse_proxy marketing:3000 }
console.yourbrand.com           { reverse_proxy console:3000 }
*.yourbrand.com {
  tls { dns cloudflare {env.CF_API_TOKEN} }
  respond /api/internal/* 404
  reverse_proxy school:3000
}
https:// {
  tls { on_demand }
  respond /api/internal/* 404
  reverse_proxy school:3000
}
```

**Connecting a custom domain.**
1. The school admin enters `www.school.in` in settings.
2. The panel shows two DNS records to add:
   - a TXT record `_smw-verify.www.school.in` with a token, which proves ownership;
   - a CNAME `www.school.in` pointing to `sites.yourbrand.com`.
3. A background job checks DNS every 10 minutes for 72 hours.
4. When both records match, the domain becomes verified. The first visit triggers the certificate.
5. For the bare domain `school.in`, the school adds an A record to the platform's reserved IP. The app redirects it to `www`.

The VPS must have a reserved or floating IP. If the IP changes, every bare-domain A record breaks.

**Local development** uses `<slug>.localhost:3000`, which browsers resolve to your own machine without any hosts file.

## 10. Identity, roles and permissions

**School users.**
- Every account belongs to exactly one school. `users` holds `school_id`, `role`, `login_id`, name, optional email, optional phone, password hash and status.
- `login_id`, email and phone are unique within a school, not across schools. Students without email log in with their admission number.
- A parent with children in two schools has a separate account in each.
- **Why not one global account per person:** with shared accounts, school B's admin could add an email that already exists in school A and then reset that person's password, which would change it for school A too. Per-school accounts make that impossible.

**School roles.** `admin`, `accountant`, `teacher`, `student`, `parent`. A permission map in code says which role can perform which action in which module.

**Sessions.**
- The session cookie is host-only. It never sets a `Domain` attribute. A cookie set on `.yourbrand.com` would leak sessions between schools, so this is tested.
- Every request checks that the session's user belongs to the school resolved from the host.
- Login, signup and password reset are rate-limited per IP and per account.

**Platform staff.** A separate `platform_staff` table and a separate cookie on the console host. Roles are `owner`, `support` and `sales`. Two-factor login is mandatory.

**Support login.**
1. Staff pick a school and a user in the console and type a reason.
2. The console creates a one-time token valid for 5 minutes.
3. The token opens `/support-login` on the school's host and starts a 30-minute session.
4. The session is read-only unless an owner allows writes.
5. A banner shows "Support session by <staff name>". Every action is written to the audit log with the staff ID.

**Phase 0 auth spike.** Better Auth is preferred if it supports host-only cookies across many domains and user accounts scoped to one school, including email unique per school. If not, we build a small session layer: random 32-byte tokens stored as SHA-256 hashes, sliding expiry, and Argon2 password hashing. The spike ends with a written decision.

## 11. Module system

This is how you build a feature once and give it to chosen schools.

**Registry in code.** Each module declares a key, name, stage, dependencies, menu entries and permissions.

```ts
export const modules = {
  attendance: { name: "Attendance", stage: "ga", requires: ["students"] },
  fees:       { name: "Fees",       stage: "ga", requires: ["students"] },
  transport:  { name: "Transport",  stage: "alpha", requires: ["students"] },
} as const;
```

**Stages.**

| Stage | Who gets it |
|---|---|
| `alpha` | Only schools you enable one by one, such as your demo school |
| `beta` | Schools you enable one by one, usually pilot schools |
| `ga` | Every school whose plan includes it |

**Resolution order for one school.**
1. A suspended school gets only billing and data export.
2. A read-only school can view every module it had but change nothing.
3. A per-school override that has not expired wins.
4. Otherwise the module is on if it is `ga` and the school's plan includes it.
5. A module is off if any module it requires is off.

**Enforcement.** The same resolver feeds three places:
- the sidebar menu, which already filters by role and now also filters by module;
- the layout for each module's routes, which shows an upgrade page when the module is off;
- every service call, which throws when the module is off. The server is the source of truth.

**Usage in the console.** A nightly job counts key actions per school and module from the audit log. The console shows how many schools have each module on and how many used it in the last 30 days.

**Releasing a feature.** Build it as `alpha`. Turn it on for your demo school. Move to `beta` for chosen pilots. Move to `ga` and add it to plans.

## 12. Theme layer

**Tokens.** Each school stores a theme validated by zod:

```
colors: primary, primaryLight, secondary, secondaryLight, accent, accentLight,
        background, surface, text, mutedText
radius: none | sm | md | lg
font:   one of a fixed list, self-hosted with next/font
logoUrl, faviconUrl
```

**How it applies.** The root layout writes the tokens as CSS variables on `:root`. Tailwind colours point at the variables. Changing a theme needs no rebuild.

**Mapping the tutorial colours.** `lamaSky` becomes `primary`, `lamaPurple` becomes `secondary`, and `lamaYellow` becomes `accent`, each with a light variant. The default theme reproduces today's look exactly.

**Rules.**
- Saving a theme checks text contrast against WCAG AA and blocks unreadable combinations.
- Presets ship in code. Schools can start from a preset and change colours, logo and font.
- The same theme styles the panel, the website, the login page, emails and PDF receipts.
- Full theme editing is a plan feature. Every plan gets logo and primary colour.

## 13. School websites and templates

**Templates in code.** Each template in `packages/site-templates` exports a key, a name, a kind (`preset` or `custom`), the section types it supports, and a layout.

**Content in the database.** Each school has a draft and a published copy of its site content:

```
pages[]:   slug, title, seo { title, description }, sections[]
sections[]: id, type, data
nav, footer
```

**Section types at launch.** hero, rich text, stats, gallery, news, events, staff list, testimonials, admission enquiry form, contact with map.

**Sections fed by the panel.**
- News shows announcements marked public.
- Events shows events marked public.
- Staff list shows teachers marked public.
- The admission enquiry form creates an enquiry in the panel, which is a strong selling point.

**Editing and publishing.** A form-based editor in the panel. Schools add, remove, reorder and fill sections. Publishing copies draft to published and clears that school's page cache.

**SEO.** Each host gets its own `sitemap.xml`, `robots.txt`, page titles and share images.

**Launch set.** Three preset templates.

**Paid custom design.**

| Level | What you deliver | How it is built |
|---|---|---|
| Custom styling | Theme, layout and content set up for the school | Done in the editor by your staff |
| Custom template | A design made only for this school | New template in code with kind `custom`, assigned to that school in the console |

The `custom_design_requests` table tracks each job: requested, quoted, paid, in progress, in review, delivered.

## 14. Platform console

| Area | What you can do |
|---|---|
| Schools | Search and filter. Create, suspend, reactivate, extend trial, change plan, export data, schedule deletion |
| School detail | Profile, plan, students against cap, modules and overrides, domains, theme, template, invoices, tickets, audit log, support login |
| Plans and add-ons | Create plan versions with price, student cap, limits and modules |
| Modules | Stage, number of schools enabled, 30-day usage |
| Templates | Presets, and custom templates assigned to schools |
| Domains | Every custom domain with verification and certificate status |
| Billing | Invoices, payments, record offline payments, overdue list, revenue report |
| Support | Tickets from schools, replies, status |
| Staff | Platform staff, roles, two-factor status |
| Audit log | Every sensitive action across the platform |

Plan changes create a new plan version. Existing subscribers keep their old price until renewal.

## 15. Onboarding

**Self-serve path.**
1. A visitor clicks "Start free trial" on the marketing site.
2. They enter school name, their name, email, phone, state, city, board and approximate student count.
3. They pick a subdomain. It must be lowercase, unique and not a reserved word.
4. They verify their email.
5. The system creates the school in `trial` status and the admin account.
6. They land on `<slug>.yourbrand.com/app` and start the setup wizard.

**Setup wizard.**
1. Academic year. Default is April to March.
2. Classes and sections, with presets: Nursery, LKG, UKG, Class 1 to Class 12.
3. Subjects, with presets per board.
4. Student import from an Excel or CSV template. The import shows a row-by-row error report before saving anything.
5. Invite staff by email or share a join link.
6. Pick a website template and theme, then publish.

**Sales-assisted path.** You create the school in the console and the admin receives an invite. Both paths end in the same state.

**Trial end.**

| Day | State |
|---|---|
| Trial length, set in the console, 30 days by default | Full access |
| Trial ends without payment | Read-only for 14 days, export still works |
| 14 days later | Suspended. Data kept for 90 days |
| 90 days later | Data deleted, after a final email |

## 16. Plans, pricing and billing

**Pricing model.** Price per school per year, tiered by active student count. Monthly billing is optional. Prices are set in the console, never in code.

**Suggested starting bands.**

| Plan | Active students | Extra over lower plans |
|---|---|---|
| Starter | Up to 300 | All core school modules, preset website on subdomain, logo and primary colour |
| Growth | 301 to 1,000 | Custom domain, full theme editor |
| Pro | 1,001 to 3,000 | Priority support, more website pages |
| Enterprise | Above 3,000 | Custom price, set up by you |

**Add-ons.** Custom styling, custom template, extra website pages, and later SMS credits.

**Student cap.**
- Active students exclude alumni and students who have left.
- At 90 percent of the cap the admin sees a warning.
- The school can go 10 percent over the cap. After that, adding students is blocked until they upgrade.

**Changing plans.** An upgrade takes effect now and charges the price difference for the remaining days of the term. A downgrade takes effect at renewal.

**Collecting money.**
- Razorpay handles card, UPI and net banking. Annual payments use one-time orders. Auto-renewal uses Razorpay subscriptions.
- Many Indian schools pay by bank transfer or cheque. Your staff record these in the console against an invoice.
- Razorpay webhooks arrive at the console app on `/api/webhooks/razorpay`. That path is excluded from any console IP allowlist.
- Webhooks are idempotent. Each event ID is stored once and replays are ignored.

**Invoices.**
- Each invoice shows your GSTIN, the school's GSTIN if it has one, SAC code, taxable value and GST.
- GST splits into CGST and SGST when the school is in your state, otherwise IGST.
- Invoice numbers run in sequence per financial year, April to March.
- Your chartered accountant confirms the SAC code and rate before launch.

**Overdue.** Reminders go out 7 days before renewal, on the due date, and 7 days after. After 15 days unpaid the school becomes read-only, then follows the same steps as an ended trial in section 15.

## 17. School core modules (Phase 1)

The tutorial screens get real data in this order.

1. **Academic setup.** Academic years, classes, sections, subjects, class teachers.
2. **People.** Students, parents, teachers and staff. Student fields include admission number, class and section, date of birth, guardians, and optional APAAR ID. School profile includes optional UDISE+ code.
3. **Attendance.** Daily attendance per section, monthly reports, parent view.
4. **Fees.** Fee heads, fee structure per class per year, installments with due dates, concessions per student, late fee per installment, payment recording for cash, cheque, UPI and bank transfer, numbered PDF receipts, dues report.
5. **Exams and results.** Exams, marks entry, results view. Board-specific report cards come later.
6. **Timetable, assignments, announcements, events.** Wired to the existing screens.

**Aadhaar.** We do not store Aadhaar numbers. Indian law strictly limits who may store them. If schools insist later, only the last four digits are kept.

## 18. Background jobs

The worker container runs pg-boss jobs. Every job is idempotent and safe to retry.

| Job | Trigger |
|---|---|
| Send email | On demand |
| Student import | On upload |
| Domain verification | Every 10 minutes while pending |
| Usage counts | Nightly |
| Trial and overdue state changes | Nightly |
| Renewal reminders | Daily |
| Data deletion after churn | Daily |

## 19. Integrations

Every outside service sits behind an interface in `packages/integrations`, with a fake adapter for tests.

| Interface | First adapter | Later |
|---|---|---|
| `EmailSender` | Amazon SES Mumbai or a similar provider | Any SMTP provider |
| `PaymentGateway` | Razorpay | Razorpay Route for parent fee payments |
| `FileStorage` | S3-compatible bucket in an Indian region | Any S3-compatible store |
| `DnsResolver` | Node's DNS module | Not needed |
| `SmsSender` | Not built in year one | DLT-registered Indian SMS provider |

**SMS note.** Indian rules require each sender and message template to be registered on a DLT platform before sending. This is why SMS waits.

## 20. Mobile readiness

- All business logic lives in each feature's `service.ts` and takes a plain context object. It never imports React or Next.js.
- zod schemas in each feature's `inputs.ts` describe every input. A REST API later reuses them unchanged.
- The future API lives under `/api/v1` on each school host, so the school is resolved the same way.
- The auth layer must support bearer tokens later. The Phase 0 spike checks this.

## 21. Infrastructure on the VPS

**Servers.**

| Environment | Size to start | Notes |
|---|---|---|
| Production | 4 vCPU, 8 GB RAM, Indian region, reserved IP | Grow to 8 vCPU and 16 GB around 100 schools |
| Staging | 2 vCPU, 4 GB RAM | Uses `*.staging.yourbrand.com` |

**Containers on each server.** caddy, marketing, console, school, worker, postgres.

**Deploy.** GitHub Actions runs checks, builds Docker images and pushes them to GitHub's container registry. It then connects over SSH, runs migrations as a one-off container, and restarts the apps. Short restarts are acceptable for pilots. Blue-green deploys come later.

**Backups.**
- wal-g streams Postgres changes continuously and takes a nightly base backup to an off-site bucket in India.
- Backups are kept 30 days. Point-in-time restore is possible.
- A restore is tested every month on staging.
- The file bucket has versioning on.

**Monitoring.** Uptime checks from outside the VPS, error tracking with Sentry or GlitchTip, and structured container logs.

**Hardening.** SSH keys only, firewall open only on 80, 443 and SSH, automatic security updates, fail2ban, Postgres not reachable from the internet.

**Scaling path.** First move Postgres to its own server with a replica. Then run several school app containers behind Caddy, with a shared Next.js cache. Put the marketing site behind a CDN.

## 22. Security and compliance

- **Isolation.** RLS plus scoped services plus the isolation test suite in section 23.
- **Console.** Separate app, separate database role, mandatory two-factor login, optional IP allowlist.
- **Input.** zod validates every input at the boundary. Queries are parameterised only.
- **Uploads.** Type and size checks, private bucket, signed URLs.
- **Secrets.** Read only through `packages/config`, validated at startup, never logged.
- **Server actions.** Next.js checks that the request origin matches the host. Caddy keeps the original host header, and a test covers custom domains.
- **Audit log.** Append-only. School admins see their own school's log.

**DPDP Act 2023 and DPDP Rules 2025.**
- The school is the Data Fiduciary. We are its Data Processor. A data processing agreement is part of the terms each school accepts.
- The product records guardian consent, exports one student's or a whole school's data, and deletes data on request or after churn.
- A breach runbook tells us how to alert affected schools quickly.
- Data and backups stay in India.
- The rules give schools some exemptions for children's data used for education and safety. A lawyer confirms the exact duties before launch.

## 23. Testing strategy

- **Unit tests** for the entitlement resolver, theme validation, pricing and proration, invoice tax split, and domain verification.
- **Integration tests** run services against a real Postgres in Docker.
- **Isolation suite.** For every service, the test seeds school A and school B and proves that A can neither read nor change B's data. A second test runs a raw query with no school set and expects zero rows.
- **Browser tests** with Playwright cover signup, the setup wizard, adding a student, recording a fee, publishing the website, and opening two schools on two `*.localhost` hosts.
- **CI** runs typecheck, lint, tests and build on every push. A failing check blocks the deploy.

## 24. Roadmap

| Phase | Outcome | Done when |
|---|---|---|
| 0. Foundation | Monorepo, Postgres with RLS, school lookup by host, login, CSS-variable theme, working lint, CI | Two demo schools on `a.localhost` and `b.localhost` show their own name and colours, users log in, isolation tests pass |
| 1. School core | Section 17 modules on real data | A demo school can run a term: admit students, mark attendance, collect fees, publish results |
| 2. Console and production | Console from section 14, support tickets, production and staging VPS, backups | You onboard pilot schools yourself on subdomains and invoice them offline |
| 3. Self-serve and billing | Signup, setup wizard, plans, Razorpay, GST invoices, trial lifecycle | A school signs up, sets up and pays with no help from you |
| 4. Themes and websites | Theme editor, three templates, section editor, admission enquiries | A school publishes a themed website on its subdomain |
| 5. Custom domains | Domain connection flow and on-demand certificates | A school's own domain serves its website and panel over HTTPS |
| 6. Later | Mobile API and app, parent fee payments, SMS and WhatsApp, report cards, transport, library | Planned one by one |

Phase 0 starts by committing or discarding the current uncommitted edits, with your approval.

## 25. Risks

| Risk | Mitigation |
|---|---|
| The tutorial code licence does not allow resale | Check with the author before launch. The screens are simple enough to rebuild one by one if needed |
| The auth library cannot handle many domains | Phase 0 spike with a small fallback design ready |
| One VPS is a single point of failure | Continuous backups, monthly restore test, written recovery steps, reserved IP. Add a database replica as revenue grows |
| Phase 1 is large | Ship in the order in section 17 and pilot with the first four modules |
| Legal and tax details differ from these assumptions | A lawyer reviews DPDP duties and a chartered accountant reviews GST before Phase 3 |
