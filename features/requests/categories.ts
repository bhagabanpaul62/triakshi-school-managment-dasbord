import { and, asc, count, eq, sql } from "drizzle-orm";
import { schoolRoles, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import type { EscalationLevel, RequestField } from "./constants";
import requestsFeature from "./feature";
import { categoryInput, orderInput } from "./inputs";
import { requestCategories, requests } from "./schema";

type Perm = keyof typeof requestsFeature.permissions;
export type Category = typeof requestCategories.$inferSelect;

const CERT_FIELDS: RequestField[] = [{ id: "kind", label: "Which certificate", kind: "choice", required: true, options: ["Bonafide", "Transfer", "Character", "Other"] }, { id: "needed_by", label: "Needed by", kind: "date", required: false }];
const level = (label: string, role: string, afterDays: number): EscalationLevel => ({ label, role, afterDays });

/** The ready set (PRD R1). Written the first time a school opens Requests; the school edits it freely after. */
type Ready = Pick<typeof requestCategories.$inferInsert, "name" | "ownerRole" | "targetDays"> & Partial<Pick<typeof requestCategories.$inferInsert, "nature" | "escalation" | "fields">>;
const READY = ((list: Ready[]) => list.map((c, sort) => ({ ...c, sort })))([
  { name: "Academics", ownerRole: "class_teacher", targetDays: 3, escalation: [level("Office", "admin", 2)] },
  { name: "Fees", ownerRole: "accountant", targetDays: 2, escalation: [level("Principal", "admin", 2)] },
  { name: "Transport", ownerRole: "admin", targetDays: 3 },
  { name: "Library", ownerRole: "admin", targetDays: 3 },
  { name: "Certificate", ownerRole: "admin", targetDays: 5, fields: CERT_FIELDS },
  { name: "Attendance", ownerRole: "class_teacher", targetDays: 2, fields: [{ id: "dates", label: "Which dates", kind: "text", required: false }], escalation: [level("Office", "admin", 2)] },
  { name: "Complaint", nature: "complaint", ownerRole: "admin", targetDays: 2 },
  { name: "Safety concern", nature: "safety", ownerRole: "admin", targetDays: 1 },
  { name: "Suggestion", ownerRole: "admin", targetDays: 7 },
  { name: "Health", ownerRole: "class_teacher", targetDays: 1, escalation: [level("Office", "admin", 1)] },
  { name: "Other", ownerRole: "admin", targetDays: 3 },
]);

/** Fills an empty school with the ready set. Safe to race: the name is unique. */
export async function ensureCategories(tx: Tx, schoolId: string): Promise<void> {
  const [{ n }] = await tx.select({ n: count() }).from(requestCategories) as [{ n: number }];
  if (Number(n) > 0) return;
  await tx.insert(requestCategories).values(READY.map((c) => ({ ...c, schoolId }))).onConflictDoNothing();
}

/** Families and staff read the active categories; the office changes them. */
export class CategoryService extends SchoolService<Perm> {
  protected feature = requestsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** A read that first fills an empty school with the ready set; a read-only school only reads. */
  private seeded<T>(permission: Perm, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.ctx.readOnly ? this.read(permission, fn) : this.write(permission, async (tx) => { await ensureCategories(tx, this.ctx.schoolId); return fn(tx); });
  }

  /** What a person may choose from when asking. Owners and targets are not shown. */
  async options() {
    return this.seeded("use", async (tx) => {
      const rows = await tx.select().from(requestCategories).where(eq(requestCategories.active, true)).orderBy(asc(requestCategories.sort), asc(requestCategories.name));
      return rows.map((c) => ({ id: c.id, name: c.name, nature: c.nature, fields: c.fields }));
    });
  }

  /** Who a category may be given to: the built-in roles, the class teacher of the child, and the school's own roles. */
  async roleOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("manage", async (tx) => {
      const own = await tx.select({ id: schoolRoles.id, name: schoolRoles.name }).from(schoolRoles).orderBy(asc(schoolRoles.name));
      return [{ value: "class_teacher", label: "Class teacher of the child" }, { value: "admin", label: "Admin" }, { value: "accountant", label: "Accountant" }, { value: "teacher", label: "Any teacher" }, ...own.map((r) => ({ value: r.id, label: r.name }))];
    });
  }

  /** Every category, with how many requests each has. A support session may set categories up but never counts requests: `used` is null for it. */
  async list() {
    const support = !!this.ctx.supportStaffId;
    return this.seeded("manage", async (tx) => {
      const rows = await tx.select({ c: requestCategories, used: sql<number>`(select count(*)::int from requests r where r.category_id = ${requestCategories.id})` }).from(requestCategories).orderBy(asc(requestCategories.sort), asc(requestCategories.name));
      return rows.map((r) => ({ ...r.c, used: support ? null : Number(r.used) }));
    });
  }

  async save(input: unknown): Promise<Category> {
    this.authorize("manage", "write");
    const d = this.parse(categoryInput, input);
    return this.write("manage", async (tx) => {
      const values = { name: d.name, nature: d.nature, ownerUserId: d.ownerUserId ?? null, ownerRole: d.ownerRole, targetDays: d.targetDays, escalation: d.escalation, fields: d.fields, updatedAt: new Date() };
      try {
        if (d.id) {
          const [row] = await tx.update(requestCategories).set(values).where(eq(requestCategories.id, d.id)).returning();
          if (!row) throw new NotFoundError("Category");
          return row;
        }
        const [last] = await tx.select({ s: sql<number>`coalesce(max(${requestCategories.sort}), -1)` }).from(requestCategories);
        const [row] = await tx.insert(requestCategories).values({ ...values, schoolId: this.ctx.schoolId, sort: Number(last?.s ?? -1) + 1 }).returning();
        return row!;
      } catch (e) {
        if ((e as { cause?: { code?: string } })?.cause?.code === "23505") throw new ValidationError({ name: "There is already a category with this name" });
        throw e;
      }
    }, (c) => ({ action: d.id ? "update" : "create", entity: "Request category", entityId: c.id, summary: `${d.id ? "Changed" : "Added"} request category ${c.name}` }));
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.write("manage", async (tx) => {
      if (!active) {
        const [r] = await tx.select({ n: count() }).from(requestCategories).where(and(eq(requestCategories.active, true), sql`${requestCategories.id} <> ${id}`));
        if (!Number(r?.n)) throw new ConflictError("Keep at least one category turned on, so families can still ask.");
      }
      await tx.update(requestCategories).set({ active, updatedAt: new Date() }).where(eq(requestCategories.id, id));
    }, () => ({ action: "update", entity: "Request category", entityId: id, summary: active ? "Turned a request category on" : "Turned a request category off" }));
  }

  /** The new order, as the list of ids top to bottom. */
  async reorder(ids: unknown): Promise<void> {
    this.authorize("manage", "write");
    const order = this.parse(orderInput, ids);
    await this.write("manage", async (tx) => {
      for (const [i, id] of order.entries()) await tx.update(requestCategories).set({ sort: i }).where(eq(requestCategories.id, id));
    }, () => ({ action: "update", entity: "Request category", summary: "Changed the order of request categories" }));
  }

  /** A category with requests stays (turn it off instead): history never loses its words. */
  async remove(id: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [used] = await tx.select({ n: count() }).from(requests).where(eq(requests.categoryId, id));
      if (Number(used?.n)) throw new ConflictError("Families have used this category, so it cannot be deleted. Turn it off instead.");
      const [others] = await tx.select({ n: count() }).from(requestCategories).where(sql`${requestCategories.id} <> ${id}`);
      if (!Number(others?.n)) throw new ConflictError("Keep at least one category, so families can still ask.");
      await tx.delete(requestCategories).where(eq(requestCategories.id, id));
    }, () => ({ action: "delete", entity: "Request category", entityId: id, summary: "Deleted a request category" }));
  }
}
