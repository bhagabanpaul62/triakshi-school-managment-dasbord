import { and, asc, count, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { schools, type Tx } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { commDeliveries, notifications } from "@smw/feature-notifications/schema";
import { PdfBuilder, services } from "@smw/integrations";
import { dateTime } from "@smw/ui/format";
import { answerText } from "./answer";
import { NoticeBase } from "./base";
import { NUDGE_GAP_MS, type Answer } from "./constants";
import type { Notice } from "./content";
import { tell } from "./fan-out";
import { peopleInput, type PeopleQuery } from "./inputs";
import { announcementRecipients, announcementResponses } from "./schema";

export interface Funnel { recipients: number; reached: number; seen: number; answered: number; yes: number; no: number; other: number; notAnswered: number; onPaper: number; late: number }
export interface Channel { state: string; reason: string | null }
export interface PersonRow {
  recipientId: string; name: string; label: string; sectionId: string | null; hasLogin: boolean; joinedLate: boolean; reached: boolean; seenAt: Date | null;
  answer: Answer | null; answerText: string; onPaper: boolean; hasSlip: boolean; byName: string | null; byRelation: string | null; answeredAt: Date | null;
  /** Result per channel of the newest notification: null = nothing was planned (switched off, or no login). */
  channels: { push: Channel | null; email: Channel | null };
}
export interface SectionRow { sectionId: string | null; label: string; recipients: number; seen: number; answered: number }

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
/** People we know a push or email reached. One uncorrelated set, built once and hashed, so the report stays linear in the recipients. */
const sentTo = (noticeId: string) => sql`coalesce(${announcementRecipients.userId} in (select n.user_id from notifications n join comm_deliveries d on d.notification_id = n.id
  where n.subject_type = 'notice' and n.subject_id = ${noticeId} and d.state = 'sent'), false)`;
const NO_ONE = "00000000-0000-0000-0000-000000000000";
const SENT_STATES = ["sending", "published", "expired", "withdrawn"];

/**
 * Who has been reached, who has opened and who has answered. "Reached" means we know it got there: opened, or a push or email was sent.
 * For the writer and managers only; never in a support session.
 */
export class ReportService extends NoticeBase {
  private async notice(tx: Tx, id: string): Promise<Notice> {
    this.noSupport();
    this.staffOnly();
    const n = await this.find(tx, id);
    this.own(n);
    // "Reached" joins 12,000 notifications to their deliveries once; right after a send the planner has no statistics yet and picks a nested loop, which is quadratic.
    await tx.execute(sql`set local enable_nestloop = off`);
    if (!SENT_STATES.includes(n.state)) throw new ConflictError("This notice has not been sent yet, so there is no report.");
    return n;
  }

  private reached(noticeId: string) { return sql<boolean>`(${announcementRecipients.seenAt} is not null or ${sentTo(noticeId)})`; }
  private live(noticeId: string) { return and(eq(announcementRecipients.announcementId, noticeId), isNull(announcementRecipients.removedAt)); }

  async funnel(id: string): Promise<Funnel> {
    return this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const [r] = await tx.select({
        recipients: count(), reached: sql<number>`count(*) filter (where ${this.reached(n.id)})::int`, seen: sql<number>`count(*) filter (where ${announcementRecipients.seenAt} is not null)::int`,
        answered: sql<number>`count(${announcementResponses.id})::int`,
        yes: sql<number>`count(*) filter (where ${announcementResponses.answer}->>'kind' = 'consent' and (${announcementResponses.answer}->>'yes')::boolean)::int`,
        no: sql<number>`count(*) filter (where ${announcementResponses.answer}->>'kind' = 'consent' and not (${announcementResponses.answer}->>'yes')::boolean)::int`,
        onPaper: sql<number>`count(*) filter (where ${announcementResponses.onPaper})::int`,
      }).from(announcementRecipients).leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id)).where(this.live(n.id));
      const f = r!, recipients = Number(f.recipients), answered = Number(f.answered), yes = Number(f.yes), no = Number(f.no);
      const asks = n.response.kind !== "none";
      return {
        recipients, reached: Number(f.reached), seen: Number(f.seen), answered, yes, no, other: answered - yes - no, notAnswered: asks ? recipients - answered : 0, onPaper: Number(f.onPaper),
        late: asks && n.dueAt && n.dueAt.getTime() < Date.now() ? recipients - answered : 0,
      };
    });
  }

  private filterOf(n: Notice, q: ReturnType<typeof peopleInput.parse>): SQL | undefined {
    const f = q.filter;
    return and(this.live(n.id), q.sectionId ? eq(announcementRecipients.sectionId, q.sectionId) : undefined, q.q ? ilike(announcementRecipients.name, `%${q.q}%`) : undefined,
      f === "unseen" ? isNull(announcementRecipients.seenAt) : undefined, f === "unanswered" ? isNull(announcementResponses.id) : undefined,
      f === "answered" ? sql`${announcementResponses.id} is not null` : undefined, f === "unreached" ? sql`not ${this.reached(n.id)}` : undefined);
  }

  /** One page of people with their seen time, answer and the result per channel. */
  async people(id: string, query: PeopleQuery = {}): Promise<{ rows: PersonRow[]; total: number; page: number; pageSize: number; pageCount: number }> {
    const q = this.parse(peopleInput, query);
    return this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const where = this.filterOf(n, q);
      const [rows, total] = await Promise.all([
        this.page(tx, n, where, q.pageSize, (q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(announcementRecipients).leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id)).where(where),
      ]);
      const t = Number(total[0]?.n ?? 0);
      return { rows, total: t, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(t / q.pageSize)) };
    });
  }

  private async page(tx: Tx, n: Notice, where: SQL | undefined, limit: number, offset: number): Promise<PersonRow[]> {
    const showSeen = (await this.settings(tx)).showStaffSeen;
    const found = await tx.select({ r: announcementRecipients, a: announcementResponses, reached: this.reached(n.id) }).from(announcementRecipients)
      .leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id)).where(where)
      .orderBy(asc(announcementRecipients.label), asc(announcementRecipients.name), asc(announcementRecipients.id)).limit(limit).offset(offset);
    const users = [...new Set(found.flatMap(({ r }) => (r.userId ? [r.userId] : [])))];
    const sent = users.length ? await tx.select({ userId: notifications.userId, channel: commDeliveries.channel, state: commDeliveries.state, reason: commDeliveries.reason, at: commDeliveries.createdAt })
      .from(notifications).innerJoin(commDeliveries, eq(commDeliveries.notificationId, notifications.id))
      .where(and(eq(notifications.subjectType, "notice"), eq(notifications.subjectId, n.id), inArray(notifications.userId, users))).orderBy(asc(commDeliveries.createdAt)) : [];
    const last = new Map<string, Channel>();
    for (const s of sent) last.set(`${s.userId}:${s.channel}`, { state: s.state, reason: s.reason });
    return found.map(({ r, a, reached }): PersonRow => ({
      recipientId: r.id, name: r.name, label: r.label, sectionId: r.sectionId, hasLogin: !!r.userId, joinedLate: r.joinedLate, reached: !!reached,
      seenAt: !showSeen && !r.studentId ? null : r.seenAt, answer: a?.answer ?? null, answerText: answerText(a?.answer), onPaper: !!a?.onPaper, hasSlip: !!a?.fileKey,
      byName: a?.byName ?? null, byRelation: a?.byRelation ?? null, answeredAt: a?.updatedAt ?? null,
      channels: { push: (r.userId && last.get(`${r.userId}:push`)) || null, email: (r.userId && last.get(`${r.userId}:email`)) || null },
    }));
  }

  /** The summary by class and section. Staff are one group. */
  async bySection(id: string): Promise<SectionRow[]> {
    return this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const label = sql<string>`case when ${announcementRecipients.studentId} is null then 'Staff' else ${announcementRecipients.label} end`;
      const rows = await tx.select({ sectionId: announcementRecipients.sectionId, label,
        recipients: count(), seen: sql<number>`count(${announcementRecipients.seenAt})::int`, answered: sql<number>`count(${announcementResponses.id})::int` })
        .from(announcementRecipients).leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id)).where(this.live(n.id))
        .groupBy(announcementRecipients.sectionId, label).orderBy(label);
      return rows.map((r) => ({ ...r, recipients: Number(r.recipients), seen: Number(r.seen), answered: Number(r.answered) }));
    });
  }

  /** Everyone, as a spreadsheet. */
  async csv(id: string): Promise<{ csv: string; fileName: string }> {
    return this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const lines = [["Name", "Class", "Has login", "Reached", "Opened", "Answer", "Answered by", "Relation", "On paper", "Answered at", "Push", "Email", "Why not sent"]];
      for (let offset = 0; ; offset += 1000) {
        const part = await this.page(tx, n, this.live(n.id), 1000, offset);
        for (const p of part) {
          lines.push([p.name, p.label, p.hasLogin ? "Yes" : "No", p.reached ? "Yes" : "No", p.seenAt ? dateTime(p.seenAt) : "", p.answerText, p.byName ?? "", p.byRelation ?? "", p.onPaper ? "Yes" : "",
            p.answeredAt ? dateTime(p.answeredAt) : "", p.channels.push?.state ?? "", p.channels.email?.state ?? "", [p.channels.push?.reason, p.channels.email?.reason].filter(Boolean).join("; ") || (p.hasLogin ? "" : "No login yet")]);
        }
        if (part.length < 1000) break;
      }
      const slug = n.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "notice";
      return { csv: lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n", fileName: `notice-${slug}.csv` };
    });
  }

  /** A 60-second link to the picture of a paper slip. */
  async slipUrl(id: string, recipientId: string): Promise<string> {
    return this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const [a] = await tx.select({ k: announcementResponses.fileKey }).from(announcementResponses).innerJoin(announcementRecipients, eq(announcementRecipients.id, announcementResponses.recipientId))
        .where(and(eq(announcementRecipients.id, recipientId), eq(announcementRecipients.announcementId, n.id)));
      if (!a?.k) throw new ConflictError("There is no slip for this person.");
      return services().storage.signedUrl(a.k, 60);
    });
  }

  /** Remind people who have not answered. A person is reminded at most once in 24 hours, whoever sends it (a button or the daily job). */
  async nudge(id: string): Promise<{ sent: number; alreadyToday: number }> {
    return this.write("read", async (tx) => {
      const n = await this.notice(tx, id);
      if (n.state !== "published" || n.response.kind === "none") throw new ConflictError("There is nothing to answer on this notice.");
      if (n.dueAt && n.dueAt.getTime() < Date.now()) throw new ConflictError("The last date has passed, so answers are locked.");
      const out = await remindUnanswered(tx, this.ctx.schoolId, n);
      await this.audit(tx, { action: "nudge", entity: "Notice", entityId: n.id, summary: `Reminded ${out.sent} people to answer "${n.title}"` });
      return out;
    });
  }

  /** Remind only these people (the ones ticked in the table), under the same once-a-day rule. */
  async nudgeSome(id: string, recipientIds: string[]): Promise<{ sent: number; alreadyToday: number }> {
    return this.write("read", async (tx) => {
      const n = await this.notice(tx, id);
      if (n.state !== "published" || n.response.kind === "none") throw new ConflictError("There is nothing to answer on this notice.");
      if (n.dueAt && n.dueAt.getTime() < Date.now()) throw new ConflictError("The last date has passed, so answers are locked.");
      const out = await remindUnanswered(tx, this.ctx.schoolId, n, new Date(), recipientIds);
      await this.audit(tx, { action: "nudge", entity: "Notice", entityId: n.id, summary: `Reminded ${out.sent} chosen people to answer "${n.title}"` });
      return out;
    });
  }

  /** Tell again the people who have not opened it (`unseen`) or who we cannot show was delivered (`unreached`). People with no login need the sign sheet. */
  async resend(id: string, to: "unseen" | "unreached"): Promise<{ sent: number; noLogin: number }> {
    return this.write("read", async (tx) => {
      const n = await this.notice(tx, id);
      if (n.state !== "published") throw new ConflictError("Only a notice that is out can be sent again.");
      const people = await tx.select({ userId: announcementRecipients.userId, studentId: announcementRecipients.studentId }).from(announcementRecipients).where(and(this.live(n.id),
        isNull(announcementRecipients.seenAt), to === "unreached" ? sql`not ${this.reached(n.id)}` : undefined));
      const ids = people.flatMap((p) => (p.userId && p.userId !== n.createdBy ? [p.userId] : []));
      const sent = await tell(tx, this.ctx.schoolId, n, ids, "new");
      await this.audit(tx, { action: "resend", entity: "Notice", entityId: n.id, summary: `Sent "${n.title}" again to ${sent} people who had not ${to === "unseen" ? "opened" : "received"} it` });
      return { sent, noLogin: people.filter((p) => !p.userId).length };
    });
  }

  /** A printable sheet for the people we cannot reach in the app: name, class and a line to sign. */
  async signSheetPdf(id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const { n, school, people } = await this.read("read", async (tx) => {
      const n = await this.notice(tx, id);
      const [school] = await tx.select({ name: schools.name }).from(schools).limit(1);
      const people: PersonRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const part = await this.page(tx, n, and(this.live(n.id), sql`not ${this.reached(n.id)}`), 1000, offset);
        people.push(...part);
        if (part.length < 1000) break;
      }
      return { n, school, people };
    });
    const pdf = await PdfBuilder.create({ unicode: true });
    await pdf.need([school?.name ?? "", n.title, ...people.flatMap((p) => [p.name, p.label])]);
    pdf.header({ orgName: school?.name ?? "School", title: "Sign sheet", rightLines: [n.number ?? "Notice", dateTime(n.publishedAt)] });
    pdf.text(n.title, { size: 12, bold: true });
    pdf.text("I have read this notice.", { size: 9 });
    pdf.space(6);
    if (!people.length) pdf.text("Everyone has been reached.");
    else pdf.table({ columns: [{ label: "Name", width: 170 }, { label: "Class", width: 90 }, { label: "Signature", width: 170 }, { label: "Date", width: 70 }], rows: people.map((p) => [p.name, p.label, "", ""]) });
    return { bytes: await pdf.save(), fileName: `sign-sheet-${n.number?.replace(/\//g, "-") ?? n.id.slice(0, 8)}.pdf` };
  }
}

/** Remind everyone who has not answered and was not reminded in the last 24 hours. Shared by the button and the job. */
export async function remindUnanswered(tx: Tx, schoolId: string, n: Notice, now = new Date(), only?: string[]): Promise<{ sent: number; alreadyToday: number }> {
  const gap = new Date(now.getTime() - NUDGE_GAP_MS);
  const unanswered = and(eq(announcementRecipients.announcementId, n.id), isNull(announcementRecipients.removedAt), sql`${announcementRecipients.userId} is not null`,
    only ? inArray(announcementRecipients.id, only.length ? only : [NO_ONE]) : undefined,
    sql`not exists (select 1 from announcement_responses a where a.recipient_id = ${announcementRecipients.id})`);
  const due = await tx.update(announcementRecipients).set({ nudgedAt: now }).where(and(unanswered, or(isNull(announcementRecipients.nudgedAt), lt(announcementRecipients.nudgedAt, gap))))
    .returning({ userId: announcementRecipients.userId });
  const [again] = await tx.select({ n: count() }).from(announcementRecipients).where(and(unanswered, gte(announcementRecipients.nudgedAt, gap)));
  const sent = await tell(tx, schoolId, n, due.flatMap((d) => (d.userId ? [d.userId] : [])), n.dueAt && n.dueAt <= now ? "late" : "remind", { now });
  return { sent, alreadyToday: Math.max(0, Number(again?.n ?? 0) - due.length) };
}
