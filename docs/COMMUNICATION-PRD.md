# PRD: School communication: notices, messages, requests, notifications, calendar and meetings

Status: **built** 2026-11-25 on branch `feat/communication` (approved the same day with every default in section 16). How it works now: [COMMUNICATION](COMMUNICATION.md).

Built differently from this plan:
- Requests and meetings are their own modules (`features/requests`, `features/meetings`), because plans switch modules on and off by key.
- Circular numbers are given when the notice really goes out, not when Publish is pressed, so an undo never leaves a gap.
- Fan-out starts right after the response and the minute job is the safety net; there is no separate `comms.fan-out` job.
- "Working Saturday" is not needed: only Sunday is a weekly off, and a working Sunday can be declared.
- Account mails (codes, passwords) are sent directly and counted; there is no "account" topic.
- 10 topic groups instead of 9. Default channels are set per group for staff and for families.
- Delivery lives at `/app/notifications/delivery` (`/app/settings/delivery` redirects).
- A role may publish to the whole school without approval only with the extra grant `announcements:whole`.
- While a concern is open, nobody is told that the conversation was read; otherwise both sides see that the school reviewed it.
- The PRD's `events:meetings` is `meetings:use` and `meetings:manage`.
Builds on [AUTH-PRD](AUTH-PRD.md) (roles, the student login is the family login), [PEOPLE-PRD](PEOPLE-PRD.md), [ACADEMICS-PRD](ACADEMICS-PRD.md) and [FINANCE-PRD](FINANCE-PRD.md).

## 1. Goal
A school reaches every family and staff member from here, **knows who got it, who saw it and who answered**, and every conversation between staff and a child is accountable. The office needs no WhatsApp group, paper circular register or second tool.

**The problem.** Today a notice is a title and a text box. Nobody can tell who read it. A message is private to two people, with no safe way to report it. Holidays live in two lists that do not agree. Section 2.3 lists the defects (22 in all: 16 reproduced by test, 3 seen on the production build, 3 read in code).

**Six rules everything follows**
1. **Published is permanent.** A published notice is corrected (new version, marked Updated) or withdrawn with a reason. Never deleted.
2. **Sent, delivered and seen are three different facts**, stored per person and shown separately.
3. **One read state.** Opening the thing clears its notification, its badge and its pending email, everywhere.
4. **No private channel between a member of staff and a child that the school cannot review**, and both sides are told so.
5. **People choose how they are told, except for safety.** Only urgent alerts, absence and account security override choices.
6. **One calendar.** A holiday is entered once; attendance, leave and payroll obey it.

### 1.1 Success measures
| Measure | How measured | Target (first term) | Stretch |
|---|---|---|---|
| Families reached: notice opened within 24 h | `notice_recipients.seen_at` | 70% | 85% |
| Consent answered before the due date | responses | 90% | 97% |
| Office time to chase one consent slip | journey J3, timed with 5 office users | under 2 min | under 1 min |
| Requests answered within the target time | request timeline | 80% | 95% |
| Families with push on (or a working email) | channels | 60% | 80% |
| Wrong-audience notices withdrawn | withdraw reason | under 1% | 0 |
| Notice text edited or deleted by someone without the right | audit log | 0 | 0 |
| Publishing to 3,000 people: request time | server log | under 1 s | under 0.4 s |

These targets are our hypotheses; we have no baseline because nothing is measured today. All are counts for the school's own delivery. **No ranking, score or behaviour profile of any child is built** (section 3.2, children's data).

### 1.2 Who it is for
| Person | Main need |
|---|---|
| Principal / admin | reach everyone in a minute, approve what goes out in the school's name, prove it was sent |
| Front office | circulars, consent follow-up, answer families from one shared inbox |
| Class teacher | tell own section, chase slips, run parent meetings, not be messaged at 11 pm |
| Subject teacher | message families of the students they teach |
| Accountant, librarian, transport in-charge | answer their own kind of request; notify only the right people |
| Safeguarding lead | receive reports, review with a reason, keep evidence |
| Family (student login) | see what matters first, answer once, ask the right person, book a meeting |
| Triakshi support | help set up, **never read private messages** |

## 2. What exists today (code read, probed and walked on 2026-11-25)

### 2.1 Size
| Module | Lines | Tests | Our estimate of a mature module |
|---|---|---|---|
| announcements | 255 | 10 | 20% |
| messages | 620 | 14 | 30% |
| notifications | 437 | 10 | 35% |
| events | 513 | 11 | 35% |

### 2.2 What works and stays
- School isolation (RLS), audit log, permission checks in services, notification written in the caller's transaction (`NotificationWriter`).
- Message membership rule: every query goes through `thread_members`; a stranger gets "not found", never "forbidden".
- `ContactRule`: listing contacts and checking recipients share one rule.
- Digest claims rows before sending, so two runs never send twice.
- Month calendar, inbox layout, bell, IST date helpers, public news and events on the school website.

### 2.3 Defects
**Proof:** P = reproduced by a throwaway test on a real database. W = seen on the production build. R = read in code.

| # | Defect | Proof |
|---|---|---|
| C3 | Deleting a notice leaves its notification, which opens an empty list. | P |
| C4 | Changing the audience after posting tells nobody new, and withdraws nothing from the old audience. | P |
| C5 | Changing from "one class" to "everyone" keeps the old class id. | P |
| C6 | A student who has **left** still sees new notices of their old class (and class events). | P (events: R) |
| C7 | Posting to a school with 11,000 logins **fails**: the insert exceeds Postgres' 65,534 parameters. The notice is lost. | P |
| C8 | The class picker sorts by name: Class 10 before Class 2. | P |
| C9 | Opening a message clears the Messages badge but **not the bell** (badge 0, bell 1). | P |
| C10 | The digest then **emails a message that was already read**. | P |
| C11 | "Mark all read" says "You are all caught up" while the bell still shows 20 and every row keeps its dot. The client copies props into state once. | W |
| C12 | The inbox shows 100 conversations, the badge counts all of them (105 shown on the badge). The other 5 cannot be opened or cleared. | P |
| C13 | No limit on sending: 200 messages in 0.6 s, 200 notifications to the teacher. | P |
| C15 | Nobody at the school can review, report or stop a staff–student conversation. | P (admin gets "not found") |
| C16 | A message to a disabled login is accepted in silence. | P |
| C17 | When a login is deleted, the conversation shows "With" nobody. | P |
| C18 | **Two holiday lists.** The calendar shows Diwali break for 8 days while Attendance → Holidays is empty. Seven places in four files read only the second list, so attendance can be marked, and leave and pay are counted, on those days. | W + R |
| C21 | Events notify nobody: not when created, changed, or cancelled. Events list opens with August first. | W + R |
| C22 | The bell and conversations never refresh until a full page load. | R (bell seen in C11) |

Also wrong: `docs/API.md` says messages return 501 (they work, read only); "Students" and "Families" are two audiences that reach the same logins; the Holidays page header breaks at 800 px ("Add holida" cut off); notice titles cannot be opened; 20 near-identical "Approval needed" rows bury a parent's message.

Five more defects (C1, C2, C14, C19, C20) were about who may see or change what. They were fixed first, with tests, and their details are not kept in this public file.

### 2.4 Not there at all
Drafts, approval, scheduling, expiry, attachments, sections or individuals as audience, read receipts, acknowledgement, consent slips, circular numbers, printing, resend, urgent alerts, templates, second language, quiet hours, report/block, office inbox, requests, message attachments, search, push, per-topic preferences, RSVP, reminders, recurrence, calendar subscription, parent-teacher meeting booking.

## 3. The bar

### 3.1 What mature products do
**D** = we read the vendor's own page. **S** = seen only in a search snippet. **J** = our judgement, no source.

| Capability | Product and behaviour | | We take |
|---|---|---|---|
| Approval before families see it | Brightwheel: staff posts stay staff-only until an admin approves; parents get the push only then | D | approval is a permission, push only after release |
| Seen list + renotify only the unread | Bloomz viewed list, "Renotify", delivery report by channel, CSV | S | all of it; delivered and viewed kept apart |
| Acknowledgement with reminders and status per family | SchoolMyKids (India), Schoolites (India: targeting, confirmation, print, archive) | S / D | consent and acknowledgement, auto reminders, print |
| Urgent alert overrides preferences, all channels at once | ParentSquare | D | urgent is the only notice that does |
| Admin can read all messages; flagged list; shared "reviewed" mark | TalkingPoints; ParentSquare transcripts | D | review **with a reason, logged**, not open browsing |
| Office hours delay, do not refuse; sender is warned | Remind office hours; ClassDojo quiet hours and away banner; read receipts also held at night | S | school quiet hours + personal hours |
| Preferences Off / Instant / Digest; alerts always instant | ParentSquare; evening digest | S | same model per topic group |
| Meeting slots: length, break, max per slot, private, cutoff; changing hours drops bookings | Bloomz | D | all; the edit warns and lists who is affected |
| Complaint tiers with owner, status, escalation, reopen, days to resolve | MyClassboard L1 → L2 → L3 | D | Requests (6.3) |
| Circular, diary, complaint tracking, event calendar, chat as modules | Skolaro, Edunext | D (lists only) | parity |
| PTM record with concerns and remarks | Edunext, MyClassboard | D / S | record + booking |
| Event reminders set ahead | Fedena, Edunext | S / D | reminders |
| Calendar subscription (iCal) | Bloomz | S | per-person secret feed |
| Inbox with a priority tab, grouped, read sync | Linear, GitHub | D | Needs action / Everything |

**What Indian users complain about** (few real reviews): alerts that come back after being cleared, notices hours late (Vawsum, S), no notification despite settings on (ParentsAlarm, S), too many messages (ParentSquare, S). C9–C11 are exactly the first; 6.5 answers the rest.
We found no public detail on circular numbering, approval chains or chat timings for the Indian products. Those parts are **J**.

### 3.2 Rules that shape the product
Not legal advice. Gazette and statute texts could not be opened; most rows rest on secondary sources.

| Rule | What we found | Confidence | What we do |
|---|---|---|---|
| DPDP Rules 2025 | notified 13 Nov 2025, core duties 18 months later (about 13 May 2027, our arithmetic) | medium | build to it now |
| Children's data | verifiable parental consent; ban on tracking, behavioural monitoring, targeted ads. Schools reported as partly exempt; exact scope not confirmed | low | read receipts are per notice and for delivery only. No engagement scores, no profiling, no ads |
| Retention | logs at least 1 year reported; erasure needs prior notice | low | retention settings with a 1-year floor, legal hold |
| Breach | tell affected people and the Board; 72 h detailed report reported | medium | urgent alert can be sent to all families with a breach template |
| POCSO s.19, s.21 | anyone who knows of an offence must report; failing is punishable | medium | "Report a concern", evidence kept, reports cannot be closed by the person reported |
| School Safety Guidelines 2021 | management accountable; audit trail expected | medium | review log |
| Teacher–student private chat | **no CBSE rule found** | none | our own rule 4 |
| SMS (TRAI DLT) | registered, pre-tagged templates | medium | SMS stays off; adapter ready |
| WhatsApp | named opt-in required | high | opt-in record is stored; sending stays off |
| Email | Gmail: aligned SPF/DKIM/DMARC; one-click unsubscribe at 5,000/day. `@gmail.com` sender through a relay cannot align (our reasoning) | high / J | own sending domain is an owner task; we add the headers |
| RTE | 200 / 220 working days | medium | the calendar counts and warns, never blocks |

## 4. Module map (reuse first)

| Module | Owns | State |
|---|---|---|
| `notifications` (core) | topics, preferences, channels, deliveries, digest, push, audience resolver, quiet hours | extend |
| `announcements` (shown as **Notices**) | notices, circular numbers, approval, recipients, responses | rebuild on the same table |
| `messages` | conversations, office inbox, requests, safeguarding | extend |
| `events` (shown as **Calendar**) | events, RSVP, recurrence, reminders, iCal, parent-teacher meetings | extend |
| `attendance` | **the one holiday store** (`attendance_holidays`) | small addition |
| `apps/school/src/lib` | joins: calendar layers, request owners, topic list | new files |

**Dependency rule:** every module may import `notifications`. `notifications` imports none; it reads classes, sections, houses, routes and staff by raw SQL with `to_regclass`, as today. `announcements`, `messages` and `events` do not import each other. The app joins them.

**What we reuse**
| Need | Reuse |
|---|---|
| Notify inside a transaction | `NotificationWriter` (signature kept, optional fields added) so the 26 calls in 19 files outside it keep compiling |
| Gap-free circular numbers | `nextSequence` |
| PDF on letterhead, Indian scripts, QR | `PdfBuilder`, fonts, `qr` |
| Files | `uploadKey`, `UPLOAD_RULES`, storage, `Field.asJpeg` |
| Approvals screen pattern | finance approvals layout; **not** its table (money rules differ) |
| Scheduled publish | assignments and timetable `publish-due` jobs |
| Email wrapper | `emailHtml`, `trySend`; the 11 private copies of `esc()` become one, and module mail loops move onto deliveries where they are notices |
| People search, side panel, states, timeline | `RecordPicker`, `SidePeek`, `StatusTrack`, `Timeline`, `SelectableTable`, `BulkBar`, `States` |
| Import of holidays | `parseSheet` |
| Queue | pg-boss in the worker |

## 5. How it flows

```
author ─▶ DRAFT ─▶ (approval) ─▶ (schedule) ─▶ PUBLISH ─▶ recipients snapshot
                                                  │
              ┌───────────────────────────────────┤
              ▼                                   ▼
      notification (one per person)        deliveries (one per person and channel)
              │  read state                 app · push · email · sms(off) · whatsapp(off)
              ▼                                   ▼
      seen ─▶ response (ack / consent / form)   sent · delivered · failed · skipped(why)
                        └────────▶ REPORT: not reached · not opened · not answered ─▶ nudge only those
```

### 5.1 States
| Thing | States |
|---|---|
| Notice | draft → waiting → (changes asked → draft) → scheduled → sending (30 s undo) → published → expired. From published: corrected (version +1), withdrawn. Drafts can be deleted, nothing else |
| Recipient | reached / not reached; seen; answered / declined / late / answered on paper |
| Delivery | pending → sent → delivered, or failed (will retry), bounced, skipped with a reason, deferred (quota) |
| Conversation | open → closed (left school, no longer teaches); restricted (reply only); held (report) |
| Message | sent → removed by sender (10 min) or by safeguarding; the original is kept |
| Request | new → assigned → in progress → waiting for family → resolved → closed; reopened; escalated |
| Report | new → under review → action taken / no action; holds evidence |
| Event | draft → scheduled → live → past; changed; cancelled |
| RSVP | no answer → yes / maybe / no; waiting list when full |
| Meeting slot | open → booked → done / missed / cancelled |
| Holiday | planned → past; emergency closure (same day) |

### 5.2 Audience: one model for notices, events, meetings and forms
An audience is a list of **include** rules minus **exclude** rules.

| Rule | Reaches | Source |
|---|---|---|
| Everyone | all active staff and families | users |
| All families · all staff | | users |
| Class · section | families of active students in it | academics |
| Subject group (elective) | families of students who take it | academics |
| House · transport route · stop | | academics, transport |
| Staff by role or custom role | | settings |
| Teachers of a class or section | class and subject teachers | academics |
| Fee overdue (accountant and admin only) | families with a due older than N days. **The list is never shown to a teacher** | fees |
| Saved group | hand-picked people, or rules | new |
| Student · staff member | one person | |

- The picker shows a live count and the first names: "412 families, 38 staff", plus **who will not be reached and why** (no login, login disabled, no email and no push).
- At publish the list is **frozen** into recipients. A later class change never rewrites who was told.
- **New joiners** of a class get its live (not expired) notices silently, by a nightly job, until 30 days after publish.
- **Siblings:** each child's login gets its own copy (consent is per child); the email is one per address and names the children.
- "Students" and "Families" become **Families**. Old rows are mapped.
- Who may target what: section 8.

## 6. Module by module
Priority: **M** must, **S** should. Both are built in this run. **L** is out of this build and listed in section 14.

### 6.1 Notices (`features/announcements`)

**Stories**
- As a principal I publish to the whole school and see in one screen who has not opened it, so I can act before the event.
- As a class teacher I collect trip consent from 40 families without paper, and the 3 families without phones are recorded too.
- As an office clerk I prepare a circular; it goes out only after the principal approves.
- As a family I see first what needs my answer, and I answer once.

| # | Requirement | P |
|---|---|---|
| N1 | **Types:** Notice; Circular (gap-free number per school and session, e.g. `CIR/2026-27/014`, format set by the school); Urgent alert | M |
| N2 | **Categories** (General, Academic, Exam, Fees, Holiday, Event, Transport, Health, Staff): editable, with a chip tone | M |
| N3 | **Editor:** title, body with bold, italic, lists, links and headings stored as a safe markdown subset; no HTML. Autosaved draft every 3 s; leaving warns; a failed save keeps the text | M |
| N4 | **Second language:** title and body again in a language the school turns on; the family sees their chosen language with a switch. No machine translation | S |
| N5 | **Attachments:** up to 10 (PDF, image, Word, Excel; 15 MB each), reorder, preview; opened through a checked route (C20) | M |
| N6 | **Audience** by 5.2 with live count and unreachable list | M |
| N7 | **Who may publish:** by permission and reach (section 8). Beyond reach → Send for approval, showing who will approve | M |
| N8 | **Approval:** approve, approve and edit (shows the difference), ask for changes with a note, reject. Author is told. An author never approves their own, except a school's only approver, with a reason on record | M |
| N9 | **Schedule** date and time (IST); list of scheduled; edit, send now, unschedule. A schedule inside quiet hours warns | M |
| N10 | **Undo:** 30 seconds after Publish, nothing has left yet. Urgent alerts skip this and ask to confirm by showing the count | M |
| N11 | **Expiry and pin until:** pinned notices unpin by themselves; expired ones move to Archive | M |
| N12 | **Correct:** new version, stamp "Updated 25 Nov, 4:10 pm", old versions kept and visible to staff; choice to notify again. Audience changes notify only the people added; people removed lose it with a note | M |
| N13 | **Withdraw** with a reason: recipients see "Withdrawn by the school", the text is hidden, the notification is rewritten (fixes C3, C4) | M |
| N14 | **Response type:** none · I have read this · consent yes/no · choice (poll) · short form (up to 10 questions: text, number, date, choice, yes/no, file) | M |
| N15 | **Responses** are per child, record the name and relation of the adult who answered (the login is shared by the family), time and IP; changeable until the due date; then locked. Consent "No" may ask for a reason | M |
| N16 | **Reminders** to people who have not answered: 2 days before, on the day, after (each can be turned off); manual Nudge at most once a day per person | M |
| N17 | **Paper answers:** staff record an answer "on paper", with an optional photo of the slip; marked as such everywhere | M |
| N18 | **Report:** funnel (recipients, reached, seen, answered yes / no / none) as one bar; table per person with section, channel result and reason, seen time, answer; filters; by-section summary; CSV; printable sign sheet for those not reached | M |
| N19 | **Resend** to not reached or not seen only | M |
| N20 | **Circular PDF** on the school's letterhead with number, date, category, signature block, QR that opens a page saying "this circular is genuine" and, only if public, its text | M |
| N21 | **Circular register:** all numbers of a session, including withdrawn, printable | S |
| N22 | **Website:** a separate choice, allowed only when the audience is Everyone or Website only, and only with `publish`. `publicNews` enforces it (fixes C1) | M |
| N23 | **Templates:** school's own plus ready-made (holiday, PTM, fee date, exam, trip consent, weather closure, lost property, data breach); Duplicate any notice | M |
| N24 | **Family feed:** Needs your answer first, then pinned, then newest; unread marker; category filter; search; Archive. Opening marks seen | M |
| N25 | **Ask about this:** starts a request to the notice's owner with the notice attached | S |
| N26 | **Urgent alert:** all channels at once, ignores quiet hours and preferences, red banner in the panel until opened, "I am safe / received" answer on by default, live count for the sender. Only `urgent` holders. Cannot be used for fees | M |
| N27 | **Search and filters** for staff: category, state, author, audience, date, needs answer | M |
| N28 | **Deleted or renamed class, student, staff:** the frozen recipients and names stay readable | M |

### 6.2 Messages (`features/messages`)

**Stories**
- As a parent I message my child's maths teacher, and I know the school can review it.
- As a teacher I write to all 40 families of my section in one go and each answer comes back privately.
- As a teacher I am not pinged at night and families know when I will answer.

| # | Requirement | P |
|---|---|---|
| M1 | **Kinds:** about a student (staff ↔ family); staff (direct or group); request (6.3). A conversation with a family always names the child. Old rows are mapped; old groups with more than one family become read only | M |
| M2 | **Never two families in one conversation.** "Message families" (a section, a subject group, chosen students) creates one private conversation per family; the sender gets one parent row with "32 seen, 9 replied" | M |
| M3 | **Who may start:** family → class teacher, subject teachers, the office (as today). Staff → families of students they teach, or anyone with `messages:all`. Staff → any staff. Students never to students | M |
| M4 | **School switches:** families may start (on), families may reply (on), attachments (on), teacher may message families (all they teach / class teacher only) | M |
| M5 | **Lapse:** when a teacher stops teaching the student, or the student leaves, the conversation closes to read only and says why. An admin may move it to the new teacher | M |
| M6 | **Quiet hours** (school default 8 pm to 7 am and Sundays) and **my hours** per staff member, and Away with a date and a short text. Sending is allowed; the other side is told "Will be delivered at 7:00 am"; the app shows it at once, push and email wait. "Seen" marks also wait | M |
| M7 | **Seen:** the sender sees Delivered / Seen for staff ↔ family; a school switch hides staff's Seen from families | M |
| M8 | **Attachments:** image or PDF, 5 per message, 15 MB each, checked per conversation, image preview, download | M |
| M9 | **Remove own message** within 10 minutes; leaves "Message removed". The original stays for safeguarding. No editing | M |
| M10 | **Report a concern** on any message or conversation, by either side, with a category and note. Goes to safeguarding leads; never to a person named in it. The reporter sees the state. Held: nothing in it can be removed and retention stops | M |
| M11 | **Review:** safeguarding lead opens a reported conversation, or another one **after typing a reason**; every opening is logged with who, when, why, and shown in a review log that admins cannot edit. A banner in every staff–family conversation says "The school can review this conversation" | M |
| M12 | **Stop:** restrict a family login or a staff member to reply-only or no messages until a date, with a reason; they are told | M |
| M13 | **Support sessions** of Triakshi can open no conversation, request text, report or private file (fixes C14) | M |
| M14 | **Limits:** 20 messages a minute, 10 new conversations a day for a family, 60 a day for staff outside Message families. Refusal says when to try again (fixes C13) | M |
| M15 | **Inbox:** keyset pages, unread and archived filters, by student, search in own messages, pin, mute, archive, mark unread (fixes C12) | M |
| M16 | **Live:** an open conversation refreshes every 10 s while visible, other pages every 60 s, paused when hidden; new messages are announced politely to screen readers (`role="log"`) (fixes C22) | M |
| M17 | **Failure:** a message that cannot be sent stays in the box with Retry; never lost; double press sends once (client id, unique) | M |
| M18 | **Disabled or deleted login:** the composer says it cannot be delivered and who to contact; names stay as they were (fixes C16, C17) | M |
| M19 | **Saved replies** per person and shared ones for the office | S |
| M20 | **Export one conversation** to PDF: a participant their own; safeguarding any, with reason | S |
| M21 | **School export** leaves messages out unless an admin ticks it with a reason; a student's export includes that student's conversations (fixes C19) | M |
| M22 | **Retention:** school sets 1 to 7 years after the student leaves (default 3); a job removes older ones with 30 days' notice to admins; held ones stay | S |

### 6.3 Requests: the office inbox (`features/messages`, same tables)
A family should not need to know who to ask. A request is a conversation with an owner, a state and a clock.

| # | Requirement | P |
|---|---|---|
| R1 | **Categories** with default owner (role or person), target days and optional form fields: Academics, Fees, Transport, Library, Certificate, Attendance, Complaint, Suggestion, Health, Other. Editable | M |
| R2 | **Number** per session (`REQ/2026-27/0123`), subject, child, details, files, linked notice or receipt | M |
| R3 | **Queue** for staff: mine, unassigned, team, overdue, all; columns: number, child, category, state, owner, age, next due. Assign, claim, change category, merge duplicates | M |
| R4 | **Answer as "School office (Anita)"**; internal notes never visible to the family | M |
| R5 | **States** by 5.1; waiting for family stops the clock; auto-close 7 days after resolved, with a notice | M |
| R6 | **Escalation:** past target → next level (class teacher → coordinator → principal, per category) with a notification; the family may escalate only after Resolved, with a reason (MyClassboard) | M |
| R7 | **Reopen** within 14 days by the family; later, by staff | M |
| R8 | **Complaint about a person:** that person cannot see or own it; safety category goes straight to safeguarding | M |
| R9 | **Feedback:** one tap (solved / not solved) and a note at close | S |
| R10 | **Report:** count by category and state, median days to answer and to close, overdue, reopened; CSV | M |
| R11 | **Certificate requests** link to the right screen (fee certificates in fees); for others the office attaches the file | S |
| R12 | **Website enquiries** stay in their module; the list links to Requests, no copy | S |

### 6.4 Calendar and meetings (`features/events`)

**Stories**
- As an admin I declare a rain holiday at 6:30 am; attendance is closed and every family knows in two minutes.
- As a family I see exams, holidays, homework and the PTM in my own phone calendar.
- As a class teacher I offer PTM slots and get a printed list in order.

| # | Requirement | P |
|---|---|---|
| E1 | **One holiday store:** `attendance_holidays` (its seven readers unchanged) gains kind (national, state, vacation, restricted, emergency closure, working Sunday/Saturday), applies to (all / students only / staff only / chosen classes), span id, note. Calendar and Attendance → Holidays edit the same rows with the same permission. Teachers cannot add a holiday | M |
| E2 | **Moving old holidays:** section 11 | M |
| E3 | **Working days:** count per term and year, per class band, warn under 200 / 220 | S |
| E4 | **Holiday import** from sheet, copy from last year, ready list of national days to tick (dates confirmed by the school) | S |
| E5 | **Event types:** Event, Meeting, Trip, Competition, Exam (from exams, read only), Cultural, Sports; colour comes from the type | M |
| E6 | **Audience** by 5.2; owner; place; map link; files; what to bring | M |
| E7 | **Notify** on create (choice), **always** on change of time or place and on cancel (with a reason); cancelled events stay struck through (fixes C21) | M |
| E8 | **Reminders:** default 1 day and 2 hours before; per event | M |
| E9 | **RSVP:** yes / maybe / no, guests, capacity, waiting list that moves up by itself, close date, list, CSV, check-in on the day | M |
| E10 | **Consent:** a trip event can require a consent notice; both link | S |
| E11 | **Repeat:** weekly, fortnightly, monthly, until a date (max 60); edit this one, this and later, all; holidays are skipped or kept by choice | M |
| E12 | **Views:** agenda (default, from today), month, week, year planner; filters by layer. Layers: holidays, events, exams, homework due, timetable special days, PTM, fee due dates (family: own only). A person sees only what they may open | M |
| E13 | **Phone calendar:** "Add to calendar" file per event, and a personal secret feed (Google, Apple, Outlook) that can be reset; public feed for the website. Correct UID, sequence, all-day and cancelled handling. The page says phones may take up to a day to refresh | M |
| E14 | **Academic calendar PDF** for the year, and the website calendar | M |
| E15 | **PTM setup:** date, teachers (class and subject), windows, slot length 5–30 min, breaks, place or video link, families may book N, open and close times, who sees what. Slots are created from this | M |
| E16 | **Booking:** a family sees only teachers of their child; picks slots; no clash with own other slots or a sibling's; change or cancel until the cutoff; staff book for families without phones; waiting list | M |
| E17 | **Changing a window** lists the bookings it drops and asks; those families are told and offered new slots | M |
| E18 | **On the day:** teacher's list in order, mark came / missed / late, private note and shared remark, next; walk-in; print list per teacher and a room sheet | M |
| E19 | **After:** shared remarks appear to the family; attendance and not-came list; follow-up as a request | S |

### 6.5 Notifications (`features/notifications`)

| # | Requirement | P |
|---|---|---|
| T1 | **Topics:** every notification names a topic from a registry: key, label, group, default channels, must-tell or optional, and where it opens. 6 kinds become about 30 topics in 9 groups: Safety and urgent, Attendance and leave, Notices, Messages and requests, Homework, Exams and results, Fees and payments, Library and transport, Approvals and work. The registry is listed in the app so nothing is sent without a topic | M |
| T2 | **Subject link:** (`subject_type`, `subject_id`). Opening the thing marks its notifications read in the same request, cancels its pending email and updates the bell (fixes C9, C10) | M |
| T3 | **Grouping:** same group key while unread → one row that updates ("5 new messages from Meera Iyer", "12 approvals waiting") instead of 12 rows | M |
| T4 | **Needs action** tab: approvals, consent, requests assigned to me, RSVP, slips. An action row is closed by the module when done, by whoever did it. **Everything** tab: the rest by day | M |
| T5 | **Bell:** always equals the server after any action and every 60 s; tab title count; no state copied from props (fixes C11, C22) | M |
| T6 | **Channels:** app (always), push, email. SMS and WhatsApp are listed as "not available yet", with the reason, to admins only | M |
| T7 | **Preferences** per group: App on; Push off/on; Email off / instant / digest. Must-tell topics show a lock and why. Quiet hours, digest time (8 am or 6 pm), language | M |
| T8 | **School defaults:** admin sets defaults per group and role; people override except locked | S |
| T9 | **Push:** installable app per school (name, logo, colour), service worker, asked only after a tap on "Turn on", with an explanation; iPhone steps shown (needs Add to Home Screen, iOS 16.4+). Devices list, test, remove. Dead subscriptions removed on 404/410. Text on a locked phone never shows message content or a child's marks: "New message from Class 5 A teacher" | M |
| T10 | **Delivery queue:** one row per person and channel, unique; worker sends in batches; 5 tries with growing waits; one school's failure never stops another; one bad address never stops a batch | M |
| T11 | **Email budget:** a daily limit (env `MAIL_DAILY_LIMIT`, Brevo free is 300) and a per-school share. Order: codes and passwords, urgent, absence, consent due, the rest. 20% is always kept for codes and passwords. What does not fit is **deferred and shown** ("214 emails will go tomorrow"), not lost | M |
| T12 | **Guardian email:** if the login has no email, general notices go to the primary guardian's email. Private content never goes to an unverified address: only "Sign in to read" | M |
| T13 | **Digest:** one per address, grouped by topic, skips what was read, one-click unsubscribe headers, per-topic links | M |
| T14 | **Bounces:** SMTP refusals mark the address; Brevo webhook (secret token) marks bounces and spam; the person's record shows "Email not working" with Fix; a list for the office | S |
| T15 | **Delivery screen** for admins: last 7 days by channel, failures by reason, quota left, retry | M |
| T16 | **Limits:** a person gets at most one push per group key in 5 minutes; urgent excluded | M |
| T17 | **Big schools:** recipients and notifications are written with `insert … select` in chunks by the worker; publishing returns at once (fixes C7) | M |
| T18 | **Keeping:** read rows 90 days, unread 180, deliveries 180; notice recipients and responses for as long as the notice | M |
| T19 | **Existing senders** (26 calls in 19 files) all get a topic and a subject; the module-owned email loops (attendance, library, transport) use deliveries, so budget and preferences apply | M |

## 7. Screens
Rules: the 7 screen rules and 9 "no dead ends" rules in [FINANCE-BUILD](FINANCE-BUILD.md) apply. Kit only; no new colours; no coloured left edge; system fade only; toggles paint first, save after.

| Screen | Path | Shape of the data → container | One primary action | Who |
|---|---|---|---|---|
| Notices (staff) | `/app/announcements` | many comparable → table with tabs Live, Waiting, Scheduled, Drafts, Archive; row opens the record | New notice | staff |
| Notices (family) | same | feed: Needs your answer, Pinned, then by day | Answer | family |
| Write a notice | `/new`, `/[id]/edit` | form left, phone preview and audience count right | Publish / Send for approval | author |
| A notice | `/[id]` | grouped detail: body, files, response bar, recipients table in tabs | state-based: Approve / Nudge / Correct | all |
| Responses | `/[id]?tab=responses` | funnel bar + selectable table + by section bars | Nudge N people | author |
| Circular register | `/circulars` | table | Print | office |
| Templates, categories, groups | `/settings` | tables | Add | office |
| Messages | `/app/messages` | master and detail; phone: one at a time | New message | all |
| Message families | `/messages/families` | 3 steps: who, what, check | Send to N families | staff |
| Requests (staff) | `/app/requests` | table with saved views; SidePeek for detail | Claim / Answer | staff |
| Requests (family) | same | list of own with StatusTrack | Ask the school | family |
| Request report | `/requests/report` | sorted bars, median days | | admin |
| Safeguarding | `/app/safeguarding` | reports table; review log timeline | Review | lead |
| Calendar | `/app/events` | agenda / month / week / year, layers | Add event | all |
| An event | `/events/[id]` | grouped detail, RSVP bar, list | Answer / Edit | all |
| Holidays | `/app/attendance/holidays` | table by month + working-day count | Add holiday | admin |
| Meetings | `/app/meetings` | list; `/[id]` slots by teacher as a grid | Book / Open booking | all |
| My meeting day | `/meetings/[id]/day` | ordered list with a now mark | Came | teacher |
| Notifications | `/app/notifications` | Needs action / Everything, grouped | open it | all |
| My preferences | `/app/profile` → Notifications | groups × channels table | saves itself | all |
| Communication settings | `/app/settings/communication` | sections: quiet hours, switches, approval, defaults | Save | admin |
| Delivery | `/app/settings/delivery` | StatCards + failures table | Retry | admin |

**Every screen has:** skeleton in its final shape, empty (first use and no match are two different texts), error with Retry and typed text kept, read-only school, no permission with who to ask, 375 px, keyboard, focus, screen-reader names, long Hindi and English names, 10,000 rows.

**How each field looks:** category → chip; state → StateBadge (one map); person → initials, name, role or class; counts → right aligned; response share → one bar with numbers; times → "2 h ago" with the exact time on hover; number → copy button; file → icon, name, size.

**Psychology used, one per place** (`/ui-psychology`)
| Place | Lever | Metric |
|---|---|---|
| Audience picker opens on the author's own section | smart default | time to publish |
| Response bar "37 of 40 answered, 3 left" | goal gradient | consent on time |
| Phone preview beside the editor | feedback | corrections after publish |
| Push asked after the first opened notice, not on sign-in | give before ask | push on |
| Undo instead of "Are you sure?" | feedback, less friction | withdrawals |
| Needs action first | Von Restorff | overdue actions |
Refused: streaks, read-rate leaderboards of families or teachers, fake urgency, pre-ticked sharing.

## 8. Who can do what

| Permission | Admin | Accountant | Teacher | Staff (custom role) | Family |
|---|---|---|---|---|---|
| `announcements:read` | all | all sent to staff | own + sent to them | by grant (**now in the baseline**) | sent to them |
| `:draft` | ✓ | ✓ | ✓ | grant | |
| `:publish` own reach | everyone | fee overdue, all families (Fees) | own sections and subject groups | grant, reach set on the role | |
| `:approve` | ✓ | | | grant | |
| `:urgent` | ✓ | | | grant | |
| `:manage` (templates, categories, any notice) | ✓ | | | grant | |
| `messages:use` | ✓ | ✓ | ✓ | baseline | ✓ |
| `messages:all` (any family) | ✓ | ✓ | | grant | |
| `messages:office` (requests) | ✓ | ✓ | own category | grant | own |
| `messages:safeguard` | ✓ | | | grant | |
| `events:read` / `:write` / `:manage` | ✓ | read | write for own reach | grant | read, RSVP |
| `events:meetings` | ✓ | | own slots | grant | book |
| holidays (`attendance:manage`) | ✓ | | | grant | |
| `notifications:delivery` | ✓ | | | | |

- **Reach** is checked in one place (`AudiencePolicy`) for notices, events and Message families.
- School setting "Teachers publish to their own sections": freely (default) / with approval.
- Ready-made roles change: Front office gets draft, requests and meetings (publish only if ticked); new **Safeguarding lead** and **Coordinator**.
- A safeguarding lead who is named in a report is skipped; with no other lead, it goes to all admins not named; if none, the screen gives outside contacts (child helpline, police), set by the school.

## 9. Data
All tables have `school_id`, RLS, and are in the isolation suite. Money tables are untouched.

| Table | Main columns |
|---|---|
| `announcements` (+) | type, number, category_id, state, body_md, lang2, title2, body2, audience jsonb, response jsonb, due_at, scheduled_at, published_at, expires_at, pinned_until, website, version, author_id, approved_by, withdrawn_at, withdraw_reason, urgent |
| `announcement_versions` | announcement_id, version, snapshot, changed_by, note |
| `announcement_files` | announcement_id, file_key, name, size, sort |
| `announcement_recipients` | announcement_id, user_id, student_id, label snapshot (name, class), added_at, removed_at, seen_at, joined_late; unique (announcement, user, student) |
| `announcement_responses` | recipient_id unique, answer jsonb, by_name, by_relation, on_paper, file_key, at, recorded_by |
| `announcement_categories`, `announcement_templates`, `comm_groups` | |
| `message_threads` (+) | kind, student_id, batch_id, number, category_id, state, owner_id, owner_role, due_at, first_answer_at, resolved_at, level, about_user_id, closed_reason, held, linked jsonb |
| `thread_members` (+) | state, muted, archived, pinned, left_at, name snapshot |
| `messages` (+) | client_id unique per sender, removed_at, removed_by, internal, as_office, deliver_after |
| `message_files`, `message_reports`, `message_reviews` (append only), `message_restrictions`, `message_batches`, `request_categories`, `saved_replies` | |
| `notifications` (+) | topic, group_key, count, subject_type, subject_id, action, done_at, urgent |
| `notification_prefs` (rebuilt) | user, group, push, email mode; quiet hours, digest time, language |
| `comm_deliveries` | notification_id or source key, user_id, address, channel, state, reason, tries, next_at, sent_at, provider_id; unique (source, user, channel) |
| `push_subscriptions`, `email_suppressions`, `mail_usage` (day, school, class of mail, count), `comm_settings` | |
| `events` (+) | type, state, audience jsonb, owner_id, series_id, reminders, rsvp jsonb, capacity, sequence, cancelled_at, cancel_reason. `is_holiday` is dropped after the move |
| `event_rsvps`, `event_files`, `calendar_feeds` (token hash) | |
| `meeting_days`, `meeting_windows`, `meeting_slots` (unique booking, exclusion on family time), `meeting_notes` | |
| `attendance_holidays` (+) | kind, applies_to, class_ids, span_id, note, created_by |

- Append-only by trigger and grants: `announcement_versions`, `message_reviews`, `message_reports` body.
- Indexes start with `school_id`. Feed, inbox, queue and delivery pages use keyset paging.
- Files: area `private/<module>/<owner id>/`; `FilePolicy` refuses that area for everyone; each module serves its own checked route with a 60-second link (fixes C20 for these files; existing areas are reviewed in wave 0).

## 10. Jobs, API and settings

| Job | When (IST) | Does |
|---|---|---|
| `comms.publish-due` | every minute | scheduled notices; ends the 30 s undo |
| `comms.fan-out` | on publish | recipients, notifications, deliveries in chunks of 1,000; safe to rerun |
| `comms.deliver` | every minute | push and email by priority, budget and quiet hours |
| `comms.response-reminders` | 09:00, 17:00 | people who have not answered |
| `comms.late-joiners` | 02:30 | section 5.2 |
| `comms.expire` | 00:10 | expiry, unpin |
| `notifications.digest` (replaces `email-digest`) | 08:00, 18:00 | by each person's time |
| `messages.lapse` | 02:40 | close by M5 |
| `requests.clock` | hourly 8–18 | overdue, escalate, auto-close |
| `events.reminders` | every 5 min | each once |
| `meetings.reminders` | every 15 min | day before and 1 h before |
| `comms.cleanup` | 03:30 | keeping rules, dead push |

Every job is idempotent, per school, in `SCHEDULES`, and a test fails if a handler has no schedule or trigger (the fees reminder bug must not repeat).

**API v1** (same services, OpenAPI updated): notices feed and one, seen, respond; conversations list, one, send, start, read, files; requests list, create, answer; calendar range, RSVP; meetings list, book, cancel; notifications list, read, preferences; device registration for push. `docs/API.md` is corrected.

**Env:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `MAIL_DAILY_LIMIT`, `MAIL_WEBHOOK_SECRET`. Missing VAPID → push is hidden, nothing breaks.
**New dependency:** `web-push` (the encryption and signing are easy to get wrong by hand). 3.6.7 is from Jan 2024; 4.0.0 was published on 2026-11-06. Use 4.0.0 if its tests pass with ours, else 3.6.7. Pinned.

**Settings** (admin): quiet hours and weekly off · teacher publishing · approval needed for (families, whole school, website) · families may start · staff Seen shown · attachments · request categories, owners, targets, escalation · circular number format · languages · default channels · retention · outside safety contacts.

## 11. Moving existing data
One additive migration per wave; data steps by hand, never regenerated; a report per school; a dry run first.

1. **Notices:** state published, number none, audience mapped (`parents` and `students` → families), recipients created from today's rule for notices of the last 90 days; seen is unknown and shown as "before tracking". Public + staff-only rows are taken **off the website** and listed.
2. **Messages:** kind from members; with exactly one student → about that student; several families → read only with a note; nothing is deleted.
3. **Notifications:** kind → topic; message and notice rows get a subject from their link.
4. **Holidays:** for each holiday event day not in `attendance_holidays`: future, or past with no mark → added. Past days **with** attendance marks, approved leave or a paid payroll month → **not added**, listed for the admin to decide one by one. No mark, leave or pay row is ever changed by the move. The event becomes a holiday span on the calendar.
5. **Preferences:** digest off stays off for all email.
6. **Roles:** `announcements:write` holders keep draft + publish; teachers' publish is limited to their reach.
Rollback: additive columns stay; the old code ignores them, except holidays (kept in `is_holiday` until wave 4).

## 12. Safety, privacy, speed
- **Isolation:** school A never sees, resolves, counts, delivers to or downloads anything of school B: tests on every service, feed URL, file route, webhook and push endpoint.
- **Inside a school:** a family sees only its own child's rows; a teacher only their reach; fee-overdue lists never leave finance roles; a reported person never sees the report.
- **Text:** markdown subset rendered by our renderer; links `http`, `https`, `mailto`, `tel` only; no remote images; emails escape everything.
- **Files:** type by content, not only by name; images re-encoded; `Content-Disposition: attachment` for non-images.
- **Tokens:** calendar feed and QR tokens are random 128-bit, stored hashed, resettable; feeds carry no marks, fees amounts or message text.
- **Webhooks:** secret, constant-time compare, replay-safe.
- **Support sessions:** no message, report, response text or private file; every refusal is logged.
- **Read-only school:** reading, seen marks and exports work; sending does not, and says why.
- **Speed (measured on the production build, 3,000 students, 20,000 notifications):** feed and inbox under 300 ms; publish returns under 1 s; fan-out of 10,000 under 60 s; bell check under 50 ms; 2,000 open pages at one check a minute = about 33 requests a second.
- **Why checks every 10–60 s and not a live socket:** one VM, Caddy in front, and reports of buffering with streaming. If checks cost too much, move the same endpoint to server-sent events with one database listener.

## 13. Acceptance (each has a test)
1. A staff-only notice can never appear on the website, by service, API or direct SQL through the public context. (C1)
2. A teacher cannot edit, withdraw, publish or make public another person's notice, nor target beyond their reach; the same for events. (C2)
3. Publish → undo within 30 s → nobody has a notification, push or email.
4. Audience correction notifies only people added; removed people lose access; versions show both. (C4, C5)
5. A withdrawn notice shows its reason; its notification opens that. (C3)
6. A student who left gets nothing new; a student who joins late gets live notices without a push. (C6)
7. 12,000 recipients: publish returns, all recipients exist once, rerunning fan-out adds none. (C7)
8. Consent: yes, no with reason, change, locked after the due date, paper answer, per sibling; the report adds up to recipients.
9. Nudge reaches only those who have not answered, once a day.
10. Approval: author cannot approve; the only approver can with a reason; edits by the approver show the difference.
11. Circular numbers have no gaps under 20 parallel publishes; a withdrawn number stays in the register.
12. Urgent reaches all channels in quiet hours; a fee notice cannot be urgent.
13. Opening a message, notice, event or approval clears its bell row, badge and pending email in one request. (C9, C10)
14. After Mark all read, bell, list and tab title all say 0 without reload. (C11)
15. 105 conversations: all can be reached; badge equals the sum shown. (C12)
16. The 21st message in a minute is refused with a time; the batch tool is not affected. (C13)
17. A support session gets "not available" for conversations, requests, reports, responses and files. (C14)
18. Report → lead reviews → log row exists; a named lead cannot open it; held messages cannot be removed, exported by the named person, or expire. (C15)
19. Review without a reason is refused; the log cannot be edited or deleted by any app role.
20. No conversation ever has two families, through start, batch, request, merge or API.
21. Teacher unassigned, student left → conversation read only the same night, with the reason.
22. Quiet hours: app now, push and email at 7:00; urgent at once; Seen held too.
23. Double press and retry create one message (client id).
24. Message file: not a member → 404; member → works; link expires; school B → 404. (C20)
25. School export has no messages unless ticked with a reason; a student's export has only theirs. (C19)
26. Request: clock, pause, escalate, resolve, reopen, close; a complaint about X is invisible to X everywhere, including counts, search and export.
27. A holiday added in the calendar blocks marking, is not a working day in leave and payroll; one added in Attendance shows in the calendar. (C18)
28. Holiday move: totals reported; a day with marks is never added by the move.
29. Event change and cancel notify exactly its audience once; RSVP capacity holds under 50 parallel answers; the waiting list moves up.
30. Repeat: edit one, later, all; 60 cap; a cancelled occurrence stays cancelled.
31. iCal feed passes a validator: all-day, time zone, folded lines, cancelled, sequence; a reset token gives 404.
32. PTM: no double booking for teacher or family under parallel requests; sibling clash refused; window change lists dropped bookings and offers others.
33. Push: subscribe, send, 410 removes it; locked-screen text has no private content; no VAPID key → hidden.
34. Email budget: with limit 10, codes still go when 10 notices are waiting; the rest is deferred and shown; next day they go once.
35. Preferences: each channel and mode is obeyed; locked topics ignore "off"; unsubscribe link works without sign-in and only for that person.
36. Every topic in code is in the registry; every sender has a topic; every job has a schedule or trigger.
37. Two schools, same names: nothing crosses (notices, recipients, threads, requests, slots, feeds, files, push, deliveries).
38. Every screen: 375 px without sideways scroll, keyboard only, axe with no serious issue, Hindi text prints in the PDF.
39. Migration on a copy of the seeded school: counts match the report, running twice changes nothing.

Property test: 5,000 random sequences of publish, correct, withdraw, join, leave, respond and remind keep: recipients unique, answered ≤ seen-or-paper, no notification for a removed person, deliveries ≤ one per channel.

### 13.1 Journeys (each a browser test on the production build)
| # | Journey |
|---|---|
| J1 | Clerk drafts a circular → sends → principal asks changes → clerk fixes → approved → scheduled → goes out → family opens → report updates |
| J2 | Principal publishes to all → undo → edits → publishes → corrects → withdraws |
| J3 | Teacher: trip consent to own section → 3 ways of answering (yes, no, paper) → nudge → due passes → CSV and sign sheet |
| J4 | Rain at 6:30: emergency closure + urgent alert → attendance blocked → families see banner → sender sees count |
| J5 | Family asks teacher at 10 pm → told it will deliver at 7 → teacher away → answers → Seen |
| J6 | Teacher messages 40 families → private replies → one reports a concern → lead reviews → restricts → closes |
| J7 | Family raises a certificate request → office claims → asks → family answers → resolved → not solved → reopened → closed; and one that goes overdue and escalates |
| J8 | Complaint about a teacher → invisible to that teacher → principal handles |
| J9 | Event with RSVP and capacity → full → waiting list → time changed → cancelled → calendar feed shows it |
| J10 | PTM: open → two siblings book → window changes → rebook → the day → came / missed → remark seen by family |
| J11 | Preferences: digest, push on, quiet hours, unsubscribe from email link |
| J12 | Bell: message, notice, approval; open each from another screen; counts agree everywhere |
| J13 | Custom roles: front office, safeguarding lead, coordinator, bus in-charge, auditor: each sees only what works |
| J14 | First day: an empty school → checklist (sender email, quiet hours, categories, roles, first notice) → first notice read by a family |
| J15 | Support session: every private screen refuses with a plain sentence |

## 14. Not in this build
| What | Why |
|---|---|
| SMS and WhatsApp sending | DLT and WhatsApp approval are outside the repo. Opt-in record and adapter are built |
| Native mobile app | the API is its contract |
| Parent logins | retired by the owner |
| Voice and IVR calls | paid provider, no evidence of need |
| Machine translation | cost and wrong-meaning risk in school notices |
| Student-to-student chat, public comments | child safety |
| AI moderation | no tested model for Hinglish; reports and review first |
| Photo gallery, birthday wishes, digital notice-board screen | no user evidence found; the website has galleries |
| Video calls | a link field is enough |
| General survey builder | the 10-question form covers school use |

## 15. Build plan
Owner per file set; at most 6 Sonnet agents at once; the lead writes contracts, migrations and the review; tests by each stream, the full suite once per wave by the lead.

| Wave | Stream | Owns |
|---|---|---|
| **0: safe now** | Close the privacy defects and C5, C6, C8, C11, C13. No new tables. Can ship alone | four modules, settings, files route |
| **1: core** | A. Audience resolver, policy, groups | `features/notifications/audience*` |
| | B. Topics, subject, grouping, action, preferences, bell | `features/notifications` (rest) |
| | C. Deliveries, budget, quiet hours, digest, push, PWA | `features/notifications/delivery*`, worker, `apps/school/public` |
| **2: modules** | D. Notices service + jobs | `features/announcements/*.ts` |
| | E. Notices screens | `features/announcements/ui` |
| | F. Messages, safeguarding | `features/messages` (not requests) |
| | G. Requests | `features/messages/requests*` |
| | H. Holidays move, calendar, RSVP, repeat, iCal | `features/events` (not meetings), `features/attendance` holidays |
| | I. Meetings | `features/events/meetings*` |
| **3: joins** | J. Topics for all 26 senders, module emails onto deliveries, calendar layers, homes, sidebar, API, OpenAPI, seeds, settings screens, roles | `apps/school`, small edits per feature |
| **4: prove** | K. Journeys, crawl, speed, axe, 375 px; two independent reviews (permissions and isolation; child safety and delivery), fixes with tests; guide `docs/COMMUNICATION.md` | tests, docs |

**Definition of done:** every M and S row above has a service, a screen, a test and a seed example; all of section 13 passes on the production build; both reviews are closed; the line-by-line check of this file is in the report. No "known limits" for anything in scope.

**Outside help needed before real schools use it:** a verified sending domain (or the paid mail plan), VAPID keys on the server, DLT and WhatsApp approval for those channels, a lawyer's look at retention and children's data, and the school naming its safeguarding lead.

## 16. Decisions
Each has a default; the build uses it unless the owner changes it.

| # | Question | Default we recommend | Why |
|---|---|---|---|
| 1 | Can the school review staff–family conversations? | **Yes, by a safeguarding lead, with a typed reason, logged, and both sides told** | accountable without open snooping. TalkingPoints and ParentSquare give admins full access; this is narrower |
| 2 | Teachers publish to their own sections without approval? | **Yes; wider needs approval** | speed for class work, control for the school's name |
| 3 | Quiet hours 8 pm to 7 am and Sundays? | **Yes, changeable** | no rule found; our choice |
| 4 | Build Requests (help desk) now? | **Yes** | strongest Indian evidence (MyClassboard) |
| 5 | Build PTM booking now? | **Yes** | Indian products record PTMs; booking is the gap |
| 6 | Add `web-push`? | **Yes** | push is the only free instant channel while SMS is blocked |
| 7 | "Students" and "Families" become one audience? | **Yes** | same logins |
| 8 | Rename menu: Announcements → Notices, Events → Calendar? | **Yes** (paths stay) | the words schools use |
| 9 | Plans: all of this in every plan; meetings and requests from Growth up? | **Yes** | same split as expenses |
| 10 | Ship wave 0 first, alone? | **Yes** | it closes privacy defects |

## 17. Confidence
- Section 2: code of all four modules was read in full. P rows were run on a real database (throwaway tests, deleted). W rows were seen on the production build as admin at about 800 px and 375 px. **Not walked:** family and teacher logins, the website, and the demo server.
- "Percent mature", targets and speed goals are estimates.
- Vendor behaviour comes from help pages and snippets, not from using the products. Remind and ClassDojo pages refused to load.
- Legal rows: no gazette or statute text was opened. Low rows must be checked by a lawyer.
- Web push, iCal and Gmail facts: RFC 8030, RFC 8058, WebKit and Google pages were read; some iCal details are from memory and are covered by the validator test.

## 18. Sources
- ParentSquare: https://www.parentsquare.com/resources/faqs/ · https://www.parentsquare.com/designed-for-k12/administrative-oversight-user-permissions/
- TalkingPoints: https://intercom.help/talkingpoints/en/articles/10073943 · Brightwheel: https://help.mybrightwheel.com/en/articles/942361-review-room-feeds-and-approve-activities
- Bloomz: https://support.bloomz.com/support/solutions/articles/62000080310 · https://support.bloomz.com/support/solutions/articles/62000232687
- Remind: https://help.remind.com/hc/en-us/articles/8187853614861 · ClassDojo: https://help.classdojo.com/hc/en-us/articles/207359446
- MyClassboard: https://kb.myclassboard.com/category/uncategorized/page/3 · Edunext: https://edunexttechnologies.com/communication.php · Skolaro: https://www.skolaro.com/school-erp
- Schoolites: https://schoolites.com/school-problems/circular-management · SchoolMyKids: https://www.schoolmykids.com/school-parent-communication-app · Teachmint: https://www.teachmint.com/features/communication-module · Fedena: https://support.fedena.com/support/solutions/articles/213228-about-reminders
- Reviews: https://play.google.com/store/apps/details?id=com.vawsum · https://apps.apple.com/in/app/parentsalarm/id1462605743
- Linear: https://linear.app/docs/inbox · GitHub: https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications · Slack: https://slack.com/help/articles/201355156-Configure-your-Slack-notifications
- DPDP: https://www.livelaw.in/amp/top-stories/digital-personal-data-protection-rules-2025-notified-309928 · https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified · schools: https://www.storyboard18.com/digital/dpdp-rules-carve-out-key-exemptions-for-healthcare-providers-schools-and-childcare-services-processing-childrens-data-84208.htm
- POCSO: https://www.livelaw.in/news-updates/offence-punishable-under-section-21-pocso-act-bailable-offence-kerala-high-court-214968 · Safety guidelines: https://www.drishtiias.com/daily-updates/daily-news-analysis/ensuring-safety-of-school-children/print_manually
- SMS: https://www.fonearena.com/blog/469120/trai-mandates-pre-tagging-sms-variables-curb-phishing-misuse.html · WhatsApp: https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- Email: https://support.google.com/a/answer/81126 · https://www.rfc-editor.org/rfc/rfc8058 · Brevo: https://help.brevo.com/hc/en-us/articles/208580669
- Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://www.rfc-editor.org/rfc/rfc8030 · https://github.com/web-push-libs/web-push
- iCal: https://www.rfc-editor.org/rfc/rfc5545 · Accessibility: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role · https://www.w3.org/WAI/ARIA/apg/patterns/feed/
- Streaming behind Caddy: https://caddy.community/t/streaming-breaks-when-caddy-proxies-next-js/31796
