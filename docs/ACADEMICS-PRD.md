# PRD: Academics group: academics, attendance, timetable, assignments, exams, library, transport

Status: approved for build on 2026-11-20 (decisions in section 10 settled). Builds on docs/AUTH-PRD.md (logins, roles, family = student login) and docs/PEOPLE-PRD.md (profiles, onboarding).

## 1. Goal
Each of the 7 modules is complete enough that an Indian CBSE, ICSE or state-board school can run its whole academic year here without paper:
- set up the year
- mark attendance
- run the timetable
- set homework
- run exams and print term report cards
- run the library and the buses

The office should not need a second tool for any of these.

## 2. The bar (what mature platforms do)
Platforms checked: Fedena, Entab CampusCare, Teachmint, MyClassboard, Skolaro, PowerSchool, Google Classroom (homework), and NIC e-Granthalaya (library). Sources are in section 12.

**What they all have:**
- Term-wise report cards with a configurable grading scale, a co-scholastic block, attendance and teacher remarks.
- Absence alerts to families.
- Leave requests with approval.
- A printable monthly register.
- Substitution (arrangement) for absent teachers.
- Barcode issue and return in the library.
- A transport fee tied to the route or stop.

**Indian rules that shape the product:**
- **CBSE 75% attendance:** students need 75% attendance for Class 10 and 12 board eligibility (Exam Bye-Laws 13–14), strictly enforced from 2025-26. Relaxation (medical, sports) needs proof on record.
- **CBSE scholastic grades:** a 9-band scale (A1 91–100 down to E). The pass mark is 33%. Classes 9–10 use 80 marks for the board exam plus 20 for internal assessment.
- **Co-scholastic grades:** A–C for Classes 6–8. The scale differs for Classes 9–10 and 11–12, so treat it as data and keep it editable.
- **ICSE/ISC:** marks-based with 80 + 20 internal. State boards vary, so scales and templates must be configurable per school.
- **NEP 2020 Holistic Progress Card (PARAKH HPC):** self, peer and teacher input each term. Not a must yet, but the data model must not block it.
- **School bus safety:** CBSE 2017 circular and state rules require GPS, CCTV, a speed governor and a lady attendant. We track the documents and checklist; we do not build GPS ourselves.

## 3. Decisions (carried over and new)
| # | Decision |
|---|---|
| A1 | **No parent logins.** Anything "to parents" goes to the student login, which is the family login. |
| A2 | **Alerts:** in-app notification + email (free SMTP, Brevo/Gmail). There is no SMS or WhatsApp until DLT is approved; the sender sits behind an interface so it can be added later. |
| A3 | **Custom staff roles get the new grants:**<br>• Librarian: library:manage<br>• Transport in-charge: transport:manage<br>• Exam coordinator: exams:manage<br>• Timetable in-charge: timetable:manage<br>No module hard-codes "teacher acts as librarian" any more. |
| A4 | **Configurable per school, not hard-coded:**<br>• grade scales<br>• co-scholastic scale<br>• term weightage<br>• library loan days, limits and fine rate<br>• the attendance threshold (default 75%) |
| A5 | **Report card templates by class band:** 1–5, 6–8, 9–10, 11–12, each with a CBSE default. A school can pick an ICSE/state variant (marks only, no grade column). |
| A6 | **No GPS tracking in v1.** Keep `gpsDeviceId` and add a "tracking link" field, so a school can paste its GPS vendor's parent URL. |
| A7 | **Whole-school timetable generator in v1.** The admin sets the rules once and the system builds every section's week without clashes. See 4.3. |
| A8 | **Student leave** is approved by the class teacher; the admin can override. |
| A9 | **Library fines post to the student's fee ledger** (a "Library fine" line), like any other due. There is no separate cash desk. A waiver cancels the ledger line. |
| A11 | **A custom role given `attendance:mark` on a non-teaching (staff) base** can mark every section: that is how a school makes an attendance clerk. Leave approval stays limited to the class teacher, the admin, and holders of `attendance:manage`. |
| A10 | **Transport fee starts from the next full month** after assignment. Unassigning stops it from the month after. There is no pro-rata. |

## 4. Module by module

Priority: **M** = must before launch, **S** = should soon, **L** = later.

### 4.1 Academics (`features/academics`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Years (one current year), terms, classes with Nursery–12 presets, sections (capacity, room, class teacher), subjects (scholastic or co-scholastic, board presets), class subjects, and a subject-teacher matrix.
- Year rollover copies sections.
- 13 tests, including isolation.

**Half-built:**
- `TermService.addDefaults` has no button.
- Rollover does not copy class teachers or subject teachers.
- Nothing can be printed or exported.

| Gap | Pri |
|---|---|
| Electives and streams: a subject group per class (e.g. Science-PCM / PCB / Commerce for 11–12, a second language for 6–10), plus a per-student subject choice. Exams and report cards use it. | M |
| Rollover also copies class teachers and subject teachers (with an option to skip) | M |
| "Add default terms" button (Term 1 / Term 2) | M |
| Houses: create houses, assign students, house points | S |
| Class/section list export (CSV) and a subject-allocation print | S |
| APAAR ID and RTE-quota flag on the student (fields live in features/students) | S |

### 4.2 Attendance (`features/attendance`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- One-tap daily marking by section; teachers are scoped to their own sections.
- Statuses: present, absent, late, half-day, leave.
- Holidays.
- Monthly register screen, and defaulters below 75% over 90 days.
- Today's summary and a 30-day trend.
- Staff marking.
- Student self view.
- REST summary.
- 17 tests.

| Gap | Pri |
|---|---|
| Absence alert: when a student is marked absent or late, the student login gets an in-app notice + email (one per day, batched after marking closes) | M |
| Leave requests: the student (family) applies with dates, reason and an optional note/file; the class teacher approves; approved days auto-mark as leave. Staff leave works the same way, with admin approval. | M |
| Register print/PDF in the official month-grid format, plus CSV export; also a staff register | M |
| Board eligibility report: % per student over the academic year (not 90 days), a condonation flag (medical/sports) with a document, and a list of Class 10/12 students below 75% | M |
| "Mark all present" then tap the exceptions (UI-level, the grid already supports it) | S |
| Period/subject-wise attendance for Class 9–12 (optional per school), rolled into daily | S |
| Biometric/RFID import (CSV or webhook) for staff | L |

### 4.3 Timetable (`features/timetable`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Bell schedule (with a preset).
- Weekly grid per section, with clash checks that name the other section.
- Teacher week and teacher load.
- Auto-fill of empty cells.
- Student NowNext.
- REST `today`.
- 26 tests.

| Gap | Pri |
|---|---|
| Substitution: on a day, list the absent teachers (from staff attendance or leave), show their periods, suggest free teachers with the lowest load, assign a cover, and notify the cover teacher. The cover shows in the teacher's "today". | M |
| Print/PDF of section and teacher timetables | M |
| Copy one section's week to another section | S |
| Room/lab clash check (the room is free text today) | S |
| Day override (exam day / half day uses a different bell schedule) | S |
| Max periods per day/week per teacher, warned in the cell editor | S |
| **Timetable generator (whole school):** a solver that builds every section's week without teacher or room clashes, then shows a review grid before publishing. Its inputs are listed below the table. | M |
| Generator re-run: keep locked cells, regenerate the rest; show what changed | M |
| Publish/draft versions: build a draft timetable while the live one keeps running, then publish on a date | S |

**Generator inputs** (the wizard order):
1. Periods per week per subject per class.
2. Double periods for labs, or any subject that needs back-to-back slots.
3. Teacher unavailability, for example "no periods on Saturday" or "free in period 1".
4. Max periods per day and per week for each teacher.
5. Labs and rooms each subject needs.
6. Class teacher takes period 1.
7. Spread each subject across the week, with no subject twice in a day unless it is a double period.
8. Locked cells the admin pins.

**How it works:** a deterministic greedy pass plus repair (most-constrained cell first, then local swaps). A seed gives the same result each run. It has a 20 s budget per school and reports what it could not place, with the reason.

### 4.4 Assignments (`features/assignments`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Draft, published and closed states, with files.
- Teachers are scoped to the sections they teach.
- Submissions with text and files, with automatic late marking.
- Grading with marks and feedback, and "send back to redo".
- A notice on publish.
- Summary tiles.
- Student view.
- REST.
- 38 tests.
- One `shortcut:` comment: deleting files before the delete commits can orphan files.

| Gap | Pri |
|---|---|
| Due-soon reminder (24 h before) to students who have not submitted | M |
| Per-student extension (a new due date for one student) | M |
| Marks CSV export per assignment and per section | S |
| Bulk grade (same marks or feedback for several students) and quick publish/close actions | S |
| Comment thread between teacher and student on a submission | S |
| Schedule publish (go live at a date and time) | S |
| Fix the orphaned-file shortcut (delete the files after commit) | S |
| Assignment marks feed into exams as internal assessment (see 4.5) | S |
| Rubrics, plagiarism check, MCQ quiz | L |

### 4.5 Exams and report cards (`features/exams`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Exams of 4 kinds with status steps (draft → marks open → published).
- Papers per class and subject; marks grid with absent and teacher scoping.
- Results ranked by section.
- Single-exam CBSE-style PDF, one per student or a batch per section.
- A notice on publish.
- 40 tests.

**Half-built:**
- The grade-scale CRUD (`saveBands`, `bands`, `scale`) has no screen.
- `saveCoScholastic` is used only by the seed, so co-scholastic grades print but cannot be entered.
- The term roll-up (`pdf({termId})`) exists but no route uses it.
- The PDF grading legend is hard-coded to CBSE.

| Gap | Pri |
|---|---|
| Grade scale editor: scholastic bands and a separate co-scholastic scale, a default per class band, presets (CBSE 9-band, CBSE co-scholastic A–C, ICSE marks-only) | M |
| Co-scholastic entry screen: per section, per area (Work Ed., Art, Health & PE, Discipline), a grade per student per term | M |
| Assessment components per paper: theory, practical and internal assessment (e.g. 80 + 20), each with a max, entered separately and summed | M |
| Term report card: Term 1 and Term 2 columns from the exams mapped to each term, a configurable weightage (e.g. PT 10 + notebook 5 + enrichment 5 + term exam 80), a final result column, and a route plus button for one student or a batch | M |
| Attendance on the card (working days and days present for the term, from attendance) | M |
| Teacher remarks per student per term (class teacher writes; there is also a bulk sheet) | M |
| Legend and grade columns follow the school's scale (no hard-coded CBSE) | M |
| Exam timetable (date sheet) per class, with a clash check, published to students | S |
| Admit card / hall ticket PDF per student, with roll number, photo and the date sheet | S |
| Class 9–12 elective subjects come from the student's subject choice (4.1) | S |
| Grace marks/moderation with an audit trail; re-exam/compartment entry | L |
| NEP Holistic Progress Card (self, peer and teacher sections) | L |

### 4.6 Library (`features/library`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Books with copies and gap-free accession numbers, ISBN check.
- Issue desk with search and the borrower's load, and a safe last-copy race.
- Returns with fines (Rs 2/day) and fine waivers.
- Lost/damaged copies.
- Overdue list with the guardian phone.
- Stats and popular titles.
- Student "my loans".
- 31 tests.

**Half-built:**
- `memberHistory` is unused.
- Loan days, limits and the fine rate are hard-coded.
- A fine can be waived, but never collected.

| Gap | Pri |
|---|---|
| Library settings: loan days, limits per member type, fine per day | M |
| Barcode/QR: accession labels PDF (sheet of labels) and a scan-to-issue/return input (a USB scanner types the accession number) | M |
| Fine goes to the fee ledger: on return with a fine, post a "Library fine" line to the student's ledger (staff fines show on the loan only); a waiver cancels the line | M |
| Member history page (uses `memberHistory`) from the student record and the staff record | M |
| Renew a loan (once, if nobody is waiting) | S |
| Overdue reminder notice + email to the student login | S |
| Reservations/holds | S |
| Student catalogue search (OPAC) | S |
| ISBN auto-fill from an open API | L |
| Stock verification, e-books | L |

### 4.7 Transport (`features/transport`), built (2026-11-20; every M and S row, see docs/STATUS.md)
**Exists:**
- Vehicles with driver and attendant, seat checks.
- Routes with stops renumbered in order, morning and evening times, and a monthly fee per stop.
- Safe student assignment.
- Unassigned list.
- Roster PDF.
- Student "my transport" with tap-to-call.
- 24 tests.

**Half-built:**
- `TransportFeeHelper.monthlyFee` is unused, so nothing bills transport even though the stop fee and the fees head kind "transport" both exist.
- `gpsDeviceId` and `startsOn` are stored but never used.

| Gap | Pri |
|---|---|
| Transport fee billing: assigning a student adds a monthly transport line to their fee ledger from the next full month (full fee both ways, half one way); moving or unassigning changes it from the month after | M |
| Vehicle documents: fitness, insurance, permit, PUC and pollution with expiry dates and an uploaded copy; an alert to admins 30 days before expiry; an expired document flags the vehicle | M |
| Safety checklist per vehicle (GPS, CCTV, speed governor, lady attendant, first aid, fire extinguisher), configurable, shown on the vehicle page | S |
| Transport notices to a route's students ("bus late", "route changed") | S |
| Tracking link field on the vehicle, shown on "my transport" | S |
| Boarding attendance by attendant (mobile list, per trip) | L |
| Native GPS/RFID | L |

## 5. Roles and visibility
| Module | Admin | Teacher | Accountant | Student (family) | Custom-role grants |
|---|---|---|---|---|---|
| Academics | all | read | read | read own class | none new |
| Attendance | all | mark own sections, approve leave for own class | read | own record, apply for leave | `attendance:mark`, `attendance:manage` |
| Timetable | all | read, own week, own covers | read | own section | `timetable:manage` (Timetable in-charge) |
| Assignments | all | own sections/subjects | none | own work | none new |
| Exams | all | marks for own section+subject, remarks for own class | none | own published results | `exams:manage` (Exam coordinator) |
| Library | all | read + manage (default, can be removed) | none | own loans | `library:manage` (Librarian) |
| Transport | all | read | read + see transport fees | own route | `transport:manage` (Transport in-charge) |

Rules:
- Every new query stays inside `withSchool`.
- Every new write is audit-logged.
- The custom-role ban list (settings, billing, domains, setup) stays as it is.

## 6. Data changes (new tables and columns, nullable or with defaults)
| Module | Change |
|---|---|
| academics | `subject_groups` (class, name), `subject_group_subjects`, `student_subjects` (student, subject, year) |
| attendance | `leave_requests` (kind student/staff, person, from, to, reason, file, status, decidedBy); `attendance_condonations` (student, year, reason, file); `attendance_settings` (threshold %) |
| timetable | `substitutions` (date, slot, absentTeacher, coverTeacher, note) |
| assignments | `assignment_extensions` (assignment, student, dueAt); `submission_comments`; `assignments.publish_at` |
| exams | `co_scholastic_scales`; `paper_components` (paper, name, max); `component_marks`; `term_weights` (term, exam, weight); `report_remarks` (student, term, text); `report_templates` (class band, board, options) |
| library | `library_settings`; `loans.fine_paid_at`, `loans.fine_receipt` |
| transport | `vehicle_documents` (vehicle, kind, number, expiresOn, fileKey); `vehicles.tracking_url`; `vehicle_checklist` (jsonb) |

## 7. Acceptance (each item has a test)
1. A Class 11 student on the "PCB" group sees and is marked only in PCB subjects. Their report card lists only those.
2. Rolling the year forward copies class teachers and subject teachers. Choosing "skip teachers" leaves them empty.
3. Marking a student absent sends exactly one notice + email to that student login that day. Re-marking present does not send another.
4. A student applies for leave for 2 days and the class teacher approves. Those days show "leave" in the register, and the % treats them per the rule.
5. The board eligibility list shows a Class 10 student at 72%. Adding a medical condonation with a file moves them to "eligible (condoned)".
6. On a day a teacher is absent, substitution lists their 4 periods. Assigning a free teacher shows the cover on that teacher's "today", and a clash is refused.
7. The term report card for Class 9 shows the Term 1 and Term 2 columns, weightage-correct totals (PT + IA + exam), co-scholastic grades entered on screen, attendance days, and the teacher's remark. The legend matches the school's scale.
8. Changing a school's scale to ICSE marks-only removes the grade column from the card.
9. A paper with components (theory 80 + IA 20) sums correctly, and marks above a component's max are refused.
10. Library settings at 7 days and Rs 5 change the due date and fine of new loans. A scanned accession issues the loan. Collecting a fine stores the receipt, and the fine leaves the "due" total.
11. Assigning a student to a stop with Rs 800/month adds a transport line to their fee ledger from the start date. Unassigning stops it from the next month.
12. A vehicle with insurance expiring in 20 days shows on the admin home and in the bell.
13. A custom "Librarian" role can issue books and cannot open fees. A custom "Exam coordinator" can publish results.
14. School A/B isolation holds for every new table.
15. Phone width (375 px) works with no sideways scroll on every new screen. The register and report-card PDFs print on A4.

## 8. Build plan (parallel streams, one owner per folder)
| Stream | Owns | Builds | Depends on |
|---|---|---|---|
| S1 Academics | `features/academics`, the `student_subjects` UI on the student record (via a slot, as on the profile page) | electives/streams, rollover copy, default terms, houses | none; ship first (schema) |
| S2 Attendance | `features/attendance` | absence alerts, leave (student + staff), register PDF/CSV, staff register, eligibility + condonation | none |
| S3 Timetable | `features/timetable` | generator + rules wizard + review/lock/re-run, substitution (reads staff attendance and leave by raw SQL), print, copy week, room clash, versions | S2 schema for staff leave (raw SQL tolerates a missing table) |
| S4 Exams | `features/exams` | scale editor, co-scholastic entry, components, term report card, attendance + remarks on the card, template by board | S1 for electives (can mock until it lands); reads attendance by raw SQL |
| S5a Library | `features/library` | settings, barcode labels/scan, member history, renew, holds, OPAC, overdue reminders |
| S5b Transport + fee hooks | `features/transport`, `features/fees` | vehicle documents + alerts, checklist, notices, tracking link; transport fee and library fine lines in the fee ledger | none |
| S6 Assignments | `features/assignments` | reminders, extensions, CSV export, bulk grade, comments, schedule publish, orphan-file fix | none |

How we run it:
- At most 4 streams at once. Wave 1: S1 Academics + S2 Attendance + S5a Library + S6 Assignments. Wave 2: S3 Timetable + S4 Exams + S5b Transport/fees.
- Each stream writes unit tests and runs typecheck.
- The lead generates the one migration after each wave and runs the e2e on the production build (`*-prod` in launch.json). Agents do not run e2e.
- Migrations are generated once per wave by the lead (`pnpm --filter @smw/db generate`), never by the streams.

## 9. Out of scope (v1)
- GPS tracking and RFID.
- SMS/WhatsApp.
- HPC (data model kept open).
- Online MCQ tests.
- E-books.
- UDISE+ export.

## 10. Settled by Suman (2026-11-20)
1. Student leave: the class teacher approves (admin can override).
2. Library fines: go to the fee ledger.
3. Transport fee: from the next full month (my pick: simple, matches monthly billing).
4. Timetable: a whole-school generator is a must-have.

## 11. Confidence notes
- The CBSE formats for Classes 1–8 and 11–12 and the exact co-scholastic scale for 9–12 vary by circular year. They ship as editable presets, not hard-coded rules.
- Vendor feature claims come from vendor pages and search summaries, not demos.

## 12. Sources
- CBSE 75% attendance circular (2025): https://www.cbse.gov.in/cbsenew/documents/Strict_Compliance_attendance_Eligibility_05082025.pdf
- CBSE CCE manual, grading: https://www.cbse.gov.in/cce/cce-manual/chapter_3.pdf
- CBSE Secondary curriculum 2025-26: https://cbseacademic.nic.in/web_material/CurriculumMain26/Sec/Curriculum_Sec_2025-26.pdf
- CBSE Senior Secondary curriculum 2024-25: https://cbseacademic.nic.in/web_material/CurriculumMain25/SrSec/Curriculum_SrSec_2024-25.pdf
- CBSE report card circular 2017: https://cbseacademic.nic.in//web_material/Circulars/2017/14_Circular_2017.pdf
- CBSE APAAR circular (2025): https://www.cbse.gov.in/cbsenew/documents/Circular_Implementation_APAAR_ID_24012025_HINDI.pdf
- NCERT PARAKH Holistic Progress Card: https://parakh.ncert.gov.in/hpc
- Fedena 3.6 features: https://support.fedena.com/support/discussions/topics/317671
- Entab CampusCare: https://www.entab.in/school-management-software.html
- Entab GPS and library: https://www.entab.in/entab-blog-gps-track.html , https://entab.in/entab-blog-library.html
- Skolaro attendance and timetable: https://www.skolaro.com/attendance-tracking , https://www.skolaro.com/time-table-management-system
- PowerSchool SIS flyer: https://go.powerschool.com/rs/861-RMI-846/images/PowerSchool_SIS_Feature_Flyer.pdf
- Google Classroom grading and feedback: https://support.google.com/edu/classroom/answer/9093530
- NIC e-Granthalaya: https://egranthalaya.nic.in/DFILES/egranthalaya/Download/e-Granthalaya_Brochure.pdf
- School bus safety (CBSE 2017, reported): https://business-standard.com/article/pti-stories/school-buses-must-have-cctvs-gps-speed-governors-cbse-117022400895_1.html
