# Finance module

How school money works in the product: fees, expenses, payroll and the books behind them. This is the guide to what is **built**. The reasons and owner decisions are in [FINANCE-PRD](FINANCE-PRD.md); rules for people who change the code are in [FINANCE-BUILD](FINANCE-BUILD.md).

- [What it is](#what-it-is)
- [Who can do what](#who-can-do-what)
- [The rules that hold everywhere](#the-rules-that-hold-everywhere)
- [First day: setting a school up](#first-day-setting-a-school-up)
- [Fees](#fees)
- [Expenses](#expenses)
- [Payroll](#payroll)
- [The books](#the-books)
- [Triakshi's own billing](#triakshis-own-billing)
- [Approvals](#approvals)
- [Settings](#settings)
- [Jobs that run by themselves](#jobs-that-run-by-themselves)
- [For developers](#for-developers)
- [Going live](#going-live)
- [Limits and things to check](#limits-and-things-to-check)

## What it is

| Module | Folder | Plan | Screens |
|---|---|---|---|
| Finance (the books) | `features/finance` | every plan (core) | `/app/finance` |
| Fees | `features/fees` | every plan | `/app/fees` |
| Expenses | `features/expenses` | Growth and up | `/app/expenses` |
| Payroll | `features/payroll` | Pro and up | `/app/payroll` |
| Leave types and balances (payroll reads them) | `features/attendance` | with attendance | `/app/attendance/leave` |
| Triakshi's bills to schools | `packages/billing`, `features/billing`, `apps/console` | platform | `/app/billing`, console `/billing` |

Every rupee in fees, expenses and payroll ends as an entry in **one ledger**. A report is never worked out a second way: dashboards, statements and dues all read the ledger or are checked against it.

A module outside the school's plan shows "not in your school's plan" with a way to the plans, never a blank page.

## Who can do what

Built-in roles, and ready-made custom roles every school gets (editable in Settings → Roles):

| Role | Can |
|---|---|
| Admin | everything, including approving, closing months and years, finance settings |
| Accountant | bills, receipts, expenses, payroll, journals, matching. Not: approve, close, settings |
| Fee accountant (ready-made) | fees only: set up, bill, collect, propose concessions |
| Cashier (ready-made) | take money at the counter. Cannot change bills |
| Bursar (ready-made) | read everything, approve, close months |
| Auditor (ready-made) | read everything, change nothing |
| Teacher and other staff | own payslips, own leave, own expense claims |
| Student (the family login) | own bills, receipts, UPI payment |

Permissions: `fees:` read, collect, setup, concede, self · `finance:` read, journal, reconcile, approve, close, settings · `expenses:` read, manage, claim · `payroll:` read, manage, self. Everyone on the staff always holds `payroll:self`.

**Anyone who asked for something** can open *My requests* (`/app/finance/approvals`) and take it back while nobody has decided.

## The rules that hold everywhere

1. **Nothing is edited after it counts.** An issued bill is revised (a new version) or credited. A receipt, payment or journal is reversed. Drafts can be edited freely.
2. **Two people.** The person who asks, made or edited the document, or is paid by it cannot approve it. A school's only admin may, with a written reason that stays on record.
3. **Limits are counted together.** Splitting one write-off into small ones does not avoid approval.
4. **Debits equal credits**, checked in code and by the database. Every posting has a source key, so running it twice posts once.
5. **Numbers never skip** and restart each April (financial year April to March).
6. **Money is whole paise** (`bigint`). Dates are Indian dates.
7. **A locked month takes nothing new.** A late entry lands in the next open month and keeps its own date.
8. **Every change is in the audit log.** Rule changes keep old and new values.
9. Deleting a student, staff member or year that has money records is refused.

## First day: setting a school up

`/app/finance` and `/app/fees` show the same checklist until it is done:

1. Academic year (Academics).
2. Cash box and bank account, UPI ID: Finance setup → *Cash accounts and UPI*.
3. Opening balance of each account: Banking (admin only).
4. Turn UPI on, if wanted: Finance setup → *Rules*.
5. Number series, if the defaults do not suit. A series is fixed once its first number is used.
6. Fee heads (Tuition, Exam…): the ledger account and whether it counts for the tuition certificate.
7. Fee plan → send → a second person publishes it.
8. Issue the bills: preview shows exactly who gets what, and who is skipped and why.
9. Old dues, advances and deposits: Fees → Opening balances, from a sheet, approved as one batch.
10. Open the cash counter and take the first receipt.

Coming from the old fee screens: `pnpm --filter @smw/school move-fees` moves everything once and prints a report (see [Going live](#going-live)).

## Fees

**Plan** → **bill (invoice)** → **receipt**. A class has one published plan for each kind of admission (all, new, existing). To change fees, make a new version: bills already issued keep their price.

| Thing | States |
|---|---|
| Plan | draft → waiting → published → archived |
| Bill | draft → upcoming / due / overdue / part paid → paid; or cancelled; or replaced by a newer version |
| Receipt | valid; clearing (cheque); bounced; reversed |
| Cheque | received → deposited → cleared or bounced; cancelled with a reversed receipt |
| UPI report | submitted → verified (receipt made) or rejected with a reason |
| Counter | open → closed; a difference: waiting → written off, or kept with the cashier, or counted again |

**Bills** come from plans, by the nightly job or the Issue screen, or are made by hand in the editor with a live preview of the printed page. One bill per student and due date, ever. Concessions, transport, library fines and late fees land on the bill.

**Late fee** is worked out live from the plan's rule and only becomes a bill line when money is taken. The school chooses if a payment clears late fee or fee first.

**Collecting** (`/app/fees/collect`): find the family (siblings show together), tick bills, split over cash, UPI, card, bank transfer, cheque and advance. The panel says what will happen before you press Collect. Extra money becomes an advance. A very large extra needs a tick that the family really paid it. Pressing twice makes one receipt.

**Printing**: the first print is the original, later prints say DUPLICATE and are logged. Receipts and bills carry a QR that opens a public check page.

**Counter**: open with a float, count at the end. A difference above the school's limit waits for an approver. Counting again keeps the first figure on record. A refused shortage stays as owed by that cashier.

**Families** (student login): dues, UPI QR with the exact amount, then "I have paid" with the UTR and a screenshot. The office checks the bank and verifies. There is **no payment gateway** by the owner's decision.

**Correcting**

| Need | Use |
|---|---|
| Wrong bill, nothing paid | Revise or cancel |
| Wrong bill, part paid | Credit note (money off) or debit note (add) |
| Wrong receipt | Ask for reversal |
| Family cannot pay | Promise, or a **settlement**: waive late fee, use advance or deposit, write off, agree a final amount, pay in parts. Approved as a whole. If dues change meanwhile it must be sent again |
| Student leaves | Refunds → *Student is leaving*: advance and deposit go against dues, the rest is refunded with a voucher |
| Cheque bounces | Bills reopen, an optional charge is billed. Advance already used from it is taken back first |

Money from an uncleared cheque is never refunded or used as advance.

**Documents**: statement of account, tuition fee certificate (cleared money only), no-dues certificate, receipts and bills in A4, A5, two-on-A4 and 80 mm. Layouts are edited in Finance → Document layouts; old documents reprint as issued.

## Expenses

Vendors · bills · payments · petty cash · staff claims · budgets · recurring costs · other income.

- **Bill**: draft → waiting (above the limit) → approved → part paid → paid; or rejected → fix → send again. Tax withheld (TDS) is worked out from the vendor.
- **Payment**: one payment can cover many bills; numbered voucher PDF. Undone only by an approved reversal.
- **Petty cash**: a float with a person; each spend needs a photo of the slip.
- **Claims**: staff ask for their own money back with a bill photo; paid now or with salary. Never approved by the claimant.
- **Budgets** per account for the year; a bill shows what it does to the budget before saving.
- **Recurring** costs draft a bill each period. Triakshi's own subscription invoices appear as draft bills for what is still due and follow the invoice if it changes.

## Payroll

1. **Person**: pay details (PAN, UAN, bank account: encrypted) and a structure with gross pay from a date.
2. **Run** for a month: days come from attendance and leave, plus loans, claims, arrears, bonus.
3. **Fix** what blocks: unmarked days (mark them, or *Count as worked*), missing bank account, an amount a person must type.
4. **Review** → **send** → a second person **approves**. The entry posts, payslips get numbers, bank details freeze.
5. **Pay**: bank file, mark paid; a failed transfer can be retried. A changed account after approval stops that person's payment until someone confirms it.
6. **Statutory dues**: remittance screen for PF, ESI, PT, TDS and LWF with due dates; PF return file, ESI sheet, TDS register. Full identity numbers only for people who manage payroll.
7. A paid run cannot be recalled; an approved one can (second person), and approving again posts again.

**If the month is not over**, days still to come count as worked; take a later absence off next month.

Also: loans with monthly recovery, bonus and off-cycle runs, raises in bulk, exit settlements (notice, leave encashment, gratuity, the year's remaining tax), tax declarations that count only after the office accepts them, and each person's own payslips at *My payslips*.

**Rates** (PF, ESI, professional tax, income tax, gratuity…) live in `features/payroll/rates.ts` as dated rows, each with its source and how sure we are. A school may override any rate on *Statutory*. A month without a rate asks a person to type the amount; nothing is guessed.

## The books

- **Chart**: 34 system accounts (renamed but never deleted), a starter set of expense accounts, and the school's own. `features/finance/chart.ts`.
- **Basis**: accrual (income when billed) by default, or cash. It can change only while the year has no entries.
- **Journals**: automatic, manual (always approved), transfer, opening, undo. Every entry links to its document, and back.
- **Banking**: import a statement (.csv or .xlsx), automatic match, manual and split match, record charges and interest, reconciliation statement.
- **Statements**: day, cash and bank book, account ledger, trial balance, income and expenditure, receipts and payments, balance sheet; with comparison, CSV, PDF and a Tally export.
- **Months**: open → soft closed → closed, reopened with a reason.
- **Year close**: a checklist, then a request; when approved, one entry carries the surplus and twelve months lock. Reopening needs approval too.
- **Checks** run every night and on the dashboard: ledger against dues, advances, deposits, cheques, vendor dues and cash. A mismatch shows in red with its words.

## Triakshi's own billing

Console → Billing: invoices, payments, credit notes, refunds, account credit, TDS certificates, school statements. Schools see theirs at `/app/billing`. Only an owner gives goodwill credit or records a refund. Subscriptions are paid through Cashfree; that is the only gateway in the product.

## Approvals

One desk: `/app/finance/approvals`. What can wait there:

| Area | Kinds |
|---|---|
| Finance | manual entry, undo, bank line as another entry, year close, year reopen |
| Fees | plan, concession, credit/debit note, settlement, refund, receipt reversal, bill change (cancel, revise, special plan, opt-out, archive), opening batch, counter difference |
| Expenses | bill above the limit, claim above the limit, reversal |
| Payroll | run, recall, loan, exit settlement |

Who asked gets a notice of the decision and the note. A refusal always says what to do next and how to send again.

## Settings

Finance setup → Rules (admin):

| Rule | Default |
|---|---|
| Accounting basis | accrual |
| Days money may be dated back | 7 |
| Concession, waiver or write-off without approval, up to | ₹0 (always approved) |
| Vendor bill without approval, up to | ₹0 |
| Warn when one person pays this much cash in a day | ₹2,00,000 |
| Counter difference without approval | ₹0 |
| Bounced cheque charge | ₹0 |
| Late fee first | on |
| Use advances on the next bill | on |
| UPI for families | off |
| Plan needs the committee's file | off |
| Hold report cards while overdue | off |
| Fee reminders | **off** until the admin turns them on; days −7, 0, 3, 10, 30 |

## Jobs that run by themselves

| Job | When (IST) | Does |
|---|---|---|
| `fees.issue-invoices` | 01:00 | issues due bills, once per student and due |
| `expenses.recurring` | 02:00 | drafts recurring bills |
| `finance.control-checks` / `fees.control-checks` | 03:00 / 03:15 | compares ledger and documents; tells admins only of a mismatch |
| `attendance.leave-credit` | 00:30 | credits leave once per person and year |
| `fees.reminders` | 09:00 | reminders, only where switched on |
| `payroll.reminders` | 09:00 | run not started, statutory and exit pay due |

## For developers

```
features/finance   posting.ts (the only door to the ledger) · chart.ts · approvals.ts · base.ts (MoneyService) · services/ · templates/
features/fees      plans · plan-billing · invoices · notes · concessions · settlements · receipts · cheques · slips · counter · refunds · dues · certificates
                   move/ (one-time move of the old fee tables) · legacy.ts (old tables, read only)
features/expenses  vendors · bills · payments · petty · claims · budgets · recurring · income
features/payroll   engine.ts (pure pay maths) · compute.ts · rates.ts · rate-book.ts · ledger.ts · review.ts · services/
packages/ui/src/components/finance   Money, MoneyInput, RecordPicker, LineItemsEditor, DocumentPaper, StateBadge, StatusTrack, ReportTable, AgeingBar…
packages/feature-kit   money.ts (paise, FY, words) · secret.ts (encryption)
apps/school/src/lib    approval-handlers.ts · finance-checks.ts · finance-links.ts · verify-lookups.ts · module-gate.tsx
```

- Modules never import each other's screens. The app joins them in `apps/school/src/lib`.
- Post only with `postJournal` / `this.post`. Give every posting a `sourceKey` that is unique to the event; if an event can happen again after an undo (a recalled run), the key must differ each time.
- A new approval kind: add a handler (`approve`, `reject`, and `withdraw`/`involved` when needed), merge it in `approval-handlers.ts`, add its label in `features/finance/ui/labels.ts`.
- A server component must not import a **value** from a `"use client"` file, or pass a function to one. `python3 scripts/check-client-values.py` finds the first.
- Compare timestamps inside Postgres: a JavaScript `Date` drops microseconds.
- Migrations 0009 (tables), 0010 (columns, money roles), 0011. 0009 and 0010 hold hand-written data steps: never regenerate them.

Tests:

| What | Command |
|---|---|
| Unit | `pnpm test` (or `pnpm vitest run` in one folder) |
| The 13 journeys in a browser | `npx playwright test finance-journeys --project=desktop --workers=1` |
| Every link, 7 logins, desktop and phone width | `npx playwright test finance-crawl --project=desktop --workers=3` |

Browser tests need the **production build** and a fresh database (`pnpm db:fresh`). Money logins are in [DEV](DEV.md). School `riverside` is empty on purpose, for the first-day journey.

## Going live

1. Back up the database.
2. Set `DATA_KEY` (encrypts PAN, bank and ID numbers; payroll refuses to save them without it). **Keep a copy: losing it loses those values.** Optional `CASHFREE_SUBSCRIPTIONS` for platform billing.
3. Run the migrations, then `pnpm --filter @smw/school bootstrap`. Bootstrap also moves old fee data, school by school, inside one transaction each; a school already moved is skipped.
4. To look first: `pnpm --filter @smw/school move-fees --dry-run`. The report shows old and new totals and explains every difference. Nothing is moved for a school whose receipts do not add up.
5. After the migration the app can no longer write the old fee tables.
6. Open Finance for one school and check that no red "books do not match" panel shows.

## Limits and things to check

- Statutory rates were checked against public sources in November 2026, not by a lawyer or accountant. Rates marked low confidence show a warning on the run. Have a payroll professional check them before the first real run.
- Income-tax slabs are held for financial year 2026-27 only; for other years the amount is typed.
- Professional tax is held for Karnataka, Maharashtra, Telangana, Andhra Pradesh, Gujarat, West Bengal, Madhya Pradesh and Odisha (the last three marked low confidence); elsewhere the amount is typed or overridden.
- No bank feed and no payment gateway for fees: UPI is verified by a person.
- The cash warning (₹2 lakh) warns; it does not stop the receipt.
- Advances used before this version cannot be taken back by a reversal; the screen says so.
