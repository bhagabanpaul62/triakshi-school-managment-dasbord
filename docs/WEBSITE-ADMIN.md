# Website and admin

How it works now: the school website, admission enquiries, the school's own domain, settings, setup, support and home. Why: [WEBSITE-ADMIN-PRD](WEBSITE-ADMIN-PRD.md). Rules for changing it: [WEBSITE-ADMIN-BUILD](WEBSITE-ADMIN-BUILD.md).

| Area | Folder | Screens |
|---|---|---|
| Public site | `packages/site-templates`, `features/website` (`public-service.ts`, `ui/site-page.tsx`) | the school's address, `/news`, `/events`, `/privacy` |
| Website rooms | `features/website` (`site-`, `version-`, `media-`, `disclosure-`, `insights-`, `site-settings-service.ts`) | `/app/website` and `/edit /pages /media /disclosure /versions /insights /settings`, `/app/theme` |
| Enquiries | `features/website/enquiry-*.ts` | `/app/enquiries`, `/[id]`, `/[id]/admit`, `/reports`, `/settings`, `/import` |
| Domains | `features/domains` | `/app/domains`, `/app/domains/[id]`, console Domains |
| Settings | `features/settings` | `/app/settings/*`, `/app/audit`, `/app/profile`, `/app/profile/data` |
| Setup | `features/setup` | `/app/setup/*`, `/app/getting-started`, console Schools |
| Support | `features/support`, `packages/platform` | `/app/support`, `/new`, `/[id]`, `/help`, console Support and Notices |
| Home | `features/home` | `/app` |

## Who can do what
| Grant | Default | Means |
|---|---|---|
| `website:manage` | admin | edit the draft |
| `website:publish` | admin | publish, schedule, restore, take offline; gets "asked to publish" |
| `website:enquiries` | admin, accountant | work the enquiry desk |
| `website:pipeline` | admin | enquiry settings, import, export, assign, join, delete |
| `support:use` / `support:all` | admin, accountant, teacher / admin | own tickets / every ticket of the school |
| `domains:*`, `settings:*`, `setup:run` | admin only, never in a custom role | |

Seeing a student's name from an enquiry also needs `students:read`; admitting needs `students:write`.

## Rules that hold everywhere
- **Live is a frozen copy.** Visitors see `school_sites.published`. Every publish writes a `site_versions` row; a restore saves the draft first and changes nothing live.
- **Every draft write locks the row.** A section save carries the hash it was opened with; a stale one is refused with the other person's name.
- **Addresses do not stop.** Renaming a page writes a redirect (308). Redirects and 404 are decided before anything streams: never add a `loading.tsx` under `apps/school/src/app/(site)`, it turns both into 200.
- **Teachers are named on the site only after the school ticked "teachers checked".**
- **Colours on the site** come from `siteRoles()`: readable for any school colour. Use `--site-fill`, `--site-on-primary`, `--site-primary-text`, not `--site-primary`, for text and buttons.
- **A domain is the main one only with a working certificate.** Verified by TXT plus CNAME (A for a bare domain), rechecked daily. Missing TXT: warned on day 1 and 7, released on day 14. Pointing elsewhere for 30 days: released. "Could not ask DNS" changes nothing.
- **An enquiry has an owner and a next step**, or a close reason. Admitting creates the student, links both, and cannot make two students.
- **Audit entries carry old and new values** (`meta.changes`). Secrets, health, pay and private words are stored as "(hidden)". Erasing a person blanks their contact values in old entries through `erase_audit_contacts` and nothing else.
- **Support staff enter only when the school allows it** (always, for a time, never). "Never" ends an open visit at the next page. An owner's emergency entry is always told. A read-only support session changes nothing.
- **Home panels** declare the grants their data needs (`features/home/panels.ts`); one panel failing never breaks the page.
- Client files never import a schema, a service or the index of `@smw/feature-kit`: it pulls the database into the browser and only the production build notices. Server pages take `INPUT` and `TONE` from `@smw/ui/tone`. A chart with a `format` function needs its own client file.

## Jobs
| Job | When (IST) | Does |
|---|---|---|
| `website.publish-due` | every 5 min | scheduled publishes; waits while a school is read-only |
| `website.enquiry-clock` | hourly 8 to 18, Mon to Sat | follow-ups due, first call late |
| `website.enquiry-retention` | 04:15 | deletes after the school's keeping time (waitlist and offered after twice it) |
| `website.document-expiry` | 09:05 | disclosure documents; also prunes visit counts after 400 days |
| `domains.verify-pending`, `domains.recheck` | 10 min, 04:20 | see the domain rule |
| `settings.exports` | every minute | builds one export per school |
| `settings.cleanup` | 04:25 | export files after 7 days, sign-in events after 180 |
| `settings.privacy-due`, `settings.sign-in-watch` | 10:00, 10 min | reminders; bursts of failed sign-ins |
| `setup.snapshot` | 02:45 | setup picture for the console |
| `support.tell`, `support.clock` | every minute, hourly | tells replies and visits once; targets, reminders, auto-solve, close |

Run one by hand: `pnpm --filter @smw/worker job <name>`.

## For developers
- Tests: each package's own suite; `packages/db/test/migration-0013.test.ts`; browser: `site-journeys`, `admin-journeys` (K1 to K12 with `admin-home`), `admin-crawl`, `admin-axe`.
- Browser tests take `SCHOOL_PORT`, `CONSOLE_PORT`, `MARKETING_PORT`, `E2E_DB`, `E2E_DATABASE_URL`, so they can run on a copy with its own database and never touch another session's servers.
- Help articles are data in `features/support/articles.ts`; a test checks every link and bold menu name in them.

## Going live
1. Back up the database. Run migrations (0013 has hand-written data steps: never regenerate it), then `pnpm --filter @smw/db post-sql`.
2. Restart the worker (new jobs). Optional env: `SUPPORT_EMAIL`, `TRUSTED_PROXY_HOPS` (only if another proxy stands in front of Caddy).
3. Run `domains.recheck` once. Until then a domain that was live before is not used as the main address, because its certificate has not been seen.
4. Tell schools: support access is "always" as before and can be changed under Settings, Support access.

## Limits and things to check
- **Legal, not verified:** the 90 days for privacy requests, the consent words on the form, and the disclosure rows come from secondary sources. A lawyer and the current board circular decide.
- Real DNS, a real certificate check and a real S3 upload of an export were not run; tests use fakes.
- Support reply mail into an outside inbox, and drag and drop by touch, were not checked.
- Visits are counted in memory and saved every 10 seconds: a crash loses at most that.
- Two-step sign-in for schools, an online application form with payment, and sending WhatsApp or SMS are not part of this (PRD 17).
