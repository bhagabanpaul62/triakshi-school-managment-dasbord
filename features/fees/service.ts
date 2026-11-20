import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, sum, type SQL } from "drizzle-orm";
import {
  ConflictError, CrudService, NotFoundError, SchoolService, ValidationError, listQuerySchema, rethrowUnique, toPage,
  type Ctx, type ListQuery,
} from "@smw/feature-kit";
import { financialYear, nextSequence, schools, type Tx } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import feesFeature from "./feature";
import { FeeCalculator, rupees, type CalcInput, type Statement } from "./calculator";
import { cancelPaymentInput, concessionInput, copyStructureInput, feeHeadInput, paymentInput, structureInput, type StructureInput } from "./inputs";
import {
  feeCharges, feeHeads, feePaymentAllocations, feePayments, feeStructureItems, feeStructures, installments, lateFeeRules, studentConcessions,
} from "./schema";

type Perm = keyof typeof feesFeature.permissions;
export type FeeHead = typeof feeHeads.$inferSelect;
export type FeePayment = typeof feePayments.$inferSelect;
export type Concession = typeof studentConcessions.$inferSelect;

export const METHOD_LABEL = { cash: "Cash", cheque: "Cheque", upi: "UPI", bank_transfer: "Bank transfer" } as const;

/** Today in India as "YYYY-MM-DD". */
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export interface StudentLine { id: string; name: string; admissionNo: string; classId: string | null; sectionId: string | null; className: string | null; sectionName: string | null }
interface Book { structure: { id: string; name: string } | null; input: CalcInput }

/**
 * What every fee service shares: who may see which student, the current year, and loading a student's
 * fee book (structure, concessions, payments) into the pure FeeCalculator input. Staff see everyone;
 * a student sees themself.
 */
export abstract class FeesService extends SchoolService<Perm> {
  protected readonly feature = feesFeature;

  constructor(ctx: Ctx) { super(ctx); }

  /** Run a read as staff (all students) or as a student (`own` = their student ids). */
  protected viewer<T>(fn: (tx: Tx, own: string[] | null) => Promise<T>): Promise<T> {
    const staff = this.can("read");
    return this.read(staff ? "read" : "self", async (tx) => fn(tx, staff ? null : await this.ownStudentIds(tx)));
  }

  protected async ownStudentIds(tx: Tx): Promise<string[]> {
    return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
  }

  /** The login of each of these students. The student login is the family login, so fee notices go there. */
  protected async studentUsers(tx: Tx, studentIds: string[]): Promise<Map<string, string>> {
    if (!studentIds.length) return new Map();
    const rows = await tx.select({ id: students.id, userId: students.userId }).from(students).where(inArray(students.id, studentIds));
    return new Map(rows.flatMap((r) => (r.userId ? [[r.id, r.userId] as const] : [])));
  }

  protected assertVisible(own: string[] | null, studentId: string, what = "Student") {
    if (own && !own.includes(studentId)) throw new NotFoundError(what);
  }

  protected async currentYear(tx: Tx) {
    const [year] = await tx.select().from(academicYears).orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)).limit(1);
    if (!year) throw new ConflictError("Set up the academic year first.");
    return year;
  }

  protected studentLines(tx: Tx, where?: SQL): Promise<StudentLine[]> {
    return tx.select({
      id: students.id, name: students.name, admissionNo: students.admissionNo, classId: students.classId, sectionId: students.sectionId,
      className: classes.name, sectionName: sections.name,
    }).from(students).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
      .where(where).orderBy(asc(classes.grade), asc(sections.name), asc(students.name));
  }

  protected async oneStudent(tx: Tx, id: string): Promise<StudentLine> {
    const [row] = await this.studentLines(tx, eq(students.id, id));
    if (!row) throw new NotFoundError("Student");
    return row;
  }

  /** Each student's fee book for one year, in the shape the calculator wants. Valid payments only. */
  protected async loadBooks(tx: Tx, rows: Pick<StudentLine, "id" | "classId">[], yearId: string, today: string): Promise<Map<string, Book>> {
    const classIds = [...new Set(rows.map((r) => r.classId).filter((c): c is string => !!c))];
    const structs = classIds.length
      ? await tx.select().from(feeStructures).where(and(eq(feeStructures.yearId, yearId), inArray(feeStructures.classId, classIds)))
      : [];
    const sids = structs.map((s) => s.id);
    const ids = rows.map((r) => r.id);
    // A handful of students: filter in SQL. A whole school: read the year and group in memory.
    const few = ids.length <= 100;
    const [items, insts, rules, concs, pays, allocs, charges] = await Promise.all([
      sids.length ? tx.select().from(feeStructureItems).where(inArray(feeStructureItems.structureId, sids)) : [],
      sids.length ? tx.select().from(installments).where(inArray(installments.structureId, sids)) : [],
      sids.length ? tx.select().from(lateFeeRules).where(inArray(lateFeeRules.structureId, sids)) : [],
      tx.select().from(studentConcessions).where(and(eq(studentConcessions.yearId, yearId), few && ids.length ? inArray(studentConcessions.studentId, ids) : undefined)),
      tx.select({ id: feePayments.id, studentId: feePayments.studentId, paidOn: feePayments.paidOn, status: feePayments.status }).from(feePayments)
        .where(and(eq(feePayments.yearId, yearId), eq(feePayments.status, "valid"), few && ids.length ? inArray(feePayments.studentId, ids) : undefined)),
      tx.select({ paymentId: feePaymentAllocations.paymentId, installmentId: feePaymentAllocations.installmentId, chargeId: feePaymentAllocations.chargeId, amountPaise: feePaymentAllocations.amountPaise, lateFeePaise: feePaymentAllocations.lateFeePaise })
        .from(feePaymentAllocations).innerJoin(feePayments, eq(feePayments.id, feePaymentAllocations.paymentId))
        .where(and(eq(feePayments.yearId, yearId), eq(feePayments.status, "valid"), few && ids.length ? inArray(feePayments.studentId, ids) : undefined)),
      tx.select().from(feeCharges).where(and(eq(feeCharges.yearId, yearId), eq(feeCharges.status, "active"), few && ids.length ? inArray(feeCharges.studentId, ids) : undefined)),
    ]);

    const structByClass = new Map(structs.map((s) => [s.classId, s]));
    const instIds = new Map(insts.map((i) => [i.id, i.structureId]));
    return new Map(rows.map((r) => {
      const st = r.classId ? structByClass.get(r.classId) : undefined;
      const sid = st?.id;
      const input: CalcInput = {
        today,
        items: items.filter((i) => i.structureId === sid).map((i) => ({ headId: i.headId, amountPaise: i.amountPaise })),
        installments: [
          ...insts.filter((i) => i.structureId === sid).map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise })),
          ...charges.filter((c) => c.studentId === r.id).map((c) => ({ id: c.id, name: c.label, dueDate: c.dueDate, amountPaise: c.amountPaise, charge: true })),
        ],
        lateRules: rules.filter((l) => l.structureId === sid).map((l) => ({ installmentId: l.installmentId, kind: l.kind, amountPaise: l.amountPaise, graceDays: l.graceDays, maxPaise: l.maxPaise })),
        concessions: concs.filter((c) => c.studentId === r.id).map((c) => ({ headId: c.headId, kind: c.kind, value: c.value })),
        payments: pays.filter((p) => p.studentId === r.id).map((p) => ({
          id: p.id, paidOn: p.paidOn, status: p.status,
          allocations: allocs.filter((a) => a.paymentId === p.id && (a.chargeId || instIds.get(a.installmentId!) === sid))
            .map((a) => ({ installmentId: a.installmentId ?? a.chargeId!, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise })),
        })),
      };
      return [r.id, { structure: st ? { id: st.id, name: st.name } : null, input }];
    }));
  }

  /** Every payment of a student (cancelled ones too) with where each rupee went. */
  protected async paymentsOf(tx: Tx, studentId: string, yearId?: string) {
    const pays = await tx.select().from(feePayments).where(and(eq(feePayments.studentId, studentId), yearId ? eq(feePayments.yearId, yearId) : undefined))
      .orderBy(desc(feePayments.paidOn), desc(feePayments.createdAt));
    const allocs = pays.length
      ? await tx.select({ paymentId: feePaymentAllocations.paymentId, name: sql<string>`coalesce(${installments.name}, ${feeCharges.label})`, amountPaise: feePaymentAllocations.amountPaise, lateFeePaise: feePaymentAllocations.lateFeePaise })
        .from(feePaymentAllocations).leftJoin(installments, eq(installments.id, feePaymentAllocations.installmentId)).leftJoin(feeCharges, eq(feeCharges.id, feePaymentAllocations.chargeId))
        .where(inArray(feePaymentAllocations.paymentId, pays.map((p) => p.id))).orderBy(sql`coalesce(${installments.dueDate}, ${feeCharges.dueDate})`)
      : [];
    return pays.map((p) => ({ ...p, allocations: allocs.filter((a) => a.paymentId === p.id) }));
  }
}

// ---------- heads ----------

export class FeeHeadService extends CrudService<typeof feeHeads, Perm> {
  protected feature = feesFeature;
  protected table = feeHeads;
  protected entityName = "Fee head";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = feeHeadInput;
  protected updateSchema = feeHeadInput;
  protected defaultSort = "name";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [feeHeads.name]; }
  protected sortColumns() { return { name: feeHeads.name, createdAt: feeHeads.createdAt }; }

  private async assertFree(tx: Tx, name: unknown, exceptId?: string) {
    const [dup] = await tx.select({ id: feeHeads.id }).from(feeHeads)
      .where(and(sql`lower(${feeHeads.name}) = lower(${String(name)})`, exceptId ? ne(feeHeads.id, exceptId) : undefined)).limit(1);
    if (dup) throw new ConflictError(`A fee called "${name}" already exists.`);
  }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { await this.assertFree(tx, data.name); return data; }
  protected async beforeUpdate(tx: Tx, existing: FeeHead, data: Record<string, unknown>) { await this.assertFree(tx, data.name, existing.id); return data; }
  protected async beforeRemove(tx: Tx, existing: FeeHead) {
    const [used] = await tx.select({ id: feeStructureItems.id }).from(feeStructureItems).where(eq(feeStructureItems.headId, existing.id)).limit(1);
    if (used) throw new ConflictError(`${existing.name} is part of a fee structure. Remove it from there first.`);
  }

  /** All heads, for pickers. */
  async options() {
    return this.read("read", (tx) => tx.select().from(feeHeads).orderBy(asc(feeHeads.name)));
  }
}

// ---------- structures ----------

export interface StructureView {
  id: string;
  name: string;
  yearId: string;
  classId: string;
  total: number;
  items: { headId: string; headName: string; amountPaise: number }[];
  installments: { id: string; name: string; dueDate: string; amountPaise: number }[];
  lateRules: { installmentId: string | null; installmentName: string | null; kind: "flat" | "per_day"; amountPaise: number; graceDays: number; maxPaise: number | null }[];
}

/** Fee structure of a class for a year: items, installments and late fee rules, saved and copied as one unit. */
export class FeeStructureService extends FeesService {
  /** Structures for a where-clause, each with its items, installments and rules. */
  private async views(tx: Tx, where?: SQL): Promise<StructureView[]> {
    const structs = await tx.select().from(feeStructures).where(where);
    if (!structs.length) return [];
    const sids = structs.map((s) => s.id);
    const [items, insts, rules] = await Promise.all([
      tx.select({ structureId: feeStructureItems.structureId, headId: feeStructureItems.headId, headName: feeHeads.name, amountPaise: feeStructureItems.amountPaise })
        .from(feeStructureItems).innerJoin(feeHeads, eq(feeHeads.id, feeStructureItems.headId)).where(inArray(feeStructureItems.structureId, sids)).orderBy(asc(feeHeads.name)),
      tx.select().from(installments).where(inArray(installments.structureId, sids)).orderBy(asc(installments.dueDate)),
      tx.select().from(lateFeeRules).where(inArray(lateFeeRules.structureId, sids)),
    ]);
    return structs.map((s) => {
      const its = insts.filter((i) => i.structureId === s.id);
      return {
        id: s.id, name: s.name, yearId: s.yearId, classId: s.classId,
        total: its.reduce((a, i) => a + i.amountPaise, 0),
        items: items.filter((i) => i.structureId === s.id),
        installments: its.map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise })),
        lateRules: rules.filter((r) => r.structureId === s.id).map((r) => ({
          installmentId: r.installmentId, installmentName: its.find((i) => i.id === r.installmentId)?.name ?? null,
          kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise,
        })),
      };
    });
  }

  /** The setup screen: the current year, the heads, and every class with its structure (or none yet). */
  async overview() {
    return this.read("read", async (tx) => {
      const year = await this.currentYear(tx);
      const [heads, cls, structs] = await Promise.all([
        tx.select().from(feeHeads).orderBy(asc(feeHeads.name)),
        tx.select().from(classes).orderBy(asc(classes.grade)),
        this.views(tx, eq(feeStructures.yearId, year.id)),
      ]);
      return { year: { id: year.id, name: year.name }, heads, classes: cls.map((c) => ({ id: c.id, name: c.name, grade: c.grade, structure: structs.find((s) => s.classId === c.id) ?? null })) };
    });
  }

  async get(id: string): Promise<StructureView> {
    return this.read("read", async (tx) => {
      const [view] = await this.views(tx, eq(feeStructures.id, id));
      if (!view) throw new NotFoundError("Fee structure");
      return view;
    });
  }

  /** Create or replace (when `id` is given) a class's structure. */
  async save(input: unknown): Promise<StructureView> {
    this.authorize("manage", "write");
    const data = this.parse(structureInput, input);
    return this.write("manage", async (tx) => this.persist(tx, data), (v) => ({ action: data.id ? "update" : "create", entity: "Fee structure", entityId: v.id, summary: `Saved fee structure ${v.name} (${rupees(v.total)})` }));
  }

  /** Copy a structure to another class of the same year. */
  async copyTo(input: unknown): Promise<StructureView> {
    this.authorize("manage", "write");
    const { id, classId } = this.parse(copyStructureInput, input);
    return this.write("manage", async (tx) => {
      const [src] = await this.views(tx, eq(feeStructures.id, id));
      if (!src) throw new NotFoundError("Fee structure");
      const [target] = await tx.select({ name: classes.name }).from(classes).where(eq(classes.id, classId)).limit(1);
      if (!target) throw new NotFoundError("Class");
      return this.persist(tx, {
        classId, yearId: src.yearId, name: `${target.name} fees`,
        items: src.items.map((i) => ({ headId: i.headId, amountPaise: i.amountPaise })),
        installments: src.installments.map((i) => ({ name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise })),
        lateRules: src.lateRules.map((r) => ({ installmentIndex: r.installmentId ? src.installments.findIndex((i) => i.id === r.installmentId) : undefined, kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise ?? undefined })),
      });
    }, (v) => ({ action: "copy", entity: "Fee structure", entityId: v.id, summary: `Copied fee structure to ${v.name}` }));
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const [view] = await this.views(tx, eq(feeStructures.id, id));
      if (!view) throw new NotFoundError("Fee structure");
      await this.assertNoPayments(tx, view.installments.map((i) => i.id), "Payments are already recorded against this structure, so it cannot be deleted.");
      await tx.delete(feeStructures).where(eq(feeStructures.id, id));
      return { id };
    }, () => ({ action: "delete", entity: "Fee structure", entityId: id, summary: "Deleted a fee structure" }));
  }

  private async assertNoPayments(tx: Tx, installmentIds: string[], message: string) {
    if (!installmentIds.length) return;
    const [hit] = await tx.select({ id: feePaymentAllocations.id }).from(feePaymentAllocations).where(inArray(feePaymentAllocations.installmentId, installmentIds)).limit(1);
    if (hit) throw new ConflictError(message);
  }

  private async persist(tx: Tx, data: StructureInput): Promise<StructureView> {
    const heads = data.items.map((i) => i.headId);
    if (new Set(heads).size !== heads.length) throw new ValidationError({ items: "Each fee can be added only once." });
    const itemTotal = data.items.reduce((s, i) => s + i.amountPaise, 0);
    const instTotal = data.installments.reduce((s, i) => s + i.amountPaise, 0);
    if (itemTotal !== instTotal) throw new ValidationError({ installments: `Installments add up to ${rupees(instTotal)} but the fees add up to ${rupees(itemTotal)}.` });
    for (const r of data.lateRules) {
      if (r.installmentIndex != null && !data.installments[r.installmentIndex]) throw new ValidationError({ lateRules: "A late fee points to an installment that does not exist." });
    }
    const known = await tx.select({ id: feeHeads.id }).from(feeHeads).where(inArray(feeHeads.id, heads));
    if (known.length !== heads.length) throw new NotFoundError("Fee head");
    const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, data.classId)).limit(1);
    if (!cls) throw new NotFoundError("Class");

    const yearId = data.yearId ?? (await this.currentYear(tx)).id;
    const [clash] = await tx.select({ id: feeStructures.id }).from(feeStructures)
      .where(and(eq(feeStructures.yearId, yearId), eq(feeStructures.classId, data.classId), data.id ? ne(feeStructures.id, data.id) : undefined)).limit(1);
    if (clash) throw new ConflictError("This class already has a fee structure for the year. Edit it instead.");

    let structureId = data.id;
    if (structureId) {
      const [row] = await tx.update(feeStructures).set({ name: data.name, classId: data.classId }).where(eq(feeStructures.id, structureId)).returning({ id: feeStructures.id });
      if (!row) throw new NotFoundError("Fee structure");
      await tx.delete(feeStructureItems).where(eq(feeStructureItems.structureId, structureId));
      await tx.delete(lateFeeRules).where(eq(lateFeeRules.structureId, structureId));
    } else {
      const [row] = await tx.insert(feeStructures).values({ schoolId: this.ctx.schoolId, yearId, classId: data.classId, name: data.name }).returning({ id: feeStructures.id });
      structureId = row!.id;
    }

    await tx.insert(feeStructureItems).values(data.items.map((i) => ({ schoolId: this.ctx.schoolId, structureId: structureId!, headId: i.headId, amountPaise: i.amountPaise })));
    const ids = await this.syncInstallments(tx, structureId, data.installments);
    if (data.lateRules.length) {
      await tx.insert(lateFeeRules).values(data.lateRules.map((r) => ({
        schoolId: this.ctx.schoolId, structureId: structureId!, installmentId: r.installmentIndex == null ? null : ids[r.installmentIndex]!,
        kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise ?? null,
      })));
    }
    const [view] = await this.views(tx, eq(feeStructures.id, structureId));
    return view!;
  }

  /** Update installments in place (so recorded payments keep pointing at them), add new ones, drop removed ones if unpaid. */
  private async syncInstallments(tx: Tx, structureId: string, rows: StructureInput["installments"]): Promise<string[]> {
    const existing = await tx.select().from(installments).where(eq(installments.structureId, structureId));
    const known = new Set(existing.map((i) => i.id));
    const ids: string[] = [];
    // Match by id, never by position: removing a middle row must not slide another installment's payments onto it.
    for (const { id, ...row } of rows) {
      if (id && known.has(id)) {
        await tx.update(installments).set(row).where(eq(installments.id, id));
        ids.push(id);
      } else {
        const [ins] = await tx.insert(installments).values({ ...row, schoolId: this.ctx.schoolId, structureId }).returning({ id: installments.id });
        ids.push(ins!.id);
      }
    }
    const kept = new Set(ids);
    const gone = existing.filter((i) => !kept.has(i.id)).map((i) => i.id);
    await this.assertNoPayments(tx, gone, "An installment with payments cannot be removed.");
    if (gone.length) await tx.delete(installments).where(inArray(installments.id, gone));
    return ids;
  }
}

// ---------- concessions ----------

/** Discounts for one student: an amount or a percent, on one fee head or the whole fee. */
export class ConcessionService extends CrudService<typeof studentConcessions, Perm> {
  protected feature = feesFeature;
  protected table = studentConcessions;
  protected entityName = "Concession";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = concessionInput;
  protected updateSchema = concessionInput;

  constructor(ctx: Ctx) { super(ctx); }

  protected filterClauses(filters: Record<string, string | undefined>) {
    return [filters.studentId ? eq(studentConcessions.studentId, filters.studentId) : undefined];
  }
  protected describe(r: Concession) { return r.reason; }

  /** Form values (amount in paise or percent) become the stored row (value in paise or basis points). */
  private async toRow(tx: Tx, data: Record<string, unknown>) {
    const d = data as ReturnType<typeof concessionInput.parse>;
    const [stu] = await tx.select({ id: students.id }).from(students).where(eq(students.id, d.studentId)).limit(1);
    if (!stu) throw new NotFoundError("Student");
    // Foreign keys ignore RLS, so confirm the head and year belong to this school.
    if (d.headId && !(await tx.select({ id: feeHeads.id }).from(feeHeads).where(eq(feeHeads.id, d.headId)).limit(1))[0]) throw new NotFoundError("Fee head");
    if (d.yearId && !(await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, d.yearId)).limit(1))[0]) throw new NotFoundError("Academic year");
    return {
      studentId: d.studentId,
      yearId: d.yearId ?? (await tx.select().from(academicYears).orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)).limit(1))[0]?.id,
      headId: d.headId ?? null,
      kind: d.kind,
      value: d.kind === "percent" ? Math.round(d.percent! * 100) : d.amountPaise!,
      reason: d.reason,
      approvedBy: this.ctx.userId,
    };
  }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { return this.toRow(tx, data); }
  protected async beforeUpdate(tx: Tx, _existing: Concession, data: Record<string, unknown>) { return this.toRow(tx, data); }

  /** A student's concessions with the head's name, for the ledger. */
  async forStudent(studentId: string) {
    return this.read("read", (tx) => tx.select({
      id: studentConcessions.id, kind: studentConcessions.kind, value: studentConcessions.value, reason: studentConcessions.reason,
      headId: studentConcessions.headId, headName: feeHeads.name, createdAt: studentConcessions.createdAt,
    }).from(studentConcessions).leftJoin(feeHeads, eq(feeHeads.id, studentConcessions.headId))
      .where(eq(studentConcessions.studentId, studentId)).orderBy(desc(studentConcessions.createdAt)));
  }
}

// ---------- payments ----------

/** Recording, cancelling and printing payments. Receipt numbers are gap-free per school per financial year. */
export class PaymentService extends FeesService {
  /** Record money from a student: spread it (oldest installment first, late fee first), number the receipt, audit it. */
  async record(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(paymentInput, input);
    const paidOn = data.paidOn ?? todayIST();
    if (paidOn > todayIST()) throw new ValidationError({ paidOn: "The payment date cannot be in the future." });

    return this.write("manage", async (tx) => {
      // Lock the student so two cashiers cannot spend the same dues twice.
      await tx.select({ id: students.id }).from(students).where(eq(students.id, data.studentId)).for("update");
      const student = await this.oneStudent(tx, data.studentId);
      const year = await this.currentYear(tx);
      const book = (await this.loadBooks(tx, [student], year.id, paidOn)).get(student.id)!;
      if (!book.structure && !book.input.installments.length) throw new ConflictError(`${student.className ?? "This class"} has no fee structure for ${year.name}. Set it up first.`);

      const plan = new FeeCalculator(book.input).allocate(data.amountPaise, paidOn);
      if (!plan.allocations.length) throw new ConflictError("This student has nothing due.");
      if (plan.unallocated > 0) throw new ValidationError({ amountPaise: `Only ${rupees(plan.allocated)} is due. Enter ${rupees(plan.allocated)} or less.` });

      const fy = financialYear(new Date(`${paidOn}T00:00:00`));
      const receiptNo = `RCPT/${fy}/${String(await nextSequence(tx, this.ctx.schoolId, `receipt:${fy}`)).padStart(6, "0")}`;
      const [payment] = await tx.insert(feePayments).values({
        schoolId: this.ctx.schoolId, studentId: student.id, yearId: year.id, receiptNo, amountPaise: data.amountPaise, method: data.method,
        reference: data.reference ?? null, paidOn, collectedBy: this.ctx.userId,
      }).returning().catch((e) => rethrowUnique(e, "That receipt number is already used. Try again."));
      await tx.insert(feePaymentAllocations).values(plan.allocations.map((a) => ({
        schoolId: this.ctx.schoolId, paymentId: payment!.id, installmentId: a.charge ? null : a.installmentId, chargeId: a.charge ? a.installmentId : null, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise,
      })));
      const family = (await this.studentUsers(tx, [student.id])).get(student.id);
      await NotificationWriter.insert(tx, this.ctx.schoolId, [family].filter((userId): userId is string => !!userId && userId !== this.ctx.userId).map((userId) => ({
        userId, kind: "fee_due" as const, title: `Payment of ${rupees(data.amountPaise)} received`,
        body: `${student.name}, receipt ${receiptNo}`, href: `/app/fees/students/${student.id}`,
      })));
      return { payment: payment!, plan, studentName: student.name };
    }, (r) => ({
      action: "record", entity: "Fee payment", entityId: r.payment.id,
      summary: `Received ${rupees(r.payment.amountPaise)} from ${r.studentName}, ${r.payment.receiptNo}`,
      meta: { receiptNo: r.payment.receiptNo, method: r.payment.method, lateFeePaise: r.plan.lateFee },
    }));
  }

  /** Cancel a wrong payment. It stays on file with its receipt number and the reason. */
  async cancel(input: unknown) {
    this.authorize("manage", "write");
    const { id, reason } = this.parse(cancelPaymentInput, input);
    return this.write("manage", async (tx) => {
      const [p] = await tx.select().from(feePayments).where(eq(feePayments.id, id)).limit(1);
      if (!p) throw new NotFoundError("Payment");
      if (p.status === "cancelled") throw new ConflictError("This payment is already cancelled.");
      const [row] = await tx.update(feePayments).set({ status: "cancelled", cancelReason: reason, cancelledAt: new Date() }).where(and(eq(feePayments.id, id), eq(feePayments.status, "valid"))).returning();
      if (!row) throw new ConflictError("This payment is already cancelled.");
      return row;
    }, (p) => ({ action: "cancel", entity: "Fee payment", entityId: p.id, summary: `Cancelled receipt ${p.receiptNo}: ${p.cancelReason}` }));
  }

  /** A student's payments, newest first. */
  async forStudent(studentId: string) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      return this.paymentsOf(tx, studentId);
    });
  }

  /** The receipt as a PDF plus the name to save it under. Students get only their own. */
  async receiptFile(paymentId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    return this.viewer(async (tx, own) => {
      const [p] = await tx.select().from(feePayments).where(eq(feePayments.id, paymentId)).limit(1);
      if (!p) throw new NotFoundError("Receipt");
      this.assertVisible(own, p.studentId, "Receipt");
      const [student, [school], allocs] = await Promise.all([
        this.oneStudent(tx, p.studentId),
        tx.select().from(schools).limit(1),
        tx.select({ name: sql<string>`coalesce(${installments.name}, ${feeCharges.label})`, amountPaise: feePaymentAllocations.amountPaise, lateFeePaise: feePaymentAllocations.lateFeePaise })
          .from(feePaymentAllocations).leftJoin(installments, eq(installments.id, feePaymentAllocations.installmentId)).leftJoin(feeCharges, eq(feeCharges.id, feePaymentAllocations.chargeId))
          .where(eq(feePaymentAllocations.paymentId, p.id)).orderBy(sql`coalesce(${installments.dueDate}, ${feeCharges.dueDate})`),
      ]);
      const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const money = PdfBuilder.money;
      const pdf = await PdfBuilder.create();
      pdf.header({
        title: p.status === "cancelled" ? "FEE RECEIPT (CANCELLED)" : "FEE RECEIPT",
        orgName: school?.name ?? "School",
        orgLines: [school?.address, school?.city, school?.phone ? `Phone: ${school.phone}` : null].filter((x): x is string => !!x),
        rightLines: [`Receipt no: ${p.receiptNo}`, `Date: ${day(p.paidOn)}`],
      });
      pdf.facts([
        ["Student", student.name], ["Admission no", student.admissionNo],
        ["Class", [student.className, student.sectionName].filter(Boolean).join(" - ") || "-"], ["Paid on", day(p.paidOn)],
        ["Method", METHOD_LABEL[p.method]], ["Reference", p.reference ?? "-"],
      ]);
      pdf.table({
        columns: [{ label: "Installment", width: 220 }, { label: "Fee", width: 95, align: "right" }, { label: "Late fee", width: 95, align: "right" }, { label: "Amount", width: 89, align: "right" }],
        rows: allocs.map((a) => [a.name, money(a.amountPaise), money(a.lateFeePaise), money(a.amountPaise + a.lateFeePaise)]),
      });
      pdf.totals([["Total received", money(p.amountPaise), true]]);
      if (p.status === "cancelled") pdf.space(8).text(`Cancelled: ${p.cancelReason ?? ""}`, { bold: true });
      pdf.space(16).text("Computer generated receipt. No signature required.", { size: 8, color: [0.4, 0.4, 0.45] });
      return { filename: `${p.receiptNo.replace(/\//g, "-")}.pdf`, bytes: await pdf.save() };
    });
  }

  async receiptPdf(paymentId: string): Promise<Uint8Array> {
    return (await this.receiptFile(paymentId)).bytes;
  }
}

// ---------- dues ----------

export interface DueRow {
  id: string; name: string; admissionNo: string; classLabel: string; classId: string | null;
  gross: number; concession: number; late: number; paid: number; due: number; overdue: number;
  status: "overdue" | "due" | "paid"; nextDueDate: string | null;
}
export interface TrendPoint { key: string; label: string; paise: number }

/** Ledgers, the dues report and the numbers behind the dashboard. */
export class DuesService extends FeesService {
  /** One student's year: statement line by line, concessions and payments. `asOf` is for tests and seeds; default is today. */
  async studentLedger(studentId: string, asOf?: string) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      const today = asOf ?? todayIST();
      const [student, year] = await Promise.all([this.oneStudent(tx, studentId), this.currentYear(tx)]);
      const book = (await this.loadBooks(tx, [student], year.id, today)).get(studentId)!;
      const [payments, concessions] = await Promise.all([
        this.paymentsOf(tx, studentId, year.id),
        tx.select({ id: studentConcessions.id, kind: studentConcessions.kind, value: studentConcessions.value, reason: studentConcessions.reason, headName: feeHeads.name })
          .from(studentConcessions).leftJoin(feeHeads, eq(feeHeads.id, studentConcessions.headId))
          .where(and(eq(studentConcessions.studentId, studentId), eq(studentConcessions.yearId, year.id))).orderBy(desc(studentConcessions.createdAt)),
      ]);
      return { student, year: { id: year.id, name: year.name }, structure: book.structure, input: book.input, statement: new FeeCalculator(book.input).statement(), payments, concessions, today };
    });
  }

  /** Every active student with a fee structure and their totals. */
  private async dueRows(tx: Tx, where?: SQL, restrictTo?: string[] | null): Promise<DueRow[]> {
    const today = todayIST();
    const year = await this.currentYear(tx);
    const rows = await this.studentLines(tx, and(eq(students.status, "active"), restrictTo ? inArray(students.id, restrictTo.length ? restrictTo : ["00000000-0000-0000-0000-000000000000"]) : undefined, where));
    const books = await this.loadBooks(tx, rows, year.id, today);
    return rows.flatMap((r): DueRow[] => {
      const book = books.get(r.id)!;
      if (!book.structure && !book.input.installments.length) return [];
      const st: Statement = new FeeCalculator(book.input).statement();
      const t = st.totals;
      return [{
        id: r.id, name: r.name, admissionNo: r.admissionNo, classId: r.classId,
        classLabel: [r.className, r.sectionName].filter(Boolean).join("-") || "-",
        gross: t.gross, concession: t.concession, late: t.late, paid: t.paid, due: t.due, overdue: t.overdue,
        status: t.overdue > 0 ? "overdue" : t.due > 0 ? "due" : "paid",
        nextDueDate: st.lines.find((l) => l.due > 0)?.dueDate ?? null,
      }];
    });
  }

  /** Dues by student, paged. Filters: classId, sectionId, overdue ("1"). `totals` cover every matching student. */
  async duesReport(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const search = q.q ? or(ilike(students.name, `%${q.q}%`), ilike(students.admissionNo, `%${q.q}%`)) : undefined;
      const where = and(search, q.filters.classId ? eq(students.classId, q.filters.classId) : undefined, q.filters.sectionId ? eq(students.sectionId, q.filters.sectionId) : undefined);
      let rows = await this.dueRows(tx, where);
      if (q.filters.overdue === "1") rows = rows.filter((r) => r.overdue > 0);
      rows.sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
      const sumOf = (f: (r: DueRow) => number) => rows.reduce((s, r) => s + f(r), 0);
      const totals = { gross: sumOf((r) => r.gross), concession: sumOf((r) => r.concession), late: sumOf((r) => r.late), paid: sumOf((r) => r.paid), due: sumOf((r) => r.due), overdue: sumOf((r) => r.overdue) };
      return { ...toPage(rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rows.length, q), totals };
    });
  }

  /** The dashboard numbers. */
  async summary() {
    return this.read("read", async (tx) => this.summarize(tx, await this.dueRows(tx)));
  }

  private async summarize(tx: Tx, rows: DueRow[]) {
    const today = todayIST();
    const month = `${today.slice(0, 7)}-01`;
    const [[collected], [now]] = await Promise.all([
      tx.select({ paise: sum(feePayments.amountPaise), n: sql<number>`count(*)::int` }).from(feePayments).where(and(eq(feePayments.status, "valid"), gte(feePayments.paidOn, month))),
      tx.select({ paise: sum(feePayments.amountPaise), n: sql<number>`count(*)::int` }).from(feePayments).where(and(eq(feePayments.status, "valid"), eq(feePayments.paidOn, today))),
    ]);
    return {
      collectedToday: Number(now?.paise ?? 0),
      receiptsToday: Number(now?.n ?? 0),
      collectedThisMonth: Number(collected?.paise ?? 0),
      receiptsThisMonth: Number(collected?.n ?? 0),
      outstanding: rows.reduce((s, r) => s + r.due, 0),
      overdueAmount: rows.reduce((s, r) => s + r.overdue, 0),
      overdueCount: rows.filter((r) => r.overdue > 0).length,
      studentsWithDues: rows.filter((r) => r.due > 0).length,
      collectedThisYear: rows.reduce((s, r) => s + r.paid, 0),
      billedThisYear: rows.reduce((s, r) => s + r.gross - r.concession + r.late, 0),
    };
  }

  /**
   * Everything the staff dashboard needs from one pass over the books: the numbers, dues by class,
   * the ten students to chase first (biggest overdue) and today's receipts for the counter.
   */
  async overview() {
    return this.read("read", async (tx) => {
      const today = todayIST();
      const [rows, cls, receipts] = await Promise.all([
        this.dueRows(tx),
        tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.grade)),
        tx.select({ id: feePayments.id, receiptNo: feePayments.receiptNo, amountPaise: feePayments.amountPaise, method: feePayments.method, studentId: feePayments.studentId, student: students.name })
          .from(feePayments).innerJoin(students, eq(students.id, feePayments.studentId))
          .where(and(eq(feePayments.status, "valid"), eq(feePayments.paidOn, today))).orderBy(desc(feePayments.createdAt)),
      ]);
      const byClass = cls.map((c) => {
        const r = rows.filter((x) => x.classId === c.id);
        return { classId: c.id, name: c.name, students: r.length, due: r.reduce((s, x) => s + x.due, 0), overdue: r.reduce((s, x) => s + x.overdue, 0), overdueStudents: r.filter((x) => x.overdue > 0).length };
      }).filter((c) => c.students > 0);
      const chase = rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name)).slice(0, 8);
      const byMethod = Object.entries(receipts.reduce<Record<string, number>>((m, p) => ({ ...m, [p.method]: (m[p.method] ?? 0) + p.amountPaise }), {}))
        .map(([method, paise]) => ({ method: method as keyof typeof METHOD_LABEL, paise })).sort((a, b) => b.paise - a.paise);
      return { summary: await this.summarize(tx, rows), byClass, chase, today: { receipts: receipts.slice(0, 8), byMethod } };
    });
  }

  /** Money collected per day (last `span` days) or per month (last `span` months), zero-filled. */
  async collectionTrend(unit: "day" | "month" = "day", span = unit === "day" ? 30 : 12): Promise<TrendPoint[]> {
    return this.read("read", async (tx) => {
      const today = todayIST();
      const [y, m, d] = today.split("-").map(Number) as [number, number, number];
      const buckets: TrendPoint[] = [];
      for (let k = span - 1; k >= 0; k--) {
        const at = unit === "day" ? new Date(Date.UTC(y, m - 1, d - k)) : new Date(Date.UTC(y, m - 1 - k, 1));
        buckets.push({
          key: at.toISOString().slice(0, unit === "day" ? 10 : 7),
          label: at.toLocaleDateString("en-IN", unit === "day" ? { day: "numeric", month: "short", timeZone: "UTC" } : { month: "short", year: "2-digit", timeZone: "UTC" }),
          paise: 0,
        });
      }
      const from = unit === "day" ? buckets[0]!.key : `${buckets[0]!.key}-01`;
      const rows = await tx.select({ day: feePayments.paidOn, paise: sum(feePayments.amountPaise) }).from(feePayments)
        .where(and(eq(feePayments.status, "valid"), gte(feePayments.paidOn, from))).groupBy(feePayments.paidOn);
      for (const r of rows) {
        const b = buckets.find((x) => x.key === r.day.slice(0, unit === "day" ? 10 : 7));
        if (b) b.paise += Number(r.paise ?? 0);
      }
      return buckets;
    });
  }

  /** Classes, for filters. */
  async classOptions() {
    return this.read("read", (tx) => tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.grade)));
  }

  /** For a student login: their own dues. */
  async mine() {
    return this.viewer(async (tx, own) => (own?.length ? this.dueRows(tx, undefined, own) : []));
  }
}
