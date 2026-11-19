# Architecture and build contract

Read this before writing code. It is how every module in this repo is built: object-oriented services, DRY shared components, one pattern for everything. The product requirements are in [PRD.md](PRD.md).

**Reference implementation:** `features/announcements/` — copy its shape for every feature.

## 1. Layers

```
apps/school/src/app/**/page.tsx   one-line re-export of a feature page
features/<key>/ui/*.tsx            server pages + client widgets, built from @smw/ui
features/<key>/ui/actions.ts       "use server" — each action is one serviceAction(...) call
features/<key>/service.ts          classes extending SchoolService / CrudService. No React, no Next.js
features/<key>/inputs.ts           zod schemas built with the `f` helpers
features/<key>/schema.ts           Drizzle tables: schoolColumns() + tenant() on every table
packages/db                        withSchool(), withConsole(), platform tables, RLS helpers
packages/feature-kit               defineFeature, Ctx, errors, SchoolService, CrudService, PlatformService, f, testing
packages/runtime                   requireCtx(), actionCtx(), serviceAction(), getSchool(), cookies
packages/ui                        the Kinetic Monolith kit + shell (AppShell, PageHeader, DataTable, FormModal, ActionButton, toast)
packages/integrations              FileStorage, EmailSender, SmsSender, DnsResolver, PaymentGateway, PdfBuilder — interfaces + adapters
```

Rules (lint enforces the import ones):
- Packages never import features. Features never import apps.
- `service.ts`, `schema.ts`, `inputs.ts` never import React, Next.js, `@smw/ui` or `@smw/runtime`. The mobile API reuses them.
- A feature uses another feature only if it lists it in `requires` (and has it in package.json).
- No business logic in pages or actions. Pages read through services; actions call one service method.

## 2. A feature package

Scaffold with `node scripts/new-feature.mjs <key> <requires,comma,list>` (already done for every planned feature). Files:

| File | Default export / contents |
|---|---|
| `feature.ts` | `export default defineFeature({ key, name, description, stage, requires, core?, permissions, menu })` |
| `schema.ts` | tables |
| `inputs.ts` | zod input schemas |
| `service.ts` | service classes (one per aggregate) |
| `service.test.ts` | tests incl. the mandatory A-vs-B isolation test |
| `seed.ts` | `const seed: FeatureSeed = async (ctx, state) => {...}; export default seed;` |
| `jobs.ts` (optional) | `export default { "<key>.<job>": async (data) => {...} }` — run by the worker |
| `ui/*.tsx` | pages (`export default async function XPage(...)` + `export const metadata`) and client components |
| `ui/actions.ts` | server actions |

`pnpm gen` turns every `features/*/feature.ts` into the registry (`apps/school/src/generated/*`), links the package into the apps, and orders features by `requires`. Never edit generated files.

### Permissions and menu

```ts
permissions: { read: ["admin","teacher"], write: ["admin"], self: ["student","parent"] },
menu: [{ label: "Students", href: "/app/students", icon: "users", permission: "read", group: "people", order: 10 }],
```
Menu icons are names from `packages/ui/src/shell/icons.tsx` (`MenuIcon` type). Groups: main, academics, people, finance, communication, website, admin.

## 3. Database

- Every school-owned table: `...schoolColumns()` (id UUIDv7, school_id, created_at, updated_at) and `(t) => [...tenant(t, "<table>"), ...more indexes]`. `tenant()` adds the `school_id` index and the RLS policy. **No exceptions.**
- Money is `bigint(..., { mode: "number" })` in **paise**. Dates without time are `date(...)` strings `"YYYY-MM-DD"`. Timestamps `timestamp(..., { withTimezone: true })`.
- Reference tables of features you require with real foreign keys; anything else is a soft `uuid` column.
- Status/kind columns are `text(...).$type<union>()` with the union exported as a `const` array.
- Never write migrations by hand. `pnpm db:reset` rebuilds the local database from all schema files; production migrations are generated once with `pnpm --filter @smw/db generate`.
- Platform tables (schools, users, sessions, plans, modules, invoices, payments, subscriptions, support tickets, sequences, audit logs) live in `packages/db/src/schema/platform.ts`. Read them; do not change them without the orchestrator.
- `nextSequence(tx, schoolId, key)` gives gap-free numbers (receipts: key `receipt:2026-27`). `financialYear(date)` → `"2026-27"`.

## 4. Services (OOP)

```ts
export class StudentService extends CrudService<typeof students, Perm> {
  protected feature = studentsFeature;           // permissions + module key
  protected table = students;
  protected entityName = "Student";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = studentInput;
  protected updateSchema = studentInput.partial();
  protected searchColumns() { return [students.name, students.admissionNo]; }
  protected filterClauses(f) { return [f.sectionId ? eq(students.sectionId, f.sectionId) : undefined]; }
  protected async scopeClause(tx) { /* parents see only their children */ }
  protected async beforeCreate(tx, data) { /* cap check, create login */ return data; }

  async promote(input: unknown) {                 // custom operations use read()/write()
    const data = this.parse(promoteInput, input);
    return this.write("write", async (tx) => { ... }, (r) => ({ action: "promote", summary: `Promoted ${r.count} students` }));
  }
}
```

- `CrudService` gives `list(query)` (search, filters, sort, pagination → `Page<Row>`), `get(id)`, `create(input)`, `update(id, input)`, `remove(id)` — all permission-checked, RLS-scoped and audited. Override the hooks, do not copy the methods.
- For anything else extend `SchoolService` and use `this.read(perm, tx => …)` and `this.write(perm, tx => …, auditFn)`. Never call `withSchool` directly in a feature.
- `this.can(perm)` for UI decisions only; services always enforce.
- Throw the typed errors from `@smw/feature-kit` (`NotFoundError`, `ConflictError`, `LimitError`, `ValidationError`, `ForbiddenError`). Wrap unique-index inserts with `rethrowUnique(err, "Admission number already used")`.
- `ctx` (`Ctx`): `schoolId, userId, role, name, features, readOnly, supportStaffId`. Use `ctx.userId` to scope "my" data (teacher's sections, parent's children via `guardians.userId`, student via `students.userId`).
- Cross-feature reads: query the other feature's tables inside your own `this.read(...)` transaction (they are in the same RLS scope).
- Shared base classes are the place for repeated logic. If two of your services repeat code, add a protected method to a local base class in your feature.

### Inputs

Use the `f` helpers (they handle HTML form strings): `f.text(min,max,msg)`, `f.optText()`, `f.id()`, `f.optId()`, `f.int()`, `f.optInt()`, `f.paise()`, `f.date()`, `f.optDate()`, `f.bool()`, `f.phone()`, `f.optPhone()`, `f.optEmail()`, `f.list()`. Messages are human ("Pick a date"); a global zod error map covers the rest.

## 5. UI (Kinetic Monolith, dark)

Before building any screen read `~/.claude/skills/cool-dashboard-ui/SKILL.md` and `~/.claude/skills/cool-dashboard-ui/reference/DASHBOARD_DESIGN.md`. The kit is in `packages/ui`.

Imports:
```ts
import { Panel, Inset, IconChip, ArrowButton } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";          // also BigStat, StatGroup, DeltaChip, TrendArea, HatchedBars, SegmentedGauge, TickBar, SummaryRows, TabBar, EntityHeader, FactList/Fact, SegmentedControl, Modal…
import { ToneBadge, EntityList, ProgressList, WidgetEmptyState, LABEL, TONE } from "@smw/ui/widgets/WidgetPrimitives";
import { SegmentedBar } from "@smw/ui/widgets/PartsOfWhole";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal, FieldGrid, INPUT, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { shortDate, dateTime, relative, paise, initials } from "@smw/ui/format";
import { formatMoneyCompact } from "@smw/ui/money";
```

Patterns (DRY — do not hand-roll these):
- **List page** (server component): `requireCtx()` → `new XService(ctx).list(listQueryFrom(await searchParams))` → `PageHeader` + `DataTable` (columns as data, URL-driven search/filters/pagination) + `FormModal` for create + per-row `FormModal` (edit) and `ActionButton` (delete with confirm). See `features/announcements/ui/list-page.tsx`.
- **Record page**: `EntityHeader` with a `TabBar` (tab in `?tab=`), a KPI row of `StatCard`s from real numbers, then panels on the 12-column `PanelGrid` with a `FactList` "Details" panel beside the main panel.
- **Forms**: a `Field[]` array in `ui/fields.ts`, rendered by `FormModal` (or `FieldGrid` inside a custom client form). Money fields `type: "money"` (user types rupees; the action receives paise).
- **Bulk grids** (attendance, marks entry, timetable): a client component posting to one server action; `INPUT` class for inputs; optimistic state; one save button with the count in the footer fact.
- **Client components** get only plain data and server actions as props — never functions created in a server component.
- States for every panel: loading skeleton, empty (one line + the action), error (inline + retry), mobile (single column, KPI 2-up).
- Tokens only (`var(--ds-*)`, `white/[0.xx]`). No hex, no borders, no gradients, no glows. Tone only via `ToneBadge`/`TONE`. Dates via `shortDate` ("18 Nov"), money via `paise()` / `formatMoneyCompact`. Never show ids or ISO strings.
- Every icon-only button has `aria-label` and `title`.

## 6. Routes

`apps/school/src/app/app/(panel)/<path>/page.tsx` contains exactly one line:
```ts
export { default, metadata } from "@smw/feature-students/ui/list-page";
```
Dynamic segments work the same (`[id]/page.tsx` re-exports a page that takes `params`). The panel layout, sidebar and login are owned by the orchestrator — do not edit `apps/school/src/app/layout.tsx`, `(panel)/layout.tsx` or `src/lib/*`.

## 7. Actions

```ts
"use server";
import { formToObject, serviceAction } from "@smw/runtime";
export async function createStudent(fd: FormData) {
  return serviceAction(StudentService, (s) => s.create(formToObject(fd)), "Student added");
}
```
Files: `fd.get("file") as File` → `services().storage.put(uploadKey(ctx.schoolId, "students", file, "image"), Buffer.from(await file.arrayBuffer()), file.type)` inside a service method that takes `{ name, type, size, bytes }` (keep `File` out of the service).

## 8. Integrations

`services()` from `@smw/integrations` returns `storage` (S3; RustFS locally), `email` (SMTP; Mailpit locally at http://localhost:8025), `sms` (log only until DLT), `dns`, `payments` (Cashfree; fake without keys). Tests call `useServices({ storage: new MemoryStorage(), email: new MemoryEmailSender() })`. PDFs: `PdfBuilder.create()` → `.header() .facts() .table() .totals() .save()`.

## 9. Seeds

Seeds run per demo school in dependency order, as the admin, through your services (so they also exercise them). Share ids through `state`:

| Key | Set by | Shape |
|---|---|---|
| `state.yearId`, `state.termIds` | academics | string, string[] |
| `state.classes` | academics | `{ id, name, grade }[]` |
| `state.sections` | academics | `{ id, classId, name }[]` |
| `state.subjects` | academics | `{ id, name }[]` |
| `state.teachers` | staff | `{ userId, name }[]` |
| `state.students` | students | `{ id, name, classId, sectionId, userId, guardianUserId }[]` |
| `state.feeStructures` | fees | `{ id, classId }[]` |
| `state.exams` | exams | `{ id, name }[]` |

Realistic Indian data: names, ₹ amounts, April–March year, CBSE subjects. A demo school should look alive: ~8 classes × 1–2 sections, ~120 students, a month of attendance, fee payments with some dues, one exam with marks.

## 10. Tests

- `pnpm --filter @smw/feature-<key> test` — Vitest on a fresh database `smw_t_<key>` (platform tables + the features in `vitest.config.ts`; list every feature whose tables you touch).
- Fixtures: `createSchoolPair(["<key>", ...requires])` from `@smw/feature-kit/testing` → `{ a, b }`, each with `as.admin|teacher|student|parent|accountant` contexts.
- **Mandatory per service:** an isolation test (school B cannot list, get, update or delete A's rows) and permission tests (the wrong role gets `ForbiddenError`). Test the real business rules (fee totals to the paisa, attendance upsert, grade boundaries…).
- Also run `pnpm --filter @smw/feature-<key> typecheck` and `npx eslint features/<key>` before finishing.
- Never run `pnpm db:reset`, `db:fresh` or `db:seed` (the orchestrator owns the dev database), never `pnpm install` or add dependencies, never commit.
