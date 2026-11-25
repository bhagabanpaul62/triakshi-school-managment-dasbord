# Student reads: fees, transport, library, finance

Wave 0, admissions core. Every read of `students` in these folders, with the verdict. File and line are as in the list taken at the start of the branch; the code has moved a few lines since.

"Joining" = status joining (billed and can pay, nothing else). "Left" = section stays, so a read by section must ask for active.

| file:line | what it reads | verdict |
|---|---|---|
| features/transport/notices.ts:22 | Riders of a route, to send a delay notice | Joining excluded by design (cannot ride); left excluded by design (status = active filter already there). |
| features/transport/service.ts:237 | Own student ids by login | Excluded by design: a joining login is off; a left login cannot open transport. |
| features/transport/service.ts:253 | Student looked up to give a route | Fixed: joining is refused with "has not joined yet", left with "has left the school". |
| features/transport/service.ts:283 | Name for the "removed from transport" audit line | Excluded by design: by id, writes nothing about status. |
| features/transport/service.ts:297 | Route roster (and the PDF list) | Fixed: only active students. A left student keeps a stop row but is not on the list. |
| features/transport/service.ts:342 | Students without a seat (assign picker) | Excluded by design: already filtered on active. |
| features/transport/service.ts:358 | Student view of own route | Fixed: active only (a left login cannot open transport anyway). |
| features/fees/base.ts:68 | Own student ids by login | Excluded by design: joining login is off; a left login keeps fees, so their own dues still show. |
| features/fees/base.ts:78 | Logins to notify (receipts, reminders) | Excluded by design: a joining child has no login yet, so no notice is made; the bill and receipt still exist. |
| features/fees/base.ts:105 | Student line (name, class, section, status) behind every fee page | Fixed: also reads joins_on and left_reason so every page can say "Joining <date>" or "Withdrew before joining". Section is only a label here, never a filter. |
| features/fees/base.ts:132 | Row lock on students in id order | Excluded by design: locks by id, no status test; joining children can pay. |
| features/fees/invoices.ts:69 | Student name on a bill page | Excluded by design: by id, any status. |
| features/fees/invoices.ts:139 | Class and admission date to find the plan late rule | Fixed: reads status so a joining child is a new admission of the joining year. |
| features/fees/plans.ts:337 | Student for a plan override | Fixed: reads status (joining = new admission). |
| features/fees/plans.ts:364 | Student for opt-in changes | Fixed: reads status. |
| features/fees/plans.ts:412 | Students put on a plan by hand (list) | Excluded by design: joining children may be on a plan; class label from class, section only a label. |
| features/fees/plans.ts:415 | Same list, rows | Excluded by design: as above. |
| features/fees/plans.ts:429 | Student for "back on the class plan" | Fixed: reads status. |
| features/fees/plans.ts:453 | Students who take optional fees (rows) | Excluded by design: joining children may opt in. |
| features/fees/plans.ts:455 | Same, count | Excluded by design. |
| features/fees/plan-billing.ts:47 | Who the published plans bill | Fixed: joining children are billed for their joining year only (never another), as new admissions, join rule counted from joins_on; withdrew before joining is passed over; left students unchanged (billed to left_on). |
| features/fees/dues.ts:175 | Dues report rows | Fixed: shows "Joining <date>" / "Withdrew before joining" tag, status filter has Joining, withdrew-before-joining is out of the overdue chase list. Joining children with open bills are listed on purpose. |
| features/fees/dues.ts:212 | Open dues per class (home) | Excluded by design: only students with an open bill appear, so a joining child counts only for a bill that is theirs. |
| features/fees/dues.ts:228 | Worst overdue (home) | Fixed: a child who withdrew before joining is not chased. |
| features/fees/dues.ts:296 | Dashboard dues by class | Excluded by design: same as 212, only open bills of the student. |
| features/fees/concessions.ts:47 | Concession list | Excluded by design: by student id, any status. |
| features/fees/concessions.ts:57 | Student for concession value | Fixed: reads status (joining = new admission). |
| features/fees/concessions.ts:84 | Student name for a concession request | Excluded by design: by id, any status. |
| features/fees/concessions.ts:189 | Sibling ranking | Fixed: joining children of that year rank after children already at school; joining children of other years stay out. |
| features/fees/concessions.ts:192 | RTE suggestions | Fixed: includes joining children of the year. |
| features/fees/concessions.ts:197 | Staff-child suggestions | Fixed: includes joining children of the year. |
| features/fees/charges.ts:45 | Row lock before cancelling unpaid charges | Excluded by design: lock by id. |
| features/fees/charges.ts:57 | Row lock before cancelling a charge | Excluded by design: lock by id. |
| features/fees/promises.ts:15 | Student exists for a promise | Excluded by design: any status may promise. |
| features/fees/promises.ts:34 | Broken promises list | Excluded by design: needs an overdue open bill; a joining child has none until a bill falls due. |
| features/fees/promises.ts:46 | Student exists for stopping reminders | Excluded by design: any status. |
| features/fees/slips.ts:46 | UPI slip list | Excluded by design: by student id, any status; family UPI slips are off for joining (login off). |
| features/fees/opening.ts:46 | Opening balance sheet rows by admission number | Excluded by design: any status; joining child gets the bill in the joining year (billYearOf). |
| features/fees/opening.ts:96 | Students still exist at approval | Excluded by design: by id. |
| features/fees/opening.ts:139 | Same at resend | Excluded by design: by id. |
| features/fees/receipts.ts:311 | Receipts filter by class | Excluded by design: a receipt belongs to its student whatever their status. |
| features/fees/desk.ts:47 | Desk search | Fixed: shows "Joining <date>", "Left <date>" or "Withdrew before joining" next to the match. |
| features/fees/settlements.ts:48 | Student name for a settlement | Excluded by design: any status. |
| features/fees/settlements.ts:100 | Settlement list | Excluded by design: by student id. |
| features/fees/move/mover.ts:64 | Legacy move reads all students | Fixed: a joining child counts as at school when planning moved bills. |
| features/fees/ui/lookups.ts:19 | Student picker | Fixed: tag "Joining <date>" etc. instead of the raw status. |
| features/fees/ui/lookups.ts:27 | Does the school have any student | Excluded by design: count of any student. |
| features/fees/ui/lookups.ts:64 | Active students of a class, for a group bill | Excluded by design: a group bill is the current year and reaches children at school only. |
| features/library/service.ts:45 | Logins to tell a hold is ready | Fixed: holds of left students are cancelled first, so only students at school are told. |
| features/library/service.ts:174 | Loans list (names) | Excluded by design: a loan out stays visible whoever holds it. |
| features/library/service.ts:227 | Overdue loans | Excluded by design: a left student with a book out is still chased. |
| features/library/service.ts:261 | Loans list page | Excluded by design: same. |
| features/library/service.ts:304 | Own loans by login | Excluded by design: joining login is off. |
| features/library/service.ts:320 | Class and phone beside a loan | Excluded by design: label only; a left student shows their last class so the desk knows whom to chase. |
| features/library/service.ts:355 | Borrower search at the desk | Excluded by design: active only, already. |
| features/library/service.ts:398 | Student who borrows | Fixed: joining and left are refused with a plain message (was "No active student"). |
| features/library/service.ts:502 | Member history header | Excluded by design: history of any member. |
| features/library/service.ts:573 | Own student ids by login | Excluded by design. |
| features/library/service.ts:586 | Student who reserves | Fixed: joining and left refused with a plain message. |
| features/library/service.ts:619 | Hold rows (names) | Fixed: the desk queue leaves out holds of students who left; holds also stop counting for copies set aside, the line and renewals. |
| features/library/service.ts:664 | Own holds in the catalogue | Excluded by design: by login. |
| features/library/reminders.ts:23 | Logins for overdue notices | Excluded by design: a left student with a book out is still told; joining has no loans. |
| features/finance/services/dashboard-extras.ts:83 | Active student count for cost per student | Excluded by design: status = active already; joining children are not at school yet. |

## Rules added in the review pass

- **New in the year they join, whatever the status.** `kindFor` says "new" when `joins_year_id` is the year (or status is joining); `sinceOf` counts the join rule from `joins_on`, else `admission_date`. `kindCols` (in `plans.ts`) is the one set of columns every pool selects (plan billing, resolve, concessions estimate, plan override, opt-ins, late rule). The same child before and after the day gets the same plan, months and amounts, and is "existing" the year after.
- **Own year for early starters.** `billYearOf` (manual, group, bounce, opening bills): joining -> joining year; a child at school with `joins_year_id` or an enrolment in a year later than the school's current one -> that year; else the current year.
- **Withdrew before joining.** Money owed or held stays visible: the dues report row and its `due` total, the student's account, `outstanding`. Leaves out: overdue and ageing (rows, totals, home and dashboard), dues by class, the month's and year's billed figures, the chase list. The report totals carry `neverStarted` (the part of `due` that belongs to such children). The student fees page shows one next step (`withdrewStep`): bills to cancel or credit first, then deposit or advance to give back through Settle up and refund.

- **Seats.** A left student keeps the stop row but takes no seat (every count reads active riders). `assertRiderFits(tx, studentId)` in `features/transport/service.ts` re-checks capacity when a child is counted again (brought back); it throws `LimitError` when the vehicle is full.

## Other places that changed for the same reason (not in the list)

- `features/fees/plan-billing.ts`: a year with no published plan still lists the joining children of that year, with "Joins on <date>".
- `features/fees/invoices.ts`, `cheques.ts`, `opening.ts`: a custom bill, a group charge, a bounce charge and an opening balance for a joining child go to the joining year (`billYearOf` in `base.ts`), not the current year.
- `features/fees/reminders.ts`: nightly run and "Remind now" skip a child who withdrew before joining.
- `features/transport/service.ts`: seat counts, route and stop rider counts, vehicle limit check, roster and the monthly fee read only students at school. `features/transport/billing.ts`: the monthly re-bill no longer posts months for a student who left, and cancels unpaid months from the month after they left.
- `features/library/service.ts`: a hold of a student who left is cancelled when the next copy is settled, and is not counted for copies kept aside, for the line, or for renewals.

## Not changed on purpose

- A nightly auto-issue for the joining year was not added: `fees.issue-invoices` bills the current year only. The office, or the admission flow, issues the joining year with `issueBulk({ yearId, studentIds })`.
- Dues route filter (`dues.ts`, `student_transport` exists test) still matches a student who left and kept a stop: it is a list of who owes, not a roster.
