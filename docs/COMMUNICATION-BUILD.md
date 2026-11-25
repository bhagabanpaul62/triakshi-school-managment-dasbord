# Communication build contract (rules for anyone changing this code)
Spec: docs/COMMUNICATION-PRD.md. Feature rules: features/README.md. UI rules: "Screen rules" and "No dead ends" in docs/FINANCE-BUILD.md; they apply word for word.

## Rules for every agent
- Edit only the files you own. Need a change elsewhere? Say so in your report; do not make it.
- Edit/Write for source. No git, no commits, no db:reset/fresh/seed/migrate/generate, no browser, no dev server, no `pnpm install`. Do not touch any schema.ts unless it is listed as yours.
- Tests: vitest with the package's own database (Postgres is up on 5433): `pnpm --filter <pkg> test` and `typecheck`. Print only failures.
- OOP and DRY: services extend SchoolService / CrudService. One rule lives in one place. Never copy a helper that exists; grep first. No dead code, no options nobody uses.
- Comments only for a why the code cannot show. Plain words in UI text. No em dashes in UI text.
- Permission check, school scope and audit on every write (`read`/`write`). Foreign ids from input are looked up in the same tx (RLS scopes them) before use.
- A family is the student login (`role: "student"`). `parent` logins are retired. Student status must be `active` to receive anything new.
- Support sessions (`ctx.supportStaffId`) never see private talk, answers, reports or private files.
- Read-only school: reading and seen marks work, sending is refused with a plain sentence.
- Files: key `uploadKey(schoolId, "private/<module>/<ownerId>", ...)`; served only by the module's own checked route with a 60-second signed link, or by FileStore-style service methods. `/api/files` refuses `private/`.
- Every date shown is IST. Counts and times follow packages/ui/src/lib/format.ts.
- Lists: search, filters, pagination in the URL, empty (first use and no match differ), skeleton, error with retry, 375 px without sideways scroll.
- Toggles, stars, pins, read marks: paint at once, save after, snap back with a toast on failure. Destructive: undo when possible, else confirm with the consequence in words.

## Kernel (features/notifications)
| File | API |
|---|---|
| `audience-rules.ts` (done) | `Audience`, `audienceField`, `EVERYONE`, `isEveryone`, `Reached`, `personKey` |
| `topics.ts`, `constants.ts` (done) | `TOPICS`, `TopicKey`, groups, channels |
| `audience.ts` | `resolveAudience(tx, audience): Promise<Reached[]>` (active only, each person once, staff and students; a student without a login is included with userId null) · `describeAudience(tx, audience): Promise<string>` · `audiencePreview(tx, audience): {families, staff, total, sample: string[], unreachable: {name,label,why}[]}` · `audienceMatches(tx, audience, {userId, studentIds})` · `audienceOptions(tx, ctx)` for the picker (classes in displayOrder, sections of the current year, houses, routes, subjects, roles, saved groups the person may use). Optional tables through `to_regclass`. |
| `policy.ts` | `AudiencePolicy.reach(tx, ctx, audience, {feature, permission}): Promise<"free" \| "approval">` (feature = the caller's own feature def), throws ForbiddenError when never allowed. Admin or `<module>:manage` → free. Teacher base: free only if every include rule is a section, subject, student or class-section they teach or are class teacher of, or a saved group made only of those; else "approval". Other staff holding the permission → free. `fee_overdue` needs fees:read or finance:read and never a teacher. |
| `settings.ts` | `commSettingsSchema` (zod, every default inside), `loadCommSettings(tx)`, `CommSettingsService` get/save (`notifications:manage`) |
| `quiet.ts` | pure: `quietUntil(now, {from,to,sundays,awayUntil?}): Date \| null` in IST |
| `writer.ts` | `NotificationWriter.insert(tx, schoolId, rows)`; row = `{userId, topic, title, body?, href?, subject?: {type,id}, groupKey?, action?, urgent?, privateBody?, deliverAfter?}`. Upserts on groupKey (count + 1, newest title/body/href), writes deliveries by preference, chunks of 1000, people of this school only. `.seen(tx, schoolId, subject, userId?)` marks read and drops pending deliveries. `.done(tx, schoolId, subject, userId?)` closes action rows. `.rewrite(tx, schoolId, subject, {title, body})`. |
| `prefs.ts` | `channelsFor(topic, pref, school): {push: boolean, email: EmailMode}` pure; `PreferenceService` mine/save/away/devices; unsubscribe by token |
| `delivery.ts` | `deliverDue({schoolId?, urgentOnly?, now?})` drains by priority, budget, quiet hours, suppression; `runDigest(hour)`; `DeliveryService` (admin screen); `planDeliveries` used by the writer |
| `push.ts` | `sendPush(sub, payload)`; hidden when VAPID keys are missing |
| `service.ts` | `NotificationService`: pulse (bell count), list(needs action / everything), markRead, emailed digest off; |
| `ui/*` | `AudiencePicker` (client; props from `audienceOptions`, live preview action), `NotificationBell`, `PreferencesPanel`, `LivePulse` (client; polls `/api/pulse`, pauses when hidden, calls router.refresh only when the numbers changed) |

Dependency rule: notifications imports no other feature. announcements, messages, requests, events, meetings never import each other (requests imports messages: its core). The app (apps/school/src/lib) joins them.

## Permissions (feature.ts of each module)
- announcements: read [admin, accountant, teacher, student] · draft [admin, accountant, teacher] · publish [admin, accountant, teacher] · approve [admin] · urgent [admin] · manage [admin]. `write` is gone.
- messages: use [admin, accountant, teacher, student] · all [admin, accountant] · safeguard [admin] · manage [admin]
- requests, meetings: as in their feature.ts (done)
- events: read [admin, accountant, teacher, student] · write [admin, teacher] · manage [admin]
- notifications: read [admin, accountant, teacher, student] · manage [admin] · delivery [admin]. `send` is gone.
- Baseline grants add: announcements:read, events:read, requests:use.

## Decisions (owner chose all defaults in PRD section 16)
Teachers publish freely to their own sections. Quiet hours 20:00-07:00 and Sundays. Review by a safeguarding lead with a typed reason, logged, both sides told. Requests and meetings are modules from the Growth plan up (PLAN_DEFS: excluded from starter). Menu labels Notices and Calendar; paths stay.
Holidays: attendance_holidays stays the only store. `closedDays` in features/attendance/holidays.ts is the only reader (Sundays, class and student-only closures, working Sundays); every other reader uses it.
