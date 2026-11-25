// The school's safety side of messages: concerns, reviews with a typed reason, an append-only review log and restrictions.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { REPORT_STATE_WORDS, RESTRICTION_WORDS, REVIEW_HOURS, type ReportCategory, type ReportState, type RestrictionKind } from "./constants";
import { conversationPdf } from "./conversation-pdf";
import { hasActiveReview, isFamily, istToday, loadThread, noSupport, postSystem, type ThreadData } from "./core";
import messagesFeature from "./feature";
import { handleReportInput, restrictInput, reviewInput } from "./inputs";
import { isNamed } from "./leads";
import { messageRestrictions, messageReports, messageReviews, messageThreads, threadMembers } from "./schema";

type Perm = keyof typeof messagesFeature.permissions;

export interface ReportRow { id: string; state: ReportState; category: ReportCategory; reporter: string; subject: string; studentName: string | null; createdAt: Date; handledAt: Date | null }
export interface ReportDetail extends ReportRow {
  threadId: string; note: string; outcome: string | null; about: string[]; aboutMessage: boolean;
  /** Reviews of this conversation so far. */
  reviews: ReviewRow[];
}
export interface ReviewRow { id: string; threadId: string; subject: string; reviewer: string; reason: string; action: "opened" | "exported"; at: Date; reportId: string | null }
export interface RestrictionRow { id: string; userId: string; name: string; role: string; kind: RestrictionKind; reason: string; until: string; createdAt: Date; active: boolean }

export class SafeguardService extends SchoolService<Perm> {
  protected feature = messagesFeature;
  constructor(ctx: Ctx) { super(ctx); }

  protected authorize(permission: Perm, mode: "read" | "write") {
    noSupport(this.ctx);
    super.authorize(permission, mode);
  }

  /** A report that names me is not mine to see, count or open. */
  private notNamingMe = () => sql`not (${this.ctx.userId}::uuid = any(${messageReports.aboutUserIds}))`;

  // ---------- reports ----------

  async queue(view: "open" | "all" = "open"): Promise<{ rows: ReportRow[]; open: number }> {
    return this.read("safeguard", async (tx) => {
      const base = and(this.notNamingMe());
      const rows = await tx.select({ r: messageReports, subject: messageThreads.subject, studentId: messageThreads.studentId }).from(messageReports)
        .innerJoin(messageThreads, eq(messageThreads.id, messageReports.threadId))
        .where(and(base, view === "open" ? inArray(messageReports.state, ["new", "reviewing"]) : undefined)).orderBy(desc(messageReports.createdAt)).limit(200);
      const kids = rows.some((r) => r.studentId) ? [...(await tx.execute(sql`select id::text as id, name from students where id in (${sql.join(rows.filter((r) => r.studentId).map((r) => sql`${r.studentId}::uuid`), sql`, `)})`))] as { id: string; name: string }[] : [];
      const [open] = [...(await tx.execute(sql`select count(*)::int as n from message_reports where state in ('new', 'reviewing') and not (${this.ctx.userId}::uuid = any(about_user_ids))`))] as { n: number }[];
      return {
        rows: rows.map(({ r, subject, studentId }) => ({ id: r.id, state: r.state, category: r.category as ReportCategory, reporter: r.reporterName, subject, studentName: kids.find((k) => k.id === studentId)?.name ?? null, createdAt: r.createdAt, handledAt: r.handledAt })),
        open: open?.n ?? 0,
      };
    });
  }

  async report(id: string): Promise<ReportDetail> {
    return this.read("safeguard", async (tx) => {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Report");
      const [row] = await tx.select({ r: messageReports, subject: messageThreads.subject, studentId: messageThreads.studentId }).from(messageReports)
        .innerJoin(messageThreads, eq(messageThreads.id, messageReports.threadId)).where(and(eq(messageReports.id, id), this.notNamingMe()));
      if (!row) throw new NotFoundError("Report");
      const names = row.r.aboutUserIds.length ? await tx.select({ name: threadMembers.name }).from(threadMembers).where(and(eq(threadMembers.threadId, row.r.threadId), inArray(threadMembers.userId, row.r.aboutUserIds))) : [];
      const [kid] = row.studentId ? [...(await tx.execute(sql`select name from students where id = ${row.studentId}::uuid`))] as { name: string }[] : [];
      return {
        id: row.r.id, state: row.r.state, category: row.r.category as ReportCategory, reporter: row.r.reporterName, subject: row.subject, studentName: kid?.name ?? null,
        createdAt: row.r.createdAt, handledAt: row.r.handledAt, threadId: row.r.threadId, note: row.r.note, outcome: row.r.outcome, about: names.map((n) => n.name),
        aboutMessage: !!row.r.messageId, reviews: await this.reviews(tx, row.r.threadId),
      };
    });
  }

  /** Move a report along and tell the reporter in plain words. A report that needed no action releases the hold when nothing else is open. */
  async handle(input: unknown): Promise<void> {
    this.authorize("safeguard", "write");
    const data = this.parse(handleReportInput, input);
    await this.write("safeguard", async (tx) => {
      const [r] = await tx.select().from(messageReports).where(and(eq(messageReports.id, data.reportId), this.notNamingMe()));
      if (!r) throw new NotFoundError("Report");
      await tx.update(messageReports).set({ state: data.state, outcome: data.outcome ?? null, handledBy: this.ctx.userId, handledAt: new Date() }).where(eq(messageReports.id, r.id));
      if (data.state === "no_action") {
        const [open] = [...(await tx.execute(sql`select count(*)::int as n from message_reports where thread_id = ${r.threadId}::uuid and id <> ${r.id}::uuid and state in ('new', 'reviewing', 'action')`))] as { n: number }[];
        if (!open?.n) await tx.update(messageThreads).set({ heldAt: null }).where(eq(messageThreads.id, r.threadId));
      }
      if (r.reportedBy) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{
          userId: r.reportedBy, topic: "work.update" as const, title: "Update on your concern", body: REPORT_STATE_WORDS[data.state], href: "/app/messages/concerns",
          subject: { type: "report", id: r.id }, groupKey: `report:${r.id}`, privateBody: true,
        }]);
      }
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "report", id: r.id });
    }, () => ({ action: "handle", entity: "Report", entityId: data.reportId, summary: `Marked a concern: ${REPORT_STATE_WORDS[data.state]}` }));
  }

  // ---------- review ----------

  private async reviews(tx: Tx, threadId?: string): Promise<ReviewRow[]> {
    const rows = await tx.select({ v: messageReviews, subject: messageThreads.subject }).from(messageReviews).innerJoin(messageThreads, eq(messageThreads.id, messageReviews.threadId))
      .where(and(threadId ? eq(messageReviews.threadId, threadId) : undefined,
        // A person named in a report about a conversation does not learn from the log that it was reviewed.
        sql`not exists (select 1 from message_reports rp where rp.thread_id = ${messageReviews.threadId} and ${this.ctx.userId}::uuid = any(rp.about_user_ids))`))
      .orderBy(desc(messageReviews.createdAt)).limit(200);
    return rows.map(({ v, subject }) => ({ id: v.id, threadId: v.threadId, subject, reviewer: v.reviewerName, reason: v.reason, action: v.action, at: v.createdAt, reportId: v.reportId }));
  }

  /** Who opened which conversation, when and why. Nobody can edit or delete it, not even an admin. */
  async log(): Promise<ReviewRow[]> { return this.read("safeguard", (tx) => this.reviews(tx)); }

  /** Open a conversation the caller is not in. A typed reason is required every time and goes in the log; both sides are told once per review. */
  async open(input: unknown): Promise<ThreadData> {
    this.authorize("safeguard", "write");
    const data = this.parse(reviewInput, input);
    return this.write("safeguard", async (tx) => {
      const thread = await this.reviewable(tx, data.threadId);
      const [recent] = [...(await tx.execute(sql`select exists (select 1 from message_reviews where thread_id = ${thread.id}::uuid and reviewer_id = ${this.ctx.userId}::uuid and created_at > now() - make_interval(hours => ${REVIEW_HOURS})) as r`))] as { r: boolean }[];
      await tx.insert(messageReviews).values({ schoolId: this.ctx.schoolId, threadId: thread.id, reportId: data.reportId ?? null, reviewerId: this.ctx.userId, reviewerName: this.ctx.name, reason: data.reason, action: "opened" });
      if (data.reportId) await tx.update(messageReports).set({ state: "reviewing", handledBy: this.ctx.userId, handledAt: new Date() }).where(and(eq(messageReports.id, data.reportId), eq(messageReports.state, "new"), eq(messageReports.threadId, thread.id)));
      if (!recent?.r) await this.tellBothSides(tx, thread.id);
      return loadThread(tx, thread.id, { userId: this.ctx.userId, role: this.ctx.role, review: true }, { limit: 500 });
    }, () => ({ action: "review", entity: "Conversation", entityId: data.threadId, summary: "Opened a conversation for review" }));
  }

  /** The conversation, unless a report about it names the caller (then it is "not found", not "forbidden", so nothing is revealed). */
  private async reviewable(tx: Tx, threadId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw new NotFoundError("Conversation");
    const [t] = await tx.select().from(messageThreads).where(eq(messageThreads.id, threadId));
    if (!t || (await isNamed(tx, threadId, this.ctx.userId))) throw new NotFoundError("Conversation");
    return t;
  }

  private async tellBothSides(tx: Tx, threadId: string) {
    await postSystem(tx, this.ctx.schoolId, threadId, "The school reviewed this conversation to check it is safe.");
    const members = await tx.select({ id: threadMembers.userId }).from(threadMembers).where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.state, "active")));
    await NotificationWriter.insert(tx, this.ctx.schoolId, members.filter((m) => m.id && m.id !== this.ctx.userId).map((m) => ({
      userId: m.id!, topic: "work.update" as const, title: "The school reviewed a conversation you are in", body: "A safeguarding lead opened it to check it is safe.", href: `/app/messages?thread=${threadId}`, subject: { type: "thread", id: threadId },
    })));
  }

  /** The conversation again, while the review that was logged is still open (8 hours). Null when there is none: the screen then asks for a reason. */
  async viewing(threadId: string): Promise<ThreadData | null> {
    return this.read("safeguard", async (tx) => {
      const thread = await this.reviewable(tx, threadId);
      if (!(await hasActiveReview(tx, this.ctx.userId, thread.id))) return null;
      return loadThread(tx, thread.id, { userId: this.ctx.userId, role: this.ctx.role, review: true }, { limit: 500 });
    });
  }

  /** A logged copy of any conversation for the school's records. The reason goes in the log like an opening. */
  async exportPdf(input: unknown): Promise<{ name: string; bytes: Uint8Array }> {
    this.authorize("safeguard", "write");
    const data = this.parse(reviewInput, input);
    return this.write("safeguard", async (tx) => {
      const thread = await this.reviewable(tx, data.threadId);
      await tx.insert(messageReviews).values({ schoolId: this.ctx.schoolId, threadId: thread.id, reportId: data.reportId ?? null, reviewerId: this.ctx.userId, reviewerName: this.ctx.name, reason: data.reason, action: "exported" });
      const view = await loadThread(tx, thread.id, { userId: this.ctx.userId, role: this.ctx.role, review: true }, { limit: 5000 });
      const [school] = [...(await tx.execute(sql`select name from schools limit 1`))] as { name: string }[];
      return { name: `conversation-${thread.id.slice(0, 8)}.pdf`, bytes: await conversationPdf(view, { school: school?.name ?? "School", exportedBy: this.ctx.name, reason: data.reason }) };
    }, () => ({ action: "export", entity: "Conversation", entityId: data.threadId, summary: "Exported a conversation for review" }));
  }

  /** Outside help to show when no lead can be told: the school's own list. */
  async contacts() { return this.read("safeguard", async (tx) => (await loadCommSettings(tx)).safetyContacts); }

  // ---------- restrictions ----------

  /** People to pick for a limit: staff by name, families by the student's name. */
  async people(q: string): Promise<{ id: string; name: string; label: string }[]> {
    const t = q.trim().slice(0, 60);
    if (t.length < 2) return this.read("safeguard", async () => []);
    const like = `%${t.replace(/[\\%_]/g, "\\$&")}%`;
    return this.read("safeguard", async (tx) => [...(await tx.execute(sql`
      select u.id::text as id, u.name, case when u.role in ('student', 'parent') then 'Family of ' || coalesce(s.name, u.name) else initcap(u.role) end as label
      from users u left join students s on s.user_id = u.id
      where u.status = 'active' and u.id <> ${this.ctx.userId}::uuid and (u.name ilike ${like} or s.name ilike ${like}) order by u.name limit 10`))] as { id: string; name: string; label: string }[]);
  }

  async restrictions(): Promise<RestrictionRow[]> {
    return this.read("safeguard", async (tx) => {
      const today = istToday();
      const rows = await tx.select({ r: messageRestrictions, name: users.name, role: users.role }).from(messageRestrictions).innerJoin(users, eq(users.id, messageRestrictions.userId)).orderBy(desc(messageRestrictions.createdAt)).limit(200);
      return rows.map(({ r, name, role }) => ({ id: r.id, userId: r.userId, name, role, kind: r.kind, reason: r.reason, until: r.until, createdAt: r.createdAt, active: !r.liftedAt && r.until >= today }));
    });
  }

  /** Limit a family login or a staff member until a date. They are told. */
  async restrict(input: unknown): Promise<void> {
    this.authorize("safeguard", "write");
    const data = this.parse(restrictInput, input);
    if (data.until < istToday()) throw new ValidationError({ until: "Pick today or a later day" });
    if (data.userId === this.ctx.userId) throw new ForbiddenError("You cannot limit your own messages.");
    await this.write("safeguard", async (tx) => {
      const [p] = await tx.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.id, data.userId), eq(users.status, "active")));
      if (!p) throw new NotFoundError("Person");
      await tx.insert(messageRestrictions).values({ schoolId: this.ctx.schoolId, userId: p.id, kind: data.kind, reason: data.reason, until: data.until, createdBy: this.ctx.userId });
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{
        userId: p.id, topic: "work.update" as const, title: "Your messages are limited", body: `${RESTRICTION_WORDS[data.kind]}, until ${data.until}. ${isFamily(p.role) ? "Contact the school office if you have a question." : ""}`.trim(),
        href: "/app/messages", privateBody: true,
      }]);
    }, () => ({ action: "restrict", entity: "Person", entityId: data.userId, summary: `Limited messages until ${data.until}` }));
  }

  async lift(id: string): Promise<void> {
    await this.write("safeguard", async (tx) => {
      const rows = await tx.update(messageRestrictions).set({ liftedAt: new Date() }).where(and(eq(messageRestrictions.id, id), isNull(messageRestrictions.liftedAt))).returning({ userId: messageRestrictions.userId });
      if (!rows.length) throw new NotFoundError("Limit");
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: rows[0]!.userId, topic: "work.update" as const, title: "Your messages are back to normal", href: "/app/messages" }]);
    }, () => ({ action: "lift", entity: "Limit", entityId: id, summary: "Lifted a message limit" }));
  }
}
