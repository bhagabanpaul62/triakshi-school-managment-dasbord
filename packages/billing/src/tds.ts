import { schoolUrl } from "@smw/config";
import { and, asc, count, desc, eq, ilike, invoices, isNull, lte, or, schools, tdsCertificates, withConsole, type Tx } from "@smw/db";
import { NotFoundError, PlatformService, ValidationError, ConflictError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { emailHtml, services, UploadError, uploadKey } from "@smw/integrations";
import { z } from "zod";
import { schoolContact } from "./contact";

/** A file as a service receives it: the `File` object stays in the server action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }

export interface TdsRow {
  id: string; schoolId: string; schoolName: string; invoiceId: string; invoiceNumber: string; amountPaise: number; quarter: string; remindOn: string;
  status: "awaited" | "received" | "verified"; fileName: string | null; uploadedAt: Date | null; note: string | null; createdAt: Date;
}

const baseSelect = (tx: Tx) => tx.select({
  id: tdsCertificates.id, schoolId: tdsCertificates.schoolId, schoolName: schools.name, invoiceId: tdsCertificates.invoiceId, invoiceNumber: invoices.number,
  amountPaise: tdsCertificates.amountPaise, quarter: tdsCertificates.quarter, remindOn: tdsCertificates.remindOn, status: tdsCertificates.status,
  fileName: tdsCertificates.fileName, uploadedAt: tdsCertificates.uploadedAt, note: tdsCertificates.note, createdAt: tdsCertificates.createdAt,
}).from(tdsCertificates).innerJoin(schools, eq(schools.id, tdsCertificates.schoolId)).innerJoin(invoices, eq(invoices.id, tdsCertificates.invoiceId));

/**
 * The school's own certificates. Pinned to one school id that PlatformBilling.forAdmin already checked, because the
 * console role that writes here bypasses RLS.
 */
export class TdsCertificates {
  constructor(private readonly schoolId: string) {}

  async upload(certId: string, file: UploadedFile): Promise<void> {
    if (!z.uuid().safeParse(certId).success) throw new NotFoundError("Certificate");
    let key: string;
    try { key = uploadKey(this.schoolId, "tds-certificates", file, "document"); } catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ file: e.message }, e.message);
      throw e;
    }
    const storage = services().storage;
    await storage.put(key, file.bytes, file.type);
    try {
      const old = await withConsole(async (tx) => {
        const [c] = await tx.select().from(tdsCertificates).where(and(eq(tdsCertificates.id, certId), eq(tdsCertificates.schoolId, this.schoolId))).for("update");
        if (!c) throw new NotFoundError("Certificate");
        if (c.status === "verified") throw new ConflictError("This certificate is already verified. Nothing more to upload.");
        await tx.update(tdsCertificates).set({ status: "received", fileKey: key, fileName: file.name, uploadedAt: new Date(), note: null }).where(eq(tdsCertificates.id, c.id));
        return c.fileKey;
      });
      if (old) await storage.delete(old).catch(() => undefined);
    } catch (err) {
      await storage.delete(key).catch(() => undefined); // nothing points at the file, so do not keep it
      throw err;
    }
  }
}

/** Console: the certificates queue and the report of what is still awaited. */
export class TdsService extends PlatformService {
  async list(query: ListQuery = {}): Promise<Page<TdsRow>> {
    const q = listQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const s = (["awaited", "received", "verified"] as const).find((x) => x === q.filters.status);
      const where = and(s ? eq(tdsCertificates.status, s) : undefined, q.q ? or(ilike(schools.name, `%${q.q}%`), ilike(invoices.number, `%${q.q}%`)) : undefined);
      const [rows, total] = await Promise.all([
        baseSelect(tx).where(where).orderBy(asc(tdsCertificates.remindOn), desc(tdsCertificates.createdAt), asc(tdsCertificates.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(tdsCertificates).innerJoin(schools, eq(schools.id, tdsCertificates.schoolId)).innerJoin(invoices, eq(invoices.id, tdsCertificates.invoiceId)).where(where),
      ]);
      return toPage(rows as TdsRow[], Number(total[0]?.n ?? 0), q);
    });
  }

  async verify(id: string) {
    this.require("owner", "sales");
    return this.tx(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== "received") throw new ConflictError(c.status === "verified" ? "This certificate is already verified." : "The school has not uploaded a certificate yet.");
      await tx.update(tdsCertificates).set({ status: "verified", verifiedAt: new Date(), verifiedBy: this.ctx.staffId, note: null }).where(eq(tdsCertificates.id, id));
      await this.audit(tx, "billing.tds_verified", `TDS certificate verified (${c.quarter})`, c.schoolId, { certificateId: id });
      return { id };
    });
  }

  /** The file is wrong: ask the school again, with the reason in front of them. */
  async sendBack(id: string, reason: unknown) {
    this.require("owner", "sales");
    const why = this.parse(z.string().trim().min(3, "Say what is wrong with it").max(300), reason);
    const old = await this.tx(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status === "awaited") throw new ConflictError("Nothing has been uploaded yet.");
      await tx.update(tdsCertificates).set({ status: "awaited", fileKey: null, fileName: null, uploadedAt: null, verifiedAt: null, verifiedBy: null, note: why }).where(eq(tdsCertificates.id, id));
      await this.audit(tx, "billing.tds_sent_back", `TDS certificate sent back (${c.quarter}): ${why}`, c.schoolId, { certificateId: id });
      return c.fileKey;
    });
    if (old) await services().storage.delete(old).catch(() => undefined);
    return { id };
  }

  /** A short-lived link to the school's file, for staff to check. */
  async fileUrl(id: string): Promise<string> {
    const [c] = await this.tx((tx) => tx.select({ key: tdsCertificates.fileKey }).from(tdsCertificates).where(eq(tdsCertificates.id, id)).limit(1));
    if (!c?.key) throw new NotFoundError("Certificate file");
    return services().storage.signedUrl(c.key, 300);
  }

  private async lock(tx: Tx, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Certificate");
    const [c] = await tx.select().from(tdsCertificates).where(eq(tdsCertificates.id, id)).for("update");
    if (!c) throw new NotFoundError("Certificate");
    return c;
  }
}

/** One email per school, 45 days after the quarter ends, for certificates still awaited. Each is claimed once, so a re-run sends nothing new. */
export class TdsReminders {
  async run(now = new Date()): Promise<number> {
    const claimed = await withConsole((tx) => tx.update(tdsCertificates).set({ remindedAt: now })
      .where(and(eq(tdsCertificates.status, "awaited"), isNull(tdsCertificates.remindedAt), lte(tdsCertificates.remindOn, todayIST(now))))
      .returning({ id: tdsCertificates.id, schoolId: tdsCertificates.schoolId, quarter: tdsCertificates.quarter, amountPaise: tdsCertificates.amountPaise }));
    const bySchool = new Map<string, typeof claimed>();
    for (const c of claimed) bySchool.set(c.schoolId, [...(bySchool.get(c.schoolId) ?? []), c]);
    let sent = 0;
    for (const [schoolId, items] of bySchool) {
      try {
        const c = await withConsole((tx) => schoolContact(tx, schoolId));
        if (!c) throw new Error("no contact");
        const list = items.map((i) => `${i.quarter}`).join(", ");
        const subject = `Please upload your TDS certificate for ${c.school.name}`;
        const body = `You paid us after withholding tax (TDS) for ${list}. Please upload the TDS certificate (Form 16A) so we can match it to our records.`;
        const url = schoolUrl(c.school.slug, "/app/billing?tab=payments");
        await services().email.send({ to: c.to, subject, text: `${body}\n\nUpload it here: ${url}`, html: emailHtml(subject, `<p>${body}</p>`, { label: "Upload certificate", url }) });
        sent++;
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "tds reminder failed", err: String(err), school: schoolId }));
        await withConsole((tx) => tx.update(tdsCertificates).set({ remindedAt: null }).where(or(...items.map((i) => eq(tdsCertificates.id, i.id)))!));
      }
    }
    return sent;
  }
}
