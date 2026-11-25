# Communication

How a school talks to its people: notices, messages, requests, the calendar, parent-teacher meetings, holidays, and the bell, push and email that carry all of it. This is the guide to what is **built**. The reasons and owner decisions are in [COMMUNICATION-PRD](COMMUNICATION-PRD.md); rules for people who change the code are in [COMMUNICATION-BUILD](COMMUNICATION-BUILD.md).

- [What it is](#what-it-is)
- [Who can do what](#who-can-do-what)
- [The rules that hold everywhere](#the-rules-that-hold-everywhere)
- [First day: setting a school up](#first-day-setting-a-school-up)
- [Notices](#notices)
- [Messages and safeguarding](#messages-and-safeguarding)
- [Requests](#requests)
- [Calendar](#calendar)
- [Meetings](#meetings)
- [Holidays](#holidays)
- [The bell, push and email](#the-bell-push-and-email)
- [Settings](#settings)
- [Jobs that run by themselves](#jobs-that-run-by-themselves)
- [For developers](#for-developers)
- [Going live](#going-live)
- [Limits and things to check](#limits-and-things-to-check)

## What it is

| Module | Folder | Plan | Screens |
|---|---|---|---|
| Notices (and circulars, urgent alerts) | `features/announcements` | every plan | `/app/announcements`, `/app/circulars` |
| Messages and Safeguarding | `features/messages` | every plan | `/app/messages`, `/app/safeguarding` |
| Requests | `features/requests` | Growth and up | `/app/requests` |
| Calendar | `features/events` | every plan | `/app/events` |
| Meetings | `features/meetings` | Growth and up | `/app/meetings` |
| Holidays | `features/attendance` | with attendance | `/app/attendance/holidays` |
| The kernel: bell, push, email, audiences, settings | `features/notifications` | every plan (core) | `/app/notifications`, `/app/settings/communication` |
| Mail, push, QR and PDF senders | `packages/integrations` | platform | none |

One **kernel** serves all of them. Every module picks its readers with the same audience rules, and every message to a person goes through one writer. A module never sends mail or push by itself.

A module outside the school's plan shows "not in your school's plan" with a way to the plans, never a blank page.

A **family** is the student login. Parent logins are retired. A student must be active to get anything new.

## Who can do what

| Role | Can |
|---|---|
| Admin | everything: approve, send urgent alerts, publish to the whole school (`announcements:whole`), review reported conversations, change settings |
| Accountant | write and publish notices to families, classes and students, message any family, work the requests inbox, see the calendar |
| Teacher | write and publish notices to their own classes, message families of their own students, run their meeting slots, add events |
| Student (the family login) | read notices and answer them, message teachers and the office, raise requests, book meetings, set own alerts |
| Support staff of Triakshi | never see private talk, answers, reports or private files (see [rule 4](#the-rules-that-hold-everywhere)) |

Ready-made custom roles (Settings → Roles): **Front office** (drafts notices, works requests, runs meetings), **Safeguarding lead** (reviews reported conversations, sees student details, nothing else) and **Coordinator** (writes, publishes and approves notices, runs events and the inbox).

Permissions:

| Module | Permissions |
|---|---|
| `announcements:` | read · draft · publish · approve · urgent · whole · manage |
| `messages:` | use · all · safeguard · manage |
| `requests:` | use · office · manage |
| `events:` | read · write · manage |
| `meetings:` | use · manage |
| `notifications:` | read · manage · delivery |

Everyone holds the baseline: `notices read`, `calendar read`, `messages use`, `requests use` and the bell. `announcements:write` and `notifications:send` no longer exist; migration 0012 turned old `write` grants into `draft` and `publish`.

## The rules that hold everywhere

1. **A person is told once.** Every audience is worked out to people (staff and families), each counted once, active only.
2. **Who may reach whom is checked on the server** (`features/notifications/policy.ts`). Saved groups are opened into their rules first, so a group cannot hide a wider rule.
   - Admin, or a role with `announcements:manage` or `announcements:whole`: free to reach anyone.
   - Teacher: free only for sections, subjects, students or classes they teach (every section of the class). Anything else goes to approval.
   - Accountant: free for family-side rules (all families, classes, sections, subjects, houses, routes, stops, students, fee dues). Staff-side rules go to approval.
   - Other staff (custom roles): the same, except "all families" and "everyone" go to approval.
   - Settings can add approval for families, the whole school and the website, and can make every teacher notice need approval.
   - Fee dues ("families with fees overdue") are for the fees team only, never a teacher. Urgent alerts need `announcements:urgent` (admin).
3. **Nothing is edited behind a person's back.** A published notice is corrected with a visible note and the old text kept, or withdrawn. A circular keeps its number.
4. **Private talk stays private.** Support sessions never see it. The school can review a conversation only with a typed reason; the review is logged and both sides are told. In a support session the message, request and safeguarding screens are closed, the bell shows "Private" for message, request and safety rows, notice answers, event answer lists and event files are refused, and nothing is marked seen.
5. **Quiet hours.** Push and email wait for 07:00 and skip Sundays by default (20:00 to 07:00). A person may set their own hours or an away date. Topics of priority 1 and 2 ignore quiet hours: urgent alerts, reported concerns, absence, cover duty and bus changes.
6. **Email has a daily budget** (`MAIL_DAILY_LIMIT`, shared by all schools). Urgent and safety mail may use 80% of it. Everything else may use 60%, and one school at most half of that. The last 20% is for sign-in codes and passwords. A mail that does not fit waits for 06:00 the next morning.
7. **A bad address stops being mailed** after a hard bounce or a spam report, for every school.
8. **A read-only school** can read and mark seen. Sending is refused with a plain sentence.
9. **Every date is IST.** Numbers restart each academic year.
10. **Every write is in the audit log.**

## First day: setting a school up

1. Academic year, classes and sections (Academics) and students with logins.
2. Open **Settings → Communication**: office name, quiet hours, who needs approval, the circular and request number formats. A format must contain both `{session}` (the academic year) and `{n}` (the running number), or it is refused.
3. Name a **safeguarding lead** (see [Going live](#going-live)) and add the **safety contacts** families can ring outside the school.
4. Add the year's **holidays**: Holidays → import a sheet, copy from last year, or add one by one. Closures tell people on their own.
5. Open **Requests** once. The school gets 11 ready categories (Academics, Fees, Transport, Library, Certificate, Attendance, Complaint, Safety concern, Suggestion, Health, Other). Set the owner and target days of each.
6. Set **message hours** and **limits** if the defaults do not suit.
7. Send a first notice to staff only, to check the bell, push and mail work.

## Notices

Three kinds: **notice**, **circular** (numbered, with a QR that opens a public "this is genuine" page) and **urgent alert**.

| State | Meaning |
|---|---|
| Draft | being written; edit freely |
| Waiting | sent for approval |
| Scheduled | goes out at a set time |
| Sending | the 30-second undo window |
| Published | live; can be corrected |
| Expired | past its end date |
| Withdrawn | taken back by the school |

- **Audience**: everyone, all staff, all families, classes, sections, houses, routes, subjects, roles, single people, fee dues (fees team only), or saved groups, with exclusions. The picker shows a live count, a sample and who cannot be reached, and why. A saved group is written out as its rules when the notice is sent for approval, scheduled or sent, so editing the group later changes nothing. Events freeze their people when they go live; meetings when they are saved.
- **Who may publish**: see rule 2. A teacher publishes freely to their own sections (a school may require approval). Wider than that goes to an approver, unless the person holds `announcements:whole`. An approver who is also the writer must type a reason. Admin can publish anywhere. An approver may open any circular, since the register lists them all.
- **Urgent alert**: `announcements:urgent` (admin) only; push and mail at once, through quiet hours. It cannot be in the fees category.
- **Undo**: 30 seconds after Publish. An undone circular uses no number.
- **Answers**: a notice can ask for an acknowledgement, consent (yes or no, with a reason), a poll or a form of up to 10 questions. People who have not answered are reminded two days before, on the last day and the day after. A teacher can nudge a person once a day.
- **Report**: who was reached, who has seen it, who has answered, who is unreachable. Staff see their own notices; a school can hide the "seen by" of staff.
- **Corrections**: edit after publishing shows a "corrected" line with a diff. A correction that widens the audience beyond what the writer may send alone is refused with a way to a new draft.
- **Website**: only a notice for everyone (or for the website alone) can go on the site, and only by someone who may publish. An approver or admin puts it live at once. For everyone else it needs approval, because **approval for the website is on by default**. Turning the website on later (a correction) needs the same right.
- **Files**: up to 10 files per notice, in the private store.
- **New joiners** get the live notices of their class for 30 days after they join, without a push.
- **Languages**: the school may add second languages to write a notice in.
- **Register**: the circulars register for one academic year downloads as a PDF (`/api/notices/register?session=2026-27`).
- **Retention**: no job removes notices. The keeping time in Settings applies to conversations only.

## Messages and safeguarding

**One conversation per family, per child and per staff member.** A family message is between the student login and school staff. Staff to staff is separate.

- **Who can start**: staff may message the families of their own students (the school may restrict teachers to the class teacher's own sections). Admins and accountants may message any family. Families may start a conversation if the school allows it, and always may reply.
- **Contacts** show why a person is in the list ("Maths", "Class teacher", "School office").
- **Message hours**: the school can set hours; a family writing outside them is told when the school will answer.
- **Saved replies**, files (up to 5, 15 MB each, PDF and pictures only; the bytes are checked), and a 10-minute window to remove a message.
- **Limits**: 20 messages a minute; 10 new conversations a day for a family, 60 for staff. Admins can restrict a person: **reply only** or **blocked**.
- **Bulk**: a staff member may write the same message to up to 1,000 families; each family gets its own private conversation.
- **Banner**: every conversation says "The school can review this conversation."
- **Reporting a concern**: any person can report a message or a conversation (unsafe, rude, inappropriate, pressure or money, other). The report goes to the **safeguarding leads**. A person named in a report never sees the report, the review or the log.
- **Review** (`/app/safeguarding`): a lead finds a conversation by student, staff or day, **types a reason**, and opens it. The files open for 8 hours after. Every open and export is in an append-only log. Both sides are told that a review happened.
- **Held conversations**: reporting a conversation or a message holds it. While held, no message can be deleted and no removal can be undone (the database refuses it). A sender can still remove their own message in the 10 minutes, but the original stays. Retention skips it. Only the reporter and the reviewers see the "held" mark, never the other side. A held conversation is released only when every report on it is closed as "no action". A report closed with action keeps the hold.
- **Conversation PDF**: exported for a review, logged.
- **Lapse**: when a teacher changes or a student leaves, the conversation closes and says why.
- **Retention**: a family conversation is removed once its student left the school and the keeping time (default 3 years) has passed. Admins are told 30 days before. A conversation with any report, any review or a hold is kept, and so is a request's conversation.

## Requests

One office inbox. A family asks, the right person answers. Requests use the messages core, so the answer is a normal conversation.

| State | Meaning |
|---|---|
| New | waiting in the team queue |
| Assigned | someone has it |
| In progress | being worked |
| Waiting | waiting for the family; **the clock stops** |
| Resolved | answered; the family may reopen for 14 days |
| Closed | done; resolved requests close by themselves after 7 days |

- **Categories** (office managers): name, owner (a person or a role such as class teacher), target days, up to 8 extra questions, and up to 5 escalation levels (who is told when it is late, after how many days).
- **Nature**: general, complaint about a person, or safety concern. A complaint is never shown to the person it is about; a safety concern goes only to the safeguarding leads.
- **Queue views**: Mine, Unassigned, Team, Overdue, All, with search and filters.
- **Staff write** an answer (the family sees it), an ask (the family sees it and the clock waits), or a note (staff only).
- **Family**: raises a request for one child, adds files, follows the timeline, replies, reopens, and gives a rating when it is closed.
- **Also**: assign, take, merge duplicates, change category, close with a reason.
- **Number**: `REQ/{session}/{n}` by default; set the format in Communication settings. Both `{session}` and `{n}` are required.
- **Report** (`/app/requests/report`): counts, median time to first answer, to resolve and to close, overdue, reopened, by category; a date range; downloads as CSV.

## Calendar

Events, trips, answers (RSVP), reminders and the layers of the school's year.

- **Types**: event, meeting, trip, competition, cultural, sports. The colour comes from the type.
- **Audience**: same picker as notices. People who join the audience later (a new student in the class) see the event too.
- **States**: draft, live, cancelled. A change or a cancel tells the people it concerns.
- **Repeat**: weekly, every two weeks or monthly up to 60 times, with the option to skip closed days. A change asks which dates it reaches: only this one, this and later, or all.
- **RSVP**: yes, maybe or no, with a capacity, guests, and a closing time. The organiser sees who has answered.
- **Reminders**: by default a day before and two hours before; the organiser may choose from a week before to 30 minutes. People who said no are not reminded.
- **Trips** can link to a consent notice; the notice and the event link to each other.
- **Layers** on the calendar: events, holidays, exams, homework due, special days, meetings, fee due dates. Each person sees only what concerns them.
- **Phone calendar**: every person has a private link to subscribe in their own calendar app. A public feed carries public events.
- **Public events** appear on the school website; the academic year calendar prints as a PDF.
- **Teachers** add events for their own classes; admin adds for anyone.

## Meetings

Parent-teacher meetings with time slots that families book.

| State | Meaning |
|---|---|
| Draft | being set up; families see nothing |
| Open | families can book; they are told |
| Closed | booking is over |
| Done | held |
| Cancelled | cancelled with a reason; families are told |

- **Setup**: title, audience (classes, sections, subjects, students, saved groups or houses; **never the fee dues group**, which the server refuses even inside a saved group), the booking window, how many times a family may book (1 to 20), and a window for each teacher with slot length, breaks, place or video link.
- **Slots** are built as a grid of back-to-back times. Changing a window shows exactly which free slots go and which booked families must be told, before saving.
- **Booking**: a family picks a time with each teacher of its child. It cannot clash with the family's other meetings, and a time taken a moment ago says so and offers another. Siblings book from one page. Staff may book for a family.
- **Waiting list**: a family can ask to be told when a time opens.
- **The day** (`/app/meetings/<id>`): each teacher's list in time order, marking came, late or missed, and a remark. Remarks stay with staff.
- **Reminders**: the day before and the hour before, to family and teacher. Booking closes and meetings finish by themselves.
- **Calendar**: booked times appear in the family's calendar layer and phone feed.

## Holidays

One list of closed days: `attendance_holidays`. The helper `closedDays` in `features/attendance/holidays.ts` is the only reader. Sundays are closed unless a **Working Sunday** opens them.

- **Kinds**: national, state, vacation, restricted, emergency closure, school holiday, working Sunday.
- **Applies to**: everyone, students only, or chosen classes.
- **Several days in one row** form a span (a vacation) and are edited together.
- **Told**: declaring a holiday notifies the people it concerns. A closure that starts today or tomorrow, and every emergency closure, goes as urgent.
- **Import**: from a sheet, or copy last year's list shifted to the new year, checked before saving.
- **Effects**: no attendance is marked on a closed day, leave days skip it, payroll does not count it as a working day, and meeting and event repeats can skip it.
- **A day with marks, approved leave or processed payroll** cannot be made a holiday by the importer; admins are told and decide.

## The bell, push and email

- **Bell**: a count and a list in two tabs, Needs action and Everything. It updates on its own while the page is open and pauses when hidden.
- **Topics**: about 30 kinds (urgent alert, notice, request update, fee due, holiday, meeting reminder…) in 10 groups. Nothing is sent without a topic. Some cannot be turned off (urgent, safety, absence).
- **Preferences** (`/app/notifications/preferences`): per group, push on or off and email off, instant or digest. Away until a date. A person manages their devices.
- **Push**: needs the VAPID keys. Without them the push option is hidden. A device with no success for a year is removed.
- **Email**: instant or a **digest** at 08:00 or 18:00, at the person's own hour. Every mail has an unsubscribe link and one-click header. Private text (messages, safeguarding) is never put in push or mail; people see "Open the app to read".
- **Cover duty** (`work.cover`, from the timetable): a teacher is told of a cover, or of a cancelled cover, at once. It ignores quiet hours and a person can turn it off.
- **Delivery screen** (admin, `/app/notifications/delivery`): sent, waiting, failed and skipped, with the reason; suppressed addresses can be freed once the office fixed them.
- **Priority**: urgent first, then safety, then answers needed, then the rest.

## Exports

| Download | Filters | Who |
|---|---|---|
| Requests list (CSV) | the same search, filters, view and page rules as the screen, every page; the same visibility | staff only, never a family |
| Request report (CSV) | the same date range as the report screen | office managers |
| Notice report (CSV) | all people of one notice: reached, opened, answer, push and email state, why not sent | staff who may read the report |
| Circulars register (PDF) | one academic year | staff |
| Event answers (CSV) | one event | staff who may change events |
| Meeting "did not come" (CSV) | one meeting | meeting staff |
| Conversation (PDF) | one conversation, for a review; logged | safeguarding leads |

## Settings

Settings → Communication (admin, `notifications:manage`):

| Setting | Default |
|---|---|
| Quiet hours | 20:00 to 07:00 |
| Quiet on Sundays | on |
| Teachers publish | freely to their own sections |
| Approval needed for non-admins: families, whole school, website | off, off, **on** |
| Families may start a conversation | on |
| Families may reply | on |
| Teachers message | families of classes they teach (or class teacher only) |
| Attachments | on |
| Show staff who has seen | on |
| Circular number (needs `{session}` and `{n}`) | `CIR/{session}/{n}` |
| Request number (needs `{session}` and `{n}`) | `REQ/{session}/{n}` |
| Second languages for notices | none |
| Channel defaults per group, for staff and for families | topic defaults |
| Keeping time for family conversations | 3 years (1 to 7) |
| Safety contacts | none (up to 10: name and phone) |
| Office name | School office |

Message hours and limits are on the Messages screens. Request categories are on the Requests settings. Notice categories, templates and groups are on the Notices settings.

## Jobs that run by themselves

| Job | When (IST) | Does |
|---|---|---|
| `comms.deliver` | every minute | sends push and email by priority, budget and quiet hours |
| `comms.publish-due` | every minute | sends scheduled notices; ends the 30-second undo |
| `comms.response-reminders` | 09:00, 17:00 | reminds only people who have not answered |
| `comms.late-joiners` | 02:30 | new students get the live notices of their class, without a push |
| `comms.expire` | 00:10 | expires and unpins notices |
| `comms.cleanup` | 03:30 | removes old read bells (90 days), unread (180), old deliveries, dead push devices |
| `notifications.digest` | 08:00, 18:00 | emails each person's digest at their own hour |
| `messages.lapse` | 02:40 | closes conversations whose teacher changed or student left |
| `messages.retention` | 03:50 | removes conversations past the keeping time; warns admins first |
| `requests.clock` | hourly 08:05 to 18:05 | marks overdue, escalates, closes resolved ones after 7 days |
| `events.reminders` | every 5 minutes | each reminder once; closes RSVPs |
| `events.late-joiners` | 02:35 | new students see the events of their class |
| `meetings.reminders` | every 15 minutes | day before, hour before, close and finish |
| `attendance.send-alerts` | every 10 minutes | absence alerts, held 30 minutes so a corrected mark never goes out |

## For developers

```
features/notifications  audience-rules · audience · policy · settings · quiet · writer · prefs · delivery · digest · push-rules · email-health · topics · jobs · ui/
features/announcements  notice-service · state · lifecycle · fan-out · response-service · report-service · feed-service · verify · circular-pdf · jobs · ui/
features/messages       core · service · batch · contact-rules · safeguard · leads · conversation-pdf · jobs · ui/
features/requests       service · workflow · reads · access · categories · routing · clock · report · csv · jobs · ui/
features/events         service · rsvp · repeat · people · feed · consent · ics · academic-pdf · jobs · ui/
features/meetings       service · booking · setup · schedule · rules · day · notices · jobs · ui/
features/attendance     holidays.ts (the only reader) · holiday-service · holiday-import
packages/integrations   mail · push · qr · pdf · sheet · storage
packages/ui/src/components/comm    shared states, tones and labels
apps/school/src/lib     joins the modules (calendar layers, verify lookups, shell, approvals)
apps/worker/src         registry.ts (schedules) · run-job.ts
```

- Modules never import each other, except that Requests imports Messages as its core. Everything shared lives in the kernel.
- Send with `NotificationWriter.insert`, never straight to mail or push. Give a `subject` so `seen` and `done` can close the row, and a `groupKey` when many rows should become one.
- Never copy audience code. Use `resolveAudience`, `describeAudience`, `audienceMatches` and `AudiencePolicy.reach`.
- The kernel table and the rules for changing this code are in [COMMUNICATION-BUILD](COMMUNICATION-BUILD.md).
- Migration 0012 holds hand-written data steps. Never regenerate it.
- Run one job once: `pnpm --filter @smw/worker job <name> '<json>'`. See [DEV](DEV.md).

Tests:

| What | Command |
|---|---|
| Unit | `pnpm test` (or `pnpm vitest run` in one folder) |
| Notices, messages, requests, calendar and meeting journeys | `npx playwright test comm- --project=desktop --workers=1` |
| Every link, every role, desktop and phone width | `npx playwright test comm-crawl --project=desktop --workers=3` |
| Accessibility | `npx playwright test comm-axe --project=desktop` |

Browser tests need the **production build** and a fresh database (`pnpm db:fresh`). Logins are in [DEV](DEV.md).

## Going live

1. **Back up the database.**
2. Run the migrations. **Migration 0012 holds hand-written data steps** (it moves old notices, conversations, holidays and notifications, and changes custom roles). Never regenerate it; apply the file as it is. Then run the SQL after-steps: `pnpm --filter @smw/db post-sql`.
3. Run `pnpm --filter @smw/school bootstrap`. It syncs the module list. The new modules **Requests** and **Meetings** join the existing plans, except Starter. A module the console took out of a plan stays out.
4. Set the environment values:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: make the pair with `npx web-push generate-vapid-keys`. Subject is `mailto:` and a contact address you own. Without the keys, push is hidden everywhere.
   - `MAIL_DAILY_LIMIT`: the most emails your provider allows per day, across all schools (default 300).
   - `MAIL_WEBHOOK_SECRET`: a long random value. Give the same value to your mail provider as the header `x-webhook-secret` (or a Bearer token) on its bounce and spam webhook to `/api/webhooks/mail`. It is not read from the URL. Without it the webhook refuses everything.
   - `DATA_KEY` (32 or more random characters): signs unsubscribe links and the circular QR. Without it in production, mail goes out with a "change your emails in Settings" line and circulars have no QR. **Keep a copy and never change it**; a change breaks every link already sent.
5. **Restart the worker** so it picks up the new schedules.
6. Use **your own sending domain** for `MAIL_FROM`, with SPF and DKIM set at your mail provider. A shared free address is for demos only; schools' mail lands in spam otherwise.
7. **Name a safeguarding lead** in every school: give a staff member the ready-made Safeguarding lead role. With none, every admin hears reports.
8. Tell each school's admins to open **Attendance → Holidays** and read the **"Check these holidays"** notices. The migration made a holiday of every old holiday event, except days that already had attendance, leave or payroll. Those are listed in the notice and left for the admin to add only if the school was closed.
9. Open Communication for one school and send a notice to staff only. Check the bell, a push and a mail.

## Limits and things to check

- Push works only over HTTPS and on phones that allow notifications. A person who blocked them gets the bell and mail only.
- Email depends on the provider's daily limit. If many schools send together, normal mail waits for the next morning. Raise `MAIL_DAILY_LIMIT` when the plan allows.
- A hard bounce stops mail to that address for every school until the office fixes it on the Delivery screen.
- A notice reaches a family through the student login. A student with no login is counted as unreachable and listed.
- Requests and Meetings are not in the Starter plan.
- There is no SMS and no WhatsApp. Safety contacts show the school's phone numbers.
- Safeguarding review is a school policy tool, not legal advice. Have the school's lead read the review screens before first use.
- The migration's holiday step needs a human look in schools that had holidays on days already marked.
- The keeping time deletes old family conversations. Set it with the school's own policy in mind.
