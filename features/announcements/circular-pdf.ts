// The circular on the school's letterhead, and the register of every number.
import { and, asc, eq, sql } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { schools, users } from "@smw/db";
import { ConflictError, ForbiddenError } from "@smw/feature-kit";
import { PdfBuilder } from "@smw/integrations";
import { dateTime } from "@smw/ui/format";
import { markdownToText } from "@smw/ui/markdown";
import { NoticeBase } from "./base";
import type { NoticeState } from "./constants";
import { sessionName } from "./lifecycle";
import { announcementCategories, announcements } from "./schema";
import { verifyToken } from "./verify";

export interface RegisterRow { id: string; number: string; title: string; state: NoticeState; date: Date | null; authorName: string | null; categoryName: string | null; withdrawReason: string | null }
const SENT = ["sending", "published", "expired", "withdrawn"];
const SLUG = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export class CircularService extends NoticeBase {
  /** The circular as a PDF with its number, date, category, signature block and a QR that opens the "this is genuine" page. */
  async pdf(id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const d = await this.read("read", async (tx) => {
      const n = await this.find(tx, id);
      if (n.type !== "circular" || !n.number || !SENT.includes(n.state)) throw new ConflictError("Only a circular that has been sent has a PDF.");
      const [[school], [cat], [author]] = await Promise.all([
        tx.select().from(schools).limit(1),
        n.categoryId ? tx.select({ name: announcementCategories.name }).from(announcementCategories).where(eq(announcementCategories.id, n.categoryId)) : Promise.resolve([]),
        n.createdBy ? tx.select({ name: users.name }).from(users).where(eq(users.id, n.createdBy)) : Promise.resolve([]),
      ]);
      return { n, number: n.number, school: school!, category: cat?.name ?? "General", author: author?.name ?? "" };
    });
    const { n, number, school, category, author } = d;
    const verify = schoolUrl(school.slug, `/verify/circular/${verifyToken(this.ctx.schoolId, n.id)}`);
    const text = markdownToText(n.body);
    const contact = [school.address, [school.phone, school.email].filter(Boolean).join("  ")].filter((x): x is string => !!x);
    const pdf = await PdfBuilder.create({ unicode: true });
    await pdf.need([school.name, ...contact, n.title, text, category, author, n.audienceLabel, number, "Circular"]);
    pdf.header({ orgName: school.name, orgLines: contact, title: "Circular", rightLines: [number, dateTime(n.publishedAt)] });
    if (n.state === "withdrawn") pdf.text(`WITHDRAWN: ${n.withdrawReason ?? ""}`, { bold: true, color: [0.7, 0.1, 0.1] });
    pdf.facts([["Category", category], ["To", n.audienceLabel || "All"]]);
    pdf.text(n.title, { size: 14, bold: true, gap: 8 });
    for (const line of pdf.wrap(text, pdf.right - pdf.left, 10.5)) pdf.text(line, { size: 10.5, gap: 5 });
    pdf.space(24);
    pdf.ensure(110);
    const top = pdf.cursor;
    pdf.qr(verify, { x: pdf.right - 84, top, size: 84 });
    pdf.text("Signed", { size: 9, color: [0.4, 0.4, 0.45] });
    pdf.space(26);
    pdf.rule();
    pdf.text(author, { bold: true });
    pdf.text(school.name, { size: 9 });
    pdf.cursor = top - 90;
    pdf.text("Scan to check that this circular is genuine.", { size: 8, color: [0.4, 0.4, 0.45], x: pdf.right - 210 });
    return { bytes: await pdf.save(), fileName: `circular-${SLUG(number)}.pdf` };
  }

  private canSeeRegister() { if (!(this.isManager || this.can("approve"))) throw new ForbiddenError(); }

  /** Every circular number of a session, withdrawn ones included, so the numbers show no gap. */
  async register(session?: string): Promise<{ session: string; rows: RegisterRow[] }> {
    this.staffOnly();
    this.canSeeRegister();
    return this.read("read", async (tx) => {
      const name = session ?? await sessionName(tx);
      const [year] = [...(await tx.execute(sql`select starts_on::text as a, ends_on::text as b from academic_years where name = ${name}`))] as { a: string; b: string }[];
      const when = sql`(coalesce(${announcements.publishedAt}, ${announcements.updatedAt}) at time zone 'Asia/Kolkata')::date`;
      const rows = await tx.select({ n: announcements, cat: announcementCategories.name, author: users.name }).from(announcements)
        .leftJoin(announcementCategories, eq(announcementCategories.id, announcements.categoryId)).leftJoin(users, eq(users.id, announcements.createdBy))
        .where(and(sql`${announcements.number} is not null`, year ? sql`${when} between ${year.a}::date and ${year.b}::date` : undefined))
        .orderBy(asc(announcements.publishedAt), asc(announcements.number));
      return { session: name, rows: rows.map(({ n, cat, author }) => ({ id: n.id, number: n.number!, title: n.title, state: n.state, date: n.publishedAt, authorName: author, categoryName: cat, withdrawReason: n.withdrawReason })) };
    });
  }

  /** Session names that have a circular, newest first, with the current one always first. */
  async sessions(): Promise<string[]> {
    this.staffOnly();
    this.canSeeRegister();
    return this.read("read", async (tx) => {
      const names = [...(await tx.execute(sql`select name from academic_years order by starts_on desc`))] as { name: string }[];
      return [...new Set([await sessionName(tx), ...names.map((y) => y.name)])];
    });
  }

  async registerPdf(session?: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const reg = await this.register(session);
    const school = await this.read("read", async (tx) => (await tx.select({ name: schools.name }).from(schools).limit(1))[0]);
    const pdf = await PdfBuilder.create({ unicode: true });
    await pdf.need([school?.name ?? "", ...reg.rows.flatMap((r) => [r.title, r.authorName ?? "", r.categoryName ?? ""])]);
    pdf.header({ orgName: school?.name ?? "School", title: "Circular register", rightLines: [`Session ${reg.session}`] });
    if (!reg.rows.length) pdf.text("No circulars yet.");
    else pdf.table({
      columns: [{ label: "Number", width: 105 }, { label: "Date", width: 70 }, { label: "Title", width: 190 }, { label: "Category", width: 70 }, { label: "State", width: 64 }],
      rows: reg.rows.map((r) => [r.number, r.date ? dateTime(r.date).split(",")[0]! : "-", r.title.slice(0, 48), r.categoryName ?? "", r.state === "withdrawn" ? "Withdrawn" : r.state === "expired" ? "Expired" : "Sent"]),
    });
    return { bytes: await pdf.save(), fileName: `circular-register-${SLUG(reg.session)}.pdf` };
  }
}
