# PRD: School finance: fees, receipts, expenses, payroll, accounts and statements

Status: **built** 2026-11-25 on branch `feat/finance` (approved 2026-11-24, decisions in section 14). How it works now: [FINANCE](FINANCE.md).

Built differently from this plan:
- Statutory rates are dated rows in code (`features/payroll/rates.ts`) with a school override table, not a platform table.
- Opening balances of cash and bank are set by an admin, not sent for approval.
- Payroll before month end: days still to come count as worked.
- The payment gateway and autopay for fees stay out (decision 14.1).
Builds on [AUTH-PRD](AUTH-PRD.md) (roles, family = student login), [PEOPLE-PRD](PEOPLE-PRD.md) (staff records) and [ACADEMICS-PRD](ACADEMICS-PRD.md) (leave, transport, library).

## 1. Goal
A school runs all its money here, with no second tool:
- **Money in:** bill every student, collect, give a proper receipt, chase dues, settle special cases.
- **Money out:** vendor bills, petty cash, salaries, statutory payments.
- **The truth:** every rupee posts to one ledger, so the day book, bank balance, dues and year-end statements always agree.

**Five rules everything follows**
1. **Nothing is edited or deleted after it is issued.** Wrong bill → credit note. Wrong receipt → reversal. Both stay visible.
2. **A bill is frozen when it is issued.** A later change of class, fee plan or year never changes it.
3. **The person who makes a money change does not approve it.**
4. **Every document posts to the ledger once**, in the same transaction, under a unique source key.
5. **Rates and limits are dated data, not code.** The rules are changing this year (section 3.2).

**What was asked, and where it is**

| Asked | Section |
|---|---|
| Invoicing | 6.2 Invoices |
| Payment receipts, receipt customisation | 6.2 Collecting, 6.1.1 |
| Marking payments, clear payment states | 6.2 Collecting and Paying from home, 5.1 |
| Recurring fees, pricing | 6.2 Plans and pricing |
| Savings (read as advances, deposits and concessions) | 6.2 Concessions and settlements, Collecting |
| Each student's payment history, student-level finance | 6.2 Dues and the student's money record |
| Custom settlement | 6.2 Concessions and settlements |
| School costs and expenses | 6.3 |
| Teacher and staff payroll, their statements | 6.4 |
| Whole-school financials and statements | 6.1, 5 |
| School paying Triakshi | 6.5 |
| Reuse where modules overlap | 4 |

## 2. What exists today (code read and run on 2026-11-24)

### 2.1 Fees (`features/fees`), about 45% of a mature module
| Area | Today | Missing |
|---|---|---|
| Setup | heads, one structure per class per year, instalments, late fee (flat or per day, grace, cap), copy to a class | monthly plans, optional fees, per-student plans, proration, approval, versions |
| Discounts | amount or percent, per head or whole fee, with a reason | types, auto sibling/RTE rules, approval (today the maker is stored as `approvedBy`) |
| Billing | dues worked out live from the class structure | invoices, frozen bills, credit notes, opening balance, arrears |
| Payments | cash, cheque, UPI, bank; partial; oldest first; gap-free receipt number per financial year; cancel with a reason | advance, cheque clearing and bounce, refund, cash counter, online, backdating control |
| Receipt | one fixed A4 PDF | school's own layout, logo, signature, copies, reprint log, QR check, ₹ sign, Indian scripts (other scripts print as `?`) |
| Reports | dues list, dues by class, trend, today's receipts | head-wise collection, ageing, cashier, day book, all-year student history, certificates |
| Family | own ledger and receipts for the current year | all years, statement, pay, invoices |
| Other modules | transport and library post through `charges.ts` (a good pattern; kept) | |

Tests: 61 in fees. Money is integer paise; calculation is pure (`calculator.ts`) and shared with the screen. Both are kept.

### 2.2 Billing (`packages/billing`, `features/billing`), about 80%
The school paying Triakshi: plans, trial, checkout (Cashfree), GST invoice PDF, proration, renewal reminders, past-due and suspension, offline payments, console revenue.
**Missing:** credit notes and refunds, TDS deducted by the school, recurring auto-renew proven against Cashfree (the code says it is untested).

### 2.3 Not there at all
Expenses, vendors, payroll, leave types and balances, bank and cash books, accounts, statements, budgets.

### 2.4 Defects found (1–6 reproduced against a real database with a throwaway test)
| # | Defect | Proof |
|---|---|---|
| D1 | **A class change or promotion wipes a student's payments off the ledger.** Dues come from the student's *current* class, and payments on the old class's instalments are ignored. | Paid ₹6,000 of ₹10,000. After the class change: paid ₹0, due ₹15,000. |
| D2 | **Editing a fee structure rewrites bills already paid.** | Plan lowered to ₹4,000 after ₹6,000 was paid: due ₹0, credit ₹2,000 that cannot be used. |
| D3 | **Old dues vanish when the new year is made current.** | Outstanding ₹14,000 became ₹0. |
| D4 | **A student who leaves drops out of dues.** | Outstanding ₹14,000 became ₹4,000. |
| D5 | **Deleting a student deletes their receipts** (database cascade, no guard in the service; the student page has a Delete button). | 1 receipt before, 0 after. |
| D6 | **The plan can be lowered by the person who collects** (`fees:manage` covers setup, discounts, collection and cancelling). | Same run as D2, done as the accountant. |
| D7 | **Fee reminders never go out.** The job `fees.overdue-reminders` is registered but has no entry in `apps/worker/src/registry.ts` `SCHEDULES`. | Read in code. |
| D8 | **The dues page slows down sharply with size.** It filters every payment for each student, then every allocation for each payment. | The grouping alone, simulated: 0.08 s at 500 students, 2.1 s at 3,000. |
| D9 | Money is allocated to instalments, not heads, so nobody can say how much *tuition* was received. | Read in schema. |
| D10 | The school data export dumps every table with a `school_id`. Payroll and bank details would leak into it. | Read in `settings/service.ts`. |

## 3. The bar

### 3.1 What mature products do
Confidence: **D** = the vendor's own docs or feature page, seen through search. **J** = our judgement; no vendor page confirmed it.

| Capability | Seen in | |
|---|---|---|
| Heads, fee categories, scheduled collections, discounts, fine slabs; fine rules lock once payment starts | Fedena | D |
| Advance payments applied to later fees; cancel/revert only for privileged staff; receipt templates | Fedena | D |
| Post-dated cheques, bounce charge per bank account, expense tracking, Tally link | MyClassboard | D |
| Payment plans, aid awards applied to plans, cash-flow projection | FACTS | D |
| Automatic due reminders; collection by class, section and period | Teachmint | D |
| eNACH and UPI Autopay instalments, vendor-wise split per transaction | Easebuzz | D |
| Split settlement, vendor KYC, refunds debited to the vendor | Cashfree Easy Split | D |
| Payroll runs with attendance, loss of pay and loans; multi-level approval; recall until paid; full-and-final and re-settlement runs | Zoho Payroll | D |
| Transaction lock by date and by module | Zoho Books | D |
| Edit log that cannot be turned off; cancelled vouchers kept | Tally | D |
| Cash counter close with variance, reprint log, concession approval, bank reconciliation, sub-ledger control checks | none confirmed | J |

### 3.2 Indian rules that shape the product
None of this is legal advice. Every rate is a dated row in the rule pack (6.4) with its source and confidence; a school can override it.

| Rule | What we found | Confidence |
|---|---|---|
| EPF wage ceiling | ₹25,000 from 17 Sep 2026 (was ₹15,000). September 2026 spans both | PIB release; high |
| ESI wage ceiling | ₹21,000. Private schools are covered only where notified; Maharashtra clarified in 2026. No full state list found | ESIC page; medium |
| Income-tax Act 2025 | In force 1 Apr 2026. Salary TDS s.392; Forms 130 (was 16), 138 (was 24Q), 140 (was 26Q). One source swaps s.392 and s.393 | several secondary sources; medium |
| Wages definition | Excluded allowances above 50% of pay are added back to the PF and gratuity base | secondary; medium |
| Exit pay | Wages within 2 working days; gratuity within 30 days. Start date reported differently | secondary; medium |
| Cash | ₹2 lakh receipt limit continues (s.186); ₹10,000 cash expense limit (s.36) | secondary; medium |
| GST | School services to students (up to higher secondary) are exempt. Goods sales and hall rent may be taxable | GST council flyer for the exemption; goods unconfirmed |
| Tuition deduction | Now s.123, old regime only, two children, no development fees or donations | secondary; medium |
| Fee regulation | Delhi 2025 Act (committee, audited accounts); Maharashtra, Tamil Nadu, Rajasthan and UP have their own rules | Delhi text; rest low |
| Payment aggregators | RBI directions of 15 Sep 2025: aggregator holds money in escrow and does KYC on each merchant | RBI; high. Whether a non-aggregator platform may pool funds was not found, so **we never do** |
| UPI for education | ₹5 lakh per transaction for verified education merchants | secondary; medium |
| Professional tax, LWF, record retention | Sources conflict | low: entered by the school, or by the rule pack once verified |
| DPDP | Parental-consent rules start about 13 May 2027 | secondary; medium |

## 4. Module map (reuse first)

| Module | Owns | State |
|---|---|---|
| **`finance`** (new, `core: true`) | accounts, journals, cash/bank, approvals, number series, document templates, period locks, bank reconciliation, statements, finance dashboard | new |
| **`fees`** | plans, invoices, concessions, receipts, refunds, dues, cash counter, family payments | extend |
| **`expenses`** (new) | vendors, bills, petty cash, claims, budgets, recurring costs, other income | new |
| **`payroll`** (new) | pay structures, runs, payslips, loans, statutory, exits | new |
| **`billing`** | the school paying Triakshi | small additions |
| `attendance` | adds leave types and balances | small addition |

**Dependency rule:** `fees`, `expenses` and `payroll` import `finance`. `finance` imports none of them. `payroll` reads attendance and leave by raw SQL, as timetable already does.
`finance` is core, so turning on only Fees still keeps a correct ledger. A school that buys Accounts later sees its full history.

**What we reuse instead of building again**
| Need | Reuse |
|---|---|
| Posting money from another module | The `charges.ts` pattern: caller's transaction, unique `source_key`, no permission check. New `finance/posting.ts` works the same way. `postCharges`/`cancelCharge` keep their signatures, so **transport and library do not change**. |
| Splitting money exactly | `FeeCalculator.apportion` and `percentOf`, moved to `@smw/feature-kit/money` |
| Gap-free numbers | `nextSequence` |
| PDFs | `PdfBuilder` + templates (6.1) |
| Excel/CSV import | `parseSheet` (opening balances, vendor list, bank statement, pay structures) |
| Reminders | notifications writer, email digest, worker jobs |
| Approvals | one `finance_approvals` table and screen for all modules |
| Siblings, RTE | the shared guardian record; `students.rte_quota` |
| Staff, leave, attendance | `staff_profiles`, `staff_attendance`, `leave_requests` |
| Triakshi's own invoice | appears in Expenses as a ready-to-approve vendor bill |
| Delete guards | `CrudService.usage()` |

## 5. How money flows

```
plan ─▶ INVOICE ─▶ RECEIPT ─▶ cash / bank / cheque / UPI ─▶ bank reconciliation
          │  ▲         │
 concession  late fee  └─▶ advance ─▶ next invoice, or REFUND
 credit note
vendor bill ─▶ approval ─▶ payment ─┐
payroll run ─▶ approval ─▶ payout ──┼─▶ JOURNAL ─▶ day book · ledgers · statements
receipts, settlements, transfers ───┘
```

### 5.1 States
| Document | States |
|---|---|
| Invoice | draft → issued → part paid → paid; `overdue` is worked out, never stored; cancelled only while unpaid (a credit note after that) |
| Receipt | issued; cheque: received → deposited → cleared or bounced; reversed (with approval) |
| UPI slip (family-entered) | submitted → matched (receipt issued) or rejected with a reason |
| Concession, waiver, refund, bill, claim | draft → submitted → approved → done, or rejected |
| Payroll run | draft → reviewed → approved (locked) → paid. Recall allowed until the first payout |
| Period | open → soft closed (approver only) → closed |

### 5.2 Postings (accrual basis)
| Event | Debit | Credit |
|---|---|---|
| Invoice issued | Student dues | Fee income, by head |
| Security deposit billed | Student dues | Deposits payable |
| Concession approved | Fee concessions | Student dues |
| RTE claim raised (the seat's own fee is fully conceded above) | Government reimbursement due | Government reimbursement income |
| Late fee fixed | Student dues | Late fee income |
| Receipt | Cash, bank, cheques in hand | Student dues; any extra to Student advances |
| Cheque cleared / bounced | Bank / Student dues | Cheques in hand |
| Advance used | Student advances | Student dues |
| Refund | Student advances or deposits payable | Bank or cash |
| Write-off | Bad debts | Student dues |
| Vendor bill / payment | Expense or asset / Vendor dues | Vendor dues, TDS payable / Bank or cash |
| Payroll approved | Salaries + employer contributions | Net pay, PF, ESI, PT, TDS payable, staff loans |
| Salary or statutory paid | The payable | Bank |

On the cash basis, income posts at the receipt and expense at the payment. The basis is chosen per school and fixed for a financial year.

**Checks that must always hold (nightly job + tests):** every journal balances; Student dues equals the sum of student balances; Vendor dues, advances and staff loans equal their own lists; the cash book equals cash receipts minus cash payments. Any mismatch alerts the admin and shows on the dashboard.

## 6. Module by module
M = must, S = should, L = later (not in this build).

### 6.1 Finance core (`features/finance`)
| Feature | |
|---|---|
| Chart of accounts: school defaults, groups, own accounts; system accounts cannot be deleted | M |
| Journals: auto from modules; manual ones need approval; reversal, never edit | M |
| Cash and bank accounts: opening balance, transfers, deposits, running balance | M |
| **Approvals inbox**: one list for concessions, waivers, refunds, receipt reversals, bills, journals and payroll; approve, reject or ask; limits by amount; maker ≠ approver | M |
| Number series per document and branch code: prefix, financial year, width, start; gap-free; locked once used | M |
| **Document templates** (6.1.1) | M |
| Period locks: soft close, close, reopen with a reason; late entries post to the open period with the original date shown | M |
| Bank reconciliation: import a statement (`parseSheet`), auto-match by amount, date and reference, manual match, unmatched list, reconciled entries cannot be reversed without un-matching | M |
| Statements: day book, cash book, bank book, account ledger, trial balance, income & expenditure, receipts & payments, balance sheet; PDF and CSV; any period; compare with last year | M |
| Year close: carry balances, lock the year | M |
| Finance dashboard: cash position, collected vs billed, dues ageing, spend vs budget, salary share of income, cost per student, 90-day cash forecast, mismatch alerts | M |
| Tally export (vouchers XML) and an auditor role (read and export only) | S |
| Cost centres (class group, transport, hostel, department) on lines, and reports by them | S |
| Several branches with separate books; fixed-asset depreciation; donations with tax forms | L |

**6.1.1 Document templates** for receipt, invoice, statement, certificate, payslip, voucher:
- Layouts: A4, A5, two-up (school + family copy), 80 mm thermal. Live preview; versions, so an old receipt reprints as issued.
- The school sets: logo, header lines (affiliation, UDISE, PAN, GSTIN), colours from its theme, title, which fields and columns show, terms, footer, signature image and name, watermark, language of labels.
- Printed always: document number, date, school name, amount in figures **and words**, status. "DUPLICATE" from the second print, "REVERSED"/"CANCELLED" when true. Every print is logged.
- **QR check:** a public page on the school's site shows number, date, amount, status and a masked name. Random token, rate limited, nothing else.
- **Fonts:** embed a font with ₹ and Indian scripts. This needs `@pdf-lib/fontkit` and a font file. Do a one-day spike on Hindi and Kannada conjuncts first; if shaping is wrong, those labels print in English and names keep their English form.

### 6.2 Fees (`features/fees`)
**Plans and pricing**
| Feature | |
|---|---|
| Fee plan per class group, board, stream, student category or new/old admission; a student can be moved to another plan with approval | M |
| Heads with type (income, deposit, pass-through), account, GST treatment, refundable, "counts as tuition" | M |
| **Recurring**: yearly, term, quarterly, monthly or custom dates; one-time; optional (opt-in per student); bill date and due date | M |
| Versions: draft → approved → published. Publishing a new version bills only what is not yet issued | M |
| Joining or leaving mid-year: full, by month or by term rule, shown before saving | M |
| Fee hike view: last year vs this year by class, percent change, committee approval file attached, publish on the school website | S |

**Invoices**
| Feature | |
|---|---|
| Issue in bulk by plan, class or due date with a preview, or singly; idempotent (one per student, plan line and period) | M |
| Lines by head, snapshot of class and plan; concession lines shown; PDF, in-app and email | M |
| Extra charges to one student or a group (trip, damage), through the same invoice | M |
| Credit note and debit note with reason and approval | M |
| **Opening balances** by sheet: dues, advances and deposits from the old system | M |
| **Arrears**: unpaid invoices simply stay open across years and for students who left | M |

**Concessions and settlements**
| Feature | |
|---|---|
| Types: sibling, staff child, merit, need, management, RTE, scholarship; limits per type; documents; valid dates; yearly renewal | M |
| Auto suggestions: siblings from shared guardians, RTE from the student record (tuition 100%, with a government claim list) | M |
| **Custom settlement** (one screen, approved as one): split a due into dated parts, waive late fee, write off part, agree a final amount, move an advance, adjust a deposit | M |
| Late fee: flat, per day, slabs, percent; cap; grace; by head or invoice; which is paid first (late fee or principal) is a school setting; waive with approval | M |
| Promise to pay: date and note; reminders pause until then; broken promises listed | S |

**Collecting**
| Feature | |
|---|---|
| Counter screen: find a student (name, number, phone, QR on the invoice), see everything due **for all siblings**, choose invoices or let it allocate, take several methods in one receipt, print. Target: under 30 seconds | M |
| Methods: cash, cheque/DD/PDC, UPI, card machine, bank transfer, online, advance, other | M |
| Extra money becomes an advance and is used automatically on the next invoice (can be turned off) | M |
| **Cash counter**: open with a float, take money, count by denomination, close with the difference explained, hand over or deposit to bank | M |
| **Cheque register**: post-dated list, deposit slip, cleared, bounced (reverses the receipt and adds the bounce charge) | M |
| Backdating within N days only; future dates never; closed counter days cannot be added to; cash limit warning at ₹2 lakh per person per day | M |
| **Receipt reversal**: reason, approval by someone else, receipt stays with its number | M |
| Refunds: from an advance, deposit or credit; approval; method; voucher | M |

**Paying from home** (family = student login)
| Feature | |
|---|---|
| Pay page: choose dues, see the late fee and the total, history of attempts with a clear state | M |
| **UPI QR to the school's own UPI ID** with the exact amount and reference. The family enters the UTR; the office matches it (or the bank import does) and the receipt goes out. | M |
| Payment gateway (each school's own account), autopay | L |

**Dues and the student's money record**
| Feature | |
|---|---|
| Reminders: 7 days before, due date, then 3, 10 and 30 days after; in-app and email; per-student stop; log of what was sent; templates | M |
| Dues report: ageing 0–30, 31–60, 61–90, 90+; class, head, route, concession type; students who left; promise dates; export | M |
| Collection: by head, class, method, cashier, day; billed vs collected vs conceded; refund and reversal registers | M |
| **Student finance page, all years**: balance, invoices, receipts, concessions, settlements, advances and deposits, reminders, notes and every document, as one timeline | M |
| Documents: statement of account, **tuition certificate** (tuition heads only, financial year, amount received), no-dues certificate; a transfer certificate warns when dues are open | M |
| Blocking by dues (report card, admit card): off by default, school setting, admin override logged. Marks entry and attendance are never blocked | S |

### 6.3 Expenses (`features/expenses`)
| Feature | |
|---|---|
| Vendors: PAN, GSTIN, bank, TDS section, contact, documents; duplicate check | M |
| Bills: lines, account, cost centre, tax, TDS, due date, file; approval by amount; part payments; payables ageing | M |
| Payments: one or many bills, cash, bank or cheque; voucher PDF; bank file | M |
| **Recurring costs** (rent, electricity, internet, Triakshi): drafts appear each period for approval | M |
| Petty cash: imprest float, spend with a photo of the slip, top-up, count | M |
| Staff claims: submit, approve, pay (or with salary) | M |
| Budgets: by account and cost centre, monthly or yearly; spent, committed, left; warn or block | M |
| Other income: hall rent, donations (plain receipt), scrap, interest; receipt from the same templates | M |
| Transport costs (fuel, repair, insurance) on a vehicle, so cost per route shows beside route income | S |
| Purchase request → order → goods received → bill; simple asset list with tag and location | S |
| Stock and uniform shop | L |

### 6.4 Payroll (`features/payroll`)
**Setup**
| Feature | |
|---|---|
| **Everyone on payroll**: teachers, staff, drivers, cleaners. A person without app access is a staff record whose login was never activated; a "no app login" tick on Add staff | M |
| Pay profile: PAN, UAN, ESI number, bank account, regime choice, PF/ESI/PT applicability. **Encrypted columns**, masked on screen, left out of the general data export (D10). The repo has no encryption helper yet: one small AES-GCM helper with a key from the environment | M |
| Pay structures: components (earning, deduction, employer cost), fixed, percent or formula, dated versions; templates by designation; import by sheet | M |
| Leave types and balances in `attendance`: casual, sick, earned, unpaid; yearly credit, carry forward; half days; `leave_requests.type` | M |
| **Statutory rule pack**: dated rows (rule, state, from, to, value, source, confidence) kept by Triakshi, overridable by the school. A component with no rule for the month is **entered by hand, never guessed** | M |

**Run**
| Feature | |
|---|---|
| Monthly run by group: pulls paid days from attendance and approved leave; lists people with unmarked days to settle before review | M |
| Loss of pay, arrears, reversal of loss of pay, one-time pay and deductions, extra classes (hourly or per period), bonus | M |
| Loans and advances with EMI, pause, early close | M |
| PF (with mid-month ceiling change), ESI, PT, LWF, TDS amount; employer cost | M |
| Review screen: change from last month, large swings, negative pay, missing bank or PAN | M |
| Approve (locks), recall before payout, bank file (CSV per bank template), mark paid or failed per person | M |
| Payslip PDF from templates; staff see their own on My profile; email | M |
| TDS estimate by regime and declarations | S |
| Files: PF ECR, ESI sheet, PT and TDS registers, salary register, yearly salary statement | M (ECR, registers), S (rest) |

**Exit:** last working day, unpaid days, leave encashment, notice, loan balance, gratuity by rule, dues to school; approval; due-date countdown from the rule pack; settlement letter. M
**Statements:** month, year, department, cost centre, person; loan ledger; leave liability. M

### 6.5 Billing (school ↔ Triakshi)
| Feature | |
|---|---|
| Credit notes and refunds on GST invoices, with their own series | M |
| TDS deducted by the school: invoice settles as paid + TDS, certificate uploaded and tracked | M |
| Two payments on one invoice: the second becomes credit for the next (today it is recorded and unused) | M |
| Account statement and payment history for the school; ageing in the console | M |
| Auto-renew proven in the Cashfree sandbox, or hidden | S |

## 7. Roles, approvals and privacy
| Grant | Admin | Accountant | Cashier (new template) | Teacher | Student (family) | Auditor (new template) |
|---|---|---|---|---|---|---|
| `fees:read` | ✓ | ✓ | ✓ | | | ✓ |
| `fees:collect` | ✓ | ✓ | ✓ | | | |
| `fees:setup`, `fees:concede` (propose) | ✓ | ✓ | | | | |
| `fees:self` | | | | | ✓ | |
| `expenses:read` / `manage` | ✓ | ✓ | | claim own | | read |
| `payroll:read` / `manage` | ✓ | ✓ | | | | |
| `payroll:self` | ✓ | ✓ | ✓ | ✓ | | |
| `finance:read` | ✓ | ✓ | | | | ✓ |
| `finance:journal`, `finance:reconcile` | ✓ | ✓ | | | | |
| `finance:approve`, `finance:close` | ✓ | | | | | |

- Today's `fees:manage` becomes collect + setup + concede for existing custom roles. **No one gains approve.**
- **Approval needed:** plan publish, concession above the type's limit, waiver, write-off, refund, reversal, manual journal, bill above a limit, payroll, year close.
- **Maker ≠ approver.** A school with one admin may approve its own with a typed reason; the dashboard counts these.
- `finance:approve` and `finance:close` can be given to a custom role (a bursar or trustee). Nobody approves their own work, so the grant alone cannot move money.
- Salary is visible only with `payroll:read` or for oneself. `settings:export` skips payroll tables unless the admin also ticks "include payroll", which is audit-logged.
- Families see only their own student's money; staff with `fees:read` see all students, as today.
- Read-only and support sessions cannot move money.

## 8. Screens (house UI kit, works at 375 px)
| Menu | Screens |
|---|---|
| Finance | Dashboard · Approvals · Accounts · Banking · Statements · Settings (series, templates, limits, periods) |
| Fees | Dashboard · Collect · Invoices · Dues · Students (finance page) · Plans · Concessions · Receipts and cheques · Cash counter · Reports |
| Expenses | Dashboard · Bills · Vendors · Petty cash · Claims · Budgets · Other income |
| Payroll | Runs · People · Structures · Loans · Exits · Statutory · Reports |
| My fees (family) | Pay · Invoices · Receipts · Statement · Certificates |
| My profile | Payslips, claims, leave balance (staff) |

Every list has search, filters, CSV, empty, loading and error states. Every money form shows the result before it saves. Accountant and admin homes get the new numbers.

## 9. Data
All tables have `school_id` and row-level security. Money is `bigint` paise. **Foreign keys from money tables to students, users, years and classes are `restrict`.**

| Module | Tables |
|---|---|
| finance | `fin_accounts`, `fin_journals`, `fin_journal_lines`, `fin_cash_accounts`, `fin_bank_statements`, `fin_bank_lines`, `fin_approvals`, `fin_series`, `fin_templates`, `fin_prints`, `fin_periods`, `fin_settings`, `fin_cost_centres` |
| fees | `fee_plans`, `fee_plan_versions`, `fee_plan_lines`, `student_plans`, `fee_invoices`, `fee_invoice_lines`, `fee_notes`, `fee_concessions`, `fee_receipts`, `fee_receipt_methods`, `fee_allocations` (receipt → invoice line), `fee_cheques`, `fee_counters`, `fee_refunds`, `fee_settlements`, `fee_advances`, `fee_upi_slips`, `fee_reminders` |
| expenses | `exp_vendors`, `exp_bills`, `exp_bill_lines`, `exp_payments`, `exp_petty`, `exp_claims`, `exp_budgets`, `exp_recurring`, `exp_income` |
| payroll | `pay_profiles`, `pay_structures`, `pay_components`, `pay_assignments`, `pay_runs`, `pay_lines`, `pay_loans`, `pay_exits`, `pay_declarations` |
| attendance | `leave_types`, `leave_balances`, `leave_requests.type_id` |
| platform | `statutory_rules`, `credit_notes`, `invoices.tds_paise` |

**Moving existing data (hand-written SQL, one transaction per school, never regenerated):**
1. For each student and year, make invoices from the structure of the class they were enrolled in that year (`student_enrollments`, else the current class), concessions as lines, and `fee_charges` as invoices.
2. Turn `fee_payments` into receipts with the same number and date, and instalment allocations into head-wise ones using `apportion`.
3. Compare each student's billed, conceded, paid and due before and after, to the paisa. **Any difference stops the migration and lists the student.** Students already hit by D1 will differ on purpose and are listed for the school to confirm.
4. Keep the old tables, read-only, for one release.

## 10. Jobs
| Job | When (IST) |
|---|---|
| `fees.issue-invoices` | daily 01:00 |
| `fees.reminders` (replaces `overdue-reminders`; fixes D7) | daily 09:00 |
| `expenses.recurring` | daily 02:00 |
| `finance.control-checks` | daily 03:00 |
| `payroll.reminders` (run due, statutory due dates, exit due dates) | daily 09:00 |

Each is idempotent, per school, and one school's failure does not stop the rest.

## 11. Acceptance (each has a test)
1. D1: after a class change, paid, due and history are unchanged; only future invoices use the new plan.
2. D2: publishing a new plan version changes no issued invoice.
3. D3 and D4: unpaid invoices stay in dues after a year change and after the student leaves.
4. D5: deleting a student, staff member, class or year with money records is refused, in the service and by the database.
5. A receipt for ₹5,000 against ₹3,000 due leaves ₹2,000 advance, used on the next invoice, and the ledger balances at every step.
6. Two cashiers collect the same due at once: one succeeds, no double allocation.
7. A cashier's reversal request does nothing until another person approves it; the receipt number survives and prints REVERSED.
8. A bounced cheque reopens the due and adds the bounce charge once.
9. Closing a counter with ₹100 less needs a reason and posts the difference; that day takes no more entries.
10. A custom settlement (split + waiver + write-off) posts exactly, and its parts are reminded on their own dates.
11. Sibling and RTE suggestions appear; neither applies without approval; RTE shows on the government claim list.
12. Reprinting a receipt prints DUPLICATE, logs it, and an old receipt keeps the template it was issued with. The QR page shows status and leaks nothing else.
13. The tuition certificate counts only tuition heads received in that financial year.
14. A family's UPI slip becomes a receipt only when the office verifies it; a used UTR is refused; a rejected slip shows the reason to the family.
15. Opening balances from `.xlsx` and `.csv` give the same result; a bad row writes nothing.
16. A vendor bill above the limit cannot be paid before approval; TDS posts to its payable.
17. A budget set to block refuses the bill that crosses it.
18. A payroll run with unmarked days cannot be reviewed; 2 unpaid days reduce pay by the school's rule; a recalled run reopens; a paid one cannot.
19. September 2026 PF uses both ceilings, by the rule pack; with no rule the amount must be typed, and a low-confidence rule is named on the review screen.
20. A teacher sees their own payslip and gets 403 on anyone else's. The data export has no payroll tables unless ticked.
21. Trial balance is zero-sum; student dues equal the control account; the balance sheet balances; the nightly check catches a tampered row.
22. A closed month refuses new entries; reopening is logged.
23. Bank import matches a deposit; a reconciled entry cannot be reversed.
24. School B can read, pay, print or verify nothing of school A, on every new service and the QR page.
25. Fees dashboard answers under 0.5 s with 5,000 students and 60,000 receipts (fixes D8).
26. Migration: totals match to the paisa on the seeded school; a forced mismatch stops it.
27. Transport and library charges still post and cancel with their existing tests unchanged.
28. Triakshi billing: a credit note, a TDS short-payment and a double payment each end with the right balance.

Property tests on the money core: 10,000 random sequences of invoice, concession, receipt, reversal, refund and bounce keep all section 5 checks true.

## 12. Build plan
Wave 0 is small and protects money already being recorded. The core comes before anything else, because all modules post to it.

| Wave | Stream | Owns |
|---|---|---|
| **0** | Schedule the reminder job; delete guards and `restrict` keys; show past-year and left-student dues; fix the slow grouping | `features/fees`, `features/students`, worker registry |
| **1** | A. Finance core: accounts, posting, approvals, series, periods | `features/finance` |
| | B. Invoice and receipt engine + data move (after A's posting API) | `features/fees` |
| **2** | C. Templates, receipts, QR check, font spike | `features/finance/templates`, `packages/integrations/pdf` |
| | D. Collect screen, counter, cheques, advances, refunds, UPI slips | `features/fees` (collect) |
| | E. Plans, concessions, settlements, reminders, student page, certificates | `features/fees` (rest) |
| | F. Expenses | `features/expenses` |
| **3** | G. Leave types and balances | `features/attendance` |
| | H. Payroll + rule pack | `features/payroll`, console |
| | I. Banking, statements, close, dashboards | `features/finance` (rest) |
| **4** | K. Billing additions, Tally export, auditor role, homes | `packages/billing`, `features/home` |

- At most 4 Sonnet agents at once, one owner per folder; D and E split `features/fees` by subfolder.
- The lead makes one migration per wave, runs typecheck, lint, unit and e2e on the **production build**, and an independent review (permissions, isolation, double-spend, rounding) after waves 1, 2 and 3.
- Each wave ships usable: after wave 2 fees and expenses are complete without payroll.

## 13. Not in this build
Autopay mandates, stock and uniform shop, depreciation, multi-branch books, donation tax forms, filing returns with government portals, SMS and WhatsApp (DLT pending), hostel and mess billing, parent logins.

## 14. Decisions (owner, 2026-11-24)
1. **Family payment:** the school's own UPI QR with manual verification by the office, plus cash and the other counter methods. **No gateway in this build**; Triakshi never holds school money.
2. **Approvals:** admin approves; a one-admin school approves its own with a reason.
3. **Accounting basis:** accrual by default, cash as a choice.
4. **Part payments:** late fee first by default, as a school setting.
5. **Plans:** finance core in every plan; expenses and statements in the middle plan; payroll in the top plan.
6. **Payroll is a full feature, not beta.** We load the rates ourselves. Each rate row shows its source and how sure we are, the school can override it, and the payroll review screen names any low-confidence rate used.
7. **Reminders** are off per school until the admin turns them on.

## 15. Confidence
- Section 2 was read in code. D1–D6 were run; D7, D9 and D10 were read; D8's timing is a simulation of the loop, not the live page.
- Vendor features were seen through search results and a few pages, not by using the products. Items marked J have no source.
- Government pages mostly could not be opened. Every "medium" or "low" row in 3.2 is unverified; the product labels it so.
- "Percent built" figures are estimates.

## 16. Sources
- EPF ceiling: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2313790 · https://www.bdo.in/en-gb/insights/alerts-updates/alert-new-epf-ceiling-hiked
- ESI: https://esic.gov.in/coverage · https://www.scconline.com/blog/post/2026/08/05/esic-clarifies-esi-coverage-educational-medical-institutions-maharashtra/
- TDS forms: https://taxguru.in/income-tax/tds-forms-138-140-replace-forms-24q-26q-fy-2026-27.html · https://cleartax.in/s/tds-and-tcs-changes-from-april-2026
- Exit pay: https://www.livelaw.in/articles/two-working-days-code-wages-employee-final-settlement-552780
- Cash limits: https://www.aubsp.com/income-tax-act-2025-section-36 · https://taxclue.in/blog/cash-payment-limit-ita-2025-rs-10000
- Tuition deduction: https://cleartax.in/s/section-123-income-tax-act-2025
- GST: https://www.gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/GST_Education_Services.pdf
- Payment aggregators: https://www.rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=12896
- Delhi fee Act: https://prsindia.org/files/bills_acts/acts_states/delhi/2025/Act4of2025DL.pdf
- DPDP: https://dpdprules.org/rules/10
- Fedena: https://fedena.com/feature-tour/school-fees-management-system · https://support.fedena.com/support/solutions/articles/211530-how-can-i-set-up-fines-for-late-fee-payments-
- MyClassboard: https://www.myclassboard.com/?p=2254 · Teachmint: https://www.teachmint.com/features/fee-management-software
- FACTS: https://factsmgt.com/financial-management/tuition-management/ · Easebuzz: https://easebuzz.in/use-cases/education/
- Cashfree Easy Split: https://www.cashfree.com/docs/payments/split/features.md
- Zoho Payroll: https://www.zoho.com/in/payroll/help/employer/settings/configure-approvals.html · https://www.zoho.com/en-in/erp/help/payroll/pay-runs/pay-run-types.html
- Zoho Books lock: https://www.zoho.com/in/books/kb/accountant/acc-transactionlock.html · Tally edit log: https://help.tallysolutions.com/tally-prime/edit-log/get-started-with-edit-log/
