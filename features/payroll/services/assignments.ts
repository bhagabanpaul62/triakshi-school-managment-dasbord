import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, rethrowUnique } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { SheetError, parseSheet } from "@smw/integrations";
import { staffProfiles } from "@smw/feature-staff/schema";
import { day } from "@smw/feature-finance/services/common";
import { PayrollService } from "../base";
import { payAssignments, payStructures } from "../schema";

export type Assignment = typeof payAssignments.$inferSelect;
const paiseField = z.coerce.number().int().min(0).max(100_000_000_00);
export const assignInput = z.object({
  userId: z.uuid(), structureId: z.uuid(), grossPaise: paiseField, fromDate: day,
  hourlyPaise: paiseField.nullish().transform((v) => v || null),
  overrides: z.record(z.string(), paiseField).default({}),
  reason: z.string().trim().max(200).optional(),
});
export const bulkRaiseInput = z.object({ percentBp: z.coerce.number().int().min(1).max(10_000), fromDate: day, userIds: z.array(z.uuid()).optional(), department: z.string().trim().optional() });
export interface RaiseRow { userId: string; name: string; oldPaise: number; newPaise: number }
export interface ImportReport { rows: { line: number; employeeId: string; ok: boolean; error?: string }[]; ok: number; failed: number }
const wholeRupee = (p: number) => Math.round(p / 100) * 100;

export class AssignmentService extends PayrollService {
  async history(userId: string): Promise<(Assignment & { structure: string | null })[]> {
    this.assertCanSee(userId);
    return this.read("self", async (tx) => {
      const rows = await tx.select({ a: payAssignments, structure: payStructures.name }).from(payAssignments).leftJoin(payStructures, eq(payStructures.id, payAssignments.structureId)).where(eq(payAssignments.userId, userId)).orderBy(desc(payAssignments.fromDate));
      return rows.map((r) => ({ ...r.a, structure: r.structure }));
    });
  }

  async assign(input: unknown): Promise<Assignment> {
    this.authorize("manage", "write");
    const d = this.parse(assignInput, input);
    try {
      return await this.write("manage", async (tx) => {
        await this.check(tx, [d.userId], d.structureId);
        await this.notSelf(tx, d.userId, "change your own pay");
        const [row] = await tx.insert(payAssignments).values({ schoolId: this.ctx.schoolId, ...d, createdBy: this.ctx.userId }).returning();
        return row!;
      }, (r) => ({ action: "create", entity: "PayAssignment", entityId: r.id, summary: `Set pay from ${r.fromDate}${r.fromDate > todayIST() ? " (future)" : ""}`, meta: { userId: r.userId, grossPaise: r.grossPaise } }));
    } catch (e) { return rethrowUnique(e, "This person already has a pay change on that date. Pick another date."); }
  }

  private async check(tx: Tx, userIds: string[], structureId: string) {
    const [s] = await tx.select().from(payStructures).where(eq(payStructures.id, structureId));
    if (!s || !s.isActive) throw new ConflictError("That pay structure is not in use. Pick another.");
    const have = await tx.select({ id: staffProfiles.userId }).from(staffProfiles).where(inArray(staffProfiles.userId, userIds));
    if (have.length !== new Set(userIds).size) throw new NotFoundError("Person");
  }

  /** A raise for many people by a percent: with `preview` nothing is saved. Each keeps their structure; the amount is rounded to a whole rupee. */
  async bulkRaise(input: unknown, o: { preview: boolean }): Promise<{ rows: RaiseRow[]; skipped: { name: string; why: string }[] }> {
    this.authorize("manage", "write");
    const d = this.parse(bulkRaiseInput, input);
    return this.write("manage", async (tx) => {
      const people = [...(await this.people(tx)).values()].filter((p) => !p.left && (!d.userIds || d.userIds.includes(p.id)) && (!d.department || p.department === d.department));
      const all = people.length ? await tx.select().from(payAssignments).where(and(inArray(payAssignments.userId, people.map((p) => p.id)), lte(payAssignments.fromDate, d.fromDate))).orderBy(desc(payAssignments.fromDate)) : [];
      const rows: RaiseRow[] = [], skipped: { name: string; why: string }[] = [], fresh: (typeof payAssignments.$inferInsert)[] = [];
      for (const p of people) {
        if (p.id === this.ctx.userId) { skipped.push({ name: p.name, why: "You cannot raise your own pay here. Change it from your pay details page." }); continue; }
        const cur = all.find((a) => a.userId === p.id);
        if (!cur) { skipped.push({ name: p.name, why: "No pay set up" }); continue; }
        if (cur.fromDate === d.fromDate) { skipped.push({ name: p.name, why: "Already has a change on that date" }); continue; }
        const next = wholeRupee(Math.round((Number(cur.grossPaise) * (10_000 + d.percentBp)) / 10_000));
        rows.push({ userId: p.id, name: p.name, oldPaise: Number(cur.grossPaise), newPaise: next });
        fresh.push({ schoolId: this.ctx.schoolId, userId: p.id, structureId: cur.structureId, grossPaise: next, fromDate: d.fromDate, hourlyPaise: cur.hourlyPaise == null ? null : wholeRupee(Math.round((Number(cur.hourlyPaise) * (10_000 + d.percentBp)) / 10_000)), overrides: {}, reason: `Raise of ${d.percentBp / 100}%`, createdBy: this.ctx.userId });
      }
      if (!o.preview && fresh.length) await tx.insert(payAssignments).values(fresh);
      if (!o.preview) await this.audit(tx, { action: "bulk_raise", entity: "PayAssignment", summary: `Raised pay by ${d.percentBp / 100}% for ${rows.length} people from ${d.fromDate}`, meta: { count: rows.length } });
      return { rows, skipped };
    });
  }

  /** Check a sheet (employee_id, structure, gross, from_date, hourly_rate in rupees) and, with `commit`, save it only if every row is right. */
  async importSheet(file: { name: string; bytes: Uint8Array }, o: { commit: boolean }): Promise<ImportReport> {
    this.authorize("manage", "write");
    let sheet;
    try { sheet = await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }, e.message); throw e; }
    return this.write("manage", async (tx) => {
      const [staff, structures] = await Promise.all([
        tx.select({ id: staffProfiles.userId, emp: staffProfiles.employeeId }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId)),
        tx.select().from(payStructures).where(eq(payStructures.isActive, true)),
      ]);
      const report: ImportReport = { rows: [], ok: 0, failed: 0 };
      const good: (typeof payAssignments.$inferInsert)[] = [];
      const seen = new Set<string>();
      sheet.rows.forEach((r, i) => {
        const fail = (error: string) => { report.rows.push({ line: sheet.lines[i]!, employeeId: r.employee_id ?? "", ok: false, error }); report.failed++; };
        const person = staff.find((s) => s.emp.toLowerCase() === (r.employee_id ?? "").toLowerCase());
        const structure = structures.find((s) => s.name.toLowerCase() === (r.structure ?? "").toLowerCase());
        const from = day.safeParse(r.from_date), gross = Number(r.gross), hourly = r.hourly_rate ? Number(r.hourly_rate) : null;
        if (!person) return fail("No staff member with this employee ID.");
        if (person.id === this.ctx.userId) return fail("You cannot change your own pay. Ask another admin or accountant to import it.");
        if (!structure) return fail("No pay structure with this name.");
        if (!from.success) return fail("from_date must look like 2026-12-01.");
        if (!(gross >= 0) || (hourly !== null && !(hourly >= 0))) return fail("gross and hourly_rate must be amounts in rupees.");
        if (seen.has(`${person.id}|${from.data}`)) return fail("The same person and date appear twice.");
        seen.add(`${person.id}|${from.data}`);
        good.push({ schoolId: this.ctx.schoolId, userId: person.id, structureId: structure.id, grossPaise: Math.round(gross * 100), hourlyPaise: hourly ? Math.round(hourly * 100) : null, fromDate: from.data, overrides: {}, reason: "Imported", createdBy: this.ctx.userId });
        report.rows.push({ line: sheet.lines[i]!, employeeId: r.employee_id!, ok: true }); report.ok++;
      });
      if (o.commit && !report.failed && good.length) {
        try { await tx.insert(payAssignments).values(good); } catch (e) { return rethrowUnique(e, "One of these people already has a pay change on that date."); }
        await this.audit(tx, { action: "import", entity: "PayAssignment", summary: `Imported pay for ${good.length} people`, meta: { count: good.length } });
      }
      return report;
    });
  }
}
