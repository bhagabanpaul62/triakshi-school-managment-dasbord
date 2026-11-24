import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, CrudService, NotFoundError, listQuerySchema, toPage, type Ctx, type ListQuery } from "@smw/feature-kit";
import { percentOf, rupees } from "@smw/feature-kit/money";
import { students } from "@smw/feature-students/schema";
import feesFeature from "./feature";
import { FeesBase, type Perm } from "./base";
import { concessionsDetailed, openOf, yearShare } from "./calc";
import { ChangeService } from "./changes";
import { PlanBilling } from "./plan-billing";
import { concessionInput, concessionTypeInput } from "./inputs";
import { NoteService } from "./notes";
import { PlanService } from "./plans";
import { feeConcessionTypes, feeConcessionUses, feeConcessions, feeHeads, feeInvoiceLines, feeInvoices, feePlanDues, feePlanLines } from "./schema";

export { NoteService } from "./notes";
export { SettlementService } from "./settlements";
export type Concession = typeof feeConcessions.$inferSelect;
type ConcessionType = typeof feeConcessionTypes.$inferSelect;

export class ConcessionTypeService extends CrudService<typeof feeConcessionTypes, Perm> {
  protected feature = feesFeature;
  protected table = feeConcessionTypes;
  protected entityName = "Concession type";
  protected readPermission = "read" as const;
  protected writePermission = "setup" as const;
  protected createSchema = concessionTypeInput;
  protected updateSchema = concessionTypeInput;
  protected defaultSort = "name";
  constructor(ctx: Ctx) { super(ctx); }
  protected searchColumns() { return [feeConcessionTypes.name]; }
  protected async usage(tx: Tx, t: ConcessionType): Promise<[string, number][]> {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(feeConcessions).where(eq(feeConcessions.typeId, t.id));
    return [["concessions given", r?.n ?? 0]];
  }
}

export interface Suggestion { kind: "sibling" | "rte" | "staff_child"; studentId: string; studentName: string; typeId: string | null; headId: string | null; mode: "percent" | "amount"; value: number; reason: string }

/** A discount for one student in one year. Approved ones cut every bill issued while they last, and open bills by a credit note. Nothing applies by itself. */
export class ConcessionService extends FeesBase {
  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.viewer(async (tx, own) => {
      const where = and(own ? inArray(feeConcessions.studentId, own.length ? own : ["00000000-0000-0000-0000-000000000000"]) : undefined, q.filters.status ? eq(feeConcessions.status, q.filters.status as Concession["status"]) : undefined, q.filters.studentId ? eq(feeConcessions.studentId, q.filters.studentId) : undefined, q.filters.yearId ? eq(feeConcessions.yearId, q.filters.yearId) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select({ c: feeConcessions, studentName: students.name, typeName: feeConcessionTypes.name, headName: feeHeads.name }).from(feeConcessions).innerJoin(students, eq(students.id, feeConcessions.studentId)).leftJoin(feeConcessionTypes, eq(feeConcessionTypes.id, feeConcessions.typeId)).leftJoin(feeHeads, eq(feeHeads.id, feeConcessions.headId))
          .where(where).orderBy(desc(feeConcessions.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeConcessions).where(where),
      ]);
      return toPage(await this.withApproval(tx, ["fees.concession"], rows.map((r) => ({ ...r.c, studentName: r.studentName, typeName: r.typeName, headName: r.headName }))), Number(n?.n ?? 0), q);
    });
  }

  /** What a concession is worth over the year, for the approval limit: the plan's dues (or the bills so far) for the head. */
  private async estimateIn(tx: Tx, c: { studentId: string; yearId: string; headId: string | null; mode: "percent" | "amount"; value: number; per: "bill" | "year" }) {
    const [s] = await tx.select({ id: students.id, classId: students.classId, admissionDate: students.admissionDate }).from(students).where(eq(students.id, c.studentId));
    const plan = s ? await new PlanService(this.ctx).resolve(tx, s, c.yearId) : null;
    const dues = plan ? await tx.select({ key: feePlanDues.dueKey, amount: feePlanDues.amountPaise }).from(feePlanDues).innerJoin(feePlanLines, eq(feePlanLines.id, feePlanDues.lineId)).where(and(eq(feePlanLines.planId, plan.id), eq(feePlanLines.optional, false), c.headId ? eq(feePlanLines.headId, c.headId) : undefined)) : [];
    // No plan covers the student: the bills already issued for the year say what the discount is worth.
    const planned = dues.reduce((a, d) => a + d.amount, 0);
    const base = planned || await this.issuedBaseIn(tx, c);
    if (c.mode === "percent") return percentOf(base, c.value);
    if (c.per === "year") return Math.min(base || c.value, c.value);
    return Math.min(base || c.value, c.value * Math.max(1, new Set(dues.map((d) => d.key)).size));
  }

  /** What the student's issued plan bills of the year total for the head, to value a discount when no plan can be found. */
  private async issuedBaseIn(tx: Tx, c: { studentId: string; yearId: string; headId: string | null }) {
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(${feeInvoiceLines.amountPaise}), 0)` }).from(feeInvoiceLines).innerJoin(feeInvoices, eq(feeInvoices.id, feeInvoiceLines.invoiceId))
      .where(and(eq(feeInvoices.studentId, c.studentId), eq(feeInvoices.yearId, c.yearId), eq(feeInvoices.status, "issued"), eq(feeInvoices.kind, "plan"), inArray(feeInvoiceLines.kind, ["fee"]), c.headId ? eq(feeInvoiceLines.headId, c.headId) : undefined));
    return Number(r?.v ?? 0);
  }

  async propose(input: unknown): Promise<Concession> {
    this.authorize("concede", "write");
    const d = this.parse(concessionInput, input);
    return this.write("concede", (tx) => this.requestIn(tx, d), (c) => ({ action: "propose", entity: "Concession", entityId: c.id, summary: `Concession for a student: ${c.reason}` }));
  }

  private async requestIn(tx: Tx, d: ReturnType<typeof concessionInput.parse>, id?: string): Promise<Concession> {
    const year = await this.yearOr(tx, d.yearId);
    const [[s], type, head] = await Promise.all([
      tx.select({ id: students.id, name: students.name }).from(students).where(eq(students.id, d.studentId)),
      d.typeId ? tx.select().from(feeConcessionTypes).where(eq(feeConcessionTypes.id, d.typeId)) : Promise.resolve([]),
      d.headId ? tx.select({ id: feeHeads.id }).from(feeHeads).where(eq(feeHeads.id, d.headId)) : Promise.resolve([]),
    ]);
    if (!s) throw new NotFoundError("Student");
    // Lock before the row below is written: the insert takes a share lock on the student, and two requests that each hold one and want the other's would deadlock.
    await this.lockStudents(tx, [s.id]);
    if (d.typeId && !type[0]) throw new NotFoundError("Concession type");
    if (d.headId && !head[0]) throw new NotFoundError("Fee head");
    const per = d.per ?? type[0]?.per ?? "year";
    const values = { studentId: s.id, yearId: year.id, typeId: d.typeId ?? null, headId: d.headId ?? null, mode: d.mode, per, value: d.value, reason: d.reason, fileKey: this.ownFile(d.fileKey, "concessions", "file"), status: "pending" as const, createdBy: this.ctx.userId };
    const [row] = id ? await tx.update(feeConcessions).set(values).where(eq(feeConcessions.id, id)).returning() : await tx.insert(feeConcessions).values({ schoolId: this.ctx.schoolId, ...values }).returning();
    const worth = await this.estimateIn(tx, { ...values });
    const changes = new ChangeService(this.ctx);
    // Small concessions apply at once, but the limit counts what this student has had alone before. A concession that cannot be valued at all is never small.
    if (worth > 0 && await changes.mayApplyAloneIn(tx, s.id, worth)) {
      await changes.recordDirectIn(tx, { kind: "concession", studentId: s.id, reason: d.reason, lowersPaise: worth });
      return this.approveIn(tx, row!.id);
    }
    await this.askApproval(tx, { kind: "fees.concession", refType: "fee_concession", refId: row!.id, title: `Concession for ${s.name}: ${d.mode === "percent" ? `${d.value / 100}%` : rupees(d.value)}`, amountPaise: worth, reason: d.reason, href: `/app/fees/concessions` });
    return row!;
  }

  async withdraw(id: string) {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      await this.withdrawRequest(tx, "fees.concession", id);
      const [c] = await tx.update(feeConcessions).set({ status: "rejected" }).where(eq(feeConcessions.id, id)).returning();
      return c!;
    }, (c) => ({ action: "withdraw", entity: "Concession", entityId: c.id, summary: "Withdrew a concession request" }));
  }

  /** Edit a refused or withdrawn concession and send it again. */
  async resubmit(id: string, input: unknown): Promise<Concession> {
    this.authorize("concede", "write");
    const d = this.parse(concessionInput, input);
    return this.write("concede", async (tx) => {
      const [cur] = await tx.select().from(feeConcessions).where(eq(feeConcessions.id, id)).for("update");
      if (!cur) throw new NotFoundError("Concession");
      if (cur.status !== "rejected") throw new ConflictError("Only a concession that was not approved can be edited and sent again.");
      return this.requestIn(tx, { ...d, studentId: cur.studentId }, id);
    }, (c) => ({ action: "resubmit", entity: "Concession", entityId: c.id, summary: "Sent a concession again" }));
  }

  /** Stop a concession for bills issued from now on. Bills already issued keep what they got. */
  async end(id: string) {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      const [c] = await tx.update(feeConcessions).set({ status: "ended" }).where(and(eq(feeConcessions.id, id), eq(feeConcessions.status, "approved"))).returning();
      if (!c) throw new ConflictError("Only a running concession can be ended.");
      return c;
    }, (c) => ({ action: "end", entity: "Concession", entityId: c.id, summary: "Ended a concession" }));
  }

  /** Approved: it counts on every bill issued from now, and the open bills of the year are cut by a credit note each. */
  async approveIn(tx: Tx, id: string): Promise<Concession> {
    const [pre] = await tx.select().from(feeConcessions).where(eq(feeConcessions.id, id));
    if (!pre) throw new NotFoundError("Concession");
    await this.lockStudents(tx, [pre.studentId]);
    const [c] = await tx.update(feeConcessions).set({ status: "approved" }).where(and(eq(feeConcessions.id, id), eq(feeConcessions.status, "pending"))).returning();
    if (!c) throw new ConflictError("This concession was already decided.");
    const open = (await this.loadInvoices(tx, and(eq(feeInvoices.studentId, c.studentId), eq(feeInvoices.yearId, c.yearId), eq(feeInvoices.status, "issued"), eq(feeInvoices.kind, "plan")), true)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    const notes = new NoteService(this.ctx);
    // A yearly amount is shared by the open bills and the bills still to come.
    const yearly = c.mode === "amount" && c.per === "year";
    let pool = c.value;
    const ahead = yearly ? (await new PlanBilling(this.ctx).build(tx, { yearId: c.yearId, studentIds: [c.studentId] })).drafts.length : 0;
    for (const [i, inv] of open.entries()) {
      const value = yearly ? yearShare(pool, open.length + ahead - i) : c.value;
      const { perLine } = concessionsDetailed(inv.lines.map((l) => ({ headId: l.headId, kind: l.kind, amountPaise: l.amountPaise - l.concessionPaise })), [{ headId: c.headId, mode: c.mode, value }]);
      const lines = inv.lines.map((l, k) => ({ lineId: l.id, amountPaise: Math.min(perLine[k]!, openOf(l)) })).filter((l) => l.amountPaise > 0);
      if (!lines.length) continue;
      await notes.issueIn(tx, { invoiceId: inv.id, kind: "credit", reasonType: "concession", reason: c.reason, lines });
      if (yearly) {
        const given = lines.reduce((s, l) => s + l.amountPaise, 0);
        pool -= given;
        await tx.insert(feeConcessionUses).values({ schoolId: this.ctx.schoolId, concessionId: c.id, invoiceId: inv.id, amountPaise: given });
      }
    }
    return c;
  }

  async rejectIn(tx: Tx, id: string) {
    await tx.update(feeConcessions).set({ status: "rejected" }).where(and(eq(feeConcessions.id, id), eq(feeConcessions.status, "pending")));
  }

  /** Who probably deserves a concession: second and later children of a family, RTE seats, staff children. Nothing is applied. */
  async suggestions(yearId?: string): Promise<Suggestion[]> {
    return this.read("concede", async (tx) => {
      const year = await this.yearOr(tx, yearId);
      const [types, taken, heads] = await Promise.all([
        tx.select().from(feeConcessionTypes).where(eq(feeConcessionTypes.isActive, true)),
        tx.select({ studentId: feeConcessions.studentId, typeId: feeConcessions.typeId, reason: feeConcessions.reason }).from(feeConcessions).where(and(eq(feeConcessions.yearId, year.id), inArray(feeConcessions.status, ["pending", "approved"]))),
        tx.select({ id: feeHeads.id }).from(feeHeads).where(and(eq(feeHeads.isTuition, true), eq(feeHeads.isActive, true))),
      ]);
      const typeOf = (auto: Suggestion["kind"]) => types.find((t) => t.auto === auto);
      const has = (studentId: string, kind: Suggestion["kind"]) => taken.some((t) => t.studentId === studentId && (typeOf(kind) ? t.typeId === typeOf(kind)!.id : t.reason.toLowerCase().includes(kind.replace("_", " "))));
      const out: Suggestion[] = [];
      const make = (kind: Suggestion["kind"], s: { id: string; name: string }, reason: string, fallback: Pick<Suggestion, "mode" | "value" | "headId">) => {
        const t = typeOf(kind);
        if (!has(s.id, kind)) out.push({ kind, studentId: s.id, studentName: s.name, typeId: t?.id ?? null, headId: t ? t.headId : fallback.headId, mode: t?.mode ?? fallback.mode, value: t?.value ?? fallback.value, reason });
      };
      // Brothers and sisters: everyone after the eldest admitted.
      const sib = await tx.execute<{ id: string; name: string; rank: number }>(sql`
        select s.id, s.name, row_number() over (partition by fam.root order by s.admission_date nulls last, s.created_at, s.id) as rank
        from students s join (select sg.student_id, min(sg2.student_id::text) as root from student_guardians sg join student_guardians sg2 on sg2.guardian_id = sg.guardian_id group by sg.student_id) fam on fam.student_id = s.id
        where s.status = 'active'`);
      for (const r of sib) if (Number(r.rank) > 1) make("sibling", r, "Brother or sister at the school", { mode: "percent", value: 1000, headId: null });
      const rte = await tx.select({ id: students.id, name: students.name }).from(students).where(and(eq(students.rteQuota, true), eq(students.status, "active")));
      for (const s of rte) make("rte", s, "RTE seat: tuition is free and claimed from the government", { mode: "percent", value: 10_000, headId: heads.length === 1 ? heads[0]!.id : null });
      // The staff module may be off, and a query on a missing table would abort the transaction, so look first.
      const [has_] = [...(await tx.execute<{ t: string | null }>(sql`select to_regclass('staff_profiles') as t`))];
      const staff = has_?.t ? await tx.execute<{ id: string; name: string }>(sql`
        select distinct s.id, s.name from students s join student_guardians sg on sg.student_id = s.id join guardians g on g.id = sg.guardian_id
        where s.status = 'active' and exists (select 1 from staff_profiles p where (p.phone is not null and p.phone = g.phone) or (p.email is not null and lower(p.email) = lower(g.email)))`) : [];
      for (const s of staff) make("staff_child", s, "Child of a staff member", { mode: "percent", value: 5000, headId: null });
      return out;
    });
  }
}
