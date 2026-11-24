import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ConflictError, CrudService, NotFoundError, listQuerySchema, toPage, type Ctx, type ListQuery } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { finAccounts } from "@smw/feature-finance/schema";
import { services } from "@smw/integrations";
import { classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import feesFeature from "./feature";
import { FeesBase, asId, invalid, type Perm } from "./base";
import { ChangeService } from "./changes";
import { PlanBilling } from "./plan-billing";
import { copyPlanInput, headInput, optInInput, planInput, removeOptInInput, removeOverrideInput, studentPlanInput } from "./inputs";
import { feeHeads, feeInvoiceLines, feeInvoices, feeOptIns, feePlanClasses, feePlanDues, feePlanLines, feePlans, feeStudentPlans } from "./schema";
import type { ADMISSION_TYPES } from "./constants";

export type Plan = typeof feePlans.$inferSelect;
export type FeeHead = typeof feeHeads.$inferSelect;

// ---------- heads ----------

export class HeadService extends CrudService<typeof feeHeads, Perm> {
  protected feature = feesFeature;
  protected table = feeHeads;
  protected entityName = "Fee head";
  protected readPermission = "read" as const;
  protected writePermission = "setup" as const;
  protected createSchema = headInput;
  protected updateSchema = headInput.extend({ isActive: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()) });
  protected defaultSort = "name";
  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [feeHeads.name]; }
  protected sortColumns() { return { name: feeHeads.name, createdAt: feeHeads.createdAt }; }

  /** Names are unique ignoring case, and an income account must be this school's own (foreign keys ignore RLS). */
  private async check(tx: Tx, data: Record<string, unknown>, exceptId?: string) {
    const [dup] = await tx.select({ id: feeHeads.id }).from(feeHeads).where(and(sql`lower(${feeHeads.name}) = lower(${String(data.name)})`, exceptId ? ne(feeHeads.id, exceptId) : undefined)).limit(1);
    if (dup) throw new ConflictError(`A fee called "${data.name}" already exists.`);
    if (data.accountId) {
      const [a] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.id, String(data.accountId))).limit(1);
      if (!a) throw new NotFoundError("Account");
    }
  }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { await this.check(tx, data); return data; }
  protected async beforeUpdate(tx: Tx, existing: FeeHead, data: Record<string, unknown>) { await this.check(tx, data, existing.id); return data; }
  protected async usage(tx: Tx, h: FeeHead): Promise<[string, number][]> {
    const [[p], [l]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(feePlanLines).where(eq(feePlanLines.headId, h.id)),
      tx.select({ n: sql<number>`count(*)::int` }).from(feeInvoiceLines).where(eq(feeInvoiceLines.headId, h.id)),
    ]);
    return [["fee plans", p?.n ?? 0], ["bill lines", l?.n ?? 0]];
  }

  async options() { return this.read("read", (tx) => tx.select().from(feeHeads).orderBy(asc(feeHeads.name))); }
}

// ---------- choosing a plan ----------

export interface PublishedPlan { id: string; rootId: string; admissionType: (typeof ADMISSION_TYPES)[number]; publishedAt: Date | null; classIds: Set<string> }

/**
 * The plan a student is billed on: their own override (the root's published version), else the plan for their class
 * and admission type. A plan made for new or existing admissions beats one for all. One rule, used by billing and screens.
 */
export function pickPlan(plans: PublishedPlan[], s: { classId: string | null; admission: "new" | "existing"; overrideRoot?: string | null }): PublishedPlan | null {
  if (s.overrideRoot) return plans.find((p) => p.rootId === s.overrideRoot) ?? null;
  const rank = (p: PublishedPlan) => (p.admissionType === s.admission ? 2 : p.admissionType === "all" ? 1 : 0);
  return plans.filter((p) => s.classId && p.classIds.has(s.classId) && rank(p) > 0)
    .sort((a, b) => rank(b) - rank(a) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0] ?? null;
}

/** New or existing: admitted inside the year or before it. */
export const admissionKind = (admissionDate: string | null, year: { startsOn: string; endsOn: string }): "new" | "existing" =>
  admissionDate && admissionDate >= year.startsOn && admissionDate <= year.endsOn ? "new" : "existing";

// ---------- plans ----------

export class PlanService extends FeesBase {
  /** Published plans of a year with their classes. */
  async publishedIn(tx: Tx, yearId: string): Promise<PublishedPlan[]> {
    const plans = await tx.select().from(feePlans).where(and(eq(feePlans.yearId, yearId), eq(feePlans.status, "published")));
    const cls = plans.length ? await tx.select().from(feePlanClasses).where(inArray(feePlanClasses.planId, plans.map((p) => p.id))) : [];
    return plans.map((p) => ({ id: p.id, rootId: p.rootId, admissionType: p.admissionType, publishedAt: p.publishedAt, classIds: new Set(cls.filter((c) => c.planId === p.id).map((c) => c.classId)) }));
  }

  /** The published plan one student is billed on in a year, or null. */
  async resolve(tx: Tx, student: { id: string; classId: string | null; admissionDate: string | null }, yearId: string): Promise<PublishedPlan | null> {
    const year = await this.yearOr(tx, yearId);
    const [over] = await tx.select({ rootId: feeStudentPlans.rootId }).from(feeStudentPlans).where(and(eq(feeStudentPlans.studentId, student.id), eq(feeStudentPlans.yearId, yearId)));
    return pickPlan(await this.publishedIn(tx, yearId), { classId: student.classId, admission: admissionKind(student.admissionDate, year), overrideRoot: over?.rootId });
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const year = await this.yearOr(tx, q.filters.yearId);
      const where = and(eq(feePlans.yearId, year.id), q.filters.status ? eq(feePlans.status, q.filters.status as Plan["status"]) : ne(feePlans.status, "archived"));
      const rows = await tx.select().from(feePlans).where(where).orderBy(desc(feePlans.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(feePlans).where(where) as [{ n: number }];
      const ids = rows.map((r) => r.id);
      const [cls, totals] = ids.length ? await Promise.all([
        tx.select({ planId: feePlanClasses.planId, name: classes.name, grade: classes.grade }).from(feePlanClasses).innerJoin(classes, eq(classes.id, feePlanClasses.classId)).where(inArray(feePlanClasses.planId, ids)).orderBy(asc(classes.grade)),
        tx.select({ planId: feePlanLines.planId, total: sql<number>`coalesce(sum(${feePlanDues.amountPaise}) filter (where not ${feePlanLines.optional}), 0)::bigint` }).from(feePlanLines).innerJoin(feePlanDues, eq(feePlanDues.lineId, feePlanLines.id)).where(inArray(feePlanLines.planId, ids)).groupBy(feePlanLines.planId),
      ]) : [[], []];
      return toPage(rows.map((r) => ({ ...r, classNames: cls.filter((c) => c.planId === r.id).map((c) => c.name), totalPaise: Number(totals.find((t) => t.planId === r.id)?.total ?? 0) })), n, q);
    });
  }

  async get(id: string) {
    return this.read("read", async (tx) => {
      const [plan] = await tx.select().from(feePlans).where(eq(feePlans.id, asId(id, "Fee plan")));
      if (!plan) throw new NotFoundError("Fee plan");
      const [cls, lines, versions] = await Promise.all([
        tx.select({ id: classes.id, name: classes.name }).from(feePlanClasses).innerJoin(classes, eq(classes.id, feePlanClasses.classId)).where(eq(feePlanClasses.planId, id)).orderBy(asc(classes.grade)),
        tx.select({ id: feePlanLines.id, headId: feePlanLines.headId, headName: feeHeads.name, optional: feePlanLines.optional }).from(feePlanLines).innerJoin(feeHeads, eq(feeHeads.id, feePlanLines.headId)).where(eq(feePlanLines.planId, id)).orderBy(asc(feePlanLines.createdAt), asc(feePlanLines.id)),
        tx.select({ id: feePlans.id, version: feePlans.version, status: feePlans.status }).from(feePlans).where(eq(feePlans.rootId, plan.rootId)).orderBy(desc(feePlans.version)),
      ]);
      const dues = lines.length ? await tx.select().from(feePlanDues).where(inArray(feePlanDues.lineId, lines.map((l) => l.id))).orderBy(asc(feePlanDues.dueOn)) : [];
      const full = lines.map((l) => ({ ...l, dues: dues.filter((d) => d.lineId === l.id) }));
      const totalPaise = full.filter((l) => !l.optional).reduce((s, l) => s + l.dues.reduce((a, d) => a + d.amountPaise, 0), 0);
      const [approval, { planNeedsFile }] = await Promise.all([this.approvalsIn(tx, ["fees.plan"], [id]).then((m) => m.get(id) ?? null), this.settings(tx)]);
      // The file route checks the caller is signed in to this school and redirects to a short-lived signed link, so an approver can open it too.
      const approvalFile = plan.approvalFileKey ? { name: plan.approvalFileKey.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, ""), href: `/api/files/${plan.approvalFileKey}` } : null;
      return { plan, classes: cls, lines: full, versions, totalPaise, approval, approvalFile, fileRequired: planNeedsFile };
    });
  }

  /** Create a new plan, or replace the lines of a draft. Published plans are never edited: make a new version. */
  async saveDraft(input: unknown) {
    this.authorize("setup", "write");
    const data = this.parse(planInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.yearOr(tx, data.yearId);
      await this.checkPlan(tx, data);
      let id = data.id;
      if (id) {
        const [cur] = await tx.select().from(feePlans).where(eq(feePlans.id, id)).for("update");
        if (!cur) throw new NotFoundError("Fee plan");
        if (cur.status !== "draft") throw new ConflictError("Only a draft can be edited. Make a new version instead.");
        await tx.update(feePlans).set({ name: data.name, admissionType: data.admissionType, joinRule: data.joinRule, lateRule: data.lateRule ?? null, note: data.note ?? null, ...(data.approvalFileKey ? { approvalFileKey: data.approvalFileKey } : {}) }).where(eq(feePlans.id, id));
        await tx.delete(feePlanClasses).where(eq(feePlanClasses.planId, id));
        await tx.delete(feePlanLines).where(eq(feePlanLines.planId, id));
      } else {
        const rootId = data.rootId ?? randomUUID();
        const [last] = await tx.select({ v: feePlans.version }).from(feePlans).where(eq(feePlans.rootId, rootId)).orderBy(desc(feePlans.version)).limit(1);
        const [row] = await tx.insert(feePlans).values({ schoolId: this.ctx.schoolId, yearId: year.id, rootId, version: (last?.v ?? 0) + 1, name: data.name, admissionType: data.admissionType, joinRule: data.joinRule, lateRule: data.lateRule ?? null, note: data.note ?? null, approvalFileKey: data.approvalFileKey ?? null, createdBy: this.ctx.userId }).returning({ id: feePlans.id });
        id = row!.id;
      }
      await this.writeChildren(tx, id, data.classIds, data.lines);
      return id;
    }, (id) => ({ action: "save_draft", entity: "Fee plan", entityId: id, summary: `Saved draft fee plan ${data.name}` })).then((id) => this.get(id));
  }

  private async checkPlan(tx: Tx, data: z.infer<typeof planInput>) {
    const heads = [...new Set(data.lines.map((l) => l.headId))];
    if (heads.length !== data.lines.length) throw invalid("lines", "Each fee can be added only once.");
    if ((await tx.select({ id: feeHeads.id }).from(feeHeads).where(inArray(feeHeads.id, heads))).length !== heads.length) throw new NotFoundError("Fee head");
    const cls = [...new Set(data.classIds)];
    if ((await tx.select({ id: classes.id }).from(classes).where(inArray(classes.id, cls))).length !== cls.length) throw new NotFoundError("Class");
    for (const l of data.lines) {
      const keys = l.dues.map((d) => d.dueKey);
      if (new Set(keys).size !== keys.length) throw invalid("lines", "A due date key repeats inside one fee.");
      if (l.dues.some((d) => d.dueOn < d.billOn)) throw invalid("lines", "A due date is before its bill date.");
    }
  }

  private async writeChildren(tx: Tx, planId: string, classIds: string[], lines: z.infer<typeof planInput>["lines"]) {
    const schoolId = this.ctx.schoolId;
    await tx.insert(feePlanClasses).values([...new Set(classIds)].map((classId) => ({ schoolId, planId, classId })));
    for (const l of lines) {
      const [line] = await tx.insert(feePlanLines).values({ schoolId, planId, headId: l.headId, optional: l.optional }).returning({ id: feePlanLines.id });
      await tx.insert(feePlanDues).values(l.dues.map((d) => ({ schoolId, lineId: line!.id, ...d })));
    }
  }

  /** A new draft version of a plan, copied from its latest. Publishing it bills only what is not yet issued. */
  async newVersion(rootId: string) {
    this.authorize("setup", "write");
    const id = await this.write("setup", async (tx) => {
      const versions = await tx.select().from(feePlans).where(eq(feePlans.rootId, rootId)).orderBy(desc(feePlans.version)).for("update");
      if (!versions.length) throw new NotFoundError("Fee plan");
      if (versions.some((v) => v.status === "draft" || v.status === "pending")) throw new ConflictError("There is already a draft of this plan. Finish that first.");
      const src = versions[0]!;
      const [row] = await tx.insert(feePlans).values({ schoolId: this.ctx.schoolId, yearId: src.yearId, rootId, version: src.version + 1, name: src.name, admissionType: src.admissionType, joinRule: src.joinRule, lateRule: src.lateRule, note: src.note, createdBy: this.ctx.userId }).returning({ id: feePlans.id });
      await this.copyChildren(tx, src.id, row!.id, 0);
      return row!.id;
    }, (id) => ({ action: "new_version", entity: "Fee plan", entityId: id, summary: "Started a new version of a fee plan" }));
    return this.get(id);
  }

  /** Copy a plan to another year (dates move by whole years) or other classes, as a new draft. */
  async copy(id: string, input: unknown = {}) {
    this.authorize("setup", "write");
    const data = this.parse(copyPlanInput, input);
    const newId = await this.write("setup", async (tx) => {
      const [src] = await tx.select().from(feePlans).where(eq(feePlans.id, id));
      if (!src) throw new NotFoundError("Fee plan");
      const [from, to] = [await this.yearOr(tx, src.yearId), await this.yearOr(tx, data.yearId ?? src.yearId)];
      const [row] = await tx.insert(feePlans).values({ schoolId: this.ctx.schoolId, yearId: to.id, rootId: randomUUID(), name: data.name ?? `${src.name} (copy)`, admissionType: src.admissionType, joinRule: src.joinRule, lateRule: src.lateRule, note: src.note, createdBy: this.ctx.userId }).returning({ id: feePlans.id });
      await this.copyChildren(tx, src.id, row!.id, Number(to.startsOn.slice(0, 4)) - Number(from.startsOn.slice(0, 4)), data.classIds);
      return row!.id;
    }, (nid) => ({ action: "copy", entity: "Fee plan", entityId: nid, summary: "Copied a fee plan" }));
    return this.get(newId);
  }

  private async copyChildren(tx: Tx, fromId: string, toId: string, shiftYears: number, classIds?: string[]) {
    const shift = (d: string) => `${Number(d.slice(0, 4)) + shiftYears}${d.slice(4)}`;
    const schoolId = this.ctx.schoolId;
    const cls = classIds ?? (await tx.select({ id: feePlanClasses.classId }).from(feePlanClasses).where(eq(feePlanClasses.planId, fromId))).map((c) => c.id);
    if (classIds && (await tx.select({ id: classes.id }).from(classes).where(inArray(classes.id, classIds))).length !== new Set(classIds).size) throw new NotFoundError("Class");
    if (cls.length) await tx.insert(feePlanClasses).values(cls.map((classId) => ({ schoolId, planId: toId, classId })));
    const lines = await tx.select().from(feePlanLines).where(eq(feePlanLines.planId, fromId)).orderBy(asc(feePlanLines.createdAt), asc(feePlanLines.id));
    for (const l of lines) {
      const [n] = await tx.insert(feePlanLines).values({ schoolId, planId: toId, headId: l.headId, optional: l.optional }).returning({ id: feePlanLines.id });
      const dues = await tx.select().from(feePlanDues).where(eq(feePlanDues.lineId, l.id));
      if (dues.length) await tx.insert(feePlanDues).values(dues.map((d) => ({ schoolId, lineId: n!.id, dueKey: d.dueKey, label: d.label, billOn: shift(d.billOn), dueOn: shift(d.dueOn), amountPaise: d.amountPaise })));
    }
  }

  /** Send a draft for approval (`fees.plan`). Publishing is what makes it bill. */
  async submit(id: string) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      const [p] = await tx.select().from(feePlans).where(eq(feePlans.id, id)).for("update");
      if (!p) throw new NotFoundError("Fee plan");
      if (p.status !== "draft") throw new ConflictError("Only a draft can be sent for approval.");
      await this.assertPublishable(tx, p);
      if ((await this.settings(tx)).planNeedsFile && !p.approvalFileKey) throw invalid("approvalFile", "Attach the committee's approval file (PDF, JPG or PNG) on the plan page first. The school asks for it before a plan goes for approval.");
      await tx.update(feePlans).set({ status: "pending" }).where(eq(feePlans.id, id));
      await this.askApproval(tx, { kind: "fees.plan", refType: "fee_plan", refId: id, title: `Publish fee plan ${p.name} (version ${p.version})`, amountPaise: 0, reason: p.note ?? "New fee plan", href: `/app/fees/plans/${id}` });
      return { ...p, status: "pending" as const };
    }, (p) => ({ action: "submit", entity: "Fee plan", entityId: p.id, summary: `Sent fee plan ${p.name} for approval` }));
  }

  /** Take a plan back from approval: it becomes a draft again, to edit and send again. */
  async withdraw(id: string) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      await this.withdrawRequest(tx, "fees.plan", id);
      await this.rejectIn(tx, id);
      return { id };
    }, () => ({ action: "withdraw", entity: "Fee plan", entityId: id, summary: "Withdrew a fee plan from approval" }));
  }

  /** Switch a published plan off: nothing more is billed from it (bills issued stay). That lowers what will be billed, so above the school's limit it waits for approval. */
  async archive(id: string) {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      const [p] = await tx.select().from(feePlans).where(eq(feePlans.id, id));
      if (!p || p.status !== "published") throw new ConflictError("Only a published plan can be archived.");
      const { drafts } = await new PlanBilling(this.ctx).build(tx, { yearId: p.yearId });
      const lowers = drafts.filter((x) => x.planId === p.id).reduce((s, x) => s + x.grossPaise - x.concessionPaise, 0);
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "archive_plan", payload: { planId: id }, reason: `Switch off fee plan ${p.name}`, lowersPaise: lowers, title: `Switch off fee plan ${p.name}`, href: `/app/fees/plans/${id}` }, () => this.archiveIn(tx, id));
      return { id, name: p.name, requested: out.requested, changeId: out.requested ? out.change.id : null };
    }, (r) => ({ action: r.requested ? "request_archive" : "archive", entity: "Fee plan", entityId: r.id, summary: `${r.requested ? "Asked to archive" : "Archived"} fee plan ${r.name}. Bills already issued stay.` }));
  }

  async archiveIn(tx: Tx, id: string) {
    const [p] = await tx.update(feePlans).set({ status: "archived" }).where(and(eq(feePlans.id, id), eq(feePlans.status, "published"))).returning({ id: feePlans.id });
    if (!p) throw new ConflictError("This plan is no longer published.");
  }

  async removeDraft(id: string) {
    return this.write("setup", async (tx) => {
      const [p] = await tx.delete(feePlans).where(and(eq(feePlans.id, id), eq(feePlans.status, "draft"))).returning({ id: feePlans.id, name: feePlans.name });
      if (!p) throw new ConflictError("Only a draft can be deleted.");
      return p;
    }, (p) => ({ action: "delete", entity: "Fee plan", entityId: p.id, summary: `Deleted draft fee plan ${p.name}` }));
  }

  private async assertPublishable(tx: Tx, p: Plan) {
    const cls = await tx.select({ classId: feePlanClasses.classId, name: classes.name }).from(feePlanClasses).innerJoin(classes, eq(classes.id, feePlanClasses.classId)).where(eq(feePlanClasses.planId, p.id));
    const lines = await tx.select({ id: feePlanLines.id }).from(feePlanLines).where(eq(feePlanLines.planId, p.id));
    if (!cls.length || !lines.length) throw new ConflictError("A plan needs classes and at least one fee.");
    // Another plan of the same kind of admission on a class would make two prices for one student.
    const clash = await tx.select({ cls: classes.name, plan: feePlans.name }).from(feePlans).innerJoin(feePlanClasses, eq(feePlanClasses.planId, feePlans.id)).innerJoin(classes, eq(classes.id, feePlanClasses.classId))
      .where(and(eq(feePlans.yearId, p.yearId), eq(feePlans.status, "published"), ne(feePlans.rootId, p.rootId), eq(feePlans.admissionType, p.admissionType), inArray(feePlanClasses.classId, cls.map((c) => c.classId)))).limit(1);
    if (clash[0]) throw new ConflictError(`${clash[0].cls} already has a published plan (${clash[0].plan}) for the same kind of admission.`);
  }

  /** Make a plan live and retire the older version of its root. Used by the approval and by seeds. No permission check. */
  async publishIn(tx: Tx, planId: string) {
    const [p] = await tx.select().from(feePlans).where(eq(feePlans.id, planId)).for("update");
    if (!p) throw new NotFoundError("Fee plan");
    if (p.status !== "pending" && p.status !== "draft") throw new ConflictError("This plan is already decided.");
    await this.assertPublishable(tx, p);
    await tx.update(feePlans).set({ status: "archived" }).where(and(eq(feePlans.rootId, p.rootId), eq(feePlans.status, "published")));
    await tx.update(feePlans).set({ status: "published", publishedAt: new Date() }).where(eq(feePlans.id, p.id));
    await this.audit(tx, { action: "publish", entity: "Fee plan", entityId: p.id, summary: `Published fee plan ${p.name} version ${p.version}` });
  }

  async rejectIn(tx: Tx, planId: string) {
    await tx.update(feePlans).set({ status: "draft" }).where(and(eq(feePlans.id, planId), eq(feePlans.status, "pending")));
  }

  /** What a plan would still bill a student: its dues (mandatory, and the optional heads taken) whose month is not yet billed to them under any plan. */
  private async unbilledIn(tx: Tx, studentId: string, planId: string, taken: Set<string>, onlyHeads?: Set<string>): Promise<number> {
    const [lines, billed] = await Promise.all([
      tx.select({ headId: feePlanLines.headId, optional: feePlanLines.optional, key: feePlanDues.dueKey, amount: feePlanDues.amountPaise }).from(feePlanLines).innerJoin(feePlanDues, eq(feePlanDues.lineId, feePlanLines.id)).where(eq(feePlanLines.planId, planId)),
      tx.select({ k: feeInvoices.sourceKey }).from(feeInvoices).where(and(eq(feeInvoices.studentId, studentId), like(feeInvoices.sourceKey, "plan:%"), ne(feeInvoices.status, "cancelled"))),
    ]);
    const done = new Set(billed.map((b) => b.k!.split(":").slice(3).join(":")));
    return lines.filter((l) => (!l.optional || taken.has(l.headId)) && (!onlyHeads || onlyHeads.has(l.headId)) && !done.has(l.key)).reduce((s, l) => s + l.amount, 0);
  }

  /**
   * Put one student on another plan for the year (their class's plan stops applying). Bills already issued stay. If the
   * new plan bills less of what is still to come by more than the school's limit, it waits for approval.
   */
  async setStudentPlan(input: unknown) {
    this.authorize("setup", "write");
    const data = this.parse(studentPlanInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.yearOr(tx, data.yearId);
      const [[s], target] = await Promise.all([
        tx.select({ id: students.id, classId: students.classId, admissionDate: students.admissionDate, name: students.name }).from(students).where(eq(students.id, data.studentId)),
        this.publishedIn(tx, year.id).then((all) => all.find((p) => p.rootId === data.rootId)),
      ]);
      if (!s) throw new NotFoundError("Student");
      if (!target) throw new ConflictError("That plan is not published for this year. Publish it first.");
      const taken = new Set((await tx.select({ h: feeOptIns.headId }).from(feeOptIns).where(and(eq(feeOptIns.studentId, s.id), eq(feeOptIns.yearId, year.id)))).map((r) => r.h));
      const current = await this.resolve(tx, s, year.id);
      const [was, will] = [current ? await this.unbilledIn(tx, s.id, current.id, taken) : 0, await this.unbilledIn(tx, s.id, target.id, taken)];
      const d = { ...data, yearId: year.id };
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "student_plan", studentId: s.id, payload: d, reason: data.reason, lowersPaise: was - will, title: `Move ${s.name} to another fee plan`, href: `/app/fees/students/${s.id}` }, () => this.applyStudentPlanIn(tx, d));
      return { studentId: s.id, requested: out.requested, changeId: out.requested ? out.change.id : null };
    }, (r) => ({ action: r.requested ? "request_student_plan" : "student_plan", entity: "Student", entityId: r.studentId, summary: `${r.requested ? "Asked to move" : "Moved"} a student to another fee plan: ${data.reason}` }));
  }

  /** `rootId` null puts the student back on their class's plan. */
  async applyStudentPlanIn(tx: Tx, d: { studentId: string; yearId: string; rootId: string | null; reason: string }) {
    if (!d.rootId) { await tx.delete(feeStudentPlans).where(and(eq(feeStudentPlans.studentId, d.studentId), eq(feeStudentPlans.yearId, d.yearId))); return; }
    await tx.insert(feeStudentPlans).values({ schoolId: this.ctx.schoolId, studentId: d.studentId, yearId: d.yearId, rootId: d.rootId, reason: d.reason, createdBy: this.ctx.userId })
      .onConflictDoUpdate({ target: [feeStudentPlans.studentId, feeStudentPlans.yearId], set: { rootId: d.rootId, reason: d.reason, createdBy: this.ctx.userId } });
  }

  /** The optional heads this student takes this year (replaces the list). Dropping one lowers what will be billed, so above the limit that waits for approval; adding one applies at once. */
  async setOptIns(input: unknown) {
    this.authorize("setup", "write");
    const data = this.parse(optInInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.yearOr(tx, data.yearId);
      const [s] = await tx.select({ id: students.id, classId: students.classId, admissionDate: students.admissionDate, name: students.name }).from(students).where(eq(students.id, data.studentId));
      if (!s) throw new NotFoundError("Student");
      const heads = [...new Set(data.headIds)];
      if (heads.length && (await tx.select({ id: feeHeads.id }).from(feeHeads).where(inArray(feeHeads.id, heads))).length !== heads.length) throw new NotFoundError("Fee head");
      const now = new Set((await tx.select({ h: feeOptIns.headId }).from(feeOptIns).where(and(eq(feeOptIns.studentId, s.id), eq(feeOptIns.yearId, year.id)))).map((r) => r.h));
      const dropped = new Set([...now].filter((h) => !heads.includes(h)));
      const plan = await this.resolve(tx, s, year.id);
      const lowers = plan && dropped.size ? await this.unbilledIn(tx, s.id, plan.id, now, dropped) : 0;
      const d = { studentId: s.id, yearId: year.id, headIds: heads };
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "opt_out", studentId: s.id, payload: d, reason: "Optional fees changed", lowersPaise: lowers, title: `Drop optional fees for ${s.name}`, href: `/app/fees/students/${s.id}` }, () => this.applyOptInsIn(tx, d));
      return { studentId: s.id, requested: out.requested, changeId: out.requested ? out.change.id : null };
    }, (r) => ({ action: r.requested ? "request_opt_in" : "opt_in", entity: "Student", entityId: r.studentId, summary: `${r.requested ? "Asked to change" : "Changed"} the optional fees a student takes` }));
  }

  async applyOptInsIn(tx: Tx, d: { studentId: string; yearId: string; headIds: string[] }) {
    await tx.delete(feeOptIns).where(and(eq(feeOptIns.studentId, d.studentId), eq(feeOptIns.yearId, d.yearId)));
    if (d.headIds.length) await tx.insert(feeOptIns).values(d.headIds.map((headId) => ({ schoolId: this.ctx.schoolId, studentId: d.studentId, yearId: d.yearId, headId })));
  }

  /** Attach (or, with null, take off) the committee's decision on a draft plan. The key must be one this school's upload made. */
  async setApprovalFile(id: string, key: string | null) {
    this.authorize("setup", "write");
    if (key && !key.startsWith(`${this.ctx.schoolId}/fees/plan-approvals/`)) throw invalid("approvalFile", "That file was not uploaded here. Upload it again.");
    return this.write("setup", async (tx) => {
      const [p] = await tx.select().from(feePlans).where(eq(feePlans.id, asId(id, "Fee plan"))).for("update");
      if (!p) throw new NotFoundError("Fee plan");
      if (p.status !== "draft") throw new ConflictError("The file can only change while the plan is a draft. Take it back from approval first, or make a new version.");
      await tx.update(feePlans).set({ approvalFileKey: key }).where(eq(feePlans.id, id));
      return { id, name: p.name, replaced: p.approvalFileKey };
    }, (r) => ({ action: key ? "attach_file" : "remove_file", entity: "Fee plan", entityId: r.id, summary: `${key ? "Attached" : "Removed"} the approval file of fee plan ${r.name}` }))
      .then(async (r) => { if (r.replaced) await services().storage.delete(r.replaced).catch(() => undefined); return { id: r.id }; });
  }

  private async rootYear(tx: Tx, rootId: string): Promise<string> {
    const [p] = await tx.select({ y: feePlans.yearId }).from(feePlans).where(eq(feePlans.rootId, asId(rootId, "Fee plan"))).orderBy(desc(feePlans.version)).limit(1);
    if (!p) throw new NotFoundError("Fee plan");
    return p.y;
  }

  private static readonly CLASS_LABEL = sql<string>`coalesce(${classes.name} || coalesce('-' || ${sections.name}, ''), '-')`;
  private who(q?: string) { return q ? or(ilike(students.name, `%${q}%`), ilike(students.admissionNo, `%${q}%`)) : undefined; }

  /** Students put on this plan by hand (not by their class), with who, why and since when. */
  async overrides(rootId: string, query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const yearId = await this.rootYear(tx, rootId);
      const where = and(eq(feeStudentPlans.rootId, rootId), eq(feeStudentPlans.yearId, yearId), this.who(q.q));
      const from = tx.select({ n: sql<number>`count(*)::int` }).from(feeStudentPlans).innerJoin(students, eq(students.id, feeStudentPlans.studentId)).where(where);
      const [rows, [n]] = await Promise.all([
        tx.select({ id: feeStudentPlans.id, studentId: students.id, name: students.name, admissionNo: students.admissionNo, classLabel: PlanService.CLASS_LABEL, reason: feeStudentPlans.reason, since: feeStudentPlans.createdAt })
          .from(feeStudentPlans).innerJoin(students, eq(students.id, feeStudentPlans.studentId)).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
          .where(where).orderBy(asc(students.name), asc(students.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        from,
      ]);
      return toPage(rows, Number(n?.n ?? 0), q);
    });
  }

  /** Put a student back on their class's plan. Taking them off a cheaper plan raises what they owe, so only a dearer one can need approval. */
  async removeOverride(input: unknown) {
    this.authorize("setup", "write");
    const data = this.parse(removeOverrideInput, input);
    return this.write("setup", async (tx) => {
      const year = await this.yearOr(tx, data.yearId);
      const [s] = await tx.select({ id: students.id, classId: students.classId, admissionDate: students.admissionDate, name: students.name }).from(students).where(eq(students.id, data.studentId));
      if (!s) throw new NotFoundError("Student");
      const [over] = await tx.select({ rootId: feeStudentPlans.rootId }).from(feeStudentPlans).where(and(eq(feeStudentPlans.studentId, s.id), eq(feeStudentPlans.yearId, year.id)));
      if (!over) throw new ConflictError("This student is not on a plan of their own, so there is nothing to remove.");
      const taken = new Set((await tx.select({ h: feeOptIns.headId }).from(feeOptIns).where(and(eq(feeOptIns.studentId, s.id), eq(feeOptIns.yearId, year.id)))).map((r) => r.h));
      const [now, back] = [await this.resolve(tx, s, year.id), pickPlan(await this.publishedIn(tx, year.id), { classId: s.classId, admission: admissionKind(s.admissionDate, year) })];
      const lowers = (now ? await this.unbilledIn(tx, s.id, now.id, taken) : 0) - (back ? await this.unbilledIn(tx, s.id, back.id, taken) : 0);
      const d = { studentId: s.id, yearId: year.id, rootId: null, reason: "Back on the class plan" };
      const out = await new ChangeService(this.ctx).submitIn(tx, { kind: "student_plan", studentId: s.id, payload: d, reason: d.reason, lowersPaise: lowers, title: `Put ${s.name} back on the class fee plan`, href: `/app/fees/students/${s.id}` }, () => this.applyStudentPlanIn(tx, d));
      return { studentId: s.id, requested: out.requested, changeId: out.requested ? out.change.id : null };
    }, (r) => ({ action: r.requested ? "request_remove_override" : "remove_override", entity: "Student", entityId: r.studentId, summary: `${r.requested ? "Asked to put" : "Put"} a student back on the class fee plan` }));
  }

  /** Students who take this plan's optional fees, with which ones and since when. */
  async optIns(rootId: string, query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const yearId = await this.rootYear(tx, rootId);
      const [latest] = await tx.select({ id: feePlans.id }).from(feePlans).where(eq(feePlans.rootId, rootId)).orderBy(desc(feePlans.version)).limit(1);
      const optional = tx.select({ h: feePlanLines.headId }).from(feePlanLines).where(and(eq(feePlanLines.planId, latest!.id), eq(feePlanLines.optional, true)));
      const where = and(eq(feeOptIns.yearId, yearId), inArray(feeOptIns.headId, optional), this.who(q.q));
      const [rows, [n]] = await Promise.all([
        tx.select({ studentId: students.id, name: students.name, admissionNo: students.admissionNo, classLabel: PlanService.CLASS_LABEL, since: sql<Date>`min(${feeOptIns.createdAt})`,
          heads: sql<{ id: string; name: string }[]>`json_agg(json_build_object('id', ${feeHeads.id}, 'name', ${feeHeads.name}) order by ${feeHeads.name})` })
          .from(feeOptIns).innerJoin(students, eq(students.id, feeOptIns.studentId)).innerJoin(feeHeads, eq(feeHeads.id, feeOptIns.headId)).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
          .where(where).groupBy(students.id, students.name, students.admissionNo, classes.name, sections.name).orderBy(asc(students.name), asc(students.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(distinct ${feeOptIns.studentId})::int` }).from(feeOptIns).innerJoin(students, eq(students.id, feeOptIns.studentId)).where(where),
      ]);
      return toPage(rows, Number(n?.n ?? 0), q);
    });
  }

  /** Stop billing one optional fee to one student (the rest they take stay). */
  async removeOptIn(input: unknown) {
    this.authorize("setup", "write");
    const data = this.parse(removeOptInInput, input);
    const keep = await this.read("setup", async (tx) => {
      const year = await this.yearOr(tx, data.yearId);
      const rows = await tx.select({ h: feeOptIns.headId }).from(feeOptIns).where(and(eq(feeOptIns.studentId, data.studentId), eq(feeOptIns.yearId, year.id)));
      if (!rows.some((r) => r.h === data.headId)) throw new ConflictError("This student does not take that fee.");
      return { yearId: year.id, headIds: rows.map((r) => r.h).filter((h) => h !== data.headId) };
    });
    return this.setOptIns({ studentId: data.studentId, ...keep });
  }

  /** Last year against this year by class: the fee hike view. */
  async compareYears(fromYearId: string, toYearId: string) {
    return this.read("read", async (tx) => {
      const totalFor = async (yearId: string) => {
        const rows = await tx.select({ classId: feePlanClasses.classId, type: feePlans.admissionType, total: sql<number>`sum(${feePlanDues.amountPaise})::bigint` })
          .from(feePlans).innerJoin(feePlanClasses, eq(feePlanClasses.planId, feePlans.id)).innerJoin(feePlanLines, eq(feePlanLines.planId, feePlans.id)).innerJoin(feePlanDues, eq(feePlanDues.lineId, feePlanLines.id))
          .where(and(eq(feePlans.yearId, yearId), eq(feePlans.status, "published"), eq(feePlanLines.optional, false))).groupBy(feePlanClasses.classId, feePlans.admissionType);
        const m = new Map<string, number>();
        for (const r of rows.sort((a, b) => (a.type === "all" ? 1 : 0) - (b.type === "all" ? 1 : 0))) m.set(r.classId, Number(r.total));
        return m;
      };
      const [a, b, cls] = await Promise.all([totalFor(fromYearId), totalFor(toYearId), tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.grade))]);
      return cls.filter((c) => a.has(c.id) || b.has(c.id)).map((c) => {
        const [from, to] = [a.get(c.id) ?? 0, b.get(c.id) ?? 0];
        return { classId: c.id, name: c.name, fromPaise: from, toPaise: to, changePercent: from ? Math.round(((to - from) / from) * 1000) / 10 : null, label: `${rupees(from)} to ${rupees(to)}` };
      });
    });
  }
}

