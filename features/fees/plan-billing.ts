import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { monthStart } from "@smw/feature-kit/money";
import { studentEnrollments, students } from "@smw/feature-students/schema";
import { FeesBase, type Snapshot } from "./base";
import { concessionsDetailed, yearShare, type Conc } from "./calc";
import { admissionKind, pickPlan, type PublishedPlan } from "./plans";
import { feeConcessionUses, feeConcessions, feeHeads, feeInvoices, feeOptIns, feePlanClasses, feePlanDues, feePlanLines, feePlans, feeStudentPlans } from "./schema";

export interface BillOptions { yearId?: string; classIds?: string[]; dueKeys?: string[]; studentIds?: string[]; /** Only dues whose bill date has come. */ billedBy?: string }
export interface PlanDraft {
  sourceKey: string; studentId: string; studentName: string; admissionNo: string; classId: string; planId: string; label: string; dueOn: string; lateRule: Plan["lateRule"];
  lines: { headId: string; kind: "fee" | "deposit"; label: string; amountPaise: number; concessionPaise: number }[];
  grossPaise: number; concessionPaise: number; snapshot: Snapshot | null;
  /** What each yearly amount concession gave on this bill, to be recorded when it is issued. */
  uses: { concessionId: string; amountPaise: number }[];
}
type Plan = typeof feePlans.$inferSelect;
/** A student the bills pass over, and where to go to fix it. One entry per student and reason. */
export interface BillException { studentId: string; studentName: string; admissionNo: string; reason: "no_plan" | "left" | "already_billed" | "opted_out"; detail: string; href: string; fix: string }

/**
 * Works out which bills the published plans call for. Issuing and previewing both read this, so the preview is exactly
 * what issuing makes. A bill already issued for a plan, student and due key is never made again.
 */
export class PlanBilling extends FeesBase {
  async build(tx: Tx, o: BillOptions) {
    const year = await this.yearOr(tx, o.yearId);
    const plans = await tx.select().from(feePlans).where(and(eq(feePlans.yearId, year.id), eq(feePlans.status, "published")));
    const skipped = { alreadyIssued: 0, noPlan: 0, left: 0 };
    const exceptions: BillException[] = [];
    if (!plans.length) return { year, drafts: [] as PlanDraft[], skipped, exceptions };
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
    const [overrides, optIns, concs, existing, used] = ids.length ? await Promise.all([
      tx.select().from(feeStudentPlans).where(eq(feeStudentPlans.yearId, year.id)),
      tx.select().from(feeOptIns).where(eq(feeOptIns.yearId, year.id)),
      tx.select().from(feeConcessions).where(and(eq(feeConcessions.yearId, year.id), eq(feeConcessions.status, "approved"))),
      tx.select({ k: feeInvoices.sourceKey }).from(feeInvoices).where(and(like(feeInvoices.sourceKey, "plan:%"), eq(feeInvoices.yearId, year.id), sql`${feeInvoices.status} <> 'cancelled'`)),
      tx.select({ id: feeConcessionUses.concessionId, v: sql<string>`sum(${feeConcessionUses.amountPaise})` }).from(feeConcessionUses).groupBy(feeConcessionUses.concessionId),
    ]) : [[], [], [], [], []];
    // "plan:<root>:<student>:<dueKey>": a due already billed to a student under any plan (a student moved to another plan is not billed twice for a month).
    const billed = new Set(existing.map((e) => { const p = e.k!.split(":"); return `${p[2]}:${p.slice(3).join(":")}`; }));
    const spent = new Map(used.map((u) => [u.id, Number(u.v)]));
    const drafts: PlanDraft[] = [];

    for (const s of pool) {
      const flag = (reason: BillException["reason"], detail: string, href: string, fix: string) => { if (!exceptions.some((e) => e.studentId === s.id && e.reason === reason)) exceptions.push({ studentId: s.id, studentName: s.name, admissionNo: s.admissionNo, reason, detail, href, fix }); };
      const pick = pickPlan(published, { classId: s.classId, admission: admissionKind(s.admissionDate, year), overrideRoot: overrides.find((x) => x.studentId === s.id)?.rootId });
      if (!pick || !s.classId) { skipped.noPlan++; flag("no_plan", s.classId ? "No published plan covers this class" : "The student has no class", s.classId ? "/app/fees/plans" : `/app/students/${s.id}`, s.classId ? "Add the class to a plan" : "Set the class"); continue; }
      const plan = planById.get(pick.id)!, classId = s.classId;
      const mine = new Set(optIns.filter((x) => x.studentId === s.id).map((x) => x.headId));
      const keys = [...new Set(lines.filter((l) => l.planId === plan.id).flatMap((l) => dues.filter((d) => d.lineId === l.id).map((d) => d.dueKey)))].sort();
      const mineConcs = concs.filter((c) => c.studentId === s.id);
      const notTaken = lines.filter((l) => l.planId === plan.id && l.optional && !mine.has(l.headId)).map((l) => headById.get(l.headId)!.name);
      const cands = keys.flatMap((key) => {
        const rows = lines.filter((l) => l.planId === plan.id && (!l.optional || mine.has(l.headId))).flatMap((l) => dues.filter((d) => d.lineId === l.id && d.dueKey === key).map((d) => ({ l, d })));
        if (!rows.length) return [];
        const dueOn = rows.map((r) => r.d.dueOn).sort()[0]!;
        // Not billed for what falls due after they left; no date means we cannot tell, so nothing more is billed.
        if (s.status !== "active" && (!s.leftOn || dueOn > s.leftOn)) { if (!billed.has(`${s.id}:${key}`) && (!o.dueKeys || o.dueKeys.includes(key))) { skipped.left++; flag("left", s.leftOn ? `Left on ${s.leftOn}` : "Left, with no leaving date", `/app/fees/students/${s.id}`, s.leftOn ? "Open their fees" : "Set the leaving date"); } return []; }
        // Joining mid-year: their joining month and later are billed, earlier ones are not.
        if (plan.joinRule === "due_after_joining" && admissionKind(s.admissionDate, year) === "new" && dueOn < monthStart(s.admissionDate!)) return [];
        if (billed.has(`${s.id}:${key}`)) { if (!o.dueKeys || o.dueKeys.includes(key)) { skipped.alreadyIssued++; flag("already_billed", `Already billed for ${key}`, `/app/fees/invoices?studentId=${s.id}`, "Open their bills"); } return []; }
        return [{ key, rows, dueOn }];
      }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
      // A yearly amount is a pool shared by the bills still to come; what each bill took is remembered so a cancelled bill gives it back.
      const pool = new Map(mineConcs.filter((c) => c.mode === "amount" && c.per === "year").map((c) => [c.id, c.value - (spent.get(c.id) ?? 0)]));
      cands.forEach(({ key, rows, dueOn }, idx) => {
        if ((o.dueKeys && !o.dueKeys.includes(key)) || (o.billedBy && rows.every((r) => r.d.billOn > o.billedBy!))) return;
        const raw = rows.map(({ l, d }) => { const h = headById.get(l.headId)!; return { headId: l.headId, kind: (h.type === "deposit" ? "deposit" : "fee") as "fee" | "deposit", label: h.name, amountPaise: d.amountPaise }; });
        const sc: Conc[] = mineConcs.map((c) => ({ headId: c.headId, mode: c.mode, value: c.mode === "amount" && c.per === "year" ? yearShare(Math.max(0, pool.get(c.id) ?? 0), cands.length - idx) : c.value }));
        const { perLine: conc, applied } = concessionsDetailed(raw, sc);
        const uses: PlanDraft["uses"] = [];
        mineConcs.forEach((c, i) => { if (pool.has(c.id) && applied[i]! > 0) { pool.set(c.id, pool.get(c.id)! - applied[i]!); uses.push({ concessionId: c.id, amountPaise: applied[i]! }); } });
        const priced = raw.map((r, i) => ({ ...r, concessionPaise: conc[i]! }));
        drafts.push({
          sourceKey: `plan:${plan.rootId}:${s.id}:${key}`, studentId: s.id, studentName: s.name, admissionNo: s.admissionNo, classId, planId: plan.id, label: rows[0]!.d.label, dueOn, lateRule: plan.lateRule, lines: priced,
          grossPaise: priced.reduce((a, l) => a + l.amountPaise, 0), concessionPaise: conc.reduce((a, c) => a + c, 0), snapshot: null, uses,
        });
      });
      if (notTaken.length && drafts.some((d) => d.studentId === s.id)) flag("opted_out", `Not billed: ${[...new Set(notTaken)].join(", ")} (optional, not taken)`, `/app/fees/plans/${plan.id}?tab=students`, "Change what they take");
    }
    return { year, drafts, skipped, exceptions };
  }
}
