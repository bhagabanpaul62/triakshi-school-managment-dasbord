import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { monthStart } from "@smw/feature-kit/money";
import { studentEnrollments, students } from "@smw/feature-students/schema";
import { FeesBase, type Snapshot } from "./base";
import { concessionsOn, type Conc } from "./calc";
import { admissionKind, pickPlan, type PublishedPlan } from "./plans";
import { feeConcessions, feeHeads, feeInvoices, feeOptIns, feePlanClasses, feePlanDues, feePlanLines, feePlans, feeStudentPlans } from "./schema";

export interface BillOptions { yearId?: string; classIds?: string[]; dueKeys?: string[]; studentIds?: string[]; /** Only dues whose bill date has come. */ billedBy?: string }
export interface PlanDraft {
  sourceKey: string; studentId: string; studentName: string; admissionNo: string; classId: string; planId: string; label: string; dueOn: string; lateRule: Plan["lateRule"];
  lines: { headId: string; kind: "fee" | "deposit"; label: string; amountPaise: number; concessionPaise: number }[];
  grossPaise: number; concessionPaise: number; snapshot: Snapshot | null;
}
type Plan = typeof feePlans.$inferSelect;

/**
 * Works out which bills the published plans call for. Issuing and previewing both read this, so the preview is exactly
 * what issuing makes. A bill already issued for a plan, student and due key is never made again.
 */
export class PlanBilling extends FeesBase {
  async build(tx: Tx, o: BillOptions) {
    const year = await this.yearOr(tx, o.yearId);
    const plans = await tx.select().from(feePlans).where(and(eq(feePlans.yearId, year.id), eq(feePlans.status, "published")));
    const skipped = { alreadyIssued: 0, noPlan: 0, left: 0 };
    if (!plans.length) return { year, drafts: [] as PlanDraft[], skipped };
    const planIds = plans.map((p) => p.id);
    const [cls, lines, heads] = await Promise.all([
      tx.select().from(feePlanClasses).where(inArray(feePlanClasses.planId, planIds)),
      tx.select().from(feePlanLines).where(inArray(feePlanLines.planId, planIds)),
      tx.select().from(feeHeads),
    ]);
    const dues = lines.length ? await tx.select().from(feePlanDues).where(inArray(feePlanDues.lineId, lines.map((l) => l.id))) : [];
    const published: PublishedPlan[] = plans.map((p) => ({ id: p.id, rootId: p.rootId, admissionType: p.admissionType, publishedAt: p.publishedAt, classIds: new Set(cls.filter((c) => c.planId === p.id).map((c) => c.classId)) }));
    const planById = new Map(plans.map((p) => [p.id, p]));
    const headById = new Map(heads.map((h) => [h.id, h]));

    // The class of the year (the enrolment), else the class now.
    const classOf = sql<string | null>`coalesce(${studentEnrollments.classId}, ${students.classId})`;
    const pool = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, classId: classOf, admissionDate: students.admissionDate, status: students.status, leftOn: students.leftOn })
      .from(students).leftJoin(studentEnrollments, and(eq(studentEnrollments.studentId, students.id), eq(studentEnrollments.yearId, year.id)))
      .where(and(o.studentIds ? inArray(students.id, o.studentIds) : undefined, o.classIds ? inArray(classOf, o.classIds) : undefined));
    const ids = pool.map((s) => s.id);
    const [overrides, optIns, concs, existing] = ids.length ? await Promise.all([
      tx.select().from(feeStudentPlans).where(eq(feeStudentPlans.yearId, year.id)),
      tx.select().from(feeOptIns).where(eq(feeOptIns.yearId, year.id)),
      tx.select().from(feeConcessions).where(and(eq(feeConcessions.yearId, year.id), eq(feeConcessions.status, "approved"))),
      tx.select({ k: feeInvoices.sourceKey }).from(feeInvoices).where(and(like(feeInvoices.sourceKey, "plan:%"), eq(feeInvoices.yearId, year.id), sql`${feeInvoices.status} <> 'cancelled'`)),
    ]) : [[], [], [], []];
    const made = new Set(existing.map((e) => e.k));
    const drafts: PlanDraft[] = [];

    for (const s of pool) {
      const pick = pickPlan(published, { classId: s.classId, admission: admissionKind(s.admissionDate, year), overrideRoot: overrides.find((x) => x.studentId === s.id)?.rootId });
      if (!pick || !s.classId) { skipped.noPlan++; continue; }
      const plan = planById.get(pick.id)!;
      const mine = new Set(optIns.filter((x) => x.studentId === s.id).map((x) => x.headId));
      const keys = [...new Set(lines.filter((l) => l.planId === plan.id).flatMap((l) => dues.filter((d) => d.lineId === l.id).map((d) => d.dueKey)))].sort();
      const sc: Conc[] = concs.filter((c) => c.studentId === s.id).map((c) => ({ headId: c.headId, mode: c.mode, value: c.value }));
      for (const key of keys) {
        if (o.dueKeys && !o.dueKeys.includes(key)) continue;
        const rows = lines.filter((l) => l.planId === plan.id && (!l.optional || mine.has(l.headId))).flatMap((l) => dues.filter((d) => d.lineId === l.id && d.dueKey === key).map((d) => ({ l, d })));
        if (!rows.length) continue;
        const dueOn = rows.map((r) => r.d.dueOn).sort()[0]!;
        if (o.billedBy && rows.every((r) => r.d.billOn > o.billedBy!)) continue;
        // Not billed for what falls due after they left; no date means we cannot tell, so nothing more is billed.
        if (s.status !== "active" && (!s.leftOn || dueOn > s.leftOn)) { skipped.left++; continue; }
        // Joining mid-year: their joining month and later are billed, earlier ones are not.
        if (plan.joinRule === "due_after_joining" && admissionKind(s.admissionDate, year) === "new" && dueOn < monthStart(s.admissionDate!)) continue;
        const sourceKey = `plan:${plan.rootId}:${s.id}:${key}`;
        if (made.has(sourceKey)) { skipped.alreadyIssued++; continue; }
        const raw = rows.map(({ l, d }) => { const h = headById.get(l.headId)!; return { headId: l.headId, kind: (h.type === "deposit" ? "deposit" : "fee") as "fee" | "deposit", label: h.name, amountPaise: d.amountPaise }; });
        const conc = concessionsOn(raw, sc);
        const priced = raw.map((r, i) => ({ ...r, concessionPaise: conc[i]! }));
        drafts.push({
          sourceKey, studentId: s.id, studentName: s.name, admissionNo: s.admissionNo, classId: s.classId, planId: plan.id, label: rows[0]!.d.label, dueOn, lateRule: plan.lateRule, lines: priced,
          grossPaise: priced.reduce((a, l) => a + l.amountPaise, 0), concessionPaise: conc.reduce((a, c) => a + c, 0), snapshot: null,
        });
      }
    }
    return { year, drafts, skipped };
  }
}
