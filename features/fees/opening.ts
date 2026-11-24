import { and, desc, eq, inArray } from "drizzle-orm";
import { parseSheet, SheetError } from "@smw/integrations";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { finApprovals } from "@smw/feature-finance/schema";
import { students } from "@smw/feature-students/schema";
import type { Tx } from "@smw/db";
import { FeesBase, invalid } from "./base";
import type { InvoiceService } from "./invoices";
import { feeAdvances, feeInvoices, feeOpeningBatches } from "./schema";

const money = (v: string): number | null => {
  if (!v) return 0;
  const n = Number(v.replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

type Batch = typeof feeOpeningBatches.$inferSelect;
type Row = Batch["rows"][number];

/**
 * Opening balances from a sheet (columns admission_no, dues, advance, deposit, as_of; rupees). Every row is checked
 * first; one bad row stops the whole import and nothing is written. A good sheet is kept as a batch and asked for
 * approval `fees.opening`; only the approval posts it: dues become one issued bill per student, advance and deposit go
 * on their lists, all against Opening balances, all or none.
 */
export class OpeningImport extends FeesBase {
  /** Students that already have opening balances (done) or have some waiting for approval (waiting), leaving one batch out. */
  private async takenIn(tx: Tx, exceptBatch?: string): Promise<{ done: Set<string>; waiting: Set<string> }> {
    const [issued, batches] = await Promise.all([
      tx.select({ k: feeInvoices.sourceKey }).from(feeInvoices).where(and(eq(feeInvoices.kind, "opening"), eq(feeInvoices.status, "issued"))),
      tx.select().from(feeOpeningBatches).where(inArray(feeOpeningBatches.status, ["pending", "approved"])),
    ]);
    const done = new Set(issued.map((r) => r.k?.replace("opening:", "")).filter((x): x is string => !!x)), waiting = new Set<string>();
    for (const b of batches) if (b.id !== exceptBatch) for (const r of b.rows) (b.status === "approved" ? done : waiting).add(r.studentId);
    return { done, waiting };
  }

  async run(file: { name: string; bytes: Uint8Array }, dryRun: boolean) {
    let sheet;
    try { sheet = await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw invalid("file", e.message); throw e; }
    const missing = ["admission_no"].filter((c) => !sheet.columns.includes(c));
    if (missing.length) throw invalid("file", `The sheet needs a column called ${missing.join(", ")}. Download the template and use its first row.`);
    return this.write("setup", async (tx) => {
      const year = await this.currentYear(tx);
      const nos = sheet.rows.map((r) => r.admission_no ?? "");
      const found = nos.length ? await tx.select({ id: students.id, no: students.admissionNo }).from(students).where(inArray(students.admissionNo, nos)) : [];
      const byNo = new Map(found.map((s) => [s.no, s.id]));
      const { done, waiting } = await this.takenIn(tx);
      const errors: { line: number; message: string }[] = [];
      const rows: Row[] = [];
      const seen = new Set<string>();
      sheet.rows.forEach((r, i) => {
        const line = sheet.lines[i]!;
        const err = (message: string) => errors.push({ line, message });
        const studentId = byNo.get(r.admission_no ?? "");
        const [dues, advance, deposit] = [money(r.dues ?? ""), money(r.advance ?? ""), money(r.deposit ?? "")];
        const asOf = r.as_of || year.startsOn;
        const no = r.admission_no ?? "";
        if (!studentId) return err(`No student with admission number ${no || "(blank)"}.`);
        if (seen.has(studentId)) return err(`${no} is on the sheet twice.`);
        seen.add(studentId);
        if (dues === null || advance === null || deposit === null) return err("Dues, advance and deposit must be amounts in rupees, like 12500 or 12,500.50.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return err("as_of must be a date like 2026-04-01.");
        if (done.has(studentId)) return err(`${no} already has opening balances. They are not entered twice.`);
        if (waiting.has(studentId)) return err(`${no} already has opening balances waiting for approval. Withdraw that request first, or wait for the decision.`);
        if (dues + advance + deposit === 0) return err("This row has no amount.");
        rows.push({ studentId, dues, advance, deposit, asOf, no });
      });
      const totals = totalsOf(rows);
      if (dryRun || errors.length) return { applied: false, submitted: false, batchId: null, approvalId: null, errors, totals };
      const [batch] = await tx.insert(feeOpeningBatches).values({ schoolId: this.ctx.schoolId, fileName: file.name, rows, totals, createdBy: this.ctx.userId }).returning();
      const approval = await this.askBatch(tx, batch!);
      await this.audit(tx, { action: "submit_opening", entity: "Fee opening balances", entityId: batch!.id, summary: `Sent opening balances for ${totals.students} students for approval`, meta: totals });
      return { applied: false, submitted: true, batchId: batch!.id, approvalId: approval.id, errors, totals };
    });
  }

  private askBatch(tx: Tx, b: Batch) {
    const total = b.totals.duesPaise + b.totals.advancePaise + b.totals.depositPaise;
    return this.askApproval(tx, { kind: "fees.opening", refType: "fee_opening_batch", refId: b.id, title: `Opening balances for ${b.totals.students} students from ${b.fileName} (${rupees(total)})`, amountPaise: total,
      reason: `Dues ${rupees(b.totals.duesPaise)}, advances ${rupees(b.totals.advancePaise)}, deposits ${rupees(b.totals.depositPaise)}. Nothing is posted until this is approved.`, href: "/app/fees/opening" });
  }

  private async lockBatchIn(tx: Tx, id: string): Promise<Batch> {
    const [b] = await tx.select().from(feeOpeningBatches).where(eq(feeOpeningBatches.id, id)).for("update");
    if (!b) throw new NotFoundError("Opening balance batch");
    return b;
  }

  /** The approval handler: check every row again (it may be days old), then post all of it. */
  async approveIn(tx: Tx, id: string, invoices: InvoiceService) {
    const b = await this.lockBatchIn(tx, id);
    if (b.status !== "pending") throw new ConflictError("This batch was already decided.");
    const year = await this.currentYear(tx);
    const ids = b.rows.map((r) => r.studentId);
    const alive = new Set((await tx.select({ id: students.id }).from(students).where(inArray(students.id, ids))).map((s) => s.id));
    const { done, waiting } = await this.takenIn(tx, id);
    for (const r of b.rows) {
      if (!alive.has(r.studentId)) throw new ConflictError(`${r.no} is no longer a student here. Reject this batch and import the sheet again without that row.`);
      if (done.has(r.studentId) || waiting.has(r.studentId)) throw new ConflictError(`${r.no} has opening balances from another batch. Reject this batch and import the sheet again without that row.`);
    }
    await this.lockStudents(tx, ids);
    for (const r of b.rows) {
      if (r.dues > 0) {
        const bill = await invoices.createDraft(tx, { studentId: r.studentId, yearId: year.id, kind: "opening", label: "Opening balance", dueDate: r.asOf, sourceKey: `opening:${r.studentId}`, lines: [{ kind: "opening", label: "Opening balance", amountPaise: r.dues }] });
        await invoices.issueIn(tx, [bill], r.asOf);
      }
      for (const [kind, amount, account, label] of [["opening", r.advance, "student_advances", "Opening advance"], ["deposit", r.deposit, "deposits_payable", "Opening deposit"]] as const) {
        if (!amount) continue;
        const [row] = await tx.insert(feeAdvances).values({ schoolId: this.ctx.schoolId, studentId: r.studentId, kind, amountPaise: amount, note: label, date: r.asOf }).returning({ id: feeAdvances.id });
        await this.post(tx, { date: r.asOf, sourceKey: `fees:opening-${kind}:${row!.id}`, sourceType: "fee_student", sourceId: r.studentId, memo: `${label} (${r.no})`, lines: [{ account: "opening", debit: amount }, { account, credit: amount, party: { type: "student", id: r.studentId } }] });
      }
    }
    await tx.update(feeOpeningBatches).set({ status: "approved" }).where(eq(feeOpeningBatches.id, id));
    await this.audit(tx, { action: "import_opening", entity: "Fee opening balances", entityId: id, summary: `Posted opening balances for ${b.rows.length} students`, meta: b.totals });
  }

  async rejectIn(tx: Tx, id: string) {
    await tx.update(feeOpeningBatches).set({ status: "rejected" }).where(and(eq(feeOpeningBatches.id, id), eq(feeOpeningBatches.status, "pending")));
  }

  /** Take a waiting batch back. It stays on file; it can be sent again. */
  async withdraw(id: string) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      await this.lockBatchIn(tx, id);
      await this.withdrawRequest(tx, "fees.opening", id);
      const [b] = await tx.update(feeOpeningBatches).set({ status: "rejected" }).where(eq(feeOpeningBatches.id, id)).returning();
      return b!;
    }, (b) => ({ action: "withdraw", entity: "Fee opening balances", entityId: b.id, summary: `Withdrew the opening balances from ${b.fileName}` }));
  }

  /** Send a refused or withdrawn batch again. The rows are checked again against today's students and batches. */
  async resubmit(id: string) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      const b = await this.lockBatchIn(tx, id);
      if (b.status !== "rejected") throw new ConflictError("Only a batch that was not approved can be sent again.");
      const alive = new Set((await tx.select({ id: students.id }).from(students).where(inArray(students.id, b.rows.map((r) => r.studentId)))).map((s) => s.id));
      const { done, waiting } = await this.takenIn(tx, id);
      const bad = b.rows.find((r) => !alive.has(r.studentId) || done.has(r.studentId) || waiting.has(r.studentId));
      if (bad) throw invalid("file", `${bad.no} cannot be entered any more (left the school, or already has opening balances). Upload the sheet again without that row.`);
      const [row] = await tx.update(feeOpeningBatches).set({ status: "pending" }).where(eq(feeOpeningBatches.id, id)).returning();
      await this.askBatch(tx, row!);
      return row!;
    }, (b) => ({ action: "resubmit", entity: "Fee opening balances", entityId: b.id, summary: `Sent the opening balances from ${b.fileName} again` }));
  }

  /** Batches newest first with where their request stands (for the opening balance screen). */
  async batches(limit = 20) {
    return this.read("setup", async (tx) => {
      const rows = await tx.select().from(feeOpeningBatches).orderBy(desc(feeOpeningBatches.createdAt)).limit(limit);
      const asks = rows.length ? await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "fees.opening"), inArray(finApprovals.refId, rows.map((r) => r.id)))).orderBy(desc(finApprovals.createdAt)) : [];
      return rows.map((b) => { const a = asks.find((x) => x.refId === b.id); return { ...b, approvalId: a?.id ?? null, approvalStatus: a?.status ?? null, decisionNote: a?.note ?? null }; });
    });
  }
}

const totalsOf = (rows: Row[]) => ({ students: rows.length, duesPaise: rows.reduce((s, r) => s + r.dues, 0), advancePaise: rows.reduce((s, r) => s + r.advance, 0), depositPaise: rows.reduce((s, r) => s + r.deposit, 0) });
