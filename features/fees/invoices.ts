import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import type { PostLine } from "@smw/feature-finance/posting";
import { students } from "@smw/feature-students/schema";
import { FeesBase, asId, calcOf, invalid, newToken, type InvoiceFull } from "./base";
import { dueState, invoiceLateFee, openOf } from "./calc";
import { chargeManyInput, draftInput, bulkInput, reviseInput } from "./inputs";
import { ChangeService } from "./changes";
import { invoiceData } from "./documents";
import { NoteService } from "./notes";
import { OpeningImport } from "./opening";
import { PlanBilling } from "./plan-billing";
import { PlanService } from "./plans";
import { feeAllocations, feeConcessionUses, feeDueParts, feeInvoiceChanges, feeInvoiceLines, feeInvoices, feeNotes, feePlans, feeReceipts } from "./schema";

type LineIn = { headId?: string | null; kind: "fee" | "deposit" | "opening" | "bounce"; label: string; amountPaise: number; concessionPaise?: number };
const CHUNK = 400;

/** Bills: drafts, issuing (one, many, or from the plans), cancel and revise. Issuing is the one place a bill gets its number and posts. */
export class InvoiceService extends FeesBase {
  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.viewer(async (tx, own) => {
      const f = q.filters, today = todayIST();
      const open = sql`(${feeInvoices.grossPaise} - ${feeInvoices.concessionPaise} - ${feeInvoices.creditedPaise} + ${feeInvoices.latePaise} - ${feeInvoices.paidPaise})`;
      // shortcut: the overdue filter uses the bill's own due date; the state shown on each row also honours settlement parts.
      const state: Record<string, SQL> = {
        draft: sql`${feeInvoices.status} = 'draft'`, cancelled: sql`${feeInvoices.status} = 'cancelled'`, paid: sql`${feeInvoices.status} = 'issued' and ${open} <= 0`,
        open: sql`${feeInvoices.status} = 'issued' and ${open} > 0`, overdue: sql`${feeInvoices.status} = 'issued' and ${open} > 0 and ${feeInvoices.dueDate} < ${today}`,
      };
      const where = and(
        own ? inArray(feeInvoices.studentId, own.length ? own : ["00000000-0000-0000-0000-000000000000"]) : undefined,
        own ? sql`${feeInvoices.status} <> 'draft'` : undefined,
        f.studentId ? eq(feeInvoices.studentId, f.studentId) : undefined, f.classId ? eq(feeInvoices.classId, f.classId) : undefined,
        f.yearId ? eq(feeInvoices.yearId, f.yearId) : undefined, f.kind ? eq(feeInvoices.kind, f.kind as never) : undefined,
        f.status ? eq(feeInvoices.status, f.status as never) : undefined, f.state ? state[f.state] : undefined,
        f.from ? sql`${feeInvoices.dueDate} >= ${f.from}` : undefined, f.to ? sql`${feeInvoices.dueDate} <= ${f.to}` : undefined,
        q.q ? or(ilike(feeInvoices.number, `%${q.q}%`), sql`${feeInvoices.snapshot}->>'studentName' ilike ${`%${q.q}%`}`, sql`${feeInvoices.snapshot}->>'admissionNo' ilike ${`%${q.q}%`}`, ilike(feeInvoices.label, `%${q.q}%`)) : undefined,
      );
      const [rows, [n]] = await Promise.all([
        tx.select().from(feeInvoices).where(where).orderBy(desc(feeInvoices.dueDate), desc(feeInvoices.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeInvoices).where(where),
      ]);
      const parts = rows.length ? await tx.select().from(feeDueParts).where(inArray(feeDueParts.invoiceId, rows.map((r) => r.id))) : [];
      return toPage(rows.map((r) => {
        const p = parts.filter((x) => x.invoiceId === r.id);
        return { ...r, openPaise: r.status === "issued" ? openOf(r) : 0, state: dueState({ ...r, parts: p }, today), studentName: r.snapshot.studentName, admissionNo: r.snapshot.admissionNo };
      }), Number(n?.n ?? 0), q);
    });
  }

  /** One bill in full: lines, notes, who paid what, earlier and later versions, and the late fee that has built up today. */
  async get(id: string) {
    return this.viewer(async (tx, own) => {
      const [inv] = await this.loadInvoices(tx, eq(feeInvoices.id, asId(id, "Invoice")));
      if (!inv) throw new NotFoundError("Invoice");
      this.assertVisible(own, inv.studentId, "Invoice");
      if (own && inv.status === "draft") throw new NotFoundError("Invoice");
      const today = todayIST();
      const [notes, allocations, versions, student] = await Promise.all([
        tx.select().from(feeNotes).where(eq(feeNotes.invoiceId, id)).orderBy(asc(feeNotes.createdAt)),
        tx.select({ id: feeAllocations.id, receiptId: feeAllocations.receiptId, receiptNumber: feeReceipts.number, lineId: feeAllocations.invoiceLineId, amountPaise: feeAllocations.amountPaise, date: feeAllocations.date, undoneAt: feeAllocations.undoneAt })
          .from(feeAllocations).leftJoin(feeReceipts, eq(feeReceipts.id, feeAllocations.receiptId)).where(inArray(feeAllocations.invoiceLineId, inv.lines.map((l) => l.id).concat(["00000000-0000-0000-0000-000000000000"]))).orderBy(asc(feeAllocations.date), asc(feeAllocations.createdAt)),
        this.lineage(tx, inv),
        tx.select({ id: students.id, name: students.name }).from(students).where(eq(students.id, inv.studentId)),
      ]);
      const accruedLatePaise = inv.status === "issued" ? invoiceLateFee(inv.lateRule, calcOf(inv), today) : 0;
      const changes = own ? [] : await this.withApproval(tx, ["fees.invoice_change"], await tx.select().from(feeInvoiceChanges).where(eq(feeInvoiceChanges.invoiceId, id)).orderBy(desc(feeInvoiceChanges.createdAt)));
      return { invoice: inv, student: student[0]!, changes, openChange: changes.find((c) => c.status === "pending") ?? null, openPaise: inv.status === "issued" ? openOf(inv) : 0, state: dueState(inv, today), accruedLatePaise, notes: await this.withApproval(tx, ["fees.note"], notes), allocations, versions };
    });
  }

  /** Every version of a bill, oldest first (follows `replacesId` both ways). */
  private async lineage(tx: Tx, inv: InvoiceFull) {
    const all = new Map<string, { id: string; number: string | null; version: number; status: string; replacesId: string | null }>();
    const add = (r: { id: string; number: string | null; version: number; status: string; replacesId: string | null }) => all.set(r.id, r);
    add(inv);
    for (let i = 0; i < 12; i++) {
      const ids = [...all.keys()];
      const more = await tx.select({ id: feeInvoices.id, number: feeInvoices.number, version: feeInvoices.version, status: feeInvoices.status, replacesId: feeInvoices.replacesId }).from(feeInvoices)
        .where(or(inArray(feeInvoices.id, [...all.values()].flatMap((v) => (v.replacesId ? [v.replacesId] : []))), inArray(feeInvoices.replacesId, ids)));
      const fresh = more.filter((m) => !all.has(m.id));
      if (!fresh.length) break;
      fresh.forEach(add);
    }
    return [...all.values()].sort((a, b) => a.version - b.version);
  }

  // ---------- drafts ----------

  /** Save a custom bill (a trip, damage, a one-off fee) as a draft; with `id`, replace the lines of a draft. */
  async saveDraft(input: unknown) {
    this.authorize("setup", "write");
    const d = this.parse(draftInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.currentYear(tx);
      if (d.id) {
        const [cur] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, d.id)).for("update");
        if (!cur) throw new NotFoundError("Invoice");
        if (cur.status !== "draft") throw new ConflictError("This bill is issued, so it cannot be edited. Revise it, or add a credit or debit note.");
        await tx.delete(feeInvoiceLines).where(eq(feeInvoiceLines.invoiceId, d.id));
        await tx.update(feeInvoices).set({ label: d.label, dueDate: d.dueDate, note: d.note ?? null, ...(d.lateRule === undefined ? {} : { lateRule: d.lateRule }) }).where(eq(feeInvoices.id, d.id));
        await this.writeLines(tx, d.id, d.lines);
        return d.id;
      }
      return this.createDraft(tx, { studentId: d.studentId, yearId: year.id, kind: "custom", label: d.label, dueDate: d.dueDate, note: d.note, lines: d.lines, lateRule: d.lateRule === undefined ? await this.planRule(tx, d.studentId, year.id) : d.lateRule });
    }, (id) => ({ action: "draft", entity: "Invoice", entityId: id, summary: `Saved draft bill ${d.label}` }));
  }

  async deleteDraft(id: string) {
    return this.write("setup", async (tx) => {
      const gone = await tx.delete(feeInvoices).where(and(eq(feeInvoices.id, id), eq(feeInvoices.status, "draft"))).returning({ id: feeInvoices.id });
      if (!gone.length) throw new ConflictError("Only a draft can be deleted. An issued bill is cancelled or corrected with a note.");
      return { id };
    }, () => ({ action: "delete", entity: "Invoice", entityId: id, summary: "Deleted a draft bill" }));
  }

  /** One extra charge for several students (a trip): a bill each, issued now. */
  async chargeMany(input: unknown) {
    this.authorize("setup", "write");
    const d = this.parse(chargeManyInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.currentYear(tx);
      const made: string[] = [];
      for (const studentId of d.studentIds) made.push(await this.createDraft(tx, { studentId, yearId: year.id, kind: "custom", label: d.label, dueDate: d.dueDate, note: d.note, lines: d.lines, lateRule: d.lateRule === undefined ? await this.planRule(tx, studentId, year.id) : d.lateRule }));
      await this.issueIn(tx, made);
      return made;
    }, (ids) => ({ action: "charge_many", entity: "Invoice", summary: `Billed ${ids.length} students for ${d.label}` }));
  }

  /** The late fee rule of the plan a student is billed on (the school's usual), or null when they have no plan or the plan has none. */
  private async planRule(tx: Tx, studentId: string, yearId: string): Promise<InvoiceFull["lateRule"]> {
    const [s] = await tx.select({ id: students.id, classId: students.classId, admissionDate: students.admissionDate }).from(students).where(eq(students.id, studentId));
    if (!s) throw new NotFoundError("Student");
    const pick = await new PlanService(this.ctx).resolve(tx, s, yearId);
    return pick ? (await tx.select({ r: feePlans.lateRule }).from(feePlans).where(eq(feePlans.id, pick.id)))[0]?.r ?? null : null;
  }

  /** What a new bill for this student charges late by default, with the plan it comes from, so the editor can say it in words. */
  async lateRuleFor(studentId: string) {
    this.authorize("setup", "write");
    return this.read("setup", async (tx) => {
      const year = await this.currentYear(tx);
      return { rule: await this.planRule(tx, asId(studentId, "Student"), year.id) };
    });
  }

  /** A draft bill row with its lines, for one student. `sourceKey` makes system bills idempotent. */
  async createDraft(tx: Tx, a: { studentId: string; yearId: string; kind: InvoiceFull["kind"]; label: string; dueDate: string; note?: string | null; lines: LineIn[]; sourceKey?: string; replacesId?: string; version?: number; lateRule?: InvoiceFull["lateRule"]; classId?: string | null; snapshot?: InvoiceFull["snapshot"] }) {
    const s = await this.oneStudent(tx, a.studentId);
    const [row] = await tx.insert(feeInvoices).values({
      schoolId: this.ctx.schoolId, studentId: s.id, yearId: a.yearId, classId: a.classId === undefined ? s.classId : a.classId, kind: a.kind, label: a.label, dueDate: a.dueDate, note: a.note ?? null, sourceKey: a.sourceKey ?? null,
      replacesId: a.replacesId ?? null, version: a.version ?? 1, lateRule: a.lateRule ?? null, snapshot: a.snapshot ?? await this.snapshot(tx, s), createdBy: this.ctx.userId,
    }).returning({ id: feeInvoices.id });
    await this.writeLines(tx, row!.id, a.lines);
    return row!.id;
  }

  private async writeLines(tx: Tx, invoiceId: string, lines: LineIn[]) {
    const heads = await this.headMap(tx, lines.map((l) => l.headId ?? null));
    if (lines.some((l) => l.headId && !heads.has(l.headId))) throw new NotFoundError("Fee head");
    await tx.insert(feeInvoiceLines).values(lines.map((l, i) => ({ schoolId: this.ctx.schoolId, invoiceId, headId: l.headId ?? null, kind: l.kind === "opening" || l.kind === "bounce" ? l.kind : l.kind === "deposit" || (l.headId && heads.get(l.headId)?.type === "deposit") ? "deposit" as const : "fee" as const, label: l.label, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise ?? 0, sort: i })));
    await this.refreshInvoiceTotals(tx, [invoiceId]);
  }

  // ---------- issue ----------

  async issue(id: string) { return this.issueMany([id]); }

  async issueMany(ids: string[]) {
    this.authorize("setup", "write");
    return this.write("setup", (tx) => this.issueIn(tx, ids), (r) => ({ action: "issue", entity: "Invoice", entityId: r[0], summary: `Issued ${r.length} bill${r.length === 1 ? "" : "s"}` }));
  }

  /**
   * Turn drafts into issued bills: number, date, token, who it is for as of today, the posting, and the advance (if the
   * school lets it) put to work. No permission check: callers did theirs.
   */
  async issueIn(tx: Tx, ids: string[], date = todayIST()): Promise<string[]> {
    if (!ids.length) return [];
    const studentIds = (await tx.select({ s: feeInvoices.studentId }).from(feeInvoices).where(inArray(feeInvoices.id, ids))).map((r) => r.s);
    await this.lockStudents(tx, studentIds);
    const drafts = (await this.invoicesById(tx, ids, true)).filter((i) => i.status === "draft");
    if (drafts.length !== new Set(ids).size) throw new ConflictError("A bill in this list is already issued or cancelled. Reload and try again.");
    const settings = await this.settings(tx);
    const byId = new Map((await this.studentLines(tx, inArray(students.id, studentIds))).map((s) => [s.id, s]));
    for (const inv of drafts) {
      if (!inv.lines.length || inv.grossPaise <= 0) throw invalid("lines", "A bill needs at least one line.");
      const s = byId.get(inv.studentId)!;
      const number = await this.number(tx, "invoice", date);
      await tx.update(feeInvoices).set({ status: "issued", number, issueDate: date, verifyToken: newToken(), templateVersion: await this.templateVersionIn(tx, "invoice"), snapshot: inv.kind === "plan" ? inv.snapshot : await this.snapshot(tx, s), classId: inv.classId ?? s.classId }).where(eq(feeInvoices.id, inv.id));
      await this.postIssue(tx, inv, settings.basis, date);
    }
    await this.autoUseAdvance(tx, studentIds, date);
    return drafts.map((d) => d.id);
  }

  /** Dr Student dues, Cr income by head; Dr concessions, Cr Student dues. On the cash basis nothing posts at issue (opening balances always do). */
  private async postIssue(tx: Tx, inv: InvoiceFull, basis: "accrual" | "cash", date: string) {
    const lines = basis === "accrual" ? inv.lines : inv.lines.filter((l) => l.kind === "opening");
    if (!lines.length) return;
    const heads = await this.headMap(tx, lines.map((l) => l.headId));
    const party = { type: "student" as const, id: inv.studentId };
    const gross = lines.reduce((s, l) => s + l.amountPaise, 0), conc = lines.reduce((s, l) => s + l.concessionPaise, 0);
    const out: PostLine[] = [{ account: "student_dues", debit: gross, party }, ...lines.map((l): PostLine => { const account = this.lineAccount(l, heads); return { account, credit: l.amountPaise, memo: l.label, ...this.party(account, inv.studentId) }; }), { account: "concessions", debit: conc }, { account: "student_dues", credit: conc, party }];
    await this.post(tx, { date, sourceKey: `fees:invoice:${inv.id}`, sourceType: "fee_invoice", sourceId: inv.id, memo: `Bill ${inv.label}`, lines: out });
  }

  /** The bill as a PDF in the school's invoice layout (the version it was issued with). A draft has no number, so it has no file. */
  async invoiceFile(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const doc = await this.viewer(async (tx, own) => {
      const [inv] = await this.loadInvoices(tx, eq(feeInvoices.id, asId(id, "Invoice")));
      if (!inv) throw new NotFoundError("Invoice");
      this.assertVisible(own, inv.studentId, "Invoice");
      if (inv.status === "draft" || !inv.number || !inv.issueDate || !inv.verifyToken) throw new ConflictError("This bill is still a draft. Issue it first, then print it.");
      const verifyUrl = await this.verifyUrlIn(tx, "invoice", inv.verifyToken);
      return { inv, data: invoiceData({ number: inv.number, label: inv.label, issueDate: inv.issueDate, dueDate: inv.dueDate, status: inv.status, note: inv.note, snapshot: inv.snapshot, verifyUrl, lines: inv.lines, paidPaise: inv.paidPaise }) };
    });
    const { bytes, copyNo } = await this.templates().print("invoice", doc.data, { docType: "fee_invoice", docId: id, version: doc.inv.templateVersion ?? undefined });
    return { filename: `${doc.inv.number!.replace(/\//g, "-")}${copyNo > 1 ? "-duplicate" : ""}.pdf`, bytes };
  }

  /** Up to 100 bills as one PDF, each printed (and logged as a print) the same way as on its own. */
  invoicesFile(ids: string[]) { return this.mergedFiles(ids, "bills", (id) => this.invoiceFile(id)); }

  // ---------- cancel and revise ----------

  /**
   * Cancel a bill nobody has paid or credited, and reverse its posting. A cancel takes what is owed off the student, so
   * above the school's limit it waits for approval `fees.invoice_change` (the proposal is kept; see `ChangeService`).
   * Anything paid or credited is corrected with a credit note instead.
   */
  async cancel(id: string, reason: string) {
    this.authorize("setup", "write");
    const why = this.parse(reviseInput.shape.reason, reason);
    return this.write("setup", async (tx) => {
      const [row] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, asId(id, "Invoice")));
      if (!row) throw new NotFoundError("Invoice");
      const label = row.number ?? row.label;
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "cancel", invoiceId: id, studentId: row.studentId, payload: {}, reason: why, lowersPaise: row.status === "issued" ? openOf(row) : 0, title: `Cancel bill ${label}`, href: `/app/fees/invoices/${id}` }, () => this.cancelIn(tx, id, why));
      return out.requested ? { id, number: row.number, label: row.label, requested: true, changeId: out.change.id } : { ...out.value, requested: false, changeId: null };
    }, (r) => ({ action: r.requested ? "request_cancel" : "cancel", entity: "Invoice", entityId: r.id, summary: `${r.requested ? "Asked to cancel" : "Cancelled"} bill ${r.number ?? r.label}: ${why}` }));
  }

  /** The cancel itself: no permission and no approval check, because the caller did them (the approval handler, the system charges of transport and library). */
  async cancelIn(tx: Tx, id: string, reason: string, date = todayIST()) {
    const [pre] = await tx.select({ s: feeInvoices.studentId }).from(feeInvoices).where(eq(feeInvoices.id, id));
    if (!pre) throw new NotFoundError("Invoice");
    await this.lockStudents(tx, [pre.s]);
    const [inv] = await this.invoicesById(tx, [id], true);
    if (inv!.status !== "issued") throw new ConflictError(inv!.status === "draft" ? "This is a draft. Delete it instead." : "This bill is already cancelled.");
    if (inv!.paidPaise > 0) throw new ConflictError(`Money was already paid on this bill. Reverse the receipt first, or add a credit note.`);
    if (inv!.creditedPaise > 0 || inv!.parts.length) throw new ConflictError("This bill has notes or a settlement on it. Correct it with a credit note instead.");
    await tx.update(feeInvoices).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason }).where(eq(feeInvoices.id, id));
    // A yearly concession gets back what this bill took.
    await tx.delete(feeConcessionUses).where(eq(feeConcessionUses.invoiceId, id));
    for (const l of inv!.lines.filter((x) => x.kind === "late")) await this.reverse(tx, `fees:late:${l.id}`, `Bill ${inv!.number} cancelled`, date);
    await this.reverse(tx, `fees:invoice:${id}`, `Bill ${inv!.number} cancelled: ${reason}`, date);
    return { id, number: inv!.number, label: inv!.label };
  }

  /**
   * Replace what is still open on a bill. Unpaid: it is cancelled and a new version issued. Part paid: its open part is
   * taken off by a credit note and a new version (the lines given) is issued for the rest. The old one stays visible.
   * A revision that lowers what is owed by more than the limit waits for approval; a fix of a date, a label, a head or
   * anything of the same total applies at once.
   */
  async revise(id: string, input: unknown) {
    this.authorize("setup", "write");
    const d = this.parse(reviseInput, input);
    return this.write("setup", async (tx) => {
      const [row] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, asId(id, "Invoice")));
      if (!row) throw new NotFoundError("Invoice");
      if (row.status !== "issued") throw new ConflictError("Only an issued bill can be revised.");
      const lowers = openOf(row) - d.lines.reduce((s, l) => s + l.amountPaise, 0);
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "revise", invoiceId: id, studentId: row.studentId, payload: d, reason: d.reason, lowersPaise: lowers, title: `Revise bill ${row.number ?? row.label}`, href: `/app/fees/invoices/${id}` }, () => this.reviseIn(tx, id, d));
      return out.requested ? { invoiceId: null, requested: true, changeId: out.change.id } : { invoiceId: out.value, requested: false, changeId: null };
    }, (r) => ({ action: r.requested ? "request_revise" : "revise", entity: "Invoice", entityId: r.invoiceId ?? id, summary: `${r.requested ? "Asked to revise" : "Revised"} a bill: ${d.reason}` }));
  }

  /** The revision itself (no permission or approval check). Returns the new version's id. */
  async reviseIn(tx: Tx, id: string, d: ReturnType<typeof reviseInput.parse>): Promise<string> {
    const [pre] = await tx.select({ s: feeInvoices.studentId }).from(feeInvoices).where(eq(feeInvoices.id, id));
    if (!pre) throw new NotFoundError("Invoice");
    await this.lockStudents(tx, [pre.s]);
    const [old] = await this.invoicesById(tx, [id], true);
    if (old!.status !== "issued") throw new ConflictError("Only an issued bill can be revised.");
    if (old!.paidPaise === 0 && old!.creditedPaise === 0 && !old!.parts.length) await this.cancelIn(tx, id, `Revised: ${d.reason}`);
    else {
      const spec = old!.lines.filter((l) => openOf(l) > 0).map((l) => ({ lineId: l.id, amountPaise: openOf(l) }));
      if (spec.length) await new NoteService(this.ctx).issueIn(tx, { invoiceId: id, kind: "credit", reasonType: "correction", reason: `Revised: ${d.reason}`, lines: spec });
    }
    const key = old!.sourceKey ? (old!.paidPaise === 0 && old!.creditedPaise === 0 ? old!.sourceKey : `${old!.sourceKey}:v${old!.version + 1}`) : undefined;
    const nid = await this.createDraft(tx, { studentId: old!.studentId, yearId: old!.yearId, kind: old!.kind, label: d.label ?? old!.label, dueDate: d.dueDate ?? old!.dueDate, note: d.reason, lines: d.lines, sourceKey: key, replacesId: id, version: old!.version + 1, lateRule: d.lateRule === undefined ? old!.lateRule : d.lateRule, classId: old!.classId, snapshot: old!.snapshot });
    await this.issueIn(tx, [nid]);
    return nid;
  }

  /** Take a waiting cancel or revision back. */
  withdrawChange(changeId: string) { return new ChangeService(this.ctx).withdraw(changeId); }

  /** Edit a refused or withdrawn cancel or revision and send it again. */
  async resubmitChange(changeId: string, input: unknown) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      const [c] = await tx.select().from(feeInvoiceChanges).where(eq(feeInvoiceChanges.id, changeId)).for("update");
      if (!c || !c.invoiceId) throw new NotFoundError("Request");
      if (c.status !== "rejected" || c.direct) throw new ConflictError("Only a request that was not approved can be edited and sent again.");
      const bills = new InvoiceService(this.ctx);
      if (c.kind === "cancel") return bills.cancel(c.invoiceId, (input as { reason?: string })?.reason ?? c.reason);
      if (c.kind === "revise") return bills.revise(c.invoiceId, input ?? c.payload);
      throw new ConflictError("Send this kind of change again from its own screen.");
    });
  }

  // ---------- from the plans ----------

  /** What issuing would make, bill by bill, without making any. */
  async previewBulk(input: unknown) {
    this.authorize("setup", "write");
    const o = this.parse(bulkInput, input);
    return this.read("setup", async (tx) => {
      const { year, drafts, skipped, exceptions } = await new PlanBilling(this.ctx).build(tx, o);
      return { yearId: year.id, count: drafts.length, exceptions, grossPaise: drafts.reduce((s, d) => s + d.grossPaise, 0), concessionPaise: drafts.reduce((s, d) => s + d.concessionPaise, 0), skipped,
        rows: drafts.map((d) => ({ studentId: d.studentId, studentName: d.studentName, admissionNo: d.admissionNo, label: d.label, dueOn: d.dueOn, grossPaise: d.grossPaise, concessionPaise: d.concessionPaise, duePaise: d.grossPaise - d.concessionPaise })) };
    });
  }

  /** Make and issue the bills the plans call for. Idempotent: a bill that exists for a plan, student and due key is left alone. */
  async issueBulk(input: unknown, billedBy?: string) {
    this.authorize("setup", "write");
    const o = this.parse(bulkInput, input);
    return this.write("setup", (tx) => this.issuePlansIn(tx, { ...o, billedBy }), (r) => ({ action: "issue_bulk", entity: "Invoice", summary: `Issued ${r.issued} bills from the fee plans` }));
  }

  async issuePlansIn(tx: Tx, o: { yearId?: string; classIds?: string[]; dueKeys?: string[]; studentIds?: string[]; billedBy?: string }, date = todayIST()) {
    const { drafts, skipped, year } = await new PlanBilling(this.ctx).build(tx, o);
    await this.lockStudents(tx, drafts.map((d) => d.studentId));
    const made: string[] = [];
    for (let i = 0; i < drafts.length; i += CHUNK) {
      const chunk = drafts.slice(i, i + CHUNK);
      const snaps = new Map<string, InvoiceFull["snapshot"]>();
      for (const s of await this.studentLines(tx, inArray(students.id, [...new Set(chunk.map((d) => d.studentId))]))) snaps.set(s.id, await this.snapshot(tx, s));
      const rows = await tx.insert(feeInvoices).values(chunk.map((d) => ({
        schoolId: this.ctx.schoolId, studentId: d.studentId, yearId: year.id, classId: d.classId, kind: "plan" as const, sourceKey: d.sourceKey, label: d.label, dueDate: d.dueOn, lateRule: d.lateRule,
        snapshot: snaps.get(d.studentId)!, createdBy: this.ctx.userId,
      }))).onConflictDoNothing().returning({ id: feeInvoices.id, sourceKey: feeInvoices.sourceKey });
      const byKey = new Map(rows.map((r) => [r.sourceKey, r.id]));
      const kept = chunk.filter((d) => byKey.has(d.sourceKey));
      if (!kept.length) continue;
      await tx.insert(feeInvoiceLines).values(kept.flatMap((d) => d.lines.map((l, k) => ({ schoolId: this.ctx.schoolId, invoiceId: byKey.get(d.sourceKey)!, headId: l.headId, kind: l.kind, label: l.label, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise, sort: k }))));
      const uses = kept.flatMap((d) => d.uses.map((u) => ({ schoolId: this.ctx.schoolId, concessionId: u.concessionId, invoiceId: byKey.get(d.sourceKey)!, amountPaise: u.amountPaise })));
      if (uses.length) await tx.insert(feeConcessionUses).values(uses);
      await this.refreshInvoiceTotals(tx, [...byKey.values()]);
      made.push(...await this.issueIn(tx, [...byKey.values()], date));
    }
    return { issued: made.length, skipped: { ...skipped, alreadyIssued: skipped.alreadyIssued + drafts.length - made.length } };
  }

  /** Opening balances from the old system: dues, advances and deposits per student. `dryRun` checks every row and writes nothing. */
  async importOpening(file: { name: string; bytes: Uint8Array }, dryRun: boolean) {
    this.authorize("setup", "write");
    return new OpeningImport(this.ctx).run(file, dryRun);
  }
}
