# Website and admin build contract

What to build: [WEBSITE-ADMIN-PRD](WEBSITE-ADMIN-PRD.md). How every module is built: [ARCHITECTURE](ARCHITECTURE.md). UI: "Screen rules" and "No dead ends" in [FINANCE-BUILD](FINANCE-BUILD.md) and "Rules for every change" in [COMMUNICATION-BUILD](COMMUNICATION-BUILD.md). They apply word for word.

## Rules
- **Every line of your PRD section is in scope.** No "known limits" that are missing features, no "coming soon", no button that ends in a refusal. A method without a screen is not a feature; a screen without its error, empty, loading and phone states is not done.
- Smallest code that fully works. Reuse before writing: `@smw/ui` (kit, shell, `finance/*`, `comm/*`: SidePeek, Timeline, StatusTrack, SavedViews, SelectableTable, BulkBar, RecordPicker, FilesField, UndoBar, SplitBar, States), `parseSheet`, `uploadKey`, `assertFileContent`, `NotificationWriter`, `nextSequence`, `RateLimiter`, `services()`. Search the repo first.
- Services extend `SchoolService` / `CrudService` / `PlatformService`; permission, school scope and audit on every write. Foreign ids are looked up in the same transaction. Lock the row you read-then-write (`for("update")`).
- Every new page: a `page.tsx` one-line re-export, `loading.tsx` and `error.tsx` like the neighbours. Lists: search, filters and paging in the URL.
- Tests: each defect in PRD 2.3 of your area gets a test that fails without the fix; each service an isolation test (school B), permission tests, and its rules. Update tests that the new rules make wrong; never weaken one.
- UI text: plain words, no em dashes, IST dates via `@smw/ui/format`, no ids. No side-stripe cards, no pop-in animation, no gradients, tokens only, one filled primary button per view.
- Schema is done for every area (`packages/db/src/schema/platform.ts`, `features/*/schema.ts`). Need a column? Add it to your own feature's schema only; `platform.ts` changes go through the orchestrator. **Never generate or edit migrations, never run `db:*` scripts, never `pnpm install`, never commit, never run git write commands, never start servers or Playwright.**
- Run only your own checks: `pnpm --filter @smw/feature-<key> test`, `... typecheck`, `npx eslint <your files>`. Other agents are editing at the same time: a type error outside your files is not yours, do not touch it. Shared files (`service.ts` barrels, `apps/console/.../schools/[id]/page.tsx`, console nav) get only the smallest Edit.
- Never import a feature from a package. Cross-feature joins that need two features without `requires` live in `apps/school/src/app/...` (like `settings/role-actions.ts`).

## Shared pieces already in place
- `getSchool().primaryHost`: verified, unbroken main custom domain or null; `getSchool().row.redirectToPrimary`.
- `CrudService.update` writes `meta.changes` to the audit log: `{ field: [old, new] }`, hidden fields as `"(hidden)"`. Hand-written updates use `auditChanges(before, after)` from `@smw/feature-kit`.
- Topics: `enquiry.new`, `enquiry.followup`, `domain.problem`, `support.reply`, `account.security`, `export.ready`, `privacy.request`, `setup.task`.
- Job names and times: `apps/worker/src/registry.ts`. Website jobs go into `site-jobs.ts` or `enquiry-jobs.ts` (joined in `jobs.ts`).
- Permissions: PRD 12, in each `feature.ts`; labels in `features/settings/catalogue.ts`.
- Site content model: `packages/site-templates/src/content.ts` (six new sections, `hidden`, `noindex`, menu with children), `disclosure.ts`, `settings.ts`.
- Audit for jobs: `systemCtx(schoolId, features)`.

## File ownership
| Agent | Owns |
|---|---|
| A1 public site | `packages/site-templates/src/{render.tsx,styles.ts,pages.ts,starters.ts,icons.tsx}` and new render files; `features/website/{public-service.ts,public.test.ts}`, `features/website/ui/{site-page,home-page,sitemap,live-preview}.tsx`; `apps/school/src/app/(site)/**`, `apps/school/src/app/{page,robots,sitemap,not-found}.*` |
| A2 site admin | `packages/site-templates/src/{content,ops,editor,disclosure,settings}.ts`; `features/website/{site-service,theme-service,media-service,version-service,disclosure-service,site-settings-service,insights-service,site-jobs}.ts`, `inputs.ts` (site part), `base.ts`, `service.test.ts` (site part), `features/website/ui/` site, theme, media, versions, pages, disclosure, insights, settings and their actions; `apps/school/.../(panel)/{website,theme}/**` |
| A3 enquiries | `features/website/enquiry-*.ts`, `features/website/ui/enquir*`, `ui/public-actions.ts`, `packages/site-templates/src/{AdmissionForm,ContactForm}.tsx`, `features/website/seed.ts`, enquiry parts of `service.test.ts`; `apps/school/.../(panel)/enquiries/**`; the "Came from enquiry" line and prefill in `features/students/ui` |
| A4 domains | `features/domains/**`, `packages/integrations/src/dns.ts` and new `tls-probe.ts`, `packages/runtime/src/{host,primary}.ts`, `packages/platform/src/domains.ts`, console domains pages, `apps/school/.../(panel)/domains/**` |
| A5 settings: people | `features/settings/service.ts` (profile, users, roles), `features/settings/ui/` hub, school, users, roles, sign-ins, profile; `packages/auth/src/**` (login events only), `apps/school/src/lib/auth-actions.ts`, `apps/school/.../(panel)/settings/{page,layout,school,users,roles,sign-ins,modules}*` |
| A6 settings: data | `features/settings/{audit-service,export-service,privacy-service,jobs,zip}.ts` (moved out of `service.ts` first), their ui; `apps/school/.../(panel)/{audit,settings/{export,privacy,account,access}}/**`, `apps/school/src/app/api/exports/**` |
| A7 support | `features/support/**`, `packages/platform/src/{support-desk,support-login,notices}.ts`, console support and notices pages, console nav, `apps/school/.../(panel)/support/**`, `apps/school/src/app/api/support/**`, `apps/school/src/app/support-login/**`, notice strip in `(panel)/layout.tsx` |
| A8 setup | `features/setup/**`, `apps/school/src/app/app/setup/**`, `apps/school/.../(panel)/getting-started/**`, `apps/school/src/lib/menu.ts`, console setup status |
| A9 home | `features/home/**`, `apps/school/.../(panel)/{page,loading}.tsx` |
