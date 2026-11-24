import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, rethrowUnique } from "@smw/feature-kit";
import { flag } from "@smw/feature-finance/services/common";
import { PayrollService } from "../base";
import { COMPONENT_KINDS, COMPONENT_MODES } from "../constants";
import { finAccounts } from "@smw/feature-finance/schema";
import { payAssignments, payComponents, payStructures } from "../schema";

export type Structure = typeof payStructures.$inferSelect;
export type Component = typeof payComponents.$inferSelect;

const component = z.object({
  label: z.string().trim().min(1, "Name the component.").max(60),
  kind: z.enum(COMPONENT_KINDS),
  mode: z.enum(COMPONENT_MODES),
  /** Paise for fixed, basis points for percent; a remainder has none. */
  value: z.coerce.number().int().min(0).max(100_000_000_00).default(0),
  isBasic: flag, isWage: flag, proRata: flag.default(true), taxable: flag.default(true),
  /** A liability account where a deduction or employer cost waits until it is paid out. */
  accountId: z.uuid().nullish().transform((v) => v ?? null),
});
export const structureInput = z.object({ name: z.string().trim().min(1, "Name the structure.").max(60), components: z.array(component).max(30) })
  .superRefine((s, ctx) => {
    const earn = s.components.filter((c) => c.kind === "earning");
    const bad = (message: string) => ctx.addIssue({ code: "custom", path: ["components"], message });
    if (earn.filter((c) => c.isBasic).length > 1) bad("Only one component can be the basic.");
    if (earn.filter((c) => c.mode === "remainder").length > 1) bad("Only one component can be the remainder.");
    if (s.components.some((c) => c.kind !== "earning" && c.mode === "remainder")) bad("Only an earning can be the remainder.");
    if (earn.some((c) => c.isBasic && (c.mode === "percent_of_basic" || c.mode === "remainder"))) bad("The basic is a fixed amount or a share of gross.");
    if (s.components.some((c) => c.mode === "percent_of_basic") && !earn.some((c) => c.isBasic)) bad("A share of basic needs a basic component.");
    if (s.components.some((c) => c.mode.startsWith("percent") && c.value > 10_000)) bad("A share cannot be more than 100%.");
    if (new Set(s.components.map((c) => `${c.kind}|${c.label.toLowerCase()}`)).size !== s.components.length) bad("Two components have the same name.");
  });

export class StructureService extends PayrollService {
  list(): Promise<(Structure & { components: number; people: number })[]> {
    return this.read("read", async (tx) => {
      const [rows, comps, used] = await Promise.all([
        tx.select().from(payStructures).orderBy(asc(payStructures.name)),
        tx.select({ id: payComponents.structureId, n: count() }).from(payComponents).groupBy(payComponents.structureId),
        tx.select({ id: payAssignments.structureId, n: count() }).from(payAssignments).groupBy(payAssignments.structureId),
      ]);
      return rows.map((s) => ({ ...s, components: comps.find((c) => c.id === s.id)?.n ?? 0, people: used.find((u) => u.id === s.id)?.n ?? 0 }));
    });
  }

  /** Liability accounts a deduction or employer cost can be held in until it is paid out. */
  heldAccounts(): Promise<{ id: string; name: string }[]> {
    return this.read("read", (tx) => tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts).where(and(eq(finAccounts.type, "liability"), eq(finAccounts.isActive, true))).orderBy(finAccounts.code));
  }

  get(id: string): Promise<{ structure: Structure; components: Component[]; people: number }> {
    return this.read("read", async (tx) => {
      const [structure] = await tx.select().from(payStructures).where(eq(payStructures.id, id));
      if (!structure) throw new NotFoundError("Structure");
      const [components, [used]] = await Promise.all([tx.select().from(payComponents).where(eq(payComponents.structureId, id)).orderBy(asc(payComponents.sort)), tx.select({ n: count() }).from(payAssignments).where(eq(payAssignments.structureId, id))]);
      return { structure, components, people: Number(used?.n ?? 0) };
    });
  }

  /** Make a structure, or replace the components of one nobody is paid by yet. A structure in use is changed by copying it. */
  async save(input: unknown, id?: string): Promise<Structure> {
    this.authorize("manage", "write");
    const d = this.parse(structureInput, input);
    try {
      return await this.write("manage", async (tx) => {
        const held = [...new Set(d.components.map((c) => c.accountId).filter((x): x is string => !!x))];
        if (held.length && (await tx.select({ id: finAccounts.id }).from(finAccounts).where(and(inArray(finAccounts.id, held), eq(finAccounts.type, "liability")))).length !== held.length) throw new ValidationError({ components: "Pick a liability account of this school to hold the amount." });
        let s: Structure | undefined;
        if (id) {
          const [have] = await tx.select().from(payStructures).where(eq(payStructures.id, id)).for("update");
          if (!have) throw new NotFoundError("Structure");
          const [used] = await tx.select({ n: count() }).from(payAssignments).where(eq(payAssignments.structureId, id));
          if (Number(used?.n)) throw new ConflictError(`${Number(used!.n)} pay assignments use this structure. Copy it and change the copy; people move over from their pay page.`);
          [s] = await tx.update(payStructures).set({ name: d.name }).where(eq(payStructures.id, id)).returning();
          await tx.delete(payComponents).where(eq(payComponents.structureId, id));
        } else [s] = await tx.insert(payStructures).values({ schoolId: this.ctx.schoolId, name: d.name }).returning();
        if (d.components.length) await tx.insert(payComponents).values(d.components.map((c, sort) => ({ schoolId: this.ctx.schoolId, structureId: s!.id, sort, ...c })));
        if (!s) throw new NotFoundError("Structure");
        const made = s;
        return made;
      }, (s) => ({ action: id ? "update" : "create", entity: "PayStructure", entityId: s.id, summary: `${id ? "Changed" : "Added"} pay structure ${s.name}` }));
    } catch (e) { return rethrowUnique(e, "A structure with this name already exists."); }
  }

  /** A new structure with the same components, so the original stays as people were paid by it. */
  async copy(id: string): Promise<Structure> {
    this.authorize("manage", "write");
    const { structure, components } = await this.get(id);
    const names = new Set((await this.list()).map((s) => s.name));
    let n = 2;
    while (names.has(`${structure.name} v${n}`)) n++;
    return this.save({ name: `${structure.name} v${n}`, components: components.map(({ label, kind, mode, value, isBasic, isWage, proRata, taxable, accountId }) => ({ label, kind, mode, value: Number(value), isBasic, isWage, proRata, taxable, accountId })) });
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.write("manage", async (tx) => { await tx.update(payStructures).set({ isActive: active }).where(eq(payStructures.id, id)); }, () => ({ action: "update", entity: "PayStructure", entityId: id, summary: active ? "Switched a structure on" : "Switched a structure off" }));
  }

  async remove(id: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [used] = await tx.select({ n: count() }).from(payAssignments).where(inArray(payAssignments.structureId, [id]));
      if (Number(used?.n)) throw new ConflictError("People are paid by this structure, so it cannot be deleted. Switch it off instead.");
      if (!(await tx.delete(payStructures).where(eq(payStructures.id, id)).returning()).length) throw new NotFoundError("Structure");
    }, () => ({ action: "delete", entity: "PayStructure", entityId: id, summary: "Deleted a pay structure" }));
  }
}
