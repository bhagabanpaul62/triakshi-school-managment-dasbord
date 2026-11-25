# Admissions: student reads outside students, fees, transport and library

Rule used: a **live list** (register, roster, strength, audience, contact, booking, homework, mark entry, hall list, elective, house, count for a plan) holds `active` only. A **paper about the past** (old attendance, results, report cards, old messages and requests, audit) opens for a left child too, and never needs a joining child. A joining child has no section, so a read by section already misses it; the filter is there anyway, because a left child keeps `section_id` and `class_id`.

"Fixed" means this pass changed the line. "By design" means it was right, or must stay as it is (reason in the last column).

Enrolment rows: the only read of `student_enrollments` in these folders is `academics/service.ts:94` (year delete guard). It counts rows of the year being deleted (`year_id` is named), so a future-year row for a joining child belongs to that year and blocks nothing else. By design.

## attendance

| file:line | purpose | verdict |
|---|---|---|
| attendance/eligibility.ts:44 | board-class eligibility counts per student | by design: `active` filter, a live list |
| attendance/eligibility.ts:78 | condone a shortfall for a student | fixed: now active only (a left or joining child could be condoned) |
| attendance/period-service.ts:203 | subject report roster (a range report) | fixed: `onRollBetween(from, to)`, same rule as the register |
| attendance/leave-service.ts:44 | the children a login can apply leave for | fixed: active only |
| attendance/leave-service.ts:126, 181 | name and section on a leave request, request list | by design: paper, a left child's old request still shows |
| attendance/leave-service.ts:336, 342 | who may decide a request, days to mark | by design: the request was made while at school; days are marked from the request dates |
| attendance/service.ts:136 | section progress, strength | fixed: `onRollOn(date)`. A past day counts a child who left on or after it; today's count never does |
| attendance/service.ts:156 | day sheet | fixed: `onRollOn(date)`. A past day lists a child who left on or after it, with "Left 10 Nov"; today's sheet is at school only |
| attendance/service.ts:180 | check the ids sent to "mark" are in the section | fixed: active only (a left child with a kept section could be marked) |
| attendance/service.ts:201 | month register people | fixed: `onRollBetween(first day, last day)`: at school, or left/graduated with the last day on or after the month's first day, or with a mark in the month |
| attendance/service.ts:204 | month register marks (join by section) | fixed: a left child's marks show up to their last day only; PDF and CSV carry the same rows and a "Left 10 Nov" note |
| attendance/service.ts:237, 245, 260, 286 | one student's own view, summary, month, recent absences | by design: paper; a left child's staff view of old marks opens. Attendance is not in the left-student access list, so the family login cannot reach it |
| attendance/service.ts:314 | defaulters | by design: active filter. A live "who to chase now" list, not a month summary |
| attendance/service.ts:335 | today's school total | by design: active filter |
| attendance/alerts.ts:30 | queue an absence alert | by design: only called with marked ids, which are active (line 180) |
| attendance/alerts.ts:49 | send a queued alert after the grace window | fixed: a child who left inside the grace window gets no alert |

## timetable

| file:line | purpose | verdict |
|---|---|---|
| timetable/service.ts:140 | sections of a student login (own timetable) | fixed: active only |
| timetable/service.ts:200 | electives chosen by a student login | fixed: active only |
| timetable/service.ts:450 | roster of a live period (period attendance) | by design: active filter |

## academics

| file:line | purpose | verdict |
|---|---|---|
| academics/service.ts:24 | section strength (`students`) | by design: active filter |
| academics/service.ts:32 | planned joiners per section (`joins_section_id`) | new: shown as "32 + 3 joining" in the classes list, the class page and its stat cards; never added to the strength |
| academics/service.ts:94 | year delete guard counts `student_enrollments` of that year | by design: names the year. Also counts children planned to join the year (`joins_year_id`) |
| academics/service.ts: `SectionService.usage` | section delete guard counts students by `section_id` | fixed: also counts joining children by `joins_section_id` ("3 children are planned to join this section"), because the delete would strip their plan. A left child keeps the section, so a section with history is not deletable |
| academics/exports.ts:32 | classes export, student count | by design: active filter |
| academics/electives.ts:14 `studentRow` | one student by id | by design: used for history (`subjectsForStudent`) and by `activeStudent` below |
| academics/electives.ts:20 `activeStudent` | live changes (electives, groups, houses) | new: one place that refuses a joining, left or alumni child |
| academics/electives.ts: `setChoices`, `assign` | choose electives, put in a subject group | fixed: now call `activeStudent` |
| academics/electives.ts:30 `sectionStudents` | roster for groups and houses | by design: active filter |
| academics/electives.ts: `subjectsForStudent` | what a student studies (exams use it) | by design: history, a left child's list opens |
| academics/houses.ts:36, 41, 54 | house member count and delete guard | fixed: counts active children only (a left child kept their link and was counted) |
| academics/houses.ts:62 | house captain name | fixed: active only, a left captain shows no name |
| academics/houses.ts:74, 79 | assign or clear a house | fixed: `activeStudent` (shared with electives) |
| academics/houses.ts:92 | house roster of a section | by design: active roster |
| academics/houses.ts:139 | a student login's own house | fixed: active only |

## exams

| file:line | purpose | verdict |
|---|---|---|
| exams/repo.ts:59 `ExamRepo.students` | roster for mark entry, remarks, co-scholastic sheet, admit cards | by design: active filter |
| exams/repo.ts:59 `resultsOf` | roster behind results, ranks and report cards | fixed: a left or alumnus child with marks in that exam stays in the result and the rank, one without marks never appears. Before, `studentResult`, class table, "my results" and term cards gave "not found" for a left child |
| exams/repo.ts:112 `electiveTakers` | who takes each elective | fixed: `past` flag, used only for results, so a left child keeps the elective they sat. Live counts stay active |
| exams/repo.ts:154 | marks-entry progress (class size) | by design: active filter |
| exams/service.ts:218 | tell every child sitting an exam | by design: active filter |
| exams/service.ts:265 | open papers list, class size | by design: active filter |
| exams/service.ts:338 | marks roster filtered by electives | by design: takers are active |
| exams/service.ts:502 | co-scholastic grades entry | fixed: active only |
| exams/service.ts:547 | a student login's own children | by design: a left child's family may open the old results (exams is in the left-student access list) |
| exams/service.ts:569, 588, 648, 830 | result of one child, "my results", term card | by design: papers about the past, now served from the `resultsOf` roster |
| exams/setup.ts:300 | a student login's upcoming date sheet | fixed: active only |
| exams/setup.ts:324 | admit card rows | fixed: active only (hall list); the single card and the class batch both go through it |
| exams/setup.ts:212, 226 | remarks sheet roster | by design: active roster; old remarks still print on a left child's card |

## messages

| file:line | purpose | verdict |
|---|---|---|
| messages/contact-rules.ts:51, 72, 79, 88, 93 | staff-to-family contact list, section scope, family's own children, family-to-teacher list | by design: all filter `active` |
| messages/jobs.ts:25 | close threads whose teacher no longer teaches | by design: active child only |
| messages/jobs.ts:40 | close threads of a child who left | fixed: `status in ('left','alumni')`. Before, `<> 'active'` also meant joining |
| messages/jobs.ts:69, 71 | retention of old conversations | fixed: same, a joining child is never "gone" |
| messages/safeguard.ts:48, 68, 84 | find a thread, name on a report | by design: paper |
| messages/safeguard.ts:209 | person picker for a limit | by design: picks logins (`users.status`), a joining login is disabled |
| messages/batch.ts:133 | who received a "message families" batch | by design: paper |
| messages/core.ts:63 | thread member must belong to the student | by design: integrity check on an existing thread |
| messages/core.ts:125 | start a conversation about a student | by design: active filter |
| messages/core.ts:339, service.ts:113, 130 | names on the inbox and thread | by design: paper, old conversations of a left child open |
| messages "Message families" audience | resolved by `notifications/audience.ts` | see notifications |

## notifications

| file:line | purpose | verdict |
|---|---|---|
| notifications/audience.ts:82 `PEOPLE` | the one source of every audience (messages, notices, events, meetings) | by design: `where s.status = 'active'`, so every rule (`families`, `class`, `section`, `student`, `house`, `route`, `subject`, `fee_overdue`) skips joining, left and alumni |
| notifications/audience.ts:163 | name of a picked student | by design: label only |
| notifications/audience.ts:228 `teachersOfStudent` | who teaches a child (contacts, requests, meetings) | fixed: active child only |
| notifications/audience.ts:312 | people search for the picker | by design: active filter |
| notifications/policy.ts:45 | does a "student" rule stay inside the teacher's sections | by design: active filter |
| notifications/delivery.ts:138 | guardian email fallback for a login | by design: left children keep fees and exam notices for 90 days |
| notifications/prefs.ts:135 | names on the preference screen | by design: active filter |

## meetings

| file:line | purpose | verdict |
|---|---|---|
| meetings/access.ts:21 `KID` | the child a login belongs to, children by id | by design: active filter |
| meetings/access.ts:39 | brothers and sisters | by design: active filter |
| meetings/base.ts:55 | waiting list offer | by design: active filter |
| meetings/schedule.ts:57 | give back the time of a child who left | fixed: `left` or `alumni` (was `<> 'active'`, which read joining as left) |
| meetings/setup.ts:79, 232, 381 | slot view, cancel notices, dropped slots | by design: existing bookings, paper |
| meetings/setup.ts:129 | families with no teacher in the meeting | by design: active filter |
| meetings/booking.ts:57, day.ts:64, 88, 185 | booked slots shown | by design: existing bookings |
| meetings/day.ts:162 | walk-in choices | by design: active filter |

## assignments

| file:line | purpose | verdict |
|---|---|---|
| assignments/access.ts:100, 106 | roster, own children | by design: active filter |
| assignments/schedule.ts:41, notices.ts:36 | reminders, "new homework" | by design: active filter |
| assignments/service.ts:200, 407, 411 | extension target, class size, running extensions | by design: active filter |
| assignments/service.ts:146, 224, notices.ts:16, 45, 54 | name or login of one child for a mark, comment or extension | by design: acts on an existing submission or on a child already checked |

## requests

| file:line | purpose | verdict |
|---|---|---|
| requests/service.ts:57, 58, 69, 87 | ask form, child search, raise | by design: active filter |
| requests/access.ts:43, 52 | which requests a viewer sees (family's own, teacher's sections) | by design: paper, a left child's old requests stay visible |
| requests/routing.ts:40 | class teacher of the child, for a new request | by design: new requests are only for active children |
| requests/reads.ts:82, 104; base.ts:66 | request list and notice target | by design: paper |

## events, announcements

| file:line | purpose | verdict |
|---|---|---|
| events/rsvp.ts:23, 82 | seat counts, answering | by design: active filter |
| events/service.ts:60 | which events a family sees | by design: active filter |
| events/service.ts:143 | chip names | by design: label |
| events/people.ts:74 | drop unanswered invitees who left | by design: a joining child is never invited, so only left, alumni and disabled people are dropped |
| announcements/notice-service.ts:102 | "does the school have students" for the audience check | by design: active filter |
| announcements/feed-service.ts:125 | guardian of a recipient | by design: paper |

## website

| file:line | purpose | verdict |
|---|---|---|
| website/enquiry-reads.ts:213, 216 | "this phone already has a child here" on an enquiry | fixed: active or joining (an accepted child makes the family a current one), never left |
| website/enquiry-reads.ts:260 | find a student to link an enquiry to | fixed: active or joining. The child made from an enquiry starts as joining, so linking would never find them |
| website/enquiry-service.ts:425, 459, enquiry-core.ts:247, enquiry-reads.ts:224 | link, claim recovery, dead link check, linked student name | by design: by id, any status |
| website/enquiry-service.ts:464 | find a child made from a crashed claim, by name | by design: any status |
| website/seed.ts:45 | demo: a student with no enquiry | by design: active filter |

## setup, platform, billing

| file:line | purpose | verdict |
|---|---|---|
| setup/service.ts:141, snapshot.ts:18 | student count for the checklist | by design: active filter |
| setup/tasks.ts:58 `people.families` | "half of the families signed in" | fixed: counts logins of active children only (left children keep a login for 90 days and dragged the share down) |
| platform/src/schools.ts:13, overview.ts:18 | students per school in the console | by design: active filter |
| billing/src/util.ts:25 `countStudents` | plan cap, plan change check, recommended plan | by design: active filter. A joining child is not on the plan until the day they start |

## Doubtful, for the orchestrator

- Enquiry sibling hint and student search now include `joining`. The contract says joining is read by nothing else than the student list, record page, fees and the admission desk; I read the enquiry desk as part of the admission desk. If not, revert the two `status in ('active', 'joining')` in `website/enquiry-reads.ts`.
- A leave request decided after the child left marks attendance days up to `left_on` only (checked in `leave-service.ts:342`, test in `attendance/admissions-reads.test.ts`).
- Homework grading and comments for a left child's old submission (`assignments/service.ts:146`) are still allowed. The mark is a paper, not a live list.
