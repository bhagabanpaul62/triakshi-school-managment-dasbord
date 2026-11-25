// The enquiry desk's own rules: sources, reasons, messages, who owns new enquiries, targets, keeping time, seats per class.
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { ValidationError, type Ctx } from "@smw/feature-kit";
import { EnquiryBase, doomedWhere, loadEnquirySettings, enquirySettingsSchema, type EnquirySettings } from "./enquiry-core";
import { seatsInput } from "./enquiry-inputs";
import { enquirySeats, enquirySettings, enquiries } from "./schema";

export class EnquirySettingsService extends EnquiryBase {
  constructor(ctx: Ctx) { super(ctx); }

  /** Whoever works enquiries may read them (the forms need the sources and messages). */
  get(): Promise<EnquirySettings> { return this.read("enquiries", loadEnquirySettings); }

  /** Takes the fields that changed; the rest stay. Every owner named must be somebody who works enquiries. */
  async save(input: unknown): Promise<EnquirySettings> {
    this.authorize("pipeline", "write");
    return this.write("pipeline", async (tx) => {
      const before = await loadEnquirySettings(tx);
      const { confirmRetention, ...given } = input as Record<string, unknown>;
      const next = this.parse(enquirySettingsSchema, { ...before, ...given });
      if (next.keepMonths < before.keepMonths) {
        const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(enquiries).where(doomedWhere(next.keepMonths, new Date())))[0]!.n;
        if (n > 0 && !(confirmRetention === true || confirmRetention === "true")) throw new ValidationError({ keepMonths: `${n} enquir${n === 1 ? "y" : "ies"} would be deleted at the next daily run. Tick the box to confirm.` });
      }
      const keys = next.templates.map((t) => t.key);
      if (new Set(keys).size !== keys.length) throw new ValidationError({ templates: "Two messages have the same short name" });
      const holders = new Set(await this.holders(tx));
      if (next.owner.userIds.some((id) => !holders.has(id))) throw new ValidationError({ owner: "Choose people who work with enquiries" });
      if (next.owner.mode !== "none" && !next.owner.userIds.length) throw new ValidationError({ owner: "Choose at least one person" });
      await tx.insert(enquirySettings).values({ schoolId: this.ctx.schoolId, settings: next }).onConflictDoUpdate({ target: enquirySettings.schoolId, set: { settings: next, updatedAt: new Date() } });
      return next;
    }, () => ({ action: "update", entity: "Enquiry settings", summary: "Changed the enquiry settings" }));
  }

  async seats(session?: string) {
    return this.read("enquiries", (tx) => tx.select().from(enquirySeats).where(session ? eq(enquirySeats.session, session) : undefined).orderBy(asc(enquirySeats.session), asc(enquirySeats.className)));
  }

  /** The seats of one session, as the page shows them: classes not listed lose their count. */
  async saveSeats(session: string, input: unknown) {
    this.authorize("pipeline", "write");
    const d = this.parse(seatsInput, input);
    if (d.rows.some((r) => r.session !== session)) throw new ValidationError({ rows: "Every row must be for the same session" });
    return this.write("pipeline", async (tx) => {
      const names = d.rows.map((r) => r.className);
      if (new Set(names).size !== names.length) throw new ValidationError({ rows: "A class is listed twice" });
      await tx.delete(enquirySeats).where(and(eq(enquirySeats.session, session), names.length ? notInArray(enquirySeats.className, names) : undefined));
      for (const r of d.rows) {
        await tx.insert(enquirySeats).values({ schoolId: this.ctx.schoolId, session, className: r.className, seats: r.seats })
          .onConflictDoUpdate({ target: [enquirySeats.schoolId, enquirySeats.session, enquirySeats.className], set: { seats: r.seats, updatedAt: new Date() } });
      }
      return d.rows.length;
    }, (n) => ({ action: "update", entity: "Enquiry seats", summary: `Set seats for ${n} classes in ${session}` }));
  }
}
