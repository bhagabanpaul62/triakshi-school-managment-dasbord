# PRD: Admissions, leaving and certificates

Status: **approved 2026-11-26 with every default in section 15**, reviewed once against the code. Wave 0 is being built. Choices that need the owner are in section 15.
Builds on [WEBSITE-ADMIN-PRD](WEBSITE-ADMIN-PRD.md) (enquiries), [PEOPLE-PRD](PEOPLE-PRD.md), [FINANCE-PRD](FINANCE-PRD.md), [COMMUNICATION-PRD](COMMUNICATION-PRD.md) and [ACADEMICS-PRD](ACADEMICS-PRD.md).

## 1. Goal
**One record from the first form to the last certificate.** A family applies without visiting, the school chooses by a rule it can show, the child is ready before the first day, and when the child leaves, everything is cleared and the certificate is printed in minutes.

**The problem.** Enquiries are handled well now, but they end at a button. "Applied" and "Offered" are only labels: there is no form, no documents, no offer, no seat behind them. A child who joins next April cannot be admitted today. Leaving is a status in an edit form. A transfer certificate is typed in Word.

**Six rules everything follows**
1. **A stage is earned.** Applied means a submitted form. Offered means a letter with a date. Admitted means a student record. Nobody drags a child to a stage.
2. **A seat is counted once.** Seats, offers and joins come from one count, locked when an offer is made.
3. **A child joins on a day.** Before that day they are "joining": they can pay and get papers, and they appear in no register, timetable, audience or plan count.
4. **The school's rule is written before the forms arrive**, and every choice can be explained from it.
5. **A certificate issued is permanent.** It is cancelled with a reason and issued again. Never edited, never deleted.
6. **Dues are the finance team's matter.** They are never printed on a transfer certificate and never stop one.

### 1.1 Success measures
Our hypotheses: we have no baseline. All are counts inside one school.

| Measure | How measured | Target (first season) |
|---|---|---|
| Application finished once started | drafts and submits | 70% |
| Applications complete at first check | no "please send again" | 80% |
| Offer answered before it expires | offers | 90% |
| Retyping at admission | fields changed on the confirm screen | under 3 |
| Transfer certificate, request to print, when clear | leaving case | same day |
| Two children for one seat | seat ledger against joins | 0 |

### 1.2 Who it is for
| Person | Main need |
|---|---|
| Parent (no login yet) | apply on a phone, stop and come back, know where things stand |
| Front office | one queue: what to check, who to call, what is missing |
| Principal | seats, selection, exceptions, one click to send offers |
| Accountant | form fee and admission fee in the books, with receipts |
| Class teacher | know who joins on Monday |
| Family of a child who leaves | one request, one list of what is pending, the certificate |
| Another school | check that a certificate is real |

## 2. What exists today (read and tested on `feat/website-admin`, 2026-11-26)

### 2.1 Works and stays
- Enquiries: references, owners, next steps, visits, merge, import, reports, seats per class, public form with consent, admit with a claim so one child is not admitted twice, link to the student.
- Student admission in one transaction: number, login, enrolment, guardian, plan limit. Import with a dry run. Promotion. Erasure of a left student's optional data.
- Fees: plans for new or existing students, deposits as money owed back, counters, UPI slips, refunds, no-dues check, tuition certificate, settlements.
- Requests has a "Certificate" category. Meetings has bookable slots. Documents print as PDF with a QR and a public check page.

### 2.2 Defects
**Proof:** P = reproduced by a throwaway test on a real database, then deleted. R = read in code.

| # | Defect | Proof |
|---|---|---|
| A1 | A child cannot be admitted into next year's section: "Choose a section of the current academic year". | P |
| A2 | With a class and a joining date of 1 April next year, the child is **active today and enrolled in this year**, so this year's counts and the plan limit include them. | P |
| A3 | Marking a student left does not close the record fully (section, enrolment, access). Fixed first in wave 0. | P |
| A4 | The leaving date is always today. No reason, no last day attended, no clearance of books, bus or dues. | R |
| A5 | The same child (name, birth date, phone) can be admitted twice with no warning. | P |
| A6 | A child born last month can be admitted to Class 12. A birth date in 2030 is accepted. | P |
| A7 | Enquiry seats are keyed by class **name** and only shown; nothing stops an offer past the last seat. Renaming a class loses its seats. | R |
| A8 | "Applied" and "Offered" can be set with nothing behind them. | R |
| A9 | Money cannot be taken before a student exists (every receipt needs a student). Schools make the student early to take the fee, which causes A2. | R |
| A10 | One guardian only at admission; the second parent is a separate visit to the record. | R |
| A11 | No transfer, bonafide, character or study certificate. No issue register. | R |
| A12 | Only the APAAR ID is stored. No Permanent Education Number (PEN), so a transfer on the national portal cannot be followed from here. | R |

### 2.3 Not there at all
Application form, documents from the family, application status page, form fee, verification, selection rule, test or interaction with scores, draw of lots, merit or selection list, waiting list that moves by itself, offer and acceptance, next-year admission, readmission, sibling checks at selection, leaving case, clearance, certificates, alumni contact.

## 3. Research

### 3.1 What mature products do
D = vendor page. S = seen in a search result, directory or review only. J = our judgement.

| Capability | Where | | We take |
|---|---|---|---|
| Enquiry to contract in one system | Finalsite Enrollment | S | yes, on our enquiries |
| Inquiry, application, decision, enrolment, re-enrolment; free for applicants | OpenApply | S | yes; re-enrolment is our promotion |
| Forms, uploads, fee, acknowledgement and receipts, all adjustable | Entab CampusCare | S | yes |
| Assessment and evaluation scores beside the file | admissions categories on review sites | S | only where the law allows |
| Points by distance, sibling, alumni; draw in front of parents for ties; lists on published dates | Delhi private schools, 2026-27 | S | the points and draw method |
| Certificate with a public check | common in Indian ERPs | J | yes |

**Limit:** vendor help pages were not opened. Claims marked S are not proof of how those products behave.

### 3.2 Law and board rules that shape the product
**Read** = the text on a public copy. **Reported** = a news, guide or law-blog summary. The owner must have a lawyer confirm every row for the school's own state.

| Topic | What it says | Source | What we do |
|---|---|---|---|
| Screening | The RTE Act s.13 bars a capitation fee and any screening of child or parents. Screening is any way of choosing other than a random one. "Child" is 6 to 14. Fines apply. | Read: [s.13](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/13.php), [s.2](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/2.php) | no test or interview for classes 1 to 8; selection by rule or draw |
| 25% seats | Unaided schools admit at least 25% of Class 1 from weaker and disadvantaged groups. | Read: [s.12](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/12.php) | seats in a separate pool, filled from the state's list, never by our selection |
| Age proof | Nobody is refused for lack of it. | Read: [s.14](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/14.php) | birth proof can be "to follow", with a task |
| Late joining | Nobody is refused for coming late. | Read: [s.15](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/15.php) | a closed cycle still lets the office admit |
| Transfer certificate | Issued at once; a delay is no ground to refuse admission. The transfer right in s.5 itself is not to a private unaided school. | Read: [s.5](https://www.advocatekhoj.com/library/bareacts/rightofchildrentofree/5.php) | TC "to follow", never a blocker for classes 1 to 8 |
| Dues on a TC | Madras High Court, July 2024: not to be written on a TC, nor used to collect; a TC is not a condition to join. | Reported: [SCC Times](https://www.scconline.com/blog/post/2024/07/22/transfer-certificate-cannot-form-basis-for-denying-admission-school-to-collect-arrear-fees-parents-madras-high-court/) | rule 6, for every state |
| CBSE TC | A 2018 circular asks schools to put issued TCs on their site, and the admitting school to check there. Countersigning is not needed between CBSE schools. | Reported | a check page by number, off by default as a public list (names of children) |
| Form fee | Delhi: ₹25, not refundable; no forced prospectus. Other states differ. | Reported: [Careers360](https://news.careers360.com/delhi-private-school-admission-2026-nursery-class-1-application-from-december-4-doe-reiterates-age-limit) | school sets it, with a note that the state may cap it |
| PEN and APAAR | The old school releases the child on the national portal, the new school takes them in. APAAR needs a parent's consent. Sources disagree on whether it is compulsory. | Reported: [Careers360](https://school.careers360.com/articles/udise-plus-student-module-2026-27) | fields and a task; no link to the portal; Aadhaar is never asked or stored |
| Privacy | Notice in plain words: what is collected, why, how to withdraw and complain. Verifiable consent of a parent for a child's data. The school exemption covers **tracking and monitoring** for education and safety, so we do not rely on it for applications. | Read: [rule 3](https://dpdpa.com/dpdparules/rule3.html), [rule 10](https://dpdpa.com/dpdparules/rule10.html), [schedule 4](https://dpdpa.com/schedule/schedule4.html) (unofficial copy) | itemised notice, consent with version, keeping time, delete on request |

**Not confirmed:** CBSE rules for direct entry to Classes 10 and 12, the last date of admission, and the official list of TC fields (the official pages refused our reader). The TC template is therefore editable.

## 4. How it fits: two modules
- **`features/admissions`**: cycles, forms, applications, checks, selection, offers, joining.
- **`features/certificates`**: leaving cases, clearance, certificate templates, issue and register. Useful without admissions.

Both require `students`. They import `students`, `academics`, `notifications` and (for printing and the check page) `finance/templates`; Finance is a core module, so it is always on. Certificates adds its own lookup to `VERIFY_LOOKUPS`. Fees, expenses, enquiries, library, transport and requests are joined in `apps/school/src/lib` by small adapters, and any of them can be off. No feature imports these two. Plans: both in Growth and up.

**Wave 0, in the core, for every plan:** A1, A2, A3, A5, A6, A10, A12, and from A4 the last-day date and reason. Starter keeps enquiries and direct admission with these fixes. It has no leaving case and prints no certificate; its menu says so.

**School states.** Read-only, suspended or pending: apply pages say closed, jobs skip the school, no offers or reminders go out. Accepted families still see their status page.

### 4.1 "Joining": the one change to the student
`students.status` gets `joining`, with `joins_on`, `joins_year_id` and `joins_section_id` (the plan for the day; the real section stays empty until then).

| | joining | active | left / alumni |
|---|---|---|---|
| Register, timetable, audiences, library, transport | no | yes | no |
| Counts against the plan | no | yes | no |
| Bills, receipts, advances, refunds | **yes, for the joining year** | yes | dues only |
| Login (`users.status`) | disabled; switched on with the day | active | see 9.4 |
| Enrolment row | in the joining year | this year | closed with its outcome |
| Section strength for offers and promotion | **counted** | counted | no |

- **Reads.** Most reads filter on active and leave joining out by themselves. Some do not filter at all (a student's own pages look up by login). Wave 0 lists every read of `students`, Drizzle and raw SQL, in the PR: each is "excluded by design" or "fixed". Plan billing today treats every status but active as left; it learns joining.
- **The joining year must exist** with its classes, sections and, when Fees is on, a published fee plan for the class before a class line opens. Placing a child in a named year becomes allowed for joining only; normal admission still means this year.
- **`admissions.join-due`** (daily 00:10 IST) makes a child active on the day, gives the roll number, switches the login on and tells the class teacher. It works on the child's own year even when the school has not yet switched the current year. It waits, and tells the office why, when: the fee rule of the line is not met (`none`, `admission fee`, `admission fee and deposit`), no section is chosen, or the plan limit is full. The family then reads "Your place is kept. The school will confirm the date."
- **Plan limit:** accepting skips it (a warning to the principal); the joining day obeys it.
- **Promotion** shows "3 joining children are planned into this section" and the seat sum is taken again after it runs.
- **Never joined:** the row becomes left with the reason "withdrew before joining". It is never deleted if money exists; optional data is erased at the keeping time. Its admission number is not used again and shows in the register.

## 5. Cycles and seats
`/app/admissions/cycles/[id]`: a **cycle** is one session's admission (for example 2027-28), with opening and closing dates per class.

- **Class line:** joining year and class, seats, pools (general, 25%, staff children, sibling, school-made), age rule (on a date, from and to, who may override), form, form fee, what must be paid before joining, documents, selection method, dates.
- **Seat ledger:** every offer takes a seat from a pool, every refusal or expiry gives it back; a row lock on the class line makes two offers for the last seat impossible. Moving seats between pools is logged. The 25% pool never gives seats to another pool without a typed reason.
- Seats start from the sections' capacity less children being promoted in, shown as a sum the principal can change. The old enquiry seats are read once into the first cycle, by class. A child from the 25% pool is accepted with `rteQuota` set, which fee concessions already read.
- A cycle has states draft → open → closed → finished. A finished cycle is read only. Late admission stays possible, marked late.
- **Admit without a cycle** stays as today, for a child who walks in mid-year.

## 6. The application

### 6.1 The family's side (public, phone first)
| Page | What |
|---|---|
| `/admissions` section | which classes are open, till when, seats shown or hidden (school's choice), fee, what to keep ready, "Apply" and "Continue my application" |
| `/apply/[class]` | 4 short steps: child, family, school and health, documents. Saves after each step. Progress starts with the class already chosen |
| `/apply/status` | one line per application: what was received, what is missing, what happens next, dates, the offer |

- **No password.** The family enters an email and gets a 6-digit code; the link in the mail also opens it. A phone-only family applies at the counter, where the office fills the same form; the paper has a QR for the status page. (SMS waits on DLT.)
- Two or more children under one email. Family details are typed once.
- From an enquiry, the form is already filled; the enquiry moves to Applied when it is submitted. With the module on, the enquiry board refuses Applied, Offered and Waitlist by hand and shows "Open the application"; Admit on such an enquiry does the same. Enquiries already at those stages when the module is switched on keep the stage and get "Start the application". Enquiries without an application admit as today.
- **Documents:** photo, birth proof, address, report card, TC, and what the school adds. Each is required, optional or "can follow". PDF or photo, 10 MB, checked by content, private.
- **Age rule** is told while choosing the class ("3 to 4 years on 31 March 2027"). Outside it: the office can be asked for an exception; nothing is silently refused.
- **After submit:** number `A-2027-0042`, a PDF of the form, a mail. Changes after submit only when the office asks.
- Never asked: Aadhaar, parents' income or education marks (the notice says so). Health questions say who sees them.

### 6.2 Form fee
Optional per class. By UPI QR of the school with the UTR and a screenshot, or at the counter. (Online gateway for parents: owner decision, not in this build.) Family UPI slips need a student, so these live in `adm_payments` with their own one-use UTR rule (also checked against fee slips) and review queue. On approval the adapter records it through Expenses' other income, account "Admission form fee", with the applicant's name; the receipt prints from there. Expenses off: marked paid with a reference, and no book entry. Refund only with a reason and approval.

### 6.3 The office's queue
`/app/admissions`: **Today** (to check, to call, sessions today, offers ending, joining this week), **Applications** (filters, saved views, bulk, CSV), **Seats**, **Reports**.

One application `/app/admissions/[id]`: header with the stage and **one** next action; left: the form side by side with the documents (accept, or "send again" with a reason); right: checks, seat, family, sibling, staff child, duplicates, enquiry, fee, timeline.

**Stages:** draft → submitted → checking → complete → in selection → selected / waiting / not selected → offered → accepted → joining → joined. Ends: withdrawn (family), closed (office, reason), offer ended.

**Checks made by the system:** age, duplicate child (name, birth date, phone; also an existing or left student), sibling by guardian phone (confirmed by a person), distance typed by the family (never measured), document list, fee.

### 6.4 States, errors, words
Saving, saved, offline (kept on the phone, sent when back), link expired (send a new one), closed cycle, full class (apply for the waiting list), already applied (open it), file too big or wrong type (what to do). No step loses what was typed.

## 7. Selection
Method per class line, fixed when the first form arrives; a later change needs a reason and is shown in the log.

| Method | How | Allowed |
|---|---|---|
| First come | by time of a complete submit | any class |
| Points | criteria and points published on the admissions page; every child's points explained line by line | any class; the screen reminds that some states fix or ban criteria |
| Draw of lots | from all, or among equal points | any class |
| Assessment | test, interaction or both, with slots, scores, remarks, a panel | **classes 9 to 12 only by default**; for pre-primary to 8 the choice is off, with the reason, and turning it on needs an admin's typed reason and is logged |
| State list | names from the state's list for the 25% pool, imported | that pool only |

- **Draw:** a date and time; the list is frozen and its fingerprint shown before; the seed is made from numbers typed by parents present plus a random part fixed beforehand; anyone can run the same draw again from the printed sheet and get the same order.
- **Assessment:** its own sessions (Meetings slots need a student record), with the same rule of one place at a time; hall list, score sheet, "did not come", second date. Scores are seen by the panel and admins only.
- **Result:** a draft list the principal reads first (with seats and reasons), then publish: family's own status only. A public list is by application number, never a name.
- **Waiting list:** ordered, with "position 3 of 12". A given-back seat offers itself to the next child after the principal's one click, or by itself if the school chooses.

## 8. Offer to joining
1. **Offer:** letter from a template (PDF, school's own words), what must be paid before joining and by when, last date to answer (default 7 days), conditions ("TC to follow by"). Bulk for a published list. Takes the seat.
2. **Reminders** 2 days and 1 day before the end; then the seat goes back and the family is told plainly. The office can extend with a reason.
3. **Accept** on the status page: terms with version, name typed. Creates the student as **joining** with a number, both guardians (two with one phone are linked once, both relations kept), sibling link, documents, consents, PEN and previous school: one transaction, using the same claim as admitting from an enquiry, so the two can never make two students. Safe to repeat. The confirm screen shows the office what will be written.
4. **Admission fee:** a bill from the plan for new students, with the deposit as money owed back. Counter and receipts as today, because a student exists; the family sends its UPI slip from the status page, since the login is not on yet.
5. **Joining kit** on the status page: first day, section once given, books, uniform, bus request, login slip to print.
6. **Join day:** active, enrolled, login on, class teacher told, family welcome mail.
7. **Not joining:** withdraw before the day. The seat returns and the cycle's rule (percent by date, deposit in full) proposes a refund. Fees can refund only advances and deposits today, so it gets one new action, **give back a paid fee**: undo the part of the payment, credit the bill for it, the money becomes an advance, refund it through the existing approval.

**Readmission:** a left student is found by the duplicate check; the old record is reopened, admission number kept. *Same year:* that year's enrolment row is reopened and the gap dates are stored; plan billing skips what fell due in the gap. *Later year:* a new enrolment row. Old dues stay and are shown to the fees team. The login is switched on by the office.

## 9. Leaving and transfer

### 9.1 The leaving case
`/app/leaving/[id]`, started by the office, by a family's Transfer request, or by promotion: graduating the last class, or marking a child left there, opens and finishes cases in bulk. Fields: last day attended, reason (list plus words), where to, who asked, date asked.

### 9.2 Clearance
Lines belong to rights people already hold: fees `fees:read`, library `library:manage`, transport `transport:manage`, the rest by named person.

| Line | From | When open |
|---|---|---|
| Fees | no-dues check | shown to the fees team; **never blocks** |
| Deposit | fees | refund proposed after the last bill |
| Library | loans, holds, fines | list with "returned / lost / waived" |
| Transport | stop and route | ends on the last day |
| Requests and messages | open ones | told, closed after 30 days |
| School-made lines | lab, hostel, ID card | done by a named person |

Each line has an owner, gets a notice, and can be skipped by an admin with a reason. The case says what is waiting and for whom.

### 9.3 Finish
On the last day: status left with that date, enrolment outcome "left", last section kept for papers (reads by section ask for active), seats free, plan count down, audiences and registers stop, bus ends, teachers told. One transaction; undo within 24 hours of Finish by an admin with a reason: status, section, outcome, login and bus stop come back, the plan limit and the section are checked again, library holds are not restored. Refused, with the reason, once a certificate is issued or the freed seat is offered.

### 9.4 The login afterwards
For 90 days (setting) the family can sign in to **dues and receipts, certificates and results only**; then the login is disabled. It is cut in one place: the session context carries the student's phase, and the shell menu, pages, actions, files and API refuse everything else there, not module by module. Students who already left get the same from the day the migration runs.

## 10. Certificates

### 10.1 Kinds
Transfer (school leaving), bonafide, study, character, migration request letter, fee certificate (already in Fees, linked), and school-made. Each has a template with fields from a fixed list, editable words, second language block, signatures, header, page size, and a preview with a real student. TC ships with the usual fields (number, admission number, name, parents, birth date in figures and words, nationality, category only if the school turns it on, first class and date, last class, subjects, result, whether qualified for promotion, days attended, conduct, reason, dates). **There is no dues field and one cannot be added.**

### 10.2 Issue
1. Request (family or office) → 2. the office checks a filled preview; missing facts are asked for, never invented ("subjects: not recorded") → 3. approve (a role, or the principal) → 4. issue: number from the school's series (`TC/{session}/{n}`), PDF with QR, frozen copy stored, register row.

- **Copies:** "Duplicate" marked, with count and reason. **Cancel:** reason, the number stays used, the check page says cancelled. `cert_issues` is insert-only; copies, cancels and signed scans are rows in `cert_events`.
- A TC needs a finished leaving case. Bonafide: joining and active. Study and character: active, left and alumni. Someone whose login is off asks the office.
- **One way to ask:** Requests, category Certificate (kinds come from this module). Transfer opens a leaving case. No second request form. The migration adds the kinds for schools that already have the category.
- Bulk for a class (bonafide for a trip) as one PDF.
- Signed copies can be scanned back in.

### 10.3 Check page
`/verify/certificate/[token]` (QR) or a new page with number plus birth date (limited per address and per number): kind, number, date, state, name with middle letters hidden. Rate limited. No list, unless the school turns on a TC list (number and date only) for a board that asks for it.

### 10.4 Register
`/app/certificates`: every issue, filters, CSV, a printable admission register and TC register in the order of number.

## 11. Screens and menu
People group: **Admissions** (Today, Applications, Seats, Cycles, Reports, Settings), **Leaving**, **Certificates**. On the student record: "How they joined", "Certificates", "Leaving". On Home: admin (seats and what waits), class teacher (who joins this week), family (certificate requests). Setup checklist gets two steps, only when the module is on.

Every screen has loading, empty (with the first action), filtered empty, error with retry, no access and read-only states, works at 360 px and by keyboard, and has one filled button.

## 12. Permissions
| Permission | Admin | Accountant | Teacher | Student | Custom role |
|---|---|---|---|---|---|
| `admissions:read` | yes | yes | no | no | grant |
| `admissions:work` (check, call, note) | yes | no | no | no | grant |
| `admissions:select` (lists, draw, offers) | yes | no | no | no | grant |
| `admissions:manage` (cycles, forms, settings) | yes | no | no | no | no |
| `admissions:assess` (own panel only) | yes | no | yes | no | grant |
| `certificates:read` | yes | no | no | own | grant |
| `certificates:prepare` | yes | no | no | no | grant |
| `certificates:approve` | yes | no | no | no | grant |
| `leaving:manage` | yes | no | no | no | grant |
| clear a line | yes | fees line | by the right in 9.2 | no | by the right in 9.2 |

Support sessions see counts, never forms, documents, scores or health answers. Scores and health answers are hidden from anyone without `select`, `assess` or the medical right.

## 13. Data and jobs
New: `adm_cycles`, `adm_lines`, `adm_pools`, `adm_forms` (versions), `adm_applications`, `adm_people`, `adm_documents`, `adm_events`, `adm_tasks`, `adm_access` (hashed codes and links), `adm_seat_moves`, `adm_criteria`, `adm_points`, `adm_draws`, `adm_sessions`, `adm_scores`, `adm_offers`, `adm_payments`, `adm_settings`; `leaving_cases`, `leaving_lines`; `cert_templates` (versions), `cert_issues`, `cert_events`, `cert_series`. All with `school_id`, row security, forced, and an isolation test each.

Changed: `students` (`joining`, `joins_on`, `joins_year_id`, `joins_section_id`, `pen`, `left_reason`; `left_on` is the last day attended), `enquiries` (`application_id`; stages Applied and Offered follow the application when the module is on), `enquiry_seats` (read once, then not used while the module is on).
**Migration 0014**, hand-written steps: left students' enrolments closed; future-dated active students are **listed for the school, never changed by us**.

Jobs: `admissions.clock` hourly (dates open and close, offers end, reminders, tasks) · `admissions.join-due` daily · `admissions.retention` daily · `leaving.finish` daily · `certificates.render` on demand.

Keeping time: drafts 60 days; not joined 12 months after the cycle ends (setting 6 to 36); joined: goes with the student; scores 12 months; certificates and the registers are permanent. Families are told 7 days before a draft is removed.

**Privacy:** every `adm_*` table is in the privacy catalogue for export, erasure and keeping time, by application (today's catalogue works only by student). Erasing an applicant removes forms, files, scores and codes and keeps one line "A-… erased on date". Certificates and the registers are legal records; the notice says they stay.

Topics: `admission.work`, `admission.offer`, `admission.joining`, `leaving.line`, `certificate.ready`. Applicants get email through the same daily budget, before notices and after codes.

### 13.1 Quality bar
- Public pages p95 under 300 ms; list of 5,000 applications under 300 ms; publish a list of 1,000 under 2 s; draw of 5,000 under 1 s.
- Public posts: rate limits per address and per email, honeypot, time trap, content-checked files, quota per application (30 MB), codes hashed, 10 minutes, 5 tries, the same answer whether an email is known or not.
- Audit on every staff write; personal fields say "changed" only.
- API v1: read applications, seats and certificates; webhook-free.

## 14. Acceptance

### 14.1 Journeys (browser, production build, all green twice)
| # | Journey |
|---|---|
| J1 | Parent on a phone: enquiry mail → form filled → stops at step 3 → returns by code next day → uploads → submits → gets the number and PDF |
| J2 | Two children, one email; the second form asks only for the child |
| J3 | Office: a document is refused with a reason, the family sends a new one, the application is complete |
| J4 | Phone-only family at the counter: paper form typed in, fee in cash, receipt, status by QR |
| J5 | Form fee by UPI slip: wrong UTR refused, right one accepted, seen in the books |
| J6 | First come: seats run out, the next child waits, a refusal moves the list |
| J7 | Points with a tie → draw → the same draw run again gives the same order |
| J8 | Class 9 assessment: slots, absent, score, list; the same is not possible for Class 3 |
| J9 | 25% pool from the state list; the pool cannot be raided |
| J10 | Offer → reminder → accept → joining student, two guardians, sibling, documents → bill and deposit paid → joining day → active, login works, teacher told |
| J11 | Offer ends by itself; seat returns; next child offered |
| J12 | Accepted, then withdraws before the day: refund by rule through approval |
| J13 | Two staff offer the last seat at once: one gets it, the other is told |
| J14 | A left student returns: found, reopened, one record |
| J15 | Leaving: request → clearance (book returned, dues open) → last day → TC issued with dues open and **nothing about dues on it** → login limited |
| J16 | Bonafide: family asks, office prepares, principal approves, family downloads, stranger checks the QR |
| J17 | TC cancelled and issued again; the old QR says cancelled |
| J18 | Custom "Admissions desk" role: sees only its work; teacher sees only their panel; support session sees no form |
| J19 | A parent who never joined asks for deletion: files, scores and codes are gone, the register line stays |
| J20 | A child returns in the same year: one enrolment row, the gap is not billed |
| J21 | Year end: promotion runs while children are joining; no seat is sold twice; they go active before the year is switched |
| J22 | Empty school, first day: from nothing to an open class in under 10 minutes |

### 14.2 Must hold (unit and isolation)
1. No child is counted in this year's registers, audiences, bills by plan or limit while joining. 2. Seats taken never pass seats, under 50 parallel offers. 3. Accept twice, or crash in the middle, makes one student. 4. An application of school A never opens for school B, by id, link, code or file. 5. An expired or wrong code never says if the email exists. 6. The draw is the same for the same input. 7. Classes 1 to 8 cannot have an assessment without the logged exception. 8. No template, field or API puts dues on a TC. 9. An issued certificate row and file cannot change (database rule). 10. Numbers have no gaps and are never reused. 11. Retention removes files as well as rows and never touches a joined child. 12. Each of A1 to A12 has a test that fails on today's code, written in its wave. 13. Enquiries work unchanged when the module is off. 14. Migration 0014 on a copy of old data changes no active student.

## 15. Choices for the owner (default first; a plain "yes" takes all defaults)
| # | Choice | Default | Why |
|---|---|---|---|
| 1 | Two modules, in Growth and up | **Yes** | certificates are useful alone |
| 2 | "Joining" status in the core for every plan | **Yes** | A1 and A2 |
| 3 | Family access by email code, no password, no SMS | **Yes** | SMS waits on DLT |
| 4 | Parent payment stays UPI slip and counter | **Yes** | owner's earlier decision |
| 5 | Assessment off for classes up to 8 | **Yes** | RTE s.13 |
| 6 | Dues never on, never block, a TC | **Yes** | rule 6 |
| 7 | Left families keep dues and papers for 90 days | **Yes** | they still owe or need receipts |
| 8 | Waiting list moves after the principal's click | **Yes** | a person decides about a child |
| 9 | Category and religion off in the form by default | **Yes** | collect less |
| 10 | Build wave 0 first, alone, as its own PR | **Yes** | small, and everything else stands on it |

## 16. Build plan
Branch `feat/admissions`, from `main` **after PR #7 is merged** (it holds the enquiries this builds on). Sonnet agents for code with file ownership, Haiku for narrow reads, a separate reviewer.

| Wave | What | Runs with |
|---|---|---|
| 0 | Core: joining and the read list, next-year placing, billing a joining child, duplicates, age, two guardians, PEN, leaving closes the record, limited access in one place | alone, first |
| 1 | Cycles, seats ledger, forms, family access, files | 2 |
| 2 | Certificates: templates, issue, register, check page | 1 |
| 3 | Applications desk, checks, form fee adapter | 4 |
| 4 | Leaving case, clearance, undo | 3 |
| 5 | Selection: first come, points, draw, assessment, state list | 6 |
| 6 | Offers, accept, joining, give back a paid fee, readmission | 5 |
| 7 | Enquiry, Home, Requests, setup, export, privacy, API, jobs | alone |
| 8 | Journeys, crawl, axe, speed, review, docs | alone |

Lesson from the last module: run unit, accessibility, links and old browser tests side by side from the first day, in a clean checkout without `.env`, and make no test depend on the hour.

## 17. Not in this build
| What | Why |
|---|---|
| Parent payment gateway | owner decision |
| SMS and WhatsApp sending | DLT and approval pending |
| National portal link, DigiLocker, Aadhaar checks | no public access for us; Aadhaar is never stored |
| Online tests taken in the browser | an exam product of its own |
| ID cards, gate passes, hostel | next modules; ID cards can reuse the certificate printer |
| Alumni network | only a contact list now |
| Scores by a model, ranking of children | never: choices must be explainable |

## 18. Risks
| Risk | Guard |
|---|---|
| A school uses points or tests its state bans | defaults off, reasons typed and logged, notice on the screen; a lawyer's check is the owner's task |
| "joining" let in where a read has no status filter | the read list of wave 0; one test per module that a joining child is absent |
| Email depends on Communication's sending domain | counter path complete without email |
| Children's files in storage | private area, checked routes, short links, quota, keeping time, erasure |
| Two ways to make one student | one path only: see 8, step 3 |
