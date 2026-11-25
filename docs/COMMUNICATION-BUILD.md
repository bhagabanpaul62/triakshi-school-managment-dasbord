# Communication build contract (rules for anyone changing this code)

What the code does is in [COMMUNICATION](COMMUNICATION.md). The reasons are in [COMMUNICATION-PRD](COMMUNICATION-PRD.md). Feature rules: `features/README.md`. UI rules: "Screen rules" and "No dead ends" in [FINANCE-BUILD](FINANCE-BUILD.md); they apply word for word.

## Rules for every change
- OOP and DRY: services extend `SchoolService` / `CrudService`. One rule lives in one place. Never copy a helper that exists; search first. No dead code, no options nobody uses.
- Comments only for a why the code cannot show. Plain words in UI text. No em dashes in UI text.
- Permission check, school scope and audit on every write (`read` / `write`). A foreign id from input is looked up in the same transaction (RLS scopes it) before use.
- A family is the student login (`role: "student"`). `parent` logins are retired. A student must be `active` to receive anything new.
- Support sessions (`ctx.supportStaffId`) never see private talk, answers, reports or private files.
- A read-only school can read and mark seen. Sending is refused with a plain sentence.
- Files: key `uploadKey(schoolId, "private/<module>/<ownerId>", ...)`. Served only by the module's own checked route with a 60-second signed link, or by service methods. `/api/files` refuses `private/`.
- Every date shown is IST. Counts and times follow `packages/ui/src/lib/format.ts`.
- Lists: search, filters and pagination in the URL; empty (first use and no match differ); skeleton; error with retry; 375 px without sideways scroll.
- Toggles, stars, pins and read marks paint at once, save after, and snap back with a toast on failure. A destructive action offers undo when it can, otherwise confirms with the consequence in words.
- Private text (messages, reports) never goes into push or mail bodies; use `privateBody`.
- Keep migrations append-only. Migration 0012 has hand-written data steps: never regenerate it.
- Tests are vitest with the package's own database: `pnpm --filter <pkg> test` and `typecheck`. Browser tests are in [COMMUNICATION](COMMUNICATION.md#for-developers).

## Kernel (`features/notifications`)
Import paths are `@smw/feature-notifications/<file>`.

| File | Exports |
|---|---|
| `audience-rules.ts` | `Audience`, `audienceField`, `EVERYONE`, `isEveryone`, `Reached`, `personKey` |
| `topics.ts`, `constants.ts` | `TOPICS`, `TOPIC_GROUPS`, `topicOf`, `TopicKey`, `TopicGroup`, `CHANNELS`, `EMAIL_MODES`, `DELIVERY_STATES`, `chunks` |
| `audience.ts` | `resolveAudience(tx, audience): Reached[]` (active only, each person once; a student with no login has `userId` null) · `describeAudience` · `audiencePreview` (`families`, `staff`, `total`, `sample`, `unreachable`) · `audienceMatches(tx, audience, {userId, studentIds})` · `audienceOptions(tx, ctx)` for the picker · `expandGroups` (saved groups to rules) · `teacherSections` · `teachersOfStudent` · `canTargetFeeOverdue` · `AudienceService` (picker search). Optional tables are read through `to_regclass`. |
| `audience-groups.ts` | `CommGroupService` (saved groups), `groupRefusal` |
| `policy.ts` | `AudiencePolicy.reach(tx, ctx, audience, {feature, permission}): "free" \| "approval"`. Throws `ForbiddenError` when never allowed. Saved groups are expanded first. Admin or `manage`/`whole`/`all` is free (`whole` is the only way a non-admin reaches the whole school without approval). Settings `approvalFor.families`, `approvalFor.wholeSchool` and `teacherPublish` add approval for notices. A teacher is free only for sections, subjects, students or classes they teach (a class needs every one of its current sections), otherwise approval. An accountant is free for family-side rules; other custom roles for the same minus "all families". `messages` is refused for anyone but a teacher or a holder of `all`. `fee_overdue` needs the fees team and never a teacher. |
| `settings.ts` | `commSettingsSchema` (zod, every default inside; `circularFormat` and `requestFormat` must contain `{session}` and `{n}`; `approvalFor.website` defaults to on), `loadCommSettings(tx)`, `CommSettingsService` (`get` for readers, `save` for `notifications:manage`). A damaged row falls back to defaults. |
| `quiet.ts` | `quietUntil(now, {from, to, sundays, awayUntil?}): Date \| null`, pure, IST |
| `writer.ts` | `NotificationWriter.insert(tx, schoolId, rows)`. Row: `{userId, topic, title, body?, href?, subject?: {type, id}, groupKey?, action?, urgent?, privateBody?, deliverAfter?}`. A `groupKey` upserts (count + 1, newest text). Writes deliveries by preference, in chunks of 1000, people of this school only. `.seen(tx, schoolId, subject, userId?)` marks read and drops pending deliveries. `.done(...)` closes action rows. `.rewrite(...)` changes the text of rows about a subject. `.schoolDefaults(tx)`. |
| `channels.ts`, `prefs.ts` | `channelsFor(topic, person, school): {push, email}` (pure) · `effectiveGroup` · `priorityOf` · `tokenKey()` (from `DATA_KEY`; a fixed key only on a developer machine; none in production without `DATA_KEY`) · `PreferenceService` (mine, group, quiet, digest hour, language, away, devices, subscribe, `unsubscribeByToken`, `unsubscribeUrlFor`) |
| `delivery.ts` | `deliverDue({schoolId?, urgentOnly?, now?})` (priority, budget, quiet hours, suppression, leases, backoff) · `reserveMail` / `releaseMail` / `mailCap` (the daily budget) · `sendAccountMail` / `accountMailer` (sign-in mail, uses the reserved fifth) · `unsubscribeHeaders` · `DeliveryService` (admin screen) · `PushTestService` |
| `digest.ts` | `runDigest({hour, now?, schoolId?})` |
| `email-health.ts` | `suppress`, `unsuppress`, `suppressedAmong`, `isSuppressed`, `suppressEverywhere`, `mailWebhook` |
| `push-rules.ts` | `mayAskForPush` (when the prompt may show) |
| `service.ts` | `NotificationService`: `pulse`, `forUser`, `list`, `markRead` |
| `jobs.ts` | `comms.deliver`, `notifications.digest`, `comms.cleanup` |
| `ui/*` | `AudiencePicker` (client; props from `audienceOptions`; live preview action), `NotificationBell`, `PreferencesPanel`, `LivePulse` (polls `/api/pulse`, pauses when hidden, refreshes only when numbers change), settings and delivery pages |

Dependency rule: `notifications` imports no other feature. `announcements`, `messages`, `requests`, `events` and `meetings` never import each other, except that `requests` imports `messages` as its core. The app (`apps/school/src/lib`) joins them.

Holidays: `attendance_holidays` is the only store. `closedDays` in `features/attendance/holidays.ts` is the only reader (Sundays, class and student-only closures, working Sundays). Every other reader uses it.

## Permissions (`feature.ts` of each module)
- announcements: read [admin, accountant, teacher, student] · draft [admin, accountant, teacher] · publish [admin, accountant, teacher] · approve [admin] · urgent [admin] · whole [admin] · manage [admin]. `write` is gone. `whole` only lifts the approval for reaching everyone; the website has its own rule (`mayShowOnWebsite` in `features/announcements/base.ts`).
- messages: use [admin, accountant, teacher, student] · all [admin, accountant] · safeguard [admin] · manage [admin]
- requests: use [admin, accountant, teacher, student] · office [admin, accountant] · manage [admin]
- events: read [admin, accountant, teacher, student] · write [admin, teacher] · manage [admin]
- meetings: use [admin, teacher, student] · manage [admin]
- notifications: read [admin, accountant, teacher, student] · manage [admin] · delivery [admin]. `send` is gone.
- Baseline grants add: `announcements:read`, `events:read`, `requests:use` (with `notifications:read`, `messages:use`).
- A new permission needs a plain label in `features/settings/catalogue.ts` (module-specific words are checked first).

## Standing decisions
- Teachers publish freely to their own sections; a school can require approval.
- A notice goes on the website only if it is for everyone (or the website alone) and an approver or admin sends it, or the school turned website approval off. The default is on.
- Meetings never accept the fee dues group, also inside a saved group (`features/meetings/setup.ts`). Saved groups are written out as rules when a notice is submitted, scheduled or sent, when an event goes live and when a meeting is saved.
- A reported conversation is held (`held_at`): nothing in it is deleted or restored, and retention skips it. Retention removes only conversations of students who left.
- Topics with priority 1 or 2 ignore quiet hours. `work.cover` (priority 2) belongs to the timetable: `features/timetable` writes it, the kernel only defines it.
- Quiet hours 20:00 to 07:00 and Sundays.
- A review of a conversation needs a safeguarding lead and a typed reason; it is logged and both sides are told.
- Requests and Meetings are modules from the Growth plan up (`PLAN_DEFS` in `apps/school/scripts/catalog.mts` excludes them from Starter).
- Menu labels are Notices and Calendar; paths stay `/app/announcements` and `/app/events`.
- Run one job by hand: `pnpm --filter @smw/worker job <name> '<json>'` (for example `comms.publish-due '{"schoolId":"..."}'`; the JSON is optional). It uses the real database, so never point it at live data by accident.
- Jobs are registered in `apps/worker/src/registry.ts` (`SCHEDULES`) and in the feature's `jobs.ts`. A name in `SCHEDULES` without a handler is simply not scheduled. Handlers must be safe to run twice.
