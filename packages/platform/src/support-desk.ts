import { max } from "drizzle-orm";
import {
  and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, plans, platformStaff, schoolSetupStatus, schools, sql, supportFiles, supportMessages,
  supportNotes, supportSavedReplies, supportTickets, supportViews, supportVisits, users, TICKET_CATEGORIES, type Tx,
} from "@smw/db";
import { ConflictError, NotFoundError, PlatformService, TICKET_FILE_RULES, TICKET_PRIORITIES, ValidationError, filesTotalProblem, listQuerySchema, slaState, toPage, type ListQuery, type SlaState } from "@smw/feature-kit";
import { services, storeTicketFile, UploadError } from "@smw/integrations";
import { z } from "zod";
import { assertId, noteInput, oneOf, replyInput, savedReplyInput } from "./inputs";

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export { TICKET_PRIORITIES };
/** The queue's ready-made views. */
export const TICKET_VIEWS = ["new", "mine", "waiting_us", "overdue", "waiting_school", "solved"] as const;
type Status = (typeof TICKET_STATUSES)[number];
type Priority = (typeof TICKET_PRIORITIES)[number];
type Category = (typeof TICKET_CATEGORIES)[number];
export type TicketView = (typeof TICKET_VIEWS)[number];
export interface DeskFile { name: string; type: string; size: number; bytes: Uint8Array }

const LINK_SECONDS = 60;

/** The same first-reply rule the school pages use. */
export const deskSla = slaState;
export type DeskSla = SlaState;

const likeEscape = (s: string) => s.replace(/[%_\\]/g, "\\$&");

/** Tickets from every school: queue, thread, files, notes, saved replies, owner, category, reports. */
export class SupportDeskService extends PlatformService {
  private views(now: Date) {
    const live = inArray(supportTickets.status, ["open", "pending"]);
    return {
      new: and(eq(supportTickets.status, "open"), isNull(supportTickets.firstReplyAt)),
      mine: and(eq(supportTickets.assignedStaffId, this.ctx.staffId), live),
      waiting_us: eq(supportTickets.status, "open"),
      overdue: and(live, isNull(supportTickets.firstReplyAt), isNotNull(supportTickets.replyDueAt), lt(supportTickets.replyDueAt, now)),
      waiting_school: eq(supportTickets.status, "pending"),
      solved: eq(supportTickets.status, "resolved"),
    } as const;
  }

  /**
   * The queue. Search `q`: subject, number (`T-1042`), school name, or words in any message. Filters: `view`, `status`, `priority`, `category`,
   * `assigned` = `me` | `none` | a staff id, `school`, `plan`. A view sorts by what matters in it (overdue: oldest due first).
   */
  async list(query: ListQuery = {}) {
    this.require("owner", "support");
    const q = listQuerySchema.parse(query);
    const now = new Date();
    const status = oneOf(q.filters.status, TICKET_STATUSES), priority = oneOf(q.filters.priority, TICKET_PRIORITIES), view = oneOf(q.filters.view, TICKET_VIEWS);
    const category = oneOf(q.filters.category, TICKET_CATEGORIES);
    const assigned = q.filters.assigned;
    const num = q.q ? /^t?-?(\d{1,9})$/i.exec(q.q)?.[1] : undefined;
    const like = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const where = and(
      status ? eq(supportTickets.status, status) : undefined,
      priority ? eq(supportTickets.priority, priority) : undefined,
      category ? eq(supportTickets.category, category) : undefined,
      view ? this.views(now)[view] : undefined,
      assigned === "me" ? eq(supportTickets.assignedStaffId, this.ctx.staffId) : assigned === "none" ? isNull(supportTickets.assignedStaffId) : assigned ? eq(supportTickets.assignedStaffId, assertId(assigned, "Staff member")) : undefined,
      q.filters.school ? eq(supportTickets.schoolId, assertId(q.filters.school, "School")) : undefined,
      q.filters.plan ? eq(plans.key, q.filters.plan) : undefined,
      like ? or(
        ilike(supportTickets.subject, like), ilike(schools.name, like), num ? eq(supportTickets.number, Number(num)) : undefined,
        sql`exists (select 1 from support_messages sm where sm.ticket_id = ${supportTickets.id} and sm.body ilike ${like})`,
      ) : undefined,
    );
    const order = view === "overdue" ? [asc(supportTickets.replyDueAt)] : view === "new" ? [asc(supportTickets.createdAt)] : [desc(supportTickets.lastMessageAt)];
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, status: supportTickets.status, priority: supportTickets.priority,
          category: supportTickets.category, lastMessageAt: supportTickets.lastMessageAt, createdAt: supportTickets.createdAt, schoolName: schools.name, schoolId: supportTickets.schoolId,
          assignee: platformStaff.name, planKey: plans.key, replyDueAt: supportTickets.replyDueAt, firstReplyAt: supportTickets.firstReplyAt,
        }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(plans, eq(plans.id, schools.planId))
          .leftJoin(platformStaff, eq(platformStaff.id, supportTickets.assignedStaffId))
          .where(where).orderBy(...order, supportTickets.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(plans, eq(plans.id, schools.planId)).where(where),
      ]);
      return toPage(rows.map((r) => ({ ...r, sla: deskSla(r, now) })), Number(total[0]?.n ?? 0), q);
    });
  }

  /** How many tickets sit in each ready-made view, for the tabs above the queue. */
  async viewCounts(): Promise<Record<TicketView, number>> {
    this.require("owner", "support");
    const v = this.views(new Date());
    return this.tx(async (tx) => {
      const out = {} as Record<TicketView, number>;
      await Promise.all(TICKET_VIEWS.map(async (k) => { out[k] = Number((await tx.select({ n: count() }).from(supportTickets).where(v[k]))[0]?.n ?? 0); }));
      return out;
    });
  }

  async thread(ticketId: string) {
    this.require("owner", "support");
    return this.tx(async (tx) => {
      assertId(ticketId, "Ticket");
      const [ticket] = await tx.select({ t: supportTickets, schoolName: schools.name, schoolSlug: schools.slug, schoolStatus: schools.status, supportAccess: schools.supportAccess, supportAccessUntil: schools.supportAccessUntil, planKey: plans.key, planName: plans.name, assignee: platformStaff.name })
        .from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(plans, eq(plans.id, schools.planId)).leftJoin(platformStaff, eq(platformStaff.id, supportTickets.assignedStaffId))
        .where(eq(supportTickets.id, ticketId)).limit(1);
      if (!ticket) throw new NotFoundError("Ticket");
      const schoolId = ticket.t.schoolId;
      const [messages, files, notes, card, earlier, staff, replies] = await Promise.all([
        tx.select({
          id: supportMessages.id, body: supportMessages.body, createdAt: supportMessages.createdAt,
          staffName: platformStaff.name, userName: users.name, fromStaff: supportMessages.authorStaffId,
        }).from(supportMessages).leftJoin(platformStaff, eq(platformStaff.id, supportMessages.authorStaffId)).leftJoin(users, eq(users.id, supportMessages.authorUserId))
          .where(eq(supportMessages.ticketId, ticketId)).orderBy(supportMessages.createdAt, supportMessages.id),
        tx.select().from(supportFiles).where(eq(supportFiles.ticketId, ticketId)).orderBy(supportFiles.createdAt),
        tx.select({ id: supportNotes.id, body: supportNotes.body, createdAt: supportNotes.createdAt, staffName: platformStaff.name }).from(supportNotes).leftJoin(platformStaff, eq(platformStaff.id, supportNotes.staffId))
          .where(eq(supportNotes.ticketId, ticketId)).orderBy(supportNotes.createdAt),
        this.schoolCard(tx, schoolId),
        tx.select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, status: supportTickets.status, createdAt: supportTickets.createdAt })
          .from(supportTickets).where(and(eq(supportTickets.schoolId, schoolId), sql`${supportTickets.id} <> ${ticketId}`)).orderBy(desc(supportTickets.createdAt)).limit(6),
        tx.select({ id: platformStaff.id, name: platformStaff.name, role: platformStaff.role }).from(platformStaff).where(and(eq(platformStaff.status, "active"), inArray(platformStaff.role, ["owner", "support"]))).orderBy(platformStaff.name),
        tx.select().from(supportSavedReplies).orderBy(supportSavedReplies.title),
      ]);
      return { ...ticket, messages, files, notes, card, earlier, staff, savedReplies: replies, sla: deskSla(ticket.t) };
    });
  }

  /** Plan, status, setup percent, open tickets, last sign-in: what staff need to know about the asking school. */
  private async schoolCard(tx: Tx, schoolId: string) {
    const [setup, open, login] = await Promise.all([
      tx.select({ percent: schoolSetupStatus.percent, nextLabel: schoolSetupStatus.nextLabel }).from(schoolSetupStatus).where(eq(schoolSetupStatus.schoolId, schoolId)).limit(1),
      tx.select({ n: count() }).from(supportTickets).where(and(eq(supportTickets.schoolId, schoolId), inArray(supportTickets.status, ["open", "pending"]))),
      tx.select({ at: max(users.lastLoginAt) }).from(users).where(eq(users.schoolId, schoolId)),
    ]);
    return { setupPercent: setup[0]?.percent ?? null, nextStep: setup[0]?.nextLabel ?? null, openTickets: Number(open[0]?.n ?? 0), lastSignIn: login[0]?.at ?? null };
  }

  /**
   * Staff reply, with files. An open ticket becomes `pending` (waiting on the school) and its pending clock starts; `solve` marks it solved instead.
   * The first staff reply is the "first reply" the target is measured against. The sender takes the ticket if nobody has.
   */
  async reply(ticketId: string, input: unknown, files: DeskFile[] = []) {
    this.require("owner", "support");
    const d = this.parse(replyInput, input);
    assertId(ticketId, "Ticket");
    if (files.length > TICKET_FILE_RULES.maxFiles) throw new ValidationError({ files: `Attach up to ${TICKET_FILE_RULES.maxFiles} files` });
    const tooMuch = filesTotalProblem(files.map((f) => f.size));
    if (tooMuch) throw new ValidationError({ files: tooMuch });
    const [exists] = await this.tx((tx) => tx.select({ schoolId: supportTickets.schoolId }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1));
    if (!exists) throw new NotFoundError("Ticket");
    const stored = await Promise.all(files.map((f) => this.store(exists.schoolId, ticketId, f)));
    return this.tx(async (tx) => {
      const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for("update");
      if (!t) throw new NotFoundError("Ticket");
      if (t.status === "closed") throw new ConflictError("This ticket is closed. Reopen it to answer.");
      const now = new Date();
      const [m] = await tx.insert(supportMessages).values({ schoolId: t.schoolId, ticketId, authorStaffId: this.ctx.staffId, staffName: this.ctx.name, body: d.body }).returning({ id: supportMessages.id });
      if (stored.length) await tx.insert(supportFiles).values(stored.map((s) => ({ schoolId: t.schoolId, ticketId, messageId: m!.id, fileKey: s.key, fileName: s.file.name.slice(0, 120), contentType: s.file.type, size: s.file.size })));
      const status: Status = d.solve ? "resolved" : t.status === "open" ? "pending" : t.status;
      await tx.update(supportTickets).set({
        lastMessageAt: now, status, assignedStaffId: t.assignedStaffId ?? this.ctx.staffId, updatedAt: now,
        firstReplyAt: t.firstReplyAt ?? now,
        ...(status === "pending" ? { pendingSince: t.status === "pending" ? t.pendingSince ?? now : now, remindedAt: null } : { pendingSince: null }),
        ...(d.solve ? { resolvedAt: now } : {}),
      }).where(eq(supportTickets.id, ticketId));
      await this.audit(tx, "ticket.reply", `Replied to "${t.subject}"${d.solve ? " and marked it solved" : ""}`, t.schoolId, { ticketId });
    });
  }

  /** A note only staff see. It sits in a table the school's database role cannot read. */
  async addNote(ticketId: string, input: unknown) {
    this.require("owner", "support");
    const d = this.parse(noteInput, input);
    assertId(ticketId, "Ticket");
    return this.tx(async (tx) => {
      const [t] = await tx.select({ schoolId: supportTickets.schoolId, subject: supportTickets.subject }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
      if (!t) throw new NotFoundError("Ticket");
      await tx.insert(supportNotes).values({ ticketId, staffId: this.ctx.staffId, body: d.body });
      await this.audit(tx, "ticket.note", `Added a note to "${t.subject}"`, t.schoolId, { ticketId });
    });
  }

  async setStatus(ticketId: string, status: Status) {
    this.require("owner", "support");
    const s = this.parse(z.enum(TICKET_STATUSES), status);
    const now = new Date();
    return this.update(ticketId, {
      status: s, ...(s === "resolved" ? { resolvedAt: now, pendingSince: null } : s === "closed" ? { closedAt: now, pendingSince: null } : s === "pending" ? { pendingSince: now, remindedAt: null } : { resolvedAt: null, closedAt: null, pendingSince: null }),
    }, "ticket.status", `Marked ticket {subject} ${s}`);
  }

  /**
   * Change how urgent it is. `dueFor` gives the new reply-by time from the ticket and its plan (the clock's working-hours rule lives in the support feature);
   * it is used only while nobody has replied yet.
   */
  async setPriority(ticketId: string, priority: Priority, dueFor?: (t: { createdAt: Date; planKey: string | null }) => Date) {
    this.require("owner", "support");
    const p = this.parse(z.enum(TICKET_PRIORITIES), priority);
    assertId(ticketId, "Ticket");
    const due = dueFor ? await this.tx(async (tx) => {
      const [t] = await tx.select({ createdAt: supportTickets.createdAt, first: supportTickets.firstReplyAt, planKey: plans.key }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(plans, eq(plans.id, schools.planId)).where(eq(supportTickets.id, ticketId)).limit(1);
      return t && !t.first ? dueFor(t) : undefined;
    }) : undefined;
    return this.update(ticketId, { priority: p, ...(due ? { replyDueAt: due, overdueToldAt: null } : {}) }, "ticket.priority", `Set ticket {subject} to ${p} priority`);
  }

  async setCategory(ticketId: string, category: Category) {
    this.require("owner", "support");
    const c = this.parse(z.enum(TICKET_CATEGORIES), category);
    return this.update(ticketId, { category: c }, "ticket.category", `Set ticket {subject} to ${c}`);
  }

  /** Take the ticket (or hand it to anyone on the team with `staffId`; `null` unassigns). */
  async assign(ticketId: string, staffId: string | null = this.ctx.staffId) {
    this.require("owner", "support");
    if (staffId) {
      assertId(staffId, "Staff member");
      const [s] = await this.tx((tx) => tx.select({ id: platformStaff.id }).from(platformStaff).where(and(eq(platformStaff.id, staffId), eq(platformStaff.status, "active"))).limit(1));
      if (!s) throw new NotFoundError("Staff member");
    }
    return this.update(ticketId, { assignedStaffId: staffId }, "ticket.assign", "Assigned ticket {subject}");
  }

  private update(ticketId: string, set: Partial<typeof supportTickets.$inferInsert>, action: string, summary: string) {
    assertId(ticketId, "Ticket");
    return this.tx(async (tx) => {
      const [t] = await tx.update(supportTickets).set({ ...set, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId)).returning();
      if (!t) throw new NotFoundError("Ticket");
      await this.audit(tx, action, summary.replace("{subject}", `"${t.subject}"`), t.schoolId, { ticketId });
      return t;
    });
  }

  // ---- files ----

  private async store(schoolId: string, ticketId: string, file: DeskFile) {
    try { return { key: await storeTicketFile(schoolId, ticketId, file), file }; }
    catch (e) { if (e instanceof UploadError) throw new ValidationError({ files: e.message }); throw e; }
  }

  /** A 60-second link to a ticket file, for the console file route. */
  async fileUrl(fileId: string): Promise<{ url: string; name: string; contentType: string; key: string }> {
    this.require("owner", "support");
    assertId(fileId, "File");
    const [f] = await this.tx((tx) => tx.select().from(supportFiles).where(eq(supportFiles.id, fileId)).limit(1));
    if (!f) throw new NotFoundError("File");
    return { url: await services().storage.signedUrl(f.fileKey, LINK_SECONDS), name: f.fileName, contentType: f.contentType, key: f.fileKey };
  }

  async fileBytes(fileId: string) {
    const f = await this.fileUrl(fileId);
    return { bytes: await services().storage.get(f.key), name: f.name, contentType: f.contentType };
  }

  // ---- saved replies (console only) ----

  async savedReplies() {
    this.require("owner", "support");
    return this.tx((tx) => tx.select().from(supportSavedReplies).orderBy(supportSavedReplies.title));
  }

  async saveReply(id: string | undefined, input: unknown) {
    this.require("owner", "support");
    const d = this.parse(savedReplyInput, input);
    return this.tx(async (tx) => {
      if (id) {
        assertId(id, "Saved reply");
        const [r] = await tx.update(supportSavedReplies).set({ title: d.title, body: d.body }).where(eq(supportSavedReplies.id, id)).returning();
        if (!r) throw new NotFoundError("Saved reply");
        return r;
      }
      const [r] = await tx.insert(supportSavedReplies).values({ title: d.title, body: d.body, createdBy: this.ctx.staffId }).returning();
      return r!;
    });
  }

  async deleteReply(id: string) {
    this.require("owner", "support");
    assertId(id, "Saved reply");
    await this.tx((tx) => tx.delete(supportSavedReplies).where(eq(supportSavedReplies.id, id)));
  }

  // ---- reports ----

  /**
   * Volume by category and school, first reply and resolution times (median and 90th percentile, in hours), ratings, help article votes.
   * `days` looks back from now (default 30).
   */
  async report(days = 30) {
    this.require("owner", "support");
    const since = new Date(Date.now() - Math.min(Math.max(Math.trunc(days) || 30, 1), 365) * 86_400_000);
    return this.tx(async (tx) => {
      const inRange = gte(supportTickets.createdAt, since);
      const hours = (a: typeof supportTickets.firstReplyAt | typeof supportTickets.resolvedAt, p: number) => sql<number | null>`percentile_cont(${p}) within group (order by extract(epoch from (${a} - ${supportTickets.createdAt})) / 3600.0)`;
      const [byCategory, bySchool, firstReply, resolution, rating, sla, votes, total] = await Promise.all([
        tx.select({ category: supportTickets.category, n: count() }).from(supportTickets).where(inRange).groupBy(supportTickets.category).orderBy(desc(count())),
        tx.select({ schoolId: supportTickets.schoolId, school: schools.name, n: count() }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).where(inRange).groupBy(supportTickets.schoolId, schools.name).orderBy(desc(count())).limit(10),
        tx.select({ median: hours(supportTickets.firstReplyAt, 0.5), p90: hours(supportTickets.firstReplyAt, 0.9), n: count() }).from(supportTickets).where(and(inRange, isNotNull(supportTickets.firstReplyAt))),
        tx.select({ median: hours(supportTickets.resolvedAt, 0.5), p90: hours(supportTickets.resolvedAt, 0.9), n: count() }).from(supportTickets).where(and(inRange, isNotNull(supportTickets.resolvedAt))),
        tx.select({ avg: sql<number | null>`avg(${supportTickets.rating})::float`, n: count() }).from(supportTickets).where(and(inRange, isNotNull(supportTickets.rating))),
        tx.select({ met: sql<number>`count(*) filter (where ${supportTickets.firstReplyAt} <= ${supportTickets.replyDueAt})`, n: sql<number>`count(*) filter (where ${supportTickets.replyDueAt} is not null and (${supportTickets.firstReplyAt} is not null or ${supportTickets.replyDueAt} < now()))` }).from(supportTickets).where(inRange),
        tx.select({ article: supportViews.article, yes: sql<number>`count(*) filter (where ${supportViews.useful})`, no: sql<number>`count(*) filter (where not ${supportViews.useful})` }).from(supportViews).where(and(gte(supportViews.createdAt, since), isNotNull(supportViews.useful))).groupBy(supportViews.article).orderBy(desc(sql`count(*) filter (where not ${supportViews.useful})`)).limit(10),
        tx.select({ n: count() }).from(supportTickets).where(inRange),
      ]);
      const num = (v: unknown) => (v == null ? null : Number(v));
      return {
        since, total: Number(total[0]?.n ?? 0),
        byCategory: byCategory.map((r) => ({ category: r.category, n: Number(r.n) })),
        bySchool: bySchool.map((r) => ({ schoolId: r.schoolId, school: r.school, n: Number(r.n) })),
        firstReply: { medianHours: num(firstReply[0]?.median), p90Hours: num(firstReply[0]?.p90), n: Number(firstReply[0]?.n ?? 0) },
        resolution: { medianHours: num(resolution[0]?.median), p90Hours: num(resolution[0]?.p90), n: Number(resolution[0]?.n ?? 0) },
        rating: { average: num(rating[0]?.avg), n: Number(rating[0]?.n ?? 0) },
        slaMetPercent: Number(sla[0]?.n ?? 0) ? Math.round((Number(sla[0]?.met ?? 0) / Number(sla[0]?.n)) * 100) : null,
        notUseful: votes.map((v) => ({ article: v.article, yes: Number(v.yes), no: Number(v.no) })),
      };
    });
  }

  /** What a school has been told by staff visits, newest first (the school sees the same list). */
  async visits(schoolId: string, limit = 20) {
    this.require("owner", "support", "sales");
    assertId(schoolId, "School");
    return this.tx((tx) => tx.select().from(supportVisits).where(eq(supportVisits.schoolId, schoolId)).orderBy(desc(supportVisits.createdAt)).limit(limit));
  }
}
