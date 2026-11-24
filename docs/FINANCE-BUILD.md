# Finance build contract (rules for anyone changing finance code; the guide to what is built is FINANCE.md)
Repo: /Users/sumanjana/Desktop/triakshi-school-managment-dasbord. Spec: docs/FINANCE-PRD.md (sections 1, 5, 6, 7, 11). Feature rules: features/README.md.

## Rules for every agent
- Stay inside the files you own. Need a change elsewhere? Describe it in your report; do not make it.
- Use Edit/Write for source. No git commands. No commits. Never run db:reset, db:fresh, db:seed, migrate or generate. No browser, no e2e, no dev server.
- Tests: vitest with the suite's own database (Postgres is up on 5433). Run only your package: `pnpm --filter <pkg> test` and `typecheck` (tsgo). Print only failures.
- Comments explain only a why the code cannot show. No dead code, no "for later" options. Plain words in UI text; no em dashes.
- OOP and DRY: services extend SchoolService / CrudService / MoneyService (features/finance/base.ts). One rule lives in one place. Never copy a helper that exists.
- Money: integer paise. Helpers in `@smw/feature-kit/money` (apportion, percentOf, rupees, todayIST, fyOf, addDays, addMonths, monthEnd, daysBetween, inWords). Dates are "YYYY-MM-DD" strings. Client components import `@smw/feature-kit/money`, never `@smw/feature-kit`.
- Every change of money: one `write()` transaction, lock the rows you change (`.for("update")`, students in id order), post to the ledger in the SAME transaction with a unique sourceKey, audit it.
- Foreign keys ignore RLS: check any id from input belongs to this school by selecting it in the same tx.
- Nothing issued is edited or deleted. Wrong bill -> note or cancel + new version. Wrong receipt -> reversal after approval.
- Permissions are checked by `this.authorize/read/write`; UI hides with `can()`.

## Ledger API (features/finance; done, do not change)
`posting.ts`: postJournal, reverseJournal, nextNumber(tx, schoolId, key, day), cashAccount(tx, schoolId, {id?, kind}), balanceOf, postingDate, SERIES_DEFAULTS. `chart.ts`: SYSTEM_ACCOUNTS keys, systemAccounts. `approvals.ts`: requestApproval(tx, ctx, {...}), ApprovalHandlers, ApprovalService. `settings.ts`: loadFinanceSettings. `base.ts`: MoneyService {post, reverse, number, askApproval, settings, moneyDate}. Schema in `schema.ts`.
Each module exports `approval-handlers.ts` -> `export const <module>Approvals: ApprovalHandlers`. The app route merges them.

## Fees engine (features/fees; schema.ts and constants.ts are done; stream B writes services)
Permissions in feature.ts: read [admin, accountant], collect [admin, accountant], setup [admin, accountant], concede [admin, accountant], self [student]. (`manage` is gone.)
Files and main API (all classes take Ctx):
- `calc.ts` pure, client-safe: `lateFee(rule, {dueOn, until, openPaise, fixedPaise})`, `dueState(inv, today)`, `openOf(line|inv)`, `allocatePlan(invoices, amount, {lateFirst, today})` -> per-line parts + leftover (oldest due first; inside a bill late line first or last by setting; then lines in `sort` order), `previewInvoice(draft)` totals.
- `invoices.ts` InvoiceService: list(query), get(id) (full view: lines, notes, allocations, versions, live accrued late fee), saveDraft(input), issue(id), issueMany(ids), cancel(id, reason) (unpaid only; reverses the posting), revise(id, input) (cancel if unpaid, else credit-note the open part, then issue version+1), previewBulk({yearId, classIds, dueKeys}) and issueBulk(...) from plans (idempotent by sourceKey), opening balances import.
  `issueForStudents(tx, poster, ...)` shared by the job `fees.issue-invoices`.
- `plans.ts` HeadService (Crud), PlanService: list, get, saveDraft, newVersion(rootId), submit (asks approval `fees.plan`), copy, archive, resolve(tx, student, yearId) -> the published plan for a student (override, else class + admissionType), setStudentPlan, setOptIns, compareYears.
- `receipts.ts` ReceiptService: collect(input {studentId, date?, methods[], invoiceIds? | parts?, payerName?, note?}) -> receipt (allocates across the student's and chosen siblings' bills; leftover -> advance; cheque -> status clearing + fee_cheques; advance method spends feeAdvances; cash requires an open counter when the school uses counters), requestReversal(id, reason) -> approval `fees.reversal`, list, get, cashierDay.
- `dues.ts` DuesService: studentAccount(studentId) (ALL years: invoices, receipts, notes, concessions, advances, deposits, promises, timeline, balance), family(studentId) (siblings through shared guardians), report(query) (ageing buckets, class/head/route filters, includes students who left), overview() (dashboard, SQL aggregates only), collection reports (byHead, byClass, byMethod, byCashier, byDay), mine(), trend().
- `concessions.ts` ConcessionTypeService (Crud), ConcessionService (propose -> approval `fees.concession` unless under the limit; suggestions() for siblings, RTE (students.rte_quota), staff children), NoteService (waive, writeOff, correct -> approval `fees.note`), SettlementService (propose(plan) -> approval `fees.settlement`; parts via feeDueParts).
- `refunds.ts`, `cheques.ts` (deposit, clear, bounce), `counter.ts` (open, close, current), `slips.ts` (family submit, office verify -> receipt, reject), `promises.ts`, `certificates.ts` (data for statement, tuition certificate, no-dues).
- `charges.ts` keeps its exported names and signatures (ledgerYear, postCharges, cancelUnpaidCharges, chargeFor, cancelCharge) but works on fee_invoices (kind transport | library_fine). Transport and library code must not change.
- `checks.ts` nightly control checks: caches vs lines vs allocations; student dues account = sum of open invoices; advances and deposits accounts = their lists.
- `jobs.ts`: fees.issue-invoices, fees.reminders, fees.control-checks.
Postings: PRD 5.2. Source keys: `fees:invoice:<id>`, `fees:invoice-cancel:<id>` (use reverseJournal), `fees:note:<id>`, `fees:receipt:<id>`, `fees:advance-used:<id>`, `fees:refund:<id>`, `fees:cheque-clear:<id>`, `fees:late:<lineId>`. Every Student dues / advances / deposits line carries party {type:"student", id}.
Basis: accrual posts income at issue. Cash basis: at issue Dr student_dues Cr a deferred account is NOT used; on cash basis issue posts nothing, and the receipt posts Dr money, Cr income by head (advances still go to student_advances). Concessions on cash basis post nothing.

## Reusable finance components (packages/ui/src/components/finance, exported as "@smw/ui/finance/*"; stream U)
All typed, accessible (labels, focus ring, keyboard), 375 px safe, dark tonal kit tokens only (no hex, no left-edge stripe, no new colours), tabular numbers, motion = system fade only. Plain-data props so server pages can pass them.
- `Money` {paise, tone?, sign?, size?}; `MoneyInput` {name, valuePaise?, onChange?, label, error?, max?} (rupees in, hidden paise out)
- `StatusTrack` {steps: {label, state: "done"|"now"|"todo"|"failed", at?}[]}
- `StateBadge` {state} one map for every finance state -> label + tone (invoice due states, receipt, cheque, request, slip, payroll run, period)
- `AgeingBar` {buckets: {label, paise, href?}[]} stacked bar with values; `SplitBar` {parts} part-of-whole
- `LineItemsEditor` {heads, lines, onChange, readOnly?} rows with head picker, label, amount, remove, reorder, running total
- `DocumentPaper` {config, data, kind, mode: "screen"|"thumb"} HTML preview of any document (same config object as the PDF)
- `RecordPicker` {action(q) => Promise<{id,label,meta}[]>, name, label, multiple?, initial?} async search box (keyboard, debounce 250 ms, "/" focuses)
- `AmountSplit` {totalPaise, methods, onChange} several payment methods adding up to a total, with what is left
- `SidePeek` (wraps kit SidePanel) for row detail; `Timeline` {items: {at, title, meta?, amountPaise?, tone?, href?}[]} grouped by day
- `BulkBar` {count, actions} appears only when something is selected; `SelectableTable` = DataTable + checkbox column + BulkBar
- `PeriodPicker` {value, presets} month / quarter / FY / custom, writes search params
- `KeyTotals` {items: {label, paise, tone?, hint?}[]} compact totals row; `VarianceBar` {actual, budget}; `Sparkline` {points}
- `ReportTable` grouped rows with subtotals and a grand total, sticky header, CSV link
- `ConfirmMoney` (amount, reason field, "this cannot be edited later" line) wraps ActionButton/FormModal patterns
- `CopyValue` {value} truncates, copies, shows a tick for 1 s; `EmptyLine`, `SkeletonRows`, `ErrorLine` {retry}

## Screen rules (from /dashboard-ui; every screen)
1. Choose the container from the data: many comparable records -> table; one record -> grouped detail page or SidePeek; stages -> StatusTrack or board; change over time -> TrendArea; parts of a whole -> SplitBar; ranking -> sorted horizontal bars (HatchedBars/TickBar); one number -> BigStat/StatCard with delta; events -> Timeline.
2. Type every field first: category -> chip; status -> StateBadge; money -> right aligned, tabular; date -> short absolute; person -> avatar + meta; empty -> muted dash; ratio -> inline bar.
3. Identity first, then the one or two fields people scan for. Secondary actions behind a menu or on hover; filters collapse. No permanent control used by few.
4. Real states: skeleton (loading.tsx), empty (one line + the primary action), error (error.tsx with retry), selection, copy feedback, hover, focus.
5. Importance = size. No wall of equal cards. No decorative colour, no gradients.
6. Forms show the result before saving (totals, what will post). One column, sections, primary filled, secondary ghost.
7. Every list: search, filters, CSV link, pagination. Works at 375 px with no sideways page scroll.

## No dead ends (owner's rule, applies to every screen)
A screen is done only when all of these are true:
1. **Way in and way out.** Reachable from a menu, a list row or a button; has a back link or breadcrumb; after a save the person lands on the result, not a blank form.
2. **Next step.** Every state shows the one thing to do next as a button (draft invoice -> Issue; issued -> Collect; paid -> Receipt; rejected -> Edit and resend with the reason shown; waiting for approval -> who it waits for, Withdraw, and a link).
3. **Missing setup is never a wall.** If something is needed first (no plan, no cash account, no approver, counter closed, no bank detail, module off), say what is missing in one line and link straight to it, then come back (`?next=`). If this person may not fix it, name who can.
4. **Empty** = what goes here + the button that makes the first one. **Error** = what failed + Retry, with typed input kept. **No permission** = plain sentence + link home, never a blank page or a raw 403.
5. **Every refusal says why and what to do.** "Closed month" offers the open one; "counter is closed" offers Open counter; "already paid" links to the receipt; "waiting for approval" links to the request.
6. **Undo path.** Each money document shows its legal correction (cancel, credit note, reversal, reopen) or one line on why it has none.
7. **Links work both ways.** Receipt <-> invoice <-> student <-> journal entry <-> approval; bill <-> vendor <-> payment <-> journal; payslip <-> run <-> person <-> journal. No id shown without a link.
8. **Role complete.** Walk it as admin, accountant, cashier (collect only), teacher, family (student login), auditor (read only): each sees only what works for them, with no button that ends in a refusal.
9. No "coming soon", no disabled control without a reason, no link to a page that does not exist.

### Journeys that must work end to end (each becomes a browser test)
J1 First day: admin opens Finance with nothing set up -> checklist (cash and bank, UPI, number series, fee heads, plan, approve, publish, issue, open counter) -> first receipt, without leaving the flow.
J2 Plan: accountant drafts -> submits -> admin approves -> issue preview -> invoices issued -> family sees them.
J3 Counter: open -> find student -> siblings' dues -> split methods -> receipt -> print -> reprint says DUPLICATE -> close with a difference -> deposit to bank.
J4 Family: sees dues -> pays by UPI QR -> enters UTR -> office verifies -> receipt; and the rejected branch -> reason -> resubmit.
J5 Wrong bill: draft edit with live preview; issued unpaid -> revise; part paid -> credit note -> new version; family sees only the right one, history shows all.
J6 Wrong receipt: cashier asks reversal -> admin approves/rejects -> dues reopen / reason shown.
J7 Cheque: received -> deposited -> cleared; and bounced -> due reopens with charge -> collect again.
J8 Hard case: overdue student -> promise -> settlement (split + waive + write off) -> approve -> parts paid -> statement and no-dues certificate -> transfer.
J9 Leaving: student leaves with advance and deposit -> adjust -> refund -> approve -> voucher -> balance zero.
J10 Spending: vendor -> bill -> approval -> pay -> voucher -> vendor statement; rejected -> fix -> resend; petty cash; claim -> approve -> paid now or with salary.
J11 Salary: person -> pay details -> structure -> leave -> run -> fix unmarked days -> review -> approve -> bank file -> mark paid (one fails -> retry) -> payslip -> own profile; loan; exit settlement.
J12 Month end: bank import -> match -> unmatched fixed -> checks green -> close month -> late entry lands next month -> reopen; year close -> opening balances.
J13 Owner: dashboard number -> drill to list -> drill to document -> journal entry and back.
