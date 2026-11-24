// Reads the money-taking screens need that no fees service offers yet (see the report to the lead): one place, so they can move into the services later.
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ForbiddenError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { addDays, rupees, todayIST } from "@smw/feature-kit/money";
import { schools, users } from "@smw/db";
import { services, PdfBuilder } from "@smw/integrations";
import { finCashAccounts, finApprovals, finBankLines, finPrints } from "@smw/feature-finance/schema";
import { defaultConfig } from "@smw/feature-finance/templates/config";
import { TemplateService } from "@smw/feature-finance/templates/service";
import { FeesBase, type Perm } from "../../base";
import { METHOD_LABEL } from "../../constants";
import { ChequeService } from "../../cheques";
import { DuesService } from "../../dues";
import { RefundService } from "../../refunds";
import { feeCheques, feeCounters, feeInvoices, feeReceiptMethods, feeReceipts, feeRefunds, feeAllocations, feeInvoiceLines } from "../../schema";
import { dueNow, receiptData, type DeskBill } from "./logic";

const LIVE = ["valid", "clearing"] as const;
const NIL = "00000000-0000-0000-0000-000000000000";

export class DeskService extends FeesBase {
  /** Staff need collect or read; a student login only reads the school's own pay details. */
  private perm(): Perm { return this.can("collect") ? "collect" : this.can("read") ? "read" : "self"; }
  private staff(): Perm { return this.can("collect") ? "collect" : "read"; }

  /** School rules and pay details the counter and the pay page need. */
  async config() {
    return this.read(this.perm(), async (tx) => {
      const [s, [anyCounter], accounts, [school]] = await Promise.all([
        this.settings(tx),
        tx.select({ id: feeCounters.id }).from(feeCounters).limit(1),
        tx.select({ id: finCashAccounts.id, name: finCashAccounts.name, kind: finCashAccounts.kind, upiId: finCashAccounts.upiId, upiName: finCashAccounts.upiName }).from(finCashAccounts).where(eq(finCashAccounts.isActive, true)).orderBy(desc(finCashAccounts.isDefault), asc(finCashAccounts.name)),
        tx.select({ name: schools.name, phone: schools.phone, address: schools.address, city: schools.city }).from(schools).limit(1),
      ]);
      const upi = accounts.find((a) => a.upiId);
      return {
        today: todayIST(), lateFeeFirst: s.lateFeeFirst, cashLimitPaise: s.cashLimitPaise, backdateDays: s.backdateDays, bounceChargePaise: s.bounceChargePaise, upiOn: s.upiOn,
        usesCounters: !!anyCounter, school: { name: school?.name ?? "School", phone: school?.phone ?? null, address: [school?.address, school?.city].filter(Boolean).join(", ") || null },
        upi: upi ? { upiId: upi.upiId!, name: upi.upiName ?? school?.name ?? "School" } : null,
        banks: accounts.filter((a) => a.kind === "bank").map((a) => ({ id: a.id, name: a.name })),
      };
    });
  }

  /** Students by name, admission number, a guardian's phone or a bill number; each with what is due. */
  async find(q: string) {
    const t = q.trim();
    if (t.length < 2) return [];
    return this.read(this.staff(), async (tx) => {
      const like = `%${t.replace(/[%_]/g, "")}%`;
      const rows = [...(await tx.execute<{ id: string; name: string; admission_no: string; cls: string; due: string }>(sql`
        select s.id, s.name, s.admission_no, coalesce(c.name || coalesce('-' || sec.name, ''), '-') cls,
          (select coalesce(sum(i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise), 0) from fee_invoices i where i.student_id = s.id and i.status = 'issued') due
        from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
        where s.name ilike ${like} or s.admission_no ilike ${like}
          or exists (select 1 from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = s.id and g.phone ilike ${like})
          or exists (select 1 from fee_invoices i where i.student_id = s.id and i.number ilike ${like})
        order by s.name limit 8`))];
      return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.admission_no} · ${r.cls}${Number(r.due) > 0 ? ` · ${rupees(Number(r.due))} due` : ""}` }));
    });
  }

  /** The picked student's family: every open bill of every sibling with its real lines (the preview uses them) and each child's advance. */
  async family(studentId: string) {
    const fam = await new DuesService(this.ctx).family(studentId);
    const ids = fam.members.flatMap((m) => m.bills.map((b) => b.id));
    const loaded = ids.length ? await this.read(this.staff(), (tx) => this.loadInvoices(tx, inArray(feeInvoices.id, ids))) : [];
    const bills: DeskBill[] = fam.members.flatMap((m) => m.bills.map((b) => {
      const full = loaded.find((l) => l.id === b.id);
      return { id: b.id, studentId: m.student.id, studentName: m.student.name, number: b.number, label: b.label, dueDate: b.dueDate, state: b.state, openPaise: b.openPaise, accruedLatePaise: b.accruedLatePaise,
        parts: full?.parts ?? [], lines: (full?.lines ?? []).map((l) => ({ id: l.id, label: l.label, kind: l.kind, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise, creditedPaise: l.creditedPaise, paidPaise: l.paidPaise, sort: l.sort })) };
    }));
    const members = fam.members.map((m) => ({
      id: m.student.id, name: m.student.name, admissionNo: m.student.admissionNo, classLabel: m.student.classLabel, advancePaise: m.advancePaise, duePaise: m.openPaise,
      overduePaise: bills.filter((b) => b.studentId === m.student.id && b.state === "overdue").reduce((s, b) => s + dueNow(b), 0),
    }));
    return { members, bills, totalPaise: fam.totalPaise };
  }

  // ---------- receipts ----------

  /** The receipt register with its totals by method over every row that matches, not only this page. Class is a filter the list service lacks. */
  async register(query: ListQuery) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const f = q.filters;
      const where = and(
        f.from ? sql`${feeReceipts.date} >= ${f.from}` : undefined, f.to ? sql`${feeReceipts.date} <= ${f.to}` : undefined,
        f.status ? eq(feeReceipts.status, f.status as (typeof feeReceipts.$inferSelect)["status"]) : undefined,
        f.cashier ? eq(feeReceipts.collectedBy, f.cashier) : undefined,
        f.method ? sql`exists (select 1 from fee_receipt_methods m where m.receipt_id = ${feeReceipts.id} and m.method = ${f.method})` : undefined,
        f.classId ? sql`exists (select 1 from students s where s.id = ${feeReceipts.studentId} and s.class_id = ${f.classId}::uuid)` : undefined,
        q.q ? or(ilike(feeReceipts.number, `%${q.q}%`), sql`${feeReceipts.snapshot}->>'studentName' ilike ${`%${q.q}%`}`, sql`${feeReceipts.snapshot}->>'admissionNo' ilike ${`%${q.q}%`}`) : undefined,
      );
      const [rows, [n], totals] = await Promise.all([
        tx.select({ r: feeReceipts, cashier: users.name }).from(feeReceipts).leftJoin(users, eq(users.id, feeReceipts.collectedBy)).where(where).orderBy(desc(feeReceipts.date), desc(feeReceipts.number)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeReceipts).where(where),
        tx.select({ method: feeReceiptMethods.method, v: sql<string>`coalesce(sum(${feeReceiptMethods.amountPaise}), 0)` }).from(feeReceiptMethods).innerJoin(feeReceipts, eq(feeReceipts.id, feeReceiptMethods.receiptId)).where(and(where, inArray(feeReceipts.status, [...LIVE]))).groupBy(feeReceiptMethods.method),
      ]);
      const methods = rows.length ? await tx.select().from(feeReceiptMethods).where(inArray(feeReceiptMethods.receiptId, rows.map((x) => x.r.id))) : [];
      const byMethod: Record<string, number> = {};
      for (const t of totals) if (t.method !== "advance") byMethod[t.method] = Number(t.v);
      return {
        ...toPage(rows.map(({ r, cashier }) => ({
          id: r.id, number: r.number, date: r.date, studentName: r.snapshot.studentName, classLabel: r.snapshot.classLabel, amountPaise: r.amountPaise, status: r.status, cashier: cashier ?? "-",
          methods: methods.filter((m) => m.receiptId === r.id).map((m) => METHOD_LABEL[m.method]).join(", "),
        })), Number(n?.n ?? 0), q),
        byMethod, totalPaise: Object.values(byMethod).reduce((s, v) => s + v, 0),
      };
    });
  }

  /** People who have taken money, for the cashier filter. */
  async cashiers() {
    return this.read("read", (tx) => tx.selectDistinct({ id: users.id, name: users.name }).from(feeReceipts).innerJoin(users, eq(users.id, feeReceipts.collectedBy)).orderBy(asc(users.name)));
  }

  /** What the receipt page adds to receipts.get: the print log and where a reversal request stands. */
  async receiptExtras(receiptId: string) {
    return this.viewer(async (tx, own) => {
      const [r] = await tx.select({ s: feeReceipts.studentId }).from(feeReceipts).where(eq(feeReceipts.id, receiptId));
      if (!r) throw new NotFoundError("Receipt");
      this.assertVisible(own, r.s, "Receipt");
      const [prints, [ask], [school]] = await Promise.all([
        tx.select({ copyNo: finPrints.copyNo, at: finPrints.createdAt, by: users.name }).from(finPrints).leftJoin(users, eq(users.id, finPrints.printedBy)).where(and(eq(finPrints.docType, "fee_receipt"), eq(finPrints.docId, receiptId))).orderBy(asc(finPrints.copyNo)),
        tx.select({ a: finApprovals, by: users.name }).from(finApprovals).leftJoin(users, eq(users.id, finApprovals.requestedBy)).where(and(eq(finApprovals.kind, "fees.reversal"), eq(finApprovals.refId, receiptId))).orderBy(desc(finApprovals.createdAt)).limit(1),
        tx.select({ name: schools.name, address: schools.address, city: schools.city }).from(schools).limit(1),
      ]);
      return { prints, ask: ask ? { ...ask.a, requestedByName: ask.by ?? "Someone" } : null, school: school ?? { name: "School", address: null, city: null } };
    });
  }

  /** The receipt as an on-screen document (same data as the PDF). `mark` stamps DUPLICATE on a reprint. */
  async receiptDocument(receiptId: string, o: { duplicate?: boolean } = {}) {
    return this.viewer(async (tx, own) => {
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, receiptId));
      if (!r) throw new NotFoundError("Receipt");
      this.assertVisible(own, r.studentId, "Receipt");
      const [methods, allocs, [school]] = await Promise.all([
        tx.select().from(feeReceiptMethods).where(eq(feeReceiptMethods.receiptId, receiptId)),
        tx.select({ bill: feeInvoices.label, line: feeInvoiceLines.label, amountPaise: feeAllocations.amountPaise }).from(feeAllocations).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId)).innerJoin(feeInvoices, eq(feeInvoices.id, feeInvoiceLines.invoiceId))
          .where(and(eq(feeAllocations.receiptId, receiptId), sql`${feeAllocations.undoneAt} is null`)).orderBy(asc(feeInvoices.dueDate), asc(feeInvoiceLines.sort)),
        tx.select({ name: schools.name, address: schools.address, city: schools.city, phone: schools.phone }).from(schools).limit(1),
      ]);
      const header = [school?.name ?? "School", ...[school?.address, school?.city, school?.phone ? `Phone: ${school.phone}` : null].filter((x): x is string => !!x)];
      const config = await new TemplateService(this.ctx).current("receipt").then((t) => t.config).catch(() => defaultConfig("receipt", header));
      const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const data = receiptData({
        number: r.number, date: r.date, student: r.snapshot.studentName, admissionNo: r.snapshot.admissionNo, classLabel: r.snapshot.classLabel, payer: r.payerName ?? r.snapshot.guardian, amountPaise: r.amountPaise,
        advancePaise: r.advancePaise, status: r.status, reason: r.reverseReason, duplicate: o.duplicate, allocations: allocs,
        methods: methods.map((m) => ({ label: METHOD_LABEL[m.method], reference: m.reference, amountPaise: m.amountPaise })),
      }, money);
      return { config, data };
    });
  }

  // ---------- cheques ----------

  /** Count and total per state, over every cheque. */
  async chequeTotals() {
    return this.read("collect", async (tx) => {
      const rows = await tx.select({ status: feeCheques.status, n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${feeCheques.amountPaise}), 0)` }).from(feeCheques).groupBy(feeCheques.status);
      return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, paise: Number(r.v) }])) as Record<string, { count: number; paise: number }>;
    });
  }

  /** The four columns of the cheque board (post-dated ones sit in "received" until their date). */
  async chequeBoard() {
    const svc = new ChequeService(this.ctx);
    const [received, deposited, cleared, bounced] = await Promise.all((["received", "deposited", "cleared", "bounced"] as const).map((status) => svc.list({ filters: { status }, pageSize: 100 })));
    return { received, deposited, cleared, bounced, totals: await this.chequeTotals() };
  }

  /** A bank slip listing the chosen cheques. It marks nothing: depositing is a separate step per cheque. */
  async chequeSlipPdf(ids: string[]): Promise<{ filename: string; bytes: Uint8Array }> {
    const rows = await this.read("collect", async (tx) => {
      const [list, [school]] = await Promise.all([
        tx.select({ c: feeCheques, student: sql<string>`${feeReceipts.snapshot}->>'studentName'` }).from(feeCheques).innerJoin(feeReceipts, eq(feeReceipts.id, feeCheques.receiptId)).where(inArray(feeCheques.id, ids.length ? ids : [NIL])).orderBy(asc(feeCheques.chequeDate)),
        tx.select({ name: schools.name }).from(schools).limit(1),
      ]);
      return { list, school };
    });
    if (!rows.list.length) throw new NotFoundError("Cheque");
    const pdf = await PdfBuilder.create();
    pdf.header({ title: "CHEQUE DEPOSIT SLIP", orgName: rows.school?.name ?? "School", rightLines: [`Date: ${todayIST()}`, `Cheques: ${rows.list.length}`] });
    const money = PdfBuilder.money;
    pdf.table({ columns: [{ label: "Cheque no", width: 80 }, { label: "Bank", width: 110 }, { label: "Cheque date", width: 70 }, { label: "Student", width: 120 }, { label: "Amount", width: 69, align: "right" }], rows: rows.list.map((r) => [r.c.chequeNo, r.c.bank, r.c.chequeDate, r.student ?? "", money(r.c.amountPaise)]) });
    pdf.totals([["Total", money(rows.list.reduce((s, r) => s + r.c.amountPaise, 0)), true]]);
    pdf.space(40).text("Deposited by: ____________________    Bank seal and date", { size: 9 });
    return { filename: `cheque-deposit-${todayIST()}.pdf`, bytes: await pdf.save() };
  }

  // ---------- counter ----------

  /** The handover slip of a closed counter: figures, notes and coins, and a line to sign. */
  async counterSlipPdf(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const got = await this.read("collect", async (tx) => {
      const [c] = await tx.select({ c: feeCounters, name: users.name }).from(feeCounters).leftJoin(users, eq(users.id, feeCounters.userId)).where(eq(feeCounters.id, id));
      if (!c) throw new NotFoundError("Counter");
      if (c.c.userId !== this.ctx.userId && !this.can("read")) throw new ForbiddenError();
      const [school] = await tx.select({ name: schools.name }).from(schools).limit(1);
      return { ...c, school: school?.name ?? "School" };
    });
    const c = got.c, money = PdfBuilder.money;
    const pdf = await PdfBuilder.create();
    pdf.header({ title: "CASH HANDOVER SLIP", orgName: got.school, rightLines: [`Day: ${c.day}`] });
    pdf.facts([["Cashier", got.name ?? "-"], ["Float at opening", money(c.floatPaise)], ["Should be in the box", c.expectedPaise == null ? "Still open" : money(c.expectedPaise)], ["Counted", c.countedPaise == null ? "Still open" : money(c.countedPaise)],
      ["Difference", c.countedPaise == null || c.expectedPaise == null ? "-" : money(c.countedPaise - c.expectedPaise)], ["Reason", c.differenceReason ?? "-"]]);
    const notes = Object.entries(c.denominations ?? {}).filter(([, n]) => n > 0).sort((a, b) => Number(b[0]) - Number(a[0]));
    if (notes.length) pdf.table({ columns: [{ label: "Note or coin", width: 150 }, { label: "Count", width: 150, align: "right" }, { label: "Amount", width: 149, align: "right" }], rows: notes.map(([p, n]) => [`Rs. ${Number(p) / 100}`, String(n), money(Number(p) * n)]) });
    pdf.space(40).text("Handed over by: ____________________      Received by: ____________________", { size: 9 });
    return { filename: `handover-${c.day}.pdf`, bytes: await pdf.save() };
  }

  /** Past sessions with the cashier's name, for the history table. */
  async counterHistory(limit = 30) {
    return this.read(this.staff(), (tx) => tx.select({ c: feeCounters, name: users.name }).from(feeCounters).leftJoin(users, eq(users.id, feeCounters.userId)).where(this.can("read") ? undefined : eq(feeCounters.userId, this.ctx.userId)).orderBy(desc(feeCounters.day), desc(feeCounters.createdAt)).limit(limit))
      .then((rows) => rows.map(({ c, name }) => ({ ...c, cashier: name ?? "-", differencePaise: c.countedPaise == null || c.expectedPaise == null ? null : c.countedPaise - c.expectedPaise })));
  }

  // ---------- UPI slips ----------

  /** What the office needs beside each slip: the bills it names, a link to the screenshot, and bank lines that look like it. */
  async slipExtras(slips: { id: string; invoiceIds: string[]; utr: string; amountPaise: number; paidOn: string; fileKey: string | null }[]) {
    return this.read("collect", async (tx) => {
      const billIds = [...new Set(slips.flatMap((s) => s.invoiceIds))];
      const bills = billIds.length ? await tx.select({ id: feeInvoices.id, number: feeInvoices.number, label: feeInvoices.label, open: sql<string>`${feeInvoices.grossPaise} - ${feeInvoices.concessionPaise} - ${feeInvoices.creditedPaise} + ${feeInvoices.latePaise} - ${feeInvoices.paidPaise}` }).from(feeInvoices).where(inArray(feeInvoices.id, billIds)) : [];
      const out: Record<string, { bills: { id: string; number: string | null; label: string; openPaise: number }[]; fileUrl: string | null; hints: { date: string; description: string; amountPaise: number; why: "utr" | "amount"; matched: boolean }[] }> = {};
      for (const s of slips) {
        const hits = await tx.select().from(finBankLines).where(and(sql`${finBankLines.amountPaise} > 0`, or(ilike(finBankLines.reference, `%${s.utr}%`), ilike(finBankLines.description, `%${s.utr}%`),
          and(eq(finBankLines.amountPaise, s.amountPaise), sql`${finBankLines.date} between ${addDays(s.paidOn, -2)}::date and ${addDays(s.paidOn, 3)}::date`)))).limit(3);
        out[s.id] = {
          bills: s.invoiceIds.flatMap((i) => bills.filter((b) => b.id === i).map((b) => ({ id: b.id, number: b.number, label: b.label, openPaise: Number(b.open) }))),
          fileUrl: s.fileKey ? await services().storage.signedUrl(s.fileKey, 3600).catch(() => null) : null,
          hints: hits.map((h) => ({ date: h.date, description: h.description, amountPaise: h.amountPaise, why: `${h.reference ?? ""} ${h.description}`.toUpperCase().includes(s.utr) ? "utr" as const : "amount" as const, matched: h.journalLineId != null })),
        };
      }
      return out;
    });
  }

  // ---------- refunds ----------

  /** What can still be refunded to a student, from the advance and from the deposit. */
  async refundBalances(studentId: string) {
    return this.read("read", async (tx) => {
      const svc = new RefundService(this.ctx);
      const [advancePaise, depositPaise] = [await svc.availableIn(tx, studentId, "advance"), await svc.availableIn(tx, studentId, "deposit")];
      return { advancePaise, depositPaise };
    });
  }

  /** Student names for a list of ids (refunds and slips show people, not ids). */
  async studentNames(ids: string[]) {
    const rows = ids.length ? await this.read("read", (tx) => this.studentLines(tx, inArray(sql`students.id`, ids))) : [];
    return new Map(rows.map((r) => [r.id, { name: r.name, admissionNo: r.admissionNo, classLabel: r.classLabel }]));
  }

  /** The payment voucher of an approved refund. */
  async refundVoucherPdf(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const got = await this.read("read", async (tx) => {
      const [r] = await tx.select().from(feeRefunds).where(eq(feeRefunds.id, id));
      if (!r) throw new NotFoundError("Refund");
      const [[school], student] = await Promise.all([tx.select({ name: schools.name }).from(schools).limit(1), this.oneStudent(tx, r.studentId)]);
      return { r, student, school: school?.name ?? "School" };
    });
    if (got.r.status !== "approved") throw new NotFoundError("Voucher");
    const money = PdfBuilder.money, pdf = await PdfBuilder.create();
    pdf.header({ title: "REFUND VOUCHER", orgName: got.school, rightLines: [`Voucher: ${got.r.number ?? "-"}`, `Date: ${got.r.paidOn ?? "-"}`] });
    pdf.facts([["Student", got.student.name], ["Admission no", got.student.admissionNo], ["Refund of", got.r.source === "advance" ? "Advance" : "Security deposit"], ["Paid by", METHOD_LABEL[got.r.method as keyof typeof METHOD_LABEL] ?? got.r.method], ["Reference", got.r.reference ?? "-"], ["Reason", got.r.reason]]);
    pdf.totals([["Amount refunded", money(got.r.amountPaise), true]]);
    pdf.space(40).text("Received by: ____________________      Authorised by: ____________________", { size: 9 });
    return { filename: `${(got.r.number ?? "refund").replace(/\//g, "-")}.pdf`, bytes: await pdf.save() };
  }
}
